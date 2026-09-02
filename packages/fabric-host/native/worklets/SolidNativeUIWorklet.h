#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <folly/dynamic.h>

namespace solid_native::worklets {

constexpr int UIWorkletProtocolVersion = 0;
constexpr size_t MaximumUIWorkletInputs = 64;
constexpr size_t MaximumUIWorkletOutputs = 64;
constexpr size_t MaximumUIWorkletExpressionDepth = 32;
constexpr size_t MaximumUIWorkletExpressionNodes = 512;
constexpr double MaximumUIWorkletTimingDurationMilliseconds = 60000;
constexpr size_t MaximumUIWorkletTimingKeyframes = 32;
constexpr size_t MaximumUIWorkletFrameIntervalSamples = 8192;
constexpr double MinimumUIWorkletSpringMass = 0.001;
constexpr double MaximumUIWorkletSpringMass = 100;
constexpr double MinimumUIWorkletSpringStiffness = 0.001;
constexpr double MaximumUIWorkletSpringStiffness = 100000;
constexpr double MaximumUIWorkletSpringDamping = 10000;
constexpr double MaximumUIWorkletSpringInitialVelocity = 100;
constexpr double MaximumUIWorkletSpringRestSpeed = 100;
constexpr double MaximumUIWorkletSpringDurationMilliseconds = 60000;
constexpr double MinimumUIWorkletDecayDeceleration = 0.001;
constexpr double MaximumUIWorkletDecayDeceleration = 1000;
constexpr double MaximumUIWorkletDecayVelocity = 100000;
constexpr double MaximumUIWorkletDecayVelocityThreshold = 10000;
constexpr double MaximumUIWorkletDecayDurationMilliseconds = 60000;

enum class UIWorkletTimingEasing {
  Linear,
  EaseIn,
  EaseOut,
  EaseInOut,
};

struct UIWorkletTiming final {
  static UIWorkletTiming parse(const folly::dynamic &value);

  double durationMilliseconds;
  UIWorkletTimingEasing easing;

  double evaluateProgress(double elapsedMilliseconds) const;
};

struct UIWorkletTimingKeyframe final {
  std::vector<double> inputs;
  UIWorkletTiming timing;
};

struct UIWorkletTimingSequenceSample final {
  std::vector<double> inputs;
  double progress;
  bool settled;
};

struct UIWorkletTimingSequence final {
  static UIWorkletTimingSequence parse(
      const folly::dynamic &value,
      size_t inputCount);

  std::vector<UIWorkletTimingKeyframe> keyframes;
  double totalDurationMilliseconds;

  UIWorkletTimingSequenceSample evaluate(
      const std::vector<double> &from,
      double elapsedMilliseconds) const;
};

struct UIWorkletSpringSample final {
  double position;
  double velocity;
  bool settled;
};

struct UIWorkletSpring final {
  static UIWorkletSpring parse(const folly::dynamic &value);

  double mass;
  double stiffness;
  double damping;
  double initialVelocity;
  double restSpeedThreshold;
  double restDisplacementThreshold;
  double maximumDurationMilliseconds;

  UIWorkletSpringSample evaluate(double elapsedMilliseconds) const;
};

struct UIWorkletDecaySample final {
  double displacementFactorSeconds;
  double velocityFactor;
  double speed;
  bool settled;
};

struct UIWorkletDecay final {
  static UIWorkletDecay parse(const folly::dynamic &value);

  double deceleration;
  double velocityThreshold;
  double maximumDurationMilliseconds;

  UIWorkletDecaySample evaluate(
      double initialSpeed,
      double elapsedMilliseconds) const;
};

std::vector<double> interpolateUIWorkletInputs(
    const std::vector<double> &from,
    const std::vector<double> &to,
    double progress);

struct UIWorkletFrameStatisticsSnapshot final {
  int64_t frameCount;
  int64_t intervalCount;
  size_t sampledIntervalCount;
  int64_t droppedIntervalSampleCount;
  double firstFrameTimeMilliseconds;
  double lastFrameTimeMilliseconds;
  double minimumFrameIntervalMilliseconds;
  double maximumFrameIntervalMilliseconds;
  double meanFrameIntervalMilliseconds;
  double p50FrameIntervalMilliseconds;
  double p95FrameIntervalMilliseconds;
  double p99FrameIntervalMilliseconds;
};

class UIWorkletFrameStatistics final {
 public:
  void reset() noexcept;
  void recordFrame(int64_t frameTimeNanoseconds);
  bool empty() const noexcept;
  UIWorkletFrameStatisticsSnapshot snapshot() const;

 private:
  int64_t frameCount_{0};
  int64_t firstFrameTimeNanoseconds_{0};
  int64_t lastFrameTimeNanoseconds_{0};
  int64_t minimumFrameIntervalNanoseconds_{0};
  int64_t maximumFrameIntervalNanoseconds_{0};
  int64_t totalFrameIntervalNanoseconds_{0};
  std::vector<int64_t> intervalSamples_;
  int64_t droppedIntervalSampleCount_{0};
};

struct UIWorkletOutputValue final {
  std::string name;
  double value;
};

/**
 * Immutable, bounded numeric program decoded from the public version-0
 * transport graph. The instruction stream is platform-neutral; platform
 * adapters decide which named output channels they can apply.
 */
class UIWorkletGraph final {
 public:
  static UIWorkletGraph parse(const folly::dynamic &value);

  size_t inputCount() const noexcept;
  const std::vector<std::string> &inputNames() const noexcept;
  const std::vector<double> &initialInputs() const noexcept;
  const std::vector<std::string> &outputNames() const noexcept;

  std::vector<UIWorkletOutputValue> evaluate(
      const std::vector<double> &inputs) const;

  /** Internal bytecode representation exposed only to the native decoder. */
  enum class Operation {
    Constant,
    Input,
    Add,
    Subtract,
    Multiply,
    Divide,
    Minimum,
    Maximum,
    Absolute,
    Negate,
    Clamp,
    Interpolate,
  };

  struct Instruction final {
    Operation operation;
    size_t input{0};
    double first{0};
    double second{0};
    double third{0};
    double fourth{0};
    bool clamp{false};
  };

  struct OutputProgram final {
    std::string name;
    std::vector<Instruction> instructions;
  };

 private:
  UIWorkletGraph(
      std::vector<std::string> inputNames,
      std::vector<double> initialInputs,
      std::vector<OutputProgram> outputs);

  std::vector<std::string> inputNames_;
  std::vector<double> initialInputs_;
  std::vector<std::string> outputNames_;
  std::vector<OutputProgram> outputs_;
};

struct UIWorkletPanGesture final {
  static UIWorkletPanGesture parse(
      const folly::dynamic &value,
      const UIWorkletGraph &graph);

  size_t xInput;
  size_t yInput;
  double minX;
  double maxX;
  double minY;
  double maxY;
  std::optional<UIWorkletDecay> releaseDecay;

  std::vector<double> evaluateInputs(
      const std::vector<double> &currentInputs,
      double originX,
      double originY,
      double translationX,
      double translationY) const;
};

enum class UIWorkletPanGesturePhase {
  Begin = 0,
  Change = 1,
  End = 2,
  Cancel = 3,
};

} // namespace solid_native::worklets
