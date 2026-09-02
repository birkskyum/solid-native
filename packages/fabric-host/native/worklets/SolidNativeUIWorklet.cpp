#include "SolidNativeUIWorklet.h"

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <stdexcept>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace solid_native::worklets {
namespace {

using Dynamic = folly::dynamic;

bool isIdentifier(std::string_view value) {
  if (value.empty() || value.size() > 64) return false;
  const auto isLetter = [](char character) {
    return (character >= 'A' && character <= 'Z') ||
        (character >= 'a' && character <= 'z');
  };
  if (!isLetter(value.front())) return false;
  return std::all_of(
      value.begin() + 1,
      value.end(),
      [&](char character) {
        return isLetter(character) ||
            (character >= '0' && character <= '9') || character == '.' ||
            character == '_' || character == '-';
      });
}

void requireExactObject(
    const Dynamic &value,
    std::initializer_list<std::string_view> keys,
    const std::string &context) {
  if (!value.isObject()) {
    throw std::invalid_argument(context + " must be a plain object.");
  }
  if (value.size() != keys.size()) {
    for (const auto &item : value.items()) {
      if (!item.first.isString()) {
        throw std::invalid_argument(
            context + " contains a non-string field.");
      }
      const auto &candidate = item.first.getString();
      if (std::none_of(
              keys.begin(),
              keys.end(),
              [&](std::string_view key) { return candidate == key; })) {
        throw std::invalid_argument(
            context + " contains unsupported field " + candidate + ".");
      }
    }
  }
  for (const auto key : keys) {
    if (value.count(std::string{key}) == 0) {
      throw std::invalid_argument(
          context + " is missing field " + std::string{key} + ".");
    }
  }
  if (value.size() != keys.size()) {
    throw std::invalid_argument(context + " contains duplicate fields.");
  }
}

double requireFiniteNumber(
    const Dynamic &value,
    const std::string &context) {
  if (!value.isNumber()) {
    throw std::invalid_argument(context + " must be a finite number.");
  }
  const auto number = value.asDouble();
  if (!std::isfinite(number)) {
    throw std::invalid_argument(context + " must be a finite number.");
  }
  return number;
}

std::string requireIdentifier(
    const Dynamic &value,
    const std::string &context) {
  if (!value.isString() || !isIdentifier(value.getString())) {
    throw std::invalid_argument(
        context + " must be an identifier of 1 to 64 ASCII characters.");
  }
  return value.getString();
}

std::pair<double, double> requireRange(
    const Dynamic &value,
    const std::string &context,
    bool strictlyAscending) {
  if (!value.isArray() || value.size() != 2) {
    throw std::invalid_argument(
        context + " must contain exactly two numbers.");
  }
  const auto lower = requireFiniteNumber(value.at(0), context + "[0]");
  const auto upper = requireFiniteNumber(value.at(1), context + "[1]");
  if (strictlyAscending && upper <= lower) {
    throw std::invalid_argument(context + " must be strictly ascending.");
  }
  return {lower, upper};
}

struct ParseBudget final {
  size_t nodes{0};
};

using Operation = UIWorkletGraph::Operation;
using Instruction = UIWorkletGraph::Instruction;

void parseExpression(
    const Dynamic &value,
    const std::unordered_map<std::string, size_t> &inputs,
    ParseBudget &budget,
    size_t depth,
    const std::string &context,
    std::vector<Instruction> &instructions) {
  if (depth > MaximumUIWorkletExpressionDepth) {
    throw std::invalid_argument(
        context + " exceeds the maximum worklet expression depth of " +
        std::to_string(MaximumUIWorkletExpressionDepth) + ".");
  }
  if (++budget.nodes > MaximumUIWorkletExpressionNodes) {
    throw std::invalid_argument(
        "The worklet graph exceeds " +
        std::to_string(MaximumUIWorkletExpressionNodes) +
        " expression nodes.");
  }
  if (!value.isObject() || value.count("kind") == 0 ||
      !value.at("kind").isString()) {
    throw std::invalid_argument(context + ".kind is unsupported.");
  }
  const auto &kind = value.at("kind").getString();
  if (kind == "constant") {
    requireExactObject(value, {"kind", "value"}, context);
    instructions.push_back({
        .operation = Operation::Constant,
        .first = requireFiniteNumber(value.at("value"), context + ".value"),
    });
    return;
  }
  if (kind == "input") {
    requireExactObject(value, {"kind", "name"}, context);
    const auto name = requireIdentifier(value.at("name"), context + ".name");
    const auto input = inputs.find(name);
    if (input == inputs.end()) {
      throw std::invalid_argument(
          context + " references undeclared worklet input " + name + ".");
    }
    instructions.push_back({
        .operation = Operation::Input,
        .input = input->second,
    });
    return;
  }
  if (kind == "binary") {
    requireExactObject(
        value, {"kind", "operator", "left", "right"}, context);
    if (!value.at("operator").isString()) {
      throw std::invalid_argument(context + ".operator is unsupported.");
    }
    const auto &name = value.at("operator").getString();
    Operation operation;
    if (name == "add") {
      operation = Operation::Add;
    } else if (name == "subtract") {
      operation = Operation::Subtract;
    } else if (name == "multiply") {
      operation = Operation::Multiply;
    } else if (name == "divide") {
      operation = Operation::Divide;
    } else if (name == "min") {
      operation = Operation::Minimum;
    } else if (name == "max") {
      operation = Operation::Maximum;
    } else {
      throw std::invalid_argument(context + ".operator is unsupported.");
    }
    parseExpression(
        value.at("left"),
        inputs,
        budget,
        depth + 1,
        context + ".left",
        instructions);
    parseExpression(
        value.at("right"),
        inputs,
        budget,
        depth + 1,
        context + ".right",
        instructions);
    instructions.push_back({.operation = operation});
    return;
  }
  if (kind == "abs" || kind == "negate") {
    requireExactObject(value, {"kind", "value"}, context);
    parseExpression(
        value.at("value"),
        inputs,
        budget,
        depth + 1,
        context + ".value",
        instructions);
    instructions.push_back({
        .operation = kind == "abs" ? Operation::Absolute : Operation::Negate,
    });
    return;
  }
  if (kind == "clamp") {
    requireExactObject(value, {"kind", "value", "min", "max"}, context);
    const auto minimum =
        requireFiniteNumber(value.at("min"), context + ".min");
    const auto maximum =
        requireFiniteNumber(value.at("max"), context + ".max");
    if (maximum < minimum) {
      throw std::invalid_argument(
          context + " clamp bounds must be ascending.");
    }
    parseExpression(
        value.at("value"),
        inputs,
        budget,
        depth + 1,
        context + ".value",
        instructions);
    instructions.push_back({
        .operation = Operation::Clamp,
        .first = minimum,
        .second = maximum,
    });
    return;
  }
  if (kind == "interpolate") {
    requireExactObject(
        value,
        {"kind", "value", "inputRange", "outputRange", "extrapolate"},
        context);
    if (!value.at("extrapolate").isString() ||
        (value.at("extrapolate").getString() != "clamp" &&
         value.at("extrapolate").getString() != "extend")) {
      throw std::invalid_argument(
          context + ".extrapolate must be clamp or extend.");
    }
    const auto inputRange = requireRange(
        value.at("inputRange"), context + ".inputRange", true);
    const auto outputRange = requireRange(
        value.at("outputRange"), context + ".outputRange", false);
    parseExpression(
        value.at("value"),
        inputs,
        budget,
        depth + 1,
        context + ".value",
        instructions);
    instructions.push_back({
        .operation = Operation::Interpolate,
        .first = inputRange.first,
        .second = inputRange.second,
        .third = outputRange.first,
        .fourth = outputRange.second,
        .clamp = value.at("extrapolate").getString() == "clamp",
    });
    return;
  }
  throw std::invalid_argument(context + ".kind is unsupported.");
}

double pop(std::vector<double> &stack) {
  if (stack.empty()) {
    throw std::logic_error("The UI worklet instruction stack underflowed.");
  }
  const auto value = stack.back();
  stack.pop_back();
  return value;
}

} // namespace

UIWorkletTiming UIWorkletTiming::parse(const Dynamic &value) {
  requireExactObject(
      value,
      {"durationMilliseconds", "easing"},
      "UI worklet timing");
  const auto duration = requireFiniteNumber(
      value.at("durationMilliseconds"),
      "UI worklet timing duration");
  if (duration <= 0 ||
      duration > MaximumUIWorkletTimingDurationMilliseconds) {
    throw std::invalid_argument(
        "UI worklet timing duration must be greater than zero and at most " +
        std::to_string(MaximumUIWorkletTimingDurationMilliseconds) +
        " milliseconds.");
  }
  if (!value.at("easing").isString()) {
    throw std::invalid_argument("UI worklet timing easing is unsupported.");
  }
  const auto &name = value.at("easing").getString();
  UIWorkletTimingEasing easing;
  if (name == "linear") {
    easing = UIWorkletTimingEasing::Linear;
  } else if (name == "ease-in") {
    easing = UIWorkletTimingEasing::EaseIn;
  } else if (name == "ease-out") {
    easing = UIWorkletTimingEasing::EaseOut;
  } else if (name == "ease-in-out") {
    easing = UIWorkletTimingEasing::EaseInOut;
  } else {
    throw std::invalid_argument("UI worklet timing easing is unsupported.");
  }
  return {.durationMilliseconds = duration, .easing = easing};
}

double UIWorkletTiming::evaluateProgress(double elapsedMilliseconds) const {
  if (!std::isfinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw std::invalid_argument(
        "UI worklet timing elapsed time must be finite and non-negative.");
  }
  const auto progress =
      std::min(1.0, elapsedMilliseconds / durationMilliseconds);
  switch (easing) {
    case UIWorkletTimingEasing::Linear:
      return progress;
    case UIWorkletTimingEasing::EaseIn:
      return progress * progress;
    case UIWorkletTimingEasing::EaseOut:
      return 1 - (1 - progress) * (1 - progress);
    case UIWorkletTimingEasing::EaseInOut:
      return progress < 0.5
          ? 2 * progress * progress
          : 1 - ((-2 * progress + 2) * (-2 * progress + 2)) / 2;
  }
  throw std::logic_error("The UI worklet timing easing is invalid.");
}

UIWorkletTimingSequence UIWorkletTimingSequence::parse(
    const Dynamic &value,
    size_t inputCount) {
  if (!value.isArray() || value.empty() ||
      value.size() > MaximumUIWorkletTimingKeyframes) {
    throw std::invalid_argument(
        "UI worklet timing keyframes must contain between 1 and " +
        std::to_string(MaximumUIWorkletTimingKeyframes) + " steps.");
  }
  std::vector<UIWorkletTimingKeyframe> keyframes;
  keyframes.reserve(value.size());
  double totalDurationMilliseconds = 0;
  for (size_t index = 0; index < value.size(); ++index) {
    const auto context =
        "UI worklet timing keyframe " + std::to_string(index);
    const auto &keyframe = value.at(index);
    requireExactObject(keyframe, {"inputs", "timing"}, context);
    const auto &inputValues = keyframe.at("inputs");
    if (!inputValues.isArray() || inputValues.size() != inputCount) {
      throw std::invalid_argument(
          context + " inputs must match the installed graph.");
    }
    std::vector<double> inputs;
    inputs.reserve(inputCount);
    for (size_t inputIndex = 0; inputIndex < inputCount; ++inputIndex) {
      inputs.push_back(requireFiniteNumber(
          inputValues.at(inputIndex),
          context + " input " + std::to_string(inputIndex)));
    }
    auto timing = UIWorkletTiming::parse(keyframe.at("timing"));
    totalDurationMilliseconds += timing.durationMilliseconds;
    if (!std::isfinite(totalDurationMilliseconds) ||
        totalDurationMilliseconds >
            MaximumUIWorkletTimingDurationMilliseconds) {
      throw std::invalid_argument(
          "UI worklet timing keyframes exceed the maximum total duration.");
    }
    keyframes.push_back(UIWorkletTimingKeyframe{
        .inputs = std::move(inputs),
        .timing = timing,
    });
  }
  return {
      .keyframes = std::move(keyframes),
      .totalDurationMilliseconds = totalDurationMilliseconds,
  };
}

UIWorkletTimingSequenceSample UIWorkletTimingSequence::evaluate(
    const std::vector<double> &from,
    double elapsedMilliseconds) const {
  if (keyframes.empty() || !std::isfinite(elapsedMilliseconds) ||
      elapsedMilliseconds < 0 ||
      from.size() != keyframes.front().inputs.size()) {
    throw std::invalid_argument(
        "UI worklet timing keyframe evaluation is invalid.");
  }
  if (elapsedMilliseconds >= totalDurationMilliseconds) {
    return {
        .inputs = keyframes.back().inputs,
        .progress = 1,
        .settled = true,
    };
  }
  auto remaining = elapsedMilliseconds;
  double completedDurationMilliseconds = 0;
  const std::vector<double> *segmentFrom = &from;
  for (size_t index = 0; index < keyframes.size(); ++index) {
    const auto &keyframe = keyframes.at(index);
    const auto last = index == keyframes.size() - 1;
    if (!last && remaining >= keyframe.timing.durationMilliseconds) {
      remaining -= keyframe.timing.durationMilliseconds;
      completedDurationMilliseconds += keyframe.timing.durationMilliseconds;
      segmentFrom = &keyframe.inputs;
      continue;
    }
    const auto localProgress = keyframe.timing.evaluateProgress(remaining);
    return {
        .inputs = interpolateUIWorkletInputs(
            *segmentFrom, keyframe.inputs, localProgress),
        .progress =
            (completedDurationMilliseconds +
             localProgress * keyframe.timing.durationMilliseconds) /
            totalDurationMilliseconds,
        .settled = false,
    };
  }
  throw std::logic_error("UI worklet timing keyframes are empty.");
}

UIWorkletSpring UIWorkletSpring::parse(const Dynamic &value) {
  requireExactObject(
      value,
      {
          "mass",
          "stiffness",
          "damping",
          "initialVelocity",
          "restSpeedThreshold",
          "restDisplacementThreshold",
          "maximumDurationMilliseconds",
      },
      "UI worklet spring");
  const auto mass =
      requireFiniteNumber(value.at("mass"), "UI worklet spring mass");
  const auto stiffness = requireFiniteNumber(
      value.at("stiffness"), "UI worklet spring stiffness");
  const auto damping = requireFiniteNumber(
      value.at("damping"), "UI worklet spring damping");
  const auto initialVelocity = requireFiniteNumber(
      value.at("initialVelocity"),
      "UI worklet spring initial velocity");
  const auto restSpeedThreshold = requireFiniteNumber(
      value.at("restSpeedThreshold"),
      "UI worklet spring rest speed threshold");
  const auto restDisplacementThreshold = requireFiniteNumber(
      value.at("restDisplacementThreshold"),
      "UI worklet spring rest displacement threshold");
  const auto maximumDurationMilliseconds = requireFiniteNumber(
      value.at("maximumDurationMilliseconds"),
      "UI worklet spring maximum duration");
  if (mass < MinimumUIWorkletSpringMass ||
      mass > MaximumUIWorkletSpringMass) {
    throw std::invalid_argument(
        "UI worklet spring mass is outside its bounded range.");
  }
  if (stiffness < MinimumUIWorkletSpringStiffness ||
      stiffness > MaximumUIWorkletSpringStiffness) {
    throw std::invalid_argument(
        "UI worklet spring stiffness is outside its bounded range.");
  }
  if (damping < 0 || damping > MaximumUIWorkletSpringDamping) {
    throw std::invalid_argument(
        "UI worklet spring damping is outside its bounded range.");
  }
  if (std::abs(initialVelocity) >
      MaximumUIWorkletSpringInitialVelocity) {
    throw std::invalid_argument(
        "UI worklet spring initial velocity is outside its bounded range.");
  }
  if (restSpeedThreshold <= 0 ||
      restSpeedThreshold > MaximumUIWorkletSpringRestSpeed) {
    throw std::invalid_argument(
        "UI worklet spring rest speed threshold is outside its bounded range.");
  }
  if (restDisplacementThreshold <= 0 ||
      restDisplacementThreshold >= 1) {
    throw std::invalid_argument(
        "UI worklet spring rest displacement threshold must be between zero and one.");
  }
  if (maximumDurationMilliseconds <= 0 ||
      maximumDurationMilliseconds >
          MaximumUIWorkletSpringDurationMilliseconds) {
    throw std::invalid_argument(
        "UI worklet spring maximum duration is outside its bounded range.");
  }
  return {
      .mass = mass,
      .stiffness = stiffness,
      .damping = damping,
      .initialVelocity = initialVelocity,
      .restSpeedThreshold = restSpeedThreshold,
      .restDisplacementThreshold = restDisplacementThreshold,
      .maximumDurationMilliseconds = maximumDurationMilliseconds,
  };
}

UIWorkletSpringSample UIWorkletSpring::evaluate(
    double elapsedMilliseconds) const {
  if (!std::isfinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw std::invalid_argument(
        "UI worklet spring elapsed time must be finite and non-negative.");
  }
  if (elapsedMilliseconds >= maximumDurationMilliseconds) {
    return {.position = 1, .velocity = 0, .settled = true};
  }
  if (elapsedMilliseconds == 0) {
    return {
        .position = 0,
        .velocity = initialVelocity,
        .settled = false,
    };
  }

  const auto elapsedSeconds = elapsedMilliseconds / 1000.0;
  const auto naturalFrequency = std::sqrt(stiffness / mass);
  const auto dampingRatio =
      damping / (2 * std::sqrt(stiffness * mass));
  constexpr double InitialDisplacement = -1;
  double displacement;
  double velocity;
  if (dampingRatio < 1 - 1e-7) {
    const auto dampedFrequency =
        naturalFrequency * std::sqrt(1 - dampingRatio * dampingRatio);
    const auto decay = std::exp(
        -dampingRatio * naturalFrequency * elapsedSeconds);
    const auto cosine = std::cos(dampedFrequency * elapsedSeconds);
    const auto sine = std::sin(dampedFrequency * elapsedSeconds);
    const auto sineCoefficient =
        (initialVelocity +
         dampingRatio * naturalFrequency * InitialDisplacement) /
        dampedFrequency;
    const auto oscillation =
        InitialDisplacement * cosine + sineCoefficient * sine;
    displacement = decay * oscillation;
    velocity =
        decay *
        (-dampingRatio * naturalFrequency * oscillation -
         InitialDisplacement * dampedFrequency * sine +
         sineCoefficient * dampedFrequency * cosine);
  } else if (dampingRatio <= 1 + 1e-7) {
    const auto linearCoefficient =
        initialVelocity + naturalFrequency * InitialDisplacement;
    const auto decay = std::exp(-naturalFrequency * elapsedSeconds);
    const auto linear =
        InitialDisplacement + linearCoefficient * elapsedSeconds;
    displacement = linear * decay;
    velocity =
        (linearCoefficient - naturalFrequency * linear) * decay;
  } else {
    const auto radical = std::sqrt(dampingRatio * dampingRatio - 1);
    const auto slowRoot =
        -naturalFrequency / (dampingRatio + radical);
    const auto fastRoot =
        -naturalFrequency * (dampingRatio + radical);
    const auto slowCoefficient =
        (initialVelocity - fastRoot * InitialDisplacement) /
        (slowRoot - fastRoot);
    const auto fastCoefficient = InitialDisplacement - slowCoefficient;
    const auto slowTerm =
        slowCoefficient * std::exp(slowRoot * elapsedSeconds);
    const auto fastTerm =
        fastCoefficient * std::exp(fastRoot * elapsedSeconds);
    displacement = slowTerm + fastTerm;
    velocity = slowRoot * slowTerm + fastRoot * fastTerm;
  }

  const auto position = 1 + displacement;
  if (!std::isfinite(position) || !std::isfinite(velocity)) {
    throw std::invalid_argument(
        "UI worklet spring evaluation was not finite.");
  }
  const auto settled =
      std::abs(displacement) <= restDisplacementThreshold &&
      std::abs(velocity) <= restSpeedThreshold;
  return settled
      ? UIWorkletSpringSample{.position = 1, .velocity = 0, .settled = true}
      : UIWorkletSpringSample{
            .position = position,
            .velocity = velocity,
            .settled = false,
        };
}

UIWorkletDecay UIWorkletDecay::parse(const Dynamic &value) {
  requireExactObject(
      value,
      {
          "deceleration",
          "velocityThreshold",
          "maximumDurationMilliseconds",
      },
      "UI worklet decay");
  const auto deceleration = requireFiniteNumber(
      value.at("deceleration"), "UI worklet decay deceleration");
  const auto velocityThreshold = requireFiniteNumber(
      value.at("velocityThreshold"),
      "UI worklet decay velocity threshold");
  const auto maximumDurationMilliseconds = requireFiniteNumber(
      value.at("maximumDurationMilliseconds"),
      "UI worklet decay maximum duration");
  if (deceleration < MinimumUIWorkletDecayDeceleration ||
      deceleration > MaximumUIWorkletDecayDeceleration) {
    throw std::invalid_argument(
        "UI worklet decay deceleration is outside its bounded range.");
  }
  if (velocityThreshold <= 0 ||
      velocityThreshold > MaximumUIWorkletDecayVelocityThreshold) {
    throw std::invalid_argument(
        "UI worklet decay velocity threshold is outside its bounded range.");
  }
  if (maximumDurationMilliseconds <= 0 ||
      maximumDurationMilliseconds >
          MaximumUIWorkletDecayDurationMilliseconds) {
    throw std::invalid_argument(
        "UI worklet decay maximum duration is outside its bounded range.");
  }
  return {
      .deceleration = deceleration,
      .velocityThreshold = velocityThreshold,
      .maximumDurationMilliseconds = maximumDurationMilliseconds,
  };
}

UIWorkletDecaySample UIWorkletDecay::evaluate(
    double initialSpeed,
    double elapsedMilliseconds) const {
  if (!std::isfinite(initialSpeed) || initialSpeed < 0 ||
      initialSpeed > MaximumUIWorkletDecayVelocity) {
    throw std::invalid_argument(
        "UI worklet decay initial speed is outside its bounded range.");
  }
  if (!std::isfinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw std::invalid_argument(
        "UI worklet decay elapsed time must be finite and non-negative.");
  }
  const auto thresholdTimeSeconds = initialSpeed <= velocityThreshold
      ? 0
      : std::log(initialSpeed / velocityThreshold) / deceleration;
  const auto terminalTimeSeconds = std::min(
      thresholdTimeSeconds, maximumDurationMilliseconds / 1000.0);
  const auto elapsedSeconds = elapsedMilliseconds / 1000.0;
  const auto settled = elapsedSeconds >= terminalTimeSeconds;
  const auto evaluatedSeconds =
      settled ? terminalTimeSeconds : elapsedSeconds;
  const auto velocityFactor =
      std::exp(-deceleration * evaluatedSeconds);
  const auto displacementFactorSeconds =
      -std::expm1(-deceleration * evaluatedSeconds) / deceleration;
  if (!std::isfinite(velocityFactor) ||
      !std::isfinite(displacementFactorSeconds)) {
    throw std::invalid_argument(
        "UI worklet decay evaluation was not finite.");
  }
  return {
      .displacementFactorSeconds = displacementFactorSeconds,
      .velocityFactor = settled ? 0 : velocityFactor,
      .speed = settled ? 0 : initialSpeed * velocityFactor,
      .settled = settled,
  };
}

std::vector<double> interpolateUIWorkletInputs(
    const std::vector<double> &from,
    const std::vector<double> &to,
    double progress) {
  if (from.size() != to.size() || !std::isfinite(progress)) {
    throw std::invalid_argument(
        "UI worklet animation inputs and position are invalid.");
  }
  std::vector<double> values;
  values.reserve(from.size());
  for (size_t index = 0; index < from.size(); ++index) {
    const auto start = from.at(index);
    const auto target = to.at(index);
    if (!std::isfinite(start) || !std::isfinite(target)) {
      throw std::invalid_argument(
          "UI worklet timing inputs must contain finite numbers.");
    }
    const auto value = progress == 0
        ? start
        : progress == 1
        ? target
        : start * (1 - progress) + target * progress;
    if (!std::isfinite(value)) {
      throw std::invalid_argument(
          "UI worklet timing interpolation was not finite.");
    }
    values.push_back(value);
  }
  return values;
}

void UIWorkletFrameStatistics::reset() noexcept {
  frameCount_ = 0;
  firstFrameTimeNanoseconds_ = 0;
  lastFrameTimeNanoseconds_ = 0;
  minimumFrameIntervalNanoseconds_ = 0;
  maximumFrameIntervalNanoseconds_ = 0;
  totalFrameIntervalNanoseconds_ = 0;
  intervalSamples_.clear();
  droppedIntervalSampleCount_ = 0;
}

void UIWorkletFrameStatistics::recordFrame(int64_t frameTimeNanoseconds) {
  if (frameTimeNanoseconds < 0) {
    throw std::invalid_argument(
        "UI worklet frame timestamps must be non-negative.");
  }
  if (frameCount_ == 0) {
    frameCount_ = 1;
    firstFrameTimeNanoseconds_ = frameTimeNanoseconds;
    lastFrameTimeNanoseconds_ = frameTimeNanoseconds;
    return;
  }
  if (frameTimeNanoseconds <= lastFrameTimeNanoseconds_) {
    throw std::invalid_argument(
        "UI worklet timing frame timestamps must be strictly increasing.");
  }
  const auto interval = frameTimeNanoseconds - lastFrameTimeNanoseconds_;
  if (interval >
      std::numeric_limits<int64_t>::max() -
          totalFrameIntervalNanoseconds_) {
    throw std::overflow_error(
        "UI worklet timing frame intervals overflowed.");
  }
  frameCount_++;
  lastFrameTimeNanoseconds_ = frameTimeNanoseconds;
  totalFrameIntervalNanoseconds_ += interval;
  if (minimumFrameIntervalNanoseconds_ == 0 ||
      interval < minimumFrameIntervalNanoseconds_) {
    minimumFrameIntervalNanoseconds_ = interval;
  }
  maximumFrameIntervalNanoseconds_ =
      std::max(maximumFrameIntervalNanoseconds_, interval);
  if (intervalSamples_.size() < MaximumUIWorkletFrameIntervalSamples) {
    intervalSamples_.push_back(interval);
  } else {
    droppedIntervalSampleCount_++;
  }
}

bool UIWorkletFrameStatistics::empty() const noexcept {
  return frameCount_ == 0;
}

UIWorkletFrameStatisticsSnapshot UIWorkletFrameStatistics::snapshot() const {
  if (empty()) {
    throw std::logic_error(
        "Empty UI worklet frame statistics cannot be inspected.");
  }
  auto samples = intervalSamples_;
  std::sort(samples.begin(), samples.end());
  const auto quantile = [&](double value) -> int64_t {
    if (samples.empty()) return 0;
    const auto index = static_cast<size_t>(std::max(
        0.0,
        std::ceil(static_cast<double>(samples.size()) * value) - 1));
    return samples.at(index);
  };
  constexpr double NanosecondsToMilliseconds = 1.0 / 1000000.0;
  const auto intervalCount = frameCount_ - 1;
  return {
      .frameCount = frameCount_,
      .intervalCount = intervalCount,
      .sampledIntervalCount = intervalSamples_.size(),
      .droppedIntervalSampleCount = droppedIntervalSampleCount_,
      .firstFrameTimeMilliseconds =
          static_cast<double>(firstFrameTimeNanoseconds_) *
          NanosecondsToMilliseconds,
      .lastFrameTimeMilliseconds =
          static_cast<double>(lastFrameTimeNanoseconds_) *
          NanosecondsToMilliseconds,
      .minimumFrameIntervalMilliseconds =
          static_cast<double>(minimumFrameIntervalNanoseconds_) *
          NanosecondsToMilliseconds,
      .maximumFrameIntervalMilliseconds =
          static_cast<double>(maximumFrameIntervalNanoseconds_) *
          NanosecondsToMilliseconds,
      .meanFrameIntervalMilliseconds = intervalCount == 0
          ? 0
          : static_cast<double>(totalFrameIntervalNanoseconds_) /
              static_cast<double>(intervalCount) *
              NanosecondsToMilliseconds,
      .p50FrameIntervalMilliseconds =
          static_cast<double>(quantile(0.5)) * NanosecondsToMilliseconds,
      .p95FrameIntervalMilliseconds =
          static_cast<double>(quantile(0.95)) * NanosecondsToMilliseconds,
      .p99FrameIntervalMilliseconds =
          static_cast<double>(quantile(0.99)) * NanosecondsToMilliseconds,
  };
}

UIWorkletGraph::UIWorkletGraph(
    std::vector<std::string> inputNames,
    std::vector<double> initialInputs,
    std::vector<OutputProgram> outputs)
    : inputNames_(std::move(inputNames)),
      initialInputs_(std::move(initialInputs)),
      outputs_(std::move(outputs)) {
  outputNames_.reserve(outputs_.size());
  for (const auto &output : outputs_) outputNames_.push_back(output.name);
}

UIWorkletGraph UIWorkletGraph::parse(const Dynamic &value) {
  requireExactObject(
      value, {"protocolVersion", "inputs", "outputs"}, "UI worklet graph");
  if (!value.at("protocolVersion").isNumber() ||
      value.at("protocolVersion").asDouble() != UIWorkletProtocolVersion) {
    throw std::invalid_argument(
        "Unsupported UI worklet protocol version.");
  }
  const auto &inputValues = value.at("inputs");
  if (!inputValues.isArray()) {
    throw std::invalid_argument("UI worklet graph inputs must be an array.");
  }
  if (inputValues.size() > MaximumUIWorkletInputs) {
    throw std::invalid_argument(
        "UI worklet graphs support at most " +
        std::to_string(MaximumUIWorkletInputs) + " inputs.");
  }
  std::vector<std::string> inputNames;
  std::vector<double> initialInputs;
  std::unordered_map<std::string, size_t> inputs;
  inputNames.reserve(inputValues.size());
  initialInputs.reserve(inputValues.size());
  for (size_t index = 0; index < inputValues.size(); ++index) {
    const auto context = "UI worklet input " + std::to_string(index);
    const auto &input = inputValues.at(index);
    requireExactObject(input, {"name", "initialValue"}, context);
    auto name = requireIdentifier(input.at("name"), context + ".name");
    if (inputs.contains(name)) {
      throw std::invalid_argument("Duplicate UI worklet input " + name + ".");
    }
    inputs.emplace(name, index);
    inputNames.push_back(std::move(name));
    initialInputs.push_back(requireFiniteNumber(
        input.at("initialValue"), context + ".initialValue"));
  }

  const auto &outputValues = value.at("outputs");
  if (!outputValues.isArray() || outputValues.empty()) {
    throw std::invalid_argument(
        "UI worklet graph outputs must be a non-empty array.");
  }
  if (outputValues.size() > MaximumUIWorkletOutputs) {
    throw std::invalid_argument(
        "UI worklet graphs support at most " +
        std::to_string(MaximumUIWorkletOutputs) + " outputs.");
  }
  std::unordered_set<std::string> outputNames;
  std::vector<OutputProgram> outputs;
  outputs.reserve(outputValues.size());
  ParseBudget budget;
  for (size_t index = 0; index < outputValues.size(); ++index) {
    const auto context = "UI worklet output " + std::to_string(index);
    const auto &output = outputValues.at(index);
    requireExactObject(output, {"name", "expression"}, context);
    auto name = requireIdentifier(output.at("name"), context + ".name");
    if (!outputNames.insert(name).second) {
      throw std::invalid_argument("Duplicate UI worklet output " + name + ".");
    }
    std::vector<Instruction> instructions;
    parseExpression(
        output.at("expression"),
        inputs,
        budget,
        1,
        context + ".expression",
        instructions);
    outputs.push_back({
        .name = std::move(name),
        .instructions = std::move(instructions),
    });
  }
  return UIWorkletGraph(
      std::move(inputNames),
      std::move(initialInputs),
      std::move(outputs));
}

size_t UIWorkletGraph::inputCount() const noexcept {
  return inputNames_.size();
}

const std::vector<std::string> &UIWorkletGraph::inputNames() const noexcept {
  return inputNames_;
}

const std::vector<double> &UIWorkletGraph::initialInputs() const noexcept {
  return initialInputs_;
}

const std::vector<std::string> &UIWorkletGraph::outputNames() const noexcept {
  return outputNames_;
}

std::vector<UIWorkletOutputValue> UIWorkletGraph::evaluate(
    const std::vector<double> &inputs) const {
  if (inputs.size() != inputNames_.size() ||
      std::any_of(inputs.begin(), inputs.end(), [](double value) {
        return !std::isfinite(value);
      })) {
    throw std::invalid_argument(
        "UI worklet input vectors must match the installed graph and contain finite numbers.");
  }
  std::vector<UIWorkletOutputValue> values;
  values.reserve(outputs_.size());
  std::vector<double> stack;
  for (const auto &output : outputs_) {
    stack.clear();
    stack.reserve(output.instructions.size());
    for (const auto &instruction : output.instructions) {
      switch (instruction.operation) {
        case Operation::Constant:
          stack.push_back(instruction.first);
          break;
        case Operation::Input:
          stack.push_back(inputs.at(instruction.input));
          break;
        case Operation::Absolute:
          stack.push_back(std::abs(pop(stack)));
          break;
        case Operation::Negate:
          stack.push_back(-pop(stack));
          break;
        case Operation::Clamp: {
          const auto value = pop(stack);
          stack.push_back(std::min(
              instruction.second, std::max(instruction.first, value)));
          break;
        }
        case Operation::Interpolate: {
          const auto value = pop(stack);
          auto progress = (value - instruction.first) /
              (instruction.second - instruction.first);
          if (instruction.clamp) {
            progress = std::min(1.0, std::max(0.0, progress));
          }
          stack.push_back(
              instruction.third +
              progress * (instruction.fourth - instruction.third));
          break;
        }
        case Operation::Add:
        case Operation::Subtract:
        case Operation::Multiply:
        case Operation::Divide:
        case Operation::Minimum:
        case Operation::Maximum: {
          const auto right = pop(stack);
          const auto left = pop(stack);
          if (instruction.operation == Operation::Divide && right == 0) {
            throw std::invalid_argument("UI worklet division by zero.");
          }
          if (instruction.operation == Operation::Add) {
            stack.push_back(left + right);
          } else if (instruction.operation == Operation::Subtract) {
            stack.push_back(left - right);
          } else if (instruction.operation == Operation::Multiply) {
            stack.push_back(left * right);
          } else if (instruction.operation == Operation::Divide) {
            stack.push_back(left / right);
          } else if (instruction.operation == Operation::Minimum) {
            stack.push_back(std::min(left, right));
          } else {
            stack.push_back(std::max(left, right));
          }
          break;
        }
      }
    }
    if (stack.size() != 1 || !std::isfinite(stack.back())) {
      throw std::invalid_argument(
          "UI worklet output " + output.name + " was not finite.");
    }
    values.push_back({.name = output.name, .value = stack.back()});
  }
  return values;
}

UIWorkletPanGesture UIWorkletPanGesture::parse(
    const Dynamic &value,
    const UIWorkletGraph &graph) {
  if (!value.isObject()) {
    throw std::invalid_argument(
        "UI worklet pan gesture must be a plain object.");
  }
  const auto hasReleaseDecay = value.count("releaseDecay") != 0;
  requireExactObject(
      value,
      hasReleaseDecay
          ? std::initializer_list<std::string_view>{
                "xInput",
                "yInput",
                "minX",
                "maxX",
                "minY",
                "maxY",
                "releaseDecay",
            }
          : std::initializer_list<std::string_view>{
                "xInput", "yInput", "minX", "maxX", "minY", "maxY"},
      "UI worklet pan gesture");
  const auto xInputName =
      requireIdentifier(value.at("xInput"), "UI worklet pan xInput");
  const auto yInputName =
      requireIdentifier(value.at("yInput"), "UI worklet pan yInput");
  if (xInputName == yInputName) {
    throw std::invalid_argument("UI worklet pan inputs must be distinct.");
  }
  const auto &inputNames = graph.inputNames();
  const auto xEntry = std::find(
      inputNames.begin(), inputNames.end(), xInputName);
  const auto yEntry = std::find(
      inputNames.begin(), inputNames.end(), yInputName);
  if (xEntry == inputNames.end()) {
    throw std::invalid_argument(
        "Unknown UI worklet pan input " + xInputName + ".");
  }
  if (yEntry == inputNames.end()) {
    throw std::invalid_argument(
        "Unknown UI worklet pan input " + yInputName + ".");
  }
  const auto minX =
      requireFiniteNumber(value.at("minX"), "UI worklet pan minX");
  const auto maxX =
      requireFiniteNumber(value.at("maxX"), "UI worklet pan maxX");
  const auto minY =
      requireFiniteNumber(value.at("minY"), "UI worklet pan minY");
  const auto maxY =
      requireFiniteNumber(value.at("maxY"), "UI worklet pan maxY");
  if (maxX < minX || maxY < minY) {
    throw std::invalid_argument(
        "UI worklet pan bounds must be ascending.");
  }
  return {
      .xInput = static_cast<size_t>(
          std::distance(inputNames.begin(), xEntry)),
      .yInput = static_cast<size_t>(
          std::distance(inputNames.begin(), yEntry)),
      .minX = minX,
      .maxX = maxX,
      .minY = minY,
      .maxY = maxY,
      .releaseDecay = hasReleaseDecay
          ? std::optional<UIWorkletDecay>{
                UIWorkletDecay::parse(value.at("releaseDecay"))}
          : std::nullopt,
  };
}

std::vector<double> UIWorkletPanGesture::evaluateInputs(
    const std::vector<double> &currentInputs,
    double originX,
    double originY,
    double translationX,
    double translationY) const {
  if (xInput >= currentInputs.size() || yInput >= currentInputs.size() ||
      !std::isfinite(originX) || !std::isfinite(originY) ||
      !std::isfinite(translationX) || !std::isfinite(translationY)) {
    throw std::invalid_argument("UI worklet pan inputs are invalid.");
  }
  auto inputs = currentInputs;
  inputs.at(xInput) =
      std::min(maxX, std::max(minX, originX + translationX));
  inputs.at(yInput) =
      std::min(maxY, std::max(minY, originY + translationY));
  return inputs;
}

} // namespace solid_native::worklets
