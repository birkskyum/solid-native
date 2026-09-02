#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <fbjni/fbjni.h>
#include <folly/dynamic.h>
#include <jsi/jsi.h>
#include <react/renderer/core/EventListener.h>
#include <react/renderer/core/InstanceHandle.h>
#include <react/renderer/core/RawEvent.h>
#include <react/renderer/core/ShadowNodeFamily.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <react/renderer/uimanager/UIManagerMountHook.h>
#include <react/runtime/jni/JBindingsInstaller.h>

#include "SolidNativeBindingsInstaller.h"
#include "SolidNativeFabricTransactionCoordinator.h"
#include "SolidNativeUIWorklet.h"

namespace solid_native::android {
namespace {

using facebook::jsi::Array;
using facebook::jsi::Function;
using facebook::jsi::JSError;
using facebook::jsi::Object;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;
using solid_native::fabric::react_native::NodeIdentity;
using solid_native::fabric::react_native::NodeIdentityMap;
using solid_native::fabric::react_native::NodeMeasurement;
using solid_native::fabric::react_native::NativeResourceResolver;
using solid_native::fabric::react_native::ReactNativeVersion;
using solid_native::fabric::react_native::TransactionCoordinator;

constexpr char GlobalBindingName[] = "__solidNativeHost";
constexpr int HostContractVersion = 1;
constexpr size_t MaximumTransportDepth = 64;
constexpr size_t MaximumTransportValues = 100000;
constexpr size_t MaximumRetainedResources = 64;
constexpr size_t MaximumResourceKindLength = 128;
constexpr size_t MaximumActiveUIWorklets = 256;
constexpr size_t MaximumFatalErrorNameBytes = 512;
constexpr size_t MaximumFatalErrorMessageBytes = 8192;
constexpr double MaximumSafeInteger = 9007199254740991.0;

double wallClockMilliseconds() {
  const auto now = std::chrono::system_clock::now().time_since_epoch();
  return std::chrono::duration<double, std::milli>(now).count();
}

double monotonicMilliseconds() {
  const auto now = std::chrono::steady_clock::now().time_since_epoch();
  return std::chrono::duration<double, std::milli>(now).count();
}

int64_t requireSafeInteger(
    Runtime &runtime,
    const Value &value,
    const char *name,
    bool positive) {
  if (!value.isNumber()) {
    throw JSError(runtime, std::string{name} + " must be an integer.");
  }
  const auto number = value.getNumber();
  if (!std::isfinite(number) || std::trunc(number) != number ||
      std::abs(number) > MaximumSafeInteger || (positive && number <= 0)) {
    throw JSError(
        runtime,
        std::string{name} +
            (positive ? " must be a positive safe integer."
                      : " must be a safe integer."));
  }
  return static_cast<int64_t>(number);
}

std::string requireResourceKind(Runtime &runtime, const Value &value) {
  if (!value.isString()) {
    throw JSError(runtime, "The native resource kind must be a string.");
  }
  const auto kind = value.getString(runtime).utf8(runtime);
  const auto validStart = [](char character) {
    return character >= 'a' && character <= 'z';
  };
  const auto validPart = [&](char character) {
    return validStart(character) ||
        (character >= '0' && character <= '9') || character == '.' ||
        character == '-';
  };
  if (kind.empty() || kind.size() > MaximumResourceKindLength ||
      !validStart(kind.front()) ||
      !std::all_of(kind.begin() + 1, kind.end(), validPart)) {
    throw JSError(
        runtime,
        "The native resource kind must contain 1-128 lowercase identifier "
        "characters.");
  }
  return kind;
}

std::string requireFatalErrorText(
    Runtime &runtime,
    const Value &value,
    const char *name,
    size_t maximumBytes) {
  if (!value.isString()) {
    throw JSError(runtime, std::string{name} + " must be a string.");
  }
  const auto text = value.getString(runtime).utf8(runtime);
  if (text.empty() || text.size() > maximumBytes ||
      text.find('\0') != std::string::npos) {
    throw JSError(
        runtime,
        std::string{name} + " must be a bounded non-empty string without null bytes.");
  }
  return text;
}

std::string childPath(const std::string &path, const std::string &name) {
  return path + "." + name;
}

std::string indexPath(const std::string &path, size_t index) {
  return path + "[" + std::to_string(index) + "]";
}

std::string requireTransportString(
    std::string value,
    const std::string &path) {
  if (value.find('\0') != std::string::npos) {
    throw std::invalid_argument(
        path + ": strings containing a null byte are not supported.");
  }
  return value;
}

bool containsObject(
    Runtime &runtime,
    const std::vector<Value> &ancestors,
    const Object &candidate) {
  for (const auto &value : ancestors) {
    auto ancestor = value.getObject(runtime);
    if (Object::strictEquals(runtime, ancestor, candidate)) return true;
  }
  return false;
}

folly::dynamic dynamicFromJSI(
    Runtime &runtime,
    const Value &value,
    const std::string &path,
    size_t depth,
    size_t &valueCount,
    std::vector<Value> &ancestors) {
  if (++valueCount > MaximumTransportValues) {
    throw std::invalid_argument(
        "The host transaction exceeds the transport value limit.");
  }
  if (depth > MaximumTransportDepth) {
    throw std::invalid_argument(
        path + ": the host transaction exceeds the nesting limit.");
  }
  if (value.isUndefined()) {
    throw std::invalid_argument(
        path + ": undefined is not a transport-safe value.");
  }
  if (value.isNull()) return nullptr;
  if (value.isBool()) return value.getBool();
  if (value.isNumber()) {
    const auto number = value.getNumber();
    if (!std::isfinite(number)) {
      throw std::invalid_argument(path + ": numbers must be finite.");
    }
    return number;
  }
  if (value.isString()) {
    return requireTransportString(
        value.getString(runtime).utf8(runtime), path);
  }
  if (value.isBigInt()) {
    throw std::invalid_argument(
        path + ": bigint is not a transport-safe value.");
  }
  if (value.isSymbol()) {
    throw std::invalid_argument(
        path + ": symbol is not a transport-safe value.");
  }
  if (!value.isObject()) {
    throw std::invalid_argument(path + ": unsupported JavaScript value.");
  }

  auto object = value.getObject(runtime);
  if (object.isFunction(runtime)) {
    throw std::invalid_argument(
        path + ": functions are not transport-safe values.");
  }
  if (containsObject(runtime, ancestors, object)) {
    throw std::invalid_argument(
        path + ": cyclic objects are not transport-safe values.");
  }
  ancestors.emplace_back(runtime, object);

  if (object.isArray(runtime)) {
    auto array = object.getArray(runtime);
    folly::dynamic result = folly::dynamic::array;
    const auto size = array.size(runtime);
    result.reserve(size);
    for (size_t index = 0; index < size; ++index) {
      const auto child = array.getValueAtIndex(runtime, index);
      result.push_back(dynamicFromJSI(
          runtime,
          child,
          indexPath(path, index),
          depth + 1,
          valueCount,
          ancestors));
    }
    ancestors.pop_back();
    return result;
  }

  folly::dynamic result = folly::dynamic::object;
  auto names = object.getPropertyNames(runtime);
  const auto size = names.size(runtime);
  for (size_t index = 0; index < size; ++index) {
    auto nameString = names.getValueAtIndex(runtime, index).getString(runtime);
    auto name = requireTransportString(nameString.utf8(runtime), path);
    const auto child = object.getProperty(runtime, nameString);
    result[name] = dynamicFromJSI(
        runtime,
        child,
        childPath(path, name),
        depth + 1,
        valueCount,
        ancestors);
  }
  ancestors.pop_back();
  return result;
}

int64_t dynamicInteger(const folly::dynamic &value) {
  if (!value.isInt() && !value.isDouble()) return 0;
  const auto number = value.asDouble();
  if (!std::isfinite(number) || std::trunc(number) != number ||
      std::abs(number) > MaximumSafeInteger) {
    return 0;
  }
  return static_cast<int64_t>(number);
}

struct RoutedEvent final {
  int64_t node;
  std::string name;
};

std::vector<std::string> semanticEventNames(const std::string &nativeName) {
  auto name = nativeName;
  if (name.size() > 3 && name.compare(0, 3, "top") == 0) {
    name = name.substr(3);
    if (!name.empty() && name[0] >= 'A' && name[0] <= 'Z') {
      name[0] = static_cast<char>(name[0] - 'A' + 'a');
    }
  }
  if (name == "click") return {"press"};
  if (name == "touchStart" || name == "pointerDown") return {"pressIn"};
  if (name == "touchMove" || name == "pointerMove") return {"pressMove"};
  if (name == "pointerEnter") return {"hoverIn"};
  if (name == "pointerLeave") return {"hoverOut"};
  if (name == "touchEnd") return {"pressOut", "press"};
  if (name == "touchCancel" || name == "pointerCancel") {
    return {"pressCancel"};
  }
  if (name == "pointerUp") return {"pressOut"};
  // TextInput and Switch share React Native's generic `change` event. The
  // committed per-node subscription selects the portable semantic route.
  if (name == "change") return {"changeText", "valueChange"};
  if (name == "appear") return {"focus"};
  if (name == "disappear") return {"blur"};
  if (name == "dismissed") return {"dismiss"};
  if (name == "nativeDismissCancelled") return {"nativeDismissCancel"};
  if (name == "sheetDetentChanged") return {"sheetDetentChange"};
  if (name == "finishTransitioning") return {"transitionEnd"};
  return {name};
}

bool eventBubbles(const std::string &name) {
  return name == "endEditing" || name == "keyPress" ||
      name == "longPress" || name == "press" || name == "pressCancel" ||
      name == "pressIn" || name == "pressMove" || name == "pressOut" ||
      name == "scroll" ||
      name == "scrollBeginDrag" || name == "scrollEndDrag" ||
      name == "valueChange";
}

const char *eventPriority(facebook::react::RawEvent::Category category) {
  using Category = facebook::react::RawEvent::Category;
  switch (category) {
    case Category::Discrete:
    case Category::ContinuousStart:
    case Category::ContinuousEnd:
      return "discrete";
    case Category::Continuous:
      return "continuous";
    case Category::Unspecified:
    case Category::Idle:
      return "default";
  }
  return "default";
}

const char *semanticEventPriority(
    const std::string &name,
    facebook::react::RawEvent::Category category) {
  if (name == "changeText" || name == "keyPress" || name == "valueChange" ||
      name == "submitEditing" || name == "scrollBeginDrag" ||
      name == "scrollEndDrag" || name == "accessibilityAction" ||
      name == "accessibilityEscape" || name == "accessibilityTap" ||
      name == "magicTap") {
    return "discrete";
  }
  if (name == "contentSizeChange" || name == "insetsChange" ||
      name == "layout" || name == "selectionChange") {
    return "default";
  }
  if (name == "scroll") return "continuous";
  if (name == "tabSelected" || name == "tabSelectionRejected" ||
      name == "tabSelectionPrevented" ||
      name == "pressHeaderBarButtonItem" ||
      name == "pressHeaderBarButtonMenuItem") {
    return "discrete";
  }
  // Android's legacy Event dispatcher sends coalescible Image completion
  // events through dispatchUniqueEvent, which assigns Continuous even though
  // load/error are asynchronous resource notifications rather than continuous
  // user input. Screen visibility events are lifecycle notifications with the
  // same default-priority semantics. Keep the framework-neutral host priority
  // stable across the Android and iOS backend paths.
  if (name == "load" || name == "error" || name == "focus" ||
      name == "blur" || name == "transitionEnd" || name == "show" ||
      name == "dismiss" || name == "orientationChange" ||
      name == "requestClose" || name == "willAppear" ||
      name == "didAppear" || name == "willDisappear" ||
      name == "didDisappear" || name == "moreTabSelected" ||
      name == "sheetDetentChange") {
    return "default";
  }
  return eventPriority(category);
}

class EventRoutingState final {
 public:
  struct LayoutRouteStageNode final {
    int64_t node;
    facebook::react::Tag tag;
    std::optional<int64_t> previousNodeForTag;
    std::optional<facebook::react::Tag> previousTagForNode;
    std::optional<std::unordered_set<std::string>> previousEvents;
  };

  struct LayoutRouteStage final {
    bool active{false};
    int64_t previousSurface{0};
    int64_t previousSequence{0};
    std::vector<LayoutRouteStageNode> nodes;
  };

  std::atomic<bool> active{true};
  std::atomic<bool> handlerInstalled{false};
  std::atomic<int64_t> surface{0};
  std::atomic<int64_t> sequence{0};

  std::optional<std::vector<RoutedEvent>> route(
      facebook::react::Tag tag,
      const std::string &nativeName) const {
    std::lock_guard lock(mutex_);
    const auto nodeEntry = nodesByTag_.find(tag);
    if (nodeEntry == nodesByTag_.end()) return std::nullopt;

    std::vector<RoutedEvent> events;
    for (const auto &name : semanticEventNames(nativeName)) {
      auto node = nodeEntry->second;
      while (true) {
        const auto eventsEntry = eventsByNode_.find(node);
        if (eventsEntry != eventsByNode_.end() &&
            eventsEntry->second.contains(name)) {
          events.push_back(RoutedEvent{.node = node, .name = name});
          break;
        }
        if (!eventBubbles(name)) break;
        const auto parentEntry = parentsByNode_.find(node);
        if (parentEntry == parentsByNode_.end()) break;
        node = parentEntry->second;
      }
    }
    return events;
  }

  bool isSubscribed(int64_t node, const std::string &name) const {
    std::lock_guard lock(mutex_);
    const auto entry = eventsByNode_.find(node);
    return entry != eventsByNode_.end() && entry->second.contains(name);
  }

  std::optional<facebook::react::Tag> tagForNode(int64_t node) const {
    std::lock_guard lock(mutex_);
    const auto entry = tagsByNode_.find(node);
    if (entry == tagsByNode_.end()) return std::nullopt;
    return entry->second;
  }

  void reclaimNode(int64_t node) {
    std::lock_guard lock(mutex_);
    eventsByNode_.erase(node);
    parentsByNode_.erase(node);
    const auto tagEntry = tagsByNode_.find(node);
    if (tagEntry == tagsByNode_.end()) return;
    nodesByTag_.erase(tagEntry->second);
    tagsByNode_.erase(tagEntry);
  }

  LayoutRouteStage stageLayoutRoutes(
      const folly::dynamic &transaction,
      const NodeIdentityMap &identities) {
    LayoutRouteStage stage;
    std::unordered_map<int64_t, std::unordered_set<std::string>> layoutEvents;
    if (transaction.isObject() && transaction.count("mutations") != 0 &&
        transaction.at("mutations").isArray()) {
      for (const auto &mutation : transaction.at("mutations")) {
        if (!mutation.isObject() || mutation.count("type") == 0 ||
            !mutation.at("type").isString() ||
            mutation.at("type").getString() != "update-event-listeners" ||
            mutation.count("node") == 0 || mutation.count("events") == 0 ||
            !mutation.at("events").isArray()) {
          continue;
        }
        std::unordered_set<std::string> events;
        for (const auto &event : mutation.at("events")) {
          if (event.isString()) events.insert(event.getString());
        }
        const auto node = dynamicInteger(mutation.at("node"));
        if (events.contains("layout")) {
          layoutEvents[node] = std::move(events);
        } else {
          layoutEvents.erase(node);
        }
      }
    }
    if (layoutEvents.empty()) return stage;

    std::lock_guard lock(mutex_);
    stage.active = true;
    stage.previousSurface = surface.load(std::memory_order_acquire);
    stage.previousSequence = sequence.load(std::memory_order_acquire);
    for (auto &[node, events] : layoutEvents) {
      std::optional<facebook::react::Tag> tag;
      const auto identity = identities.find(node);
      if (identity != identities.end()) {
        tag = identity->second.tag;
      } else {
        const auto existingTag = tagsByNode_.find(node);
        if (existingTag != tagsByNode_.end()) tag = existingTag->second;
      }
      if (!tag.has_value()) continue;

      LayoutRouteStageNode stagedNode{
          .node = node,
          .tag = *tag,
          .previousNodeForTag = std::nullopt,
          .previousTagForNode = std::nullopt,
          .previousEvents = std::nullopt};
      const auto previousNode = nodesByTag_.find(*tag);
      if (previousNode != nodesByTag_.end()) {
        stagedNode.previousNodeForTag = previousNode->second;
      }
      const auto previousTag = tagsByNode_.find(node);
      if (previousTag != tagsByNode_.end()) {
        stagedNode.previousTagForNode = previousTag->second;
      }
      const auto previousEvents = eventsByNode_.find(node);
      if (previousEvents != eventsByNode_.end()) {
        stagedNode.previousEvents = previousEvents->second;
      }
      nodesByTag_[*tag] = node;
      tagsByNode_[node] = *tag;
      eventsByNode_[node] = std::move(events);
      stage.nodes.push_back(std::move(stagedNode));
    }
    if (stage.nodes.empty()) {
      stage.active = false;
      return stage;
    }
    if (transaction.count("surface") != 0) {
      surface.store(
          dynamicInteger(transaction.at("surface")),
          std::memory_order_release);
    }
    if (transaction.count("sequence") != 0) {
      sequence.store(
          dynamicInteger(transaction.at("sequence")),
          std::memory_order_release);
    }
    return stage;
  }

  void finishLayoutRoutes(LayoutRouteStage &stage) {
    stage.active = false;
  }

  void rollbackLayoutRoutes(LayoutRouteStage &stage) {
    if (!stage.active) return;
    std::lock_guard lock(mutex_);
    for (auto iterator = stage.nodes.rbegin();
         iterator != stage.nodes.rend();
         ++iterator) {
      const auto &node = *iterator;
      if (node.previousNodeForTag.has_value()) {
        nodesByTag_[node.tag] = *node.previousNodeForTag;
      } else {
        nodesByTag_.erase(node.tag);
      }
      if (node.previousTagForNode.has_value()) {
        tagsByNode_[node.node] = *node.previousTagForNode;
      } else {
        tagsByNode_.erase(node.node);
      }
      if (node.previousEvents.has_value()) {
        eventsByNode_[node.node] = *node.previousEvents;
      } else {
        eventsByNode_.erase(node.node);
      }
    }
    surface.store(stage.previousSurface, std::memory_order_release);
    sequence.store(stage.previousSequence, std::memory_order_release);
    stage.active = false;
  }

  void publishCommit(
      const folly::dynamic &transaction,
      const NodeIdentityMap &identities,
      int64_t committedSequence) {
    std::lock_guard lock(mutex_);
    for (const auto &[node, identity] : identities) {
      nodesByTag_[identity.tag] = node;
      tagsByNode_[node] = identity.tag;
    }

    if (transaction.isObject() && transaction.count("mutations") != 0) {
      const auto &mutations = transaction.at("mutations");
      if (mutations.isArray()) {
        for (const auto &mutation : mutations) {
          if (!mutation.isObject() || mutation.count("type") == 0 ||
              !mutation.at("type").isString()) {
            continue;
          }
          const auto &type = mutation.at("type").getString();
          if (type == "insert-child" || type == "remove-child") {
            if (mutation.count("parent") == 0 ||
                mutation.count("child") == 0) {
              continue;
            }
            const auto parent = dynamicInteger(mutation.at("parent"));
            const auto child = dynamicInteger(mutation.at("child"));
            if (parent <= 0 || child <= 0) continue;
            if (type == "insert-child") {
              parentsByNode_[child] = parent;
            } else {
              const auto parentEntry = parentsByNode_.find(child);
              if (parentEntry != parentsByNode_.end() &&
                  parentEntry->second == parent) {
                parentsByNode_.erase(parentEntry);
              }
            }
            continue;
          }
          if (mutation.count("node") == 0) continue;
          const auto node = dynamicInteger(mutation.at("node"));
          if (node <= 0) continue;
          if (type == "delete-node") {
            eventsByNode_.erase(node);
            parentsByNode_.erase(node);
            continue;
          }
          if (type != "update-event-listeners" ||
              mutation.count("events") == 0 ||
              !mutation.at("events").isArray()) {
            continue;
          }
          std::unordered_set<std::string> events;
          for (const auto &event : mutation.at("events")) {
            if (event.isString()) events.insert(event.getString());
          }
          eventsByNode_[node] = std::move(events);
        }
      }
    }
    sequence.store(committedSequence, std::memory_order_release);
  }

 private:
  mutable std::mutex mutex_;
  std::unordered_map<facebook::react::Tag, int64_t> nodesByTag_;
  std::unordered_map<int64_t, facebook::react::Tag> tagsByNode_;
  std::unordered_map<int64_t, int64_t> parentsByNode_;
  std::unordered_map<int64_t, std::unordered_set<std::string>> eventsByNode_;
};

facebook::react::UIManager &uiManager(Runtime &runtime) {
  auto binding = facebook::react::UIManagerBinding::getBinding(runtime);
  if (!binding) {
    throw JSError(
        runtime, "React Native did not install its UIManager binding.");
  }
  return binding->getUIManager();
}

void installEmptySurfaceStopHandler(Runtime &runtime) {
  auto global = runtime.global();
  auto existing = global.getProperty(runtime, "RN$stopSurface");
  if (existing.isObject() && existing.getObject(runtime).isFunction(runtime)) {
    return;
  }
  global.setProperty(
      runtime,
      "RN$stopSurface",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "RN$stopSurface"),
          1,
          [](Runtime &,
             const Value &,
             const Value *,
             size_t) -> Value { return Value(); }));
}

enum class AndroidViewOutput : size_t {
  Opacity = 0,
  TranslateX = 1,
  TranslateY = 2,
  ScaleX = 3,
  ScaleY = 4,
  Rotation = 5,
};

constexpr size_t AndroidViewOutputCount = 6;

AndroidViewOutput requireAndroidViewOutput(const std::string &name) {
  if (name == "opacity") return AndroidViewOutput::Opacity;
  if (name == "translateX") return AndroidViewOutput::TranslateX;
  if (name == "translateY") return AndroidViewOutput::TranslateY;
  if (name == "scaleX") return AndroidViewOutput::ScaleX;
  if (name == "scaleY") return AndroidViewOutput::ScaleY;
  if (name == "rotation") return AndroidViewOutput::Rotation;
  throw std::invalid_argument(
      "Android native view worklets do not support output channel " + name +
      ".");
}

struct AndroidUIWorkletTimingState final {
  std::vector<double> from;
  solid_native::worklets::UIWorkletTimingSequence definition;
  std::optional<int64_t> startedAtNanoseconds;
};

struct AndroidUIWorkletSpringState final {
  std::vector<double> from;
  std::vector<double> to;
  solid_native::worklets::UIWorkletSpring definition;
  std::optional<int64_t> startedAtNanoseconds;
};

struct AndroidUIWorkletDecayState final {
  std::vector<double> from;
  std::vector<double> velocities;
  double initialSpeed;
  solid_native::worklets::UIWorkletDecay definition;
  std::optional<int64_t> startedAtNanoseconds;
};

struct AndroidUIWorkletPanState final {
  solid_native::worklets::UIWorkletPanGesture definition;
  int64_t token;
  bool active{false};
  double originX{0};
  double originY{0};
  int64_t sequence{0};
  std::optional<double> timestamp;
};

struct AndroidUIWorkletState final {
  AndroidUIWorkletState(
      int64_t handleValue,
      int64_t targetNodeValue,
      facebook::react::Tag targetTagValue,
      solid_native::worklets::UIWorkletGraph graphValue,
      std::vector<AndroidViewOutput> channelValues)
      : handle(handleValue),
        targetNode(targetNodeValue),
        targetTag(targetTagValue),
        graph(std::move(graphValue)),
        channels(std::move(channelValues)),
        inputs(graph.initialInputs()),
        outputs(graph.evaluate(inputs)) {}

  mutable std::mutex mutex;
  const int64_t handle;
  const int64_t targetNode;
  const facebook::react::Tag targetTag;
  const solid_native::worklets::UIWorkletGraph graph;
  const std::vector<AndroidViewOutput> channels;
  std::vector<double> inputs;
  std::vector<solid_native::worklets::UIWorkletOutputValue> outputs;
  bool active{true};
  bool framePending{false};
  std::optional<int64_t> frameToken;
  bool hasTimestamp{false};
  double timestamp{0};
  int64_t sequence{0};
  int64_t appliedSequence{0};
  int64_t frameTimeNanoseconds{0};
  std::optional<AndroidUIWorkletTimingState> timing;
  double timingProgress{0};
  solid_native::worklets::UIWorkletFrameStatistics timingFrameStatistics;
  std::optional<AndroidUIWorkletSpringState> spring;
  std::optional<double> springPosition;
  std::optional<double> springVelocity;
  solid_native::worklets::UIWorkletFrameStatistics springFrameStatistics;
  std::optional<AndroidUIWorkletDecayState> decay;
  std::optional<double> decayElapsedMilliseconds;
  std::optional<double> decaySpeed;
  solid_native::worklets::UIWorkletFrameStatistics decayFrameStatistics;
  std::optional<AndroidUIWorkletPanState> pan;
  bool applied{false};
};

Object makeUIWorkletFrameStatistics(
    Runtime &runtime,
    const solid_native::worklets::UIWorkletFrameStatisticsSnapshot &value) {
  Object statistics(runtime);
  statistics.setProperty(
      runtime, "frameCount", static_cast<double>(value.frameCount));
  statistics.setProperty(
      runtime, "intervalCount", static_cast<double>(value.intervalCount));
  statistics.setProperty(
      runtime,
      "sampledIntervalCount",
      static_cast<double>(value.sampledIntervalCount));
  statistics.setProperty(
      runtime,
      "droppedIntervalSampleCount",
      static_cast<double>(value.droppedIntervalSampleCount));
  statistics.setProperty(
      runtime,
      "firstFrameTimeMilliseconds",
      value.firstFrameTimeMilliseconds);
  statistics.setProperty(
      runtime,
      "lastFrameTimeMilliseconds",
      value.lastFrameTimeMilliseconds);
  statistics.setProperty(
      runtime,
      "minimumFrameIntervalMilliseconds",
      value.minimumFrameIntervalMilliseconds);
  statistics.setProperty(
      runtime,
      "maximumFrameIntervalMilliseconds",
      value.maximumFrameIntervalMilliseconds);
  statistics.setProperty(
      runtime,
      "meanFrameIntervalMilliseconds",
      value.meanFrameIntervalMilliseconds);
  statistics.setProperty(
      runtime,
      "p50FrameIntervalMilliseconds",
      value.p50FrameIntervalMilliseconds);
  statistics.setProperty(
      runtime,
      "p95FrameIntervalMilliseconds",
      value.p95FrameIntervalMilliseconds);
  statistics.setProperty(
      runtime,
      "p99FrameIntervalMilliseconds",
      value.p99FrameIntervalMilliseconds);
  return statistics;
}

std::atomic<int64_t> nextUIWorkletHandle{1};
std::atomic<int64_t> nextUIWorkletFrameToken{1};
std::atomic<int64_t> nextUIWorkletPanToken{1};
std::mutex uiWorkletFrameMutex;
std::unordered_map<int64_t, std::shared_ptr<AndroidUIWorkletState>>
    uiWorkletFrames;
std::mutex uiWorkletPanMutex;
std::unordered_map<int64_t, std::shared_ptr<AndroidUIWorkletState>>
    uiWorkletPans;

void requestJavaUIWorkletFrame(int64_t token);
void discardUIWorkletFrame(int64_t token) noexcept;
bool attachJavaUIWorkletPan(int64_t token, facebook::react::Tag targetTag);
void detachJavaUIWorkletPan(int64_t token) noexcept;
bool applyJavaUIWorkletFrame(
    int64_t handle,
    facebook::react::Tag targetTag,
    int64_t sequence,
    int64_t frameTimeNanoseconds,
    const std::array<double, AndroidViewOutputCount> &values);

int64_t retainUIWorkletPan(
    const std::shared_ptr<AndroidUIWorkletState> &state) {
  const auto token =
      nextUIWorkletPanToken.fetch_add(1, std::memory_order_relaxed);
  if (token <= 0 || token > static_cast<int64_t>(MaximumSafeInteger)) {
    throw std::runtime_error(
        "The Android UI worklet pan token space is exhausted.");
  }
  std::lock_guard lock(uiWorkletPanMutex);
  if (uiWorkletPans.size() >= MaximumActiveUIWorklets) {
    throw std::runtime_error(
        "The Android UI worklet pan registry is full.");
  }
  uiWorkletPans.emplace(token, state);
  return token;
}

void discardUIWorkletPan(int64_t token) noexcept {
  std::lock_guard lock(uiWorkletPanMutex);
  uiWorkletPans.erase(token);
}

void deactivateAndroidUIWorklet(
    const std::shared_ptr<AndroidUIWorkletState> &state) {
  int64_t panToken = 0;
  std::optional<int64_t> frameToken;
  {
    std::lock_guard lock(state->mutex);
    state->active = false;
    state->framePending = false;
    frameToken = state->frameToken;
    state->frameToken.reset();
    if (state->pan.has_value()) {
      state->pan->active = false;
      panToken = state->pan->token;
    }
  }
  if (frameToken.has_value()) discardUIWorkletFrame(*frameToken);
  if (panToken > 0) {
    detachJavaUIWorkletPan(panToken);
    discardUIWorkletPan(panToken);
  }
}

int64_t retainUIWorkletFrame(
    const std::shared_ptr<AndroidUIWorkletState> &state) {
  const auto token =
      nextUIWorkletFrameToken.fetch_add(1, std::memory_order_relaxed);
  if (token <= 0 || token > static_cast<int64_t>(MaximumSafeInteger)) {
    throw std::runtime_error(
        "The Android UI worklet frame token space is exhausted.");
  }
  std::lock_guard lock(uiWorkletFrameMutex);
  if (uiWorkletFrames.size() >= MaximumActiveUIWorklets) {
    throw std::runtime_error(
        "The Android UI worklet frame queue is full.");
  }
  uiWorkletFrames.emplace(token, state);
  return token;
}

void discardUIWorkletFrame(int64_t token) noexcept {
  std::lock_guard lock(uiWorkletFrameMutex);
  uiWorkletFrames.erase(token);
}

void scheduleUIWorkletFrame(
    const std::shared_ptr<AndroidUIWorkletState> &state) {
  int64_t token;
  {
    std::lock_guard lock(state->mutex);
    if (!state->active || state->framePending) return;
    state->framePending = true;
    try {
      token = retainUIWorkletFrame(state);
      state->frameToken = token;
    } catch (...) {
      state->framePending = false;
      state->frameToken.reset();
      throw;
    }
  }
  try {
    requestJavaUIWorkletFrame(token);
  } catch (...) {
    discardUIWorkletFrame(token);
    std::lock_guard lock(state->mutex);
    state->framePending = false;
    state->frameToken.reset();
    throw;
  }
}

class AndroidUIWorkletRegistry final {
 public:
  int64_t install(
      int64_t targetNode,
      facebook::react::Tag targetTag,
      solid_native::worklets::UIWorkletGraph graph) {
    std::vector<AndroidViewOutput> channels;
    channels.reserve(graph.outputNames().size());
    for (const auto &name : graph.outputNames()) {
      channels.push_back(requireAndroidViewOutput(name));
    }
    graph.evaluate(graph.initialInputs());
    const auto handle =
        nextUIWorkletHandle.fetch_add(1, std::memory_order_relaxed);
    if (handle <= 0 || handle > static_cast<int64_t>(MaximumSafeInteger)) {
      throw std::runtime_error(
          "The Android UI worklet handle space is exhausted.");
    }
    auto state = std::make_shared<AndroidUIWorkletState>(
        handle,
        targetNode,
        targetTag,
        std::move(graph),
        std::move(channels));
    {
      std::lock_guard lock(mutex_);
      if (active_.size() >= MaximumActiveUIWorklets) {
        throw std::runtime_error(
            "The Android UI worklet registry is full.");
      }
      active_.emplace(handle, state);
      issued_.insert(handle);
    }
    try {
      scheduleUIWorkletFrame(state);
    } catch (...) {
      destroy(handle);
      throw;
    }
    return handle;
  }

  void update(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet input vector is owned by its native pan gesture.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      // Validate the entire candidate frame before publishing any input.
      state->graph.evaluate(inputs);
      state->inputs = std::move(inputs);
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      state->timing.reset();
      state->timingProgress = 0;
      state->timingFrameStatistics.reset();
      state->spring.reset();
      state->springPosition.reset();
      state->springVelocity.reset();
      state->springFrameStatistics.reset();
      state->decay.reset();
      state->decayElapsedMilliseconds.reset();
      state->decaySpeed.reset();
      state->decayFrameStatistics.reset();
    }
    scheduleUIWorkletFrame(state);
  }

  void animate(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp,
      solid_native::worklets::UIWorkletTiming timing) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet input vector is owned by its native pan gesture.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      // Validate the complete target before replacing an active timing.
      state->graph.evaluate(inputs);
      std::vector<solid_native::worklets::UIWorkletTimingKeyframe> keyframes;
      keyframes.push_back({.inputs = std::move(inputs), .timing = timing});
      state->timing = AndroidUIWorkletTimingState{
          .from = state->inputs,
          .definition = {
              .keyframes = std::move(keyframes),
              .totalDurationMilliseconds = timing.durationMilliseconds,
          },
      };
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      state->timingProgress = 0;
      state->timingFrameStatistics.reset();
      state->spring.reset();
      state->springPosition.reset();
      state->springVelocity.reset();
      state->springFrameStatistics.reset();
      state->decay.reset();
      state->decayElapsedMilliseconds.reset();
      state->decaySpeed.reset();
      state->decayFrameStatistics.reset();
    }
    scheduleUIWorkletFrame(state);
  }

  void animateKeyframes(
      int64_t handle,
      solid_native::worklets::UIWorkletTimingSequence keyframes,
      double timestamp) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet input vector is owned by its native pan gesture.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      // Reject any invalid terminal before replacing the active driver.
      for (const auto &keyframe : keyframes.keyframes) {
        state->graph.evaluate(keyframe.inputs);
      }
      state->timing = AndroidUIWorkletTimingState{
          .from = state->inputs,
          .definition = std::move(keyframes),
      };
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      state->timingProgress = 0;
      state->timingFrameStatistics.reset();
      state->spring.reset();
      state->springPosition.reset();
      state->springVelocity.reset();
      state->springFrameStatistics.reset();
      state->decay.reset();
      state->decayElapsedMilliseconds.reset();
      state->decaySpeed.reset();
      state->decayFrameStatistics.reset();
    }
    scheduleUIWorkletFrame(state);
  }

  void spring(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp,
      solid_native::worklets::UIWorkletSpring spring) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet input vector is owned by its native pan gesture.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      state->graph.evaluate(inputs);
      state->timing.reset();
      state->timingProgress = 0;
      state->timingFrameStatistics.reset();
      state->spring = AndroidUIWorkletSpringState{
          .from = state->inputs,
          .to = std::move(inputs),
          .definition = spring,
      };
      state->springPosition = 0;
      state->springVelocity = spring.initialVelocity;
      state->springFrameStatistics.reset();
      state->decay.reset();
      state->decayElapsedMilliseconds.reset();
      state->decaySpeed.reset();
      state->decayFrameStatistics.reset();
      state->timestamp = timestamp;
      state->hasTimestamp = true;
    }
    scheduleUIWorkletFrame(state);
  }

  void decay(
      int64_t handle,
      std::vector<double> velocities,
      double timestamp,
      solid_native::worklets::UIWorkletDecay decay) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet input vector is owned by its native pan gesture.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      if (velocities.size() != state->inputs.size()) {
        throw std::invalid_argument(
            "UI worklet decay velocities must match the input vector.");
      }
      double initialSpeed = 0;
      for (const auto velocity : velocities) {
        if (!std::isfinite(velocity) ||
            std::abs(velocity) >
                solid_native::worklets::MaximumUIWorkletDecayVelocity) {
          throw std::invalid_argument(
              "UI worklet decay velocity is outside its bounded range.");
        }
        initialSpeed = std::max(initialSpeed, std::abs(velocity));
      }
      const auto terminal = decay.evaluate(
          initialSpeed, decay.maximumDurationMilliseconds);
      auto terminalInputs = state->inputs;
      for (size_t index = 0; index < terminalInputs.size(); ++index) {
        terminalInputs.at(index) +=
            velocities.at(index) * terminal.displacementFactorSeconds;
      }
      state->graph.evaluate(terminalInputs);
      state->timing.reset();
      state->timingProgress = 0;
      state->timingFrameStatistics.reset();
      state->spring.reset();
      state->springPosition.reset();
      state->springVelocity.reset();
      state->springFrameStatistics.reset();
      state->decay = AndroidUIWorkletDecayState{
          .from = state->inputs,
          .velocities = std::move(velocities),
          .initialSpeed = initialSpeed,
          .definition = decay,
      };
      state->decayElapsedMilliseconds = 0;
      state->decaySpeed = initialSpeed;
      state->decayFrameStatistics.reset();
      state->timestamp = timestamp;
      state->hasTimestamp = true;
    }
    scheduleUIWorkletFrame(state);
  }

  std::vector<double> cancelAnimation(int64_t handle, double timestamp) {
    auto state = requireActive(handle);
    std::optional<int64_t> frameToken;
    std::vector<double> inputs;
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      const auto hadDriver = state->timing.has_value() ||
          state->spring.has_value() || state->decay.has_value();
      state->timing.reset();
      state->spring.reset();
      if (state->springVelocity.has_value()) state->springVelocity = 0;
      state->decay.reset();
      if (state->decaySpeed.has_value()) state->decaySpeed = 0;
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      if (hadDriver) {
        state->framePending = false;
        frameToken = state->frameToken;
        state->frameToken.reset();
      }
      inputs = state->inputs;
    }
    if (frameToken.has_value()) discardUIWorkletFrame(*frameToken);
    return inputs;
  }

  std::shared_ptr<AndroidUIWorkletState> attachPan(
      int64_t handle,
      solid_native::worklets::UIWorkletPanGesture pan) {
    auto state = requireActive(handle);
    const auto token = retainUIWorkletPan(state);
    try {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet graph already owns a native pan gesture.");
      }
      state->pan = AndroidUIWorkletPanState{
          .definition = std::move(pan),
          .token = token,
      };
    } catch (...) {
      discardUIWorkletPan(token);
      throw;
    }
    return state;
  }

  void detachPan(int64_t handle) {
    auto state = requireActive(handle);
    int64_t token = 0;
    {
      std::lock_guard lock(state->mutex);
      if (state->pan.has_value()) {
        state->pan->active = false;
        token = state->pan->token;
      }
      state->pan.reset();
    }
    if (token > 0) {
      detachJavaUIWorkletPan(token);
      discardUIWorkletPan(token);
    }
  }

  std::vector<double> releasePan(int64_t handle, double timestamp) {
    auto state = requireActive(handle);
    int64_t panToken = 0;
    std::optional<int64_t> frameToken;
    std::vector<double> inputs;
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The Android UI worklet graph is no longer active.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      if (!state->pan.has_value()) {
        throw std::invalid_argument(
            "The Android UI worklet graph does not own a native pan gesture.");
      }
      const auto hadDriver = state->timing.has_value() ||
          state->spring.has_value() || state->decay.has_value();
      state->pan->active = false;
      panToken = state->pan->token;
      state->pan.reset();
      state->timing.reset();
      state->spring.reset();
      if (state->springVelocity.has_value()) state->springVelocity = 0;
      state->decay.reset();
      if (state->decaySpeed.has_value()) state->decaySpeed = 0;
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      if (hadDriver) {
        state->framePending = false;
        frameToken = state->frameToken;
        state->frameToken.reset();
      }
      inputs = state->inputs;
    }
    if (frameToken.has_value()) discardUIWorkletFrame(*frameToken);
    detachJavaUIWorkletPan(panToken);
    discardUIWorkletPan(panToken);
    return inputs;
  }

  void destroy(int64_t handle) {
    std::shared_ptr<AndroidUIWorkletState> state;
    {
      std::lock_guard lock(mutex_);
      if (issued_.erase(handle) == 0) {
        throw std::invalid_argument(
            "Unknown Android UI worklet graph handle " +
            std::to_string(handle) + ".");
      }
      const auto entry = active_.find(handle);
      if (entry != active_.end()) {
        state = std::move(entry->second);
        active_.erase(entry);
      }
    }
    if (state) deactivateAndroidUIWorklet(state);
  }

  void cancelNode(int64_t targetNode) {
    std::vector<std::shared_ptr<AndroidUIWorkletState>> cancelled;
    {
      std::lock_guard lock(mutex_);
      for (auto iterator = active_.begin(); iterator != active_.end();) {
        if (iterator->second->targetNode != targetNode) {
          ++iterator;
          continue;
        }
        cancelled.push_back(iterator->second);
        iterator = active_.erase(iterator);
      }
    }
    for (const auto &state : cancelled) {
      deactivateAndroidUIWorklet(state);
    }
  }

  void cancelAll() {
    std::vector<std::shared_ptr<AndroidUIWorkletState>> cancelled;
    {
      std::lock_guard lock(mutex_);
      for (const auto &[_, state] : active_) cancelled.push_back(state);
      active_.clear();
      issued_.clear();
    }
    for (const auto &state : cancelled) {
      deactivateAndroidUIWorklet(state);
    }
  }

  size_t activeCount() const {
    std::lock_guard lock(mutex_);
    return active_.size();
  }

  std::pair<size_t, size_t> activityCounts() const {
    std::lock_guard lock(mutex_);
    size_t pendingFrameCount = 0;
    for (const auto &[_, state] : active_) {
      std::lock_guard lock(state->mutex);
      if (state->active && state->framePending) pendingFrameCount++;
    }
    return {active_.size(), pendingFrameCount};
  }

  std::shared_ptr<AndroidUIWorkletState> requireActive(int64_t handle) const {
    std::lock_guard lock(mutex_);
    const auto entry = active_.find(handle);
    if (entry == active_.end()) {
      throw std::invalid_argument(
          "Unknown or cancelled Android UI worklet graph handle " +
          std::to_string(handle) + ".");
    }
    return entry->second;
  }

 private:
  mutable std::mutex mutex_;
  std::unordered_map<int64_t, std::shared_ptr<AndroidUIWorkletState>> active_;
  std::unordered_set<int64_t> issued_;
};

struct RetiredInstances final {
  int64_t fabricRevision;
  std::vector<int64_t> handles;
};

class RuntimeState final : public facebook::jsi::NativeState {
 public:
  RuntimeState(
      Runtime &runtime,
      const Object &storage,
      std::shared_ptr<EventRoutingState> routing)
      : storage_(runtime, storage), routing_(std::move(routing)) {}

  ~RuntimeState() override {
    deactivateNativeWork();
    if (runtimeRetirementHandler_) runtimeRetirementHandler_();
  }

  void setRuntimeRetirementHandler(std::function<void()> handler) {
    runtimeRetirementHandler_ = std::move(handler);
  }

  Object storage(Runtime &runtime) const {
    auto value = storage_.lock(runtime);
    if (!value.isObject()) {
      throw std::runtime_error(
          "The Solid Native runtime storage was collected unexpectedly.");
    }
    return value.getObject(runtime);
  }

  Object instances(Runtime &runtime) const {
    return storage(runtime).getPropertyAsObject(runtime, "instances");
  }

  Object resources(Runtime &runtime) const {
    return storage(runtime).getPropertyAsObject(runtime, "resources");
  }

  int64_t retainResource(
      Runtime &runtime,
      const std::string &kind,
      const Value &value) {
    if (resourceKinds_.size() >= MaximumRetainedResources) {
      throw std::runtime_error(
          "The Solid Native runtime resource registry is full.");
    }
    if (nextResourceHandle_ > 9007199254740991LL) {
      throw std::runtime_error(
          "The Solid Native runtime exhausted native resource handles.");
    }
    const auto handle = nextResourceHandle_++;
    const auto key = std::to_string(handle);
    resources(runtime).setProperty(
        runtime, key.c_str(), Value(runtime, value));
    resourceKinds_.emplace(handle, kind);
    return handle;
  }

  Value resolveResource(
      Runtime &runtime,
      int64_t handle,
      const std::string &kind) const {
    const auto resource = resourceKinds_.find(handle);
    if (resource == resourceKinds_.end()) {
      throw std::invalid_argument(
          "Native resource " + std::to_string(handle) +
          " is not retained.");
    }
    if (resource->second != kind) {
      throw std::invalid_argument(
          "Native resource " + std::to_string(handle) +
          " has kind " + resource->second + ", not " + kind + ".");
    }
    const auto key = std::to_string(handle);
    return resources(runtime).getProperty(runtime, key.c_str());
  }

  void releaseResource(Runtime &runtime, int64_t handle) {
    if (resourceKinds_.erase(handle) == 0) {
      throw std::invalid_argument(
          "Native resource " + std::to_string(handle) +
          " is not retained.");
    }
    const auto key = std::to_string(handle);
    resources(runtime).deleteProperty(runtime, key.c_str());
  }

  void reclaimAllResources(Runtime &runtime) {
    const auto handles = resourceKinds_;
    for (const auto &[handle, _] : handles) {
      const auto key = std::to_string(handle);
      resources(runtime).deleteProperty(runtime, key.c_str());
    }
    resourceKinds_.clear();
  }

  size_t retainedResourceCount() const {
    return resourceKinds_.size();
  }

  bool hasInstance(Runtime &runtime, int64_t handle) const {
    const auto key = std::to_string(handle);
    return instances(runtime).hasProperty(runtime, key.c_str());
  }

  void retainInstance(Runtime &runtime, int64_t handle, Value &&value) {
    const auto key = std::to_string(handle);
    instances(runtime).setProperty(runtime, key.c_str(), std::move(value));
    retainedHandles_.insert(handle);
  }

  void releaseInstance(Runtime &runtime, int64_t handle) {
    if (retainedHandles_.erase(handle) == 0) return;
    uiWorklets_.cancelNode(handle);
    const auto key = std::to_string(handle);
    instances(runtime).deleteProperty(runtime, key.c_str());
    routing_->reclaimNode(handle);
  }

  size_t retainedNodeCount() const {
    return retainedHandles_.size();
  }

  int64_t installUIWorklet(
      Runtime &runtime,
      int64_t targetNode,
      const Value &graphValue) {
    if (!hasInstance(runtime, targetNode)) {
      throw std::invalid_argument(
          "A native UI worklet target must be a live Solid Native node.");
    }
    const auto targetTag = routing_->tagForNode(targetNode);
    if (!targetTag.has_value()) {
      throw std::invalid_argument(
          "A native UI worklet target must have a committed Fabric identity.");
    }
    size_t valueCount = 0;
    std::vector<Value> ancestors;
    auto graph = dynamicFromJSI(
        runtime,
        graphValue,
        "UI worklet graph",
        0,
        valueCount,
        ancestors);
    return uiWorklets_.install(
        targetNode,
        *targetTag,
        solid_native::worklets::UIWorkletGraph::parse(graph));
  }

  void updateUIWorklet(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp) {
    uiWorklets_.update(handle, std::move(inputs), timestamp);
  }

  void animateUIWorklet(
      Runtime &runtime,
      int64_t handle,
      std::vector<double> inputs,
      double timestamp,
      const Value &timingValue) {
    size_t valueCount = 0;
    std::vector<Value> ancestors;
    auto timing = dynamicFromJSI(
        runtime,
        timingValue,
        "UI worklet timing",
        0,
        valueCount,
        ancestors);
    uiWorklets_.animate(
        handle,
        std::move(inputs),
        timestamp,
        solid_native::worklets::UIWorkletTiming::parse(timing));
  }

  void animateUIWorkletKeyframes(
      Runtime &runtime,
      int64_t handle,
      const Value &keyframesValue,
      double timestamp) {
    auto state = uiWorklets_.requireActive(handle);
    size_t valueCount = 0;
    std::vector<Value> ancestors;
    auto keyframes = dynamicFromJSI(
        runtime,
        keyframesValue,
        "UI worklet timing keyframes",
        0,
        valueCount,
        ancestors);
    uiWorklets_.animateKeyframes(
        handle,
        solid_native::worklets::UIWorkletTimingSequence::parse(
            keyframes, state->graph.inputCount()),
        timestamp);
  }

  void springUIWorklet(
      Runtime &runtime,
      int64_t handle,
      std::vector<double> inputs,
      double timestamp,
      const Value &springValue) {
    size_t valueCount = 0;
    std::vector<Value> ancestors;
    auto spring = dynamicFromJSI(
        runtime,
        springValue,
        "UI worklet spring",
        0,
        valueCount,
        ancestors);
    uiWorklets_.spring(
        handle,
        std::move(inputs),
        timestamp,
        solid_native::worklets::UIWorkletSpring::parse(spring));
  }

  void decayUIWorklet(
      Runtime &runtime,
      int64_t handle,
      std::vector<double> velocities,
      double timestamp,
      const Value &decayValue) {
    size_t valueCount = 0;
    std::vector<Value> ancestors;
    auto decay = dynamicFromJSI(
        runtime,
        decayValue,
        "UI worklet decay",
        0,
        valueCount,
        ancestors);
    uiWorklets_.decay(
        handle,
        std::move(velocities),
        timestamp,
        solid_native::worklets::UIWorkletDecay::parse(decay));
  }

  std::vector<double> cancelUIWorkletAnimation(
      int64_t handle,
      double timestamp) {
    return uiWorklets_.cancelAnimation(handle, timestamp);
  }

  std::shared_ptr<AndroidUIWorkletState> attachUIWorkletPan(
      Runtime &runtime,
      int64_t handle,
      const Value &panValue) {
    auto state = uiWorklets_.requireActive(handle);
    size_t valueCount = 0;
    std::vector<Value> ancestors;
    auto pan = dynamicFromJSI(
        runtime,
        panValue,
        "UI worklet pan gesture",
        0,
        valueCount,
        ancestors);
    return uiWorklets_.attachPan(
        handle,
        solid_native::worklets::UIWorkletPanGesture::parse(
            pan, state->graph));
  }

  void detachUIWorkletPan(int64_t handle) {
    uiWorklets_.detachPan(handle);
  }

  std::vector<double> releaseUIWorkletPan(
      int64_t handle,
      double timestamp) {
    return uiWorklets_.releasePan(handle, timestamp);
  }

  void destroyUIWorklet(int64_t handle) {
    uiWorklets_.destroy(handle);
  }

  std::shared_ptr<AndroidUIWorkletState> requireUIWorklet(
      int64_t handle) const {
    return uiWorklets_.requireActive(handle);
  }

  size_t activeUIWorkletCount() const {
    return uiWorklets_.activeCount();
  }

  std::pair<size_t, size_t> uiWorkletActivityCounts() const {
    return uiWorklets_.activityCounts();
  }

  void cancelAllUIWorklets() {
    uiWorklets_.cancelAll();
  }

  void deactivateNativeWork() {
    cancelAllUIWorklets();
    deactivateEvents();
  }

  void cancelDeletedUIWorklets(const std::vector<int64_t> &handles) {
    for (const auto handle : handles) uiWorklets_.cancelNode(handle);
  }

  void retireInstances(
      int64_t fabricRevision,
      const std::vector<int64_t> &handles) {
    std::vector<int64_t> retainedHandles;
    retainedHandles.reserve(handles.size());
    for (const auto handle : handles) {
      if (retainedHandles_.contains(handle) &&
          !isPendingRetirement(handle)) {
        retainedHandles.push_back(handle);
      }
    }
    if (!retainedHandles.empty()) {
      retiredInstances_.push_back({
          .fabricRevision = fabricRevision,
          .handles = std::move(retainedHandles),
      });
    }
  }

  void reclaimMountedInstances(
      Runtime &runtime,
      int64_t mountedFabricRevision) {
    auto iterator = retiredInstances_.begin();
    while (iterator != retiredInstances_.end()) {
      if (iterator->fabricRevision > mountedFabricRevision) {
        iterator++;
        continue;
      }
      for (const auto handle : iterator->handles) {
        releaseInstance(runtime, handle);
      }
      iterator = retiredInstances_.erase(iterator);
    }
  }

  void reclaimAllInstances(Runtime &runtime) {
    const std::vector<int64_t> handles(
        retainedHandles_.begin(), retainedHandles_.end());
    for (const auto handle : handles) releaseInstance(runtime, handle);
    retiredInstances_.clear();
  }

  void setEventHandler(Runtime &runtime, const Value &handler) {
    storage(runtime).setProperty(
        runtime, "eventHandler", Value(runtime, handler));
    routing_->handlerInstalled.store(
        handler.isObject() && handler.getObject(runtime).isFunction(runtime),
        std::memory_order_release);
  }

  Value eventHandler(Runtime &runtime) const {
    return storage(runtime).getProperty(runtime, "eventHandler");
  }

  void publishCommit(
      const folly::dynamic &transaction,
      const NodeIdentityMap &identities,
      int64_t sequence) {
    routing_->surface.store(
        dynamicInteger(transaction.at("surface")),
        std::memory_order_release);
    routing_->publishCommit(transaction, identities, sequence);
  }

  EventRoutingState::LayoutRouteStage stageLayoutRoutes(
      const folly::dynamic &transaction,
      const NodeIdentityMap &identities) {
    return routing_->stageLayoutRoutes(transaction, identities);
  }

  void finishLayoutRoutes(EventRoutingState::LayoutRouteStage &stage) {
    routing_->finishLayoutRoutes(stage);
  }

  void rollbackLayoutRoutes(EventRoutingState::LayoutRouteStage &stage) {
    routing_->rollbackLayoutRoutes(stage);
  }

  void setEventListener(
      std::shared_ptr<const facebook::react::EventListener> listener) {
    eventListener_ = std::move(listener);
  }

  void attachEventListener(facebook::react::UIManager &manager) {
    if (eventListenerAttached_ || !eventListener_) return;
    manager.addEventListener(eventListener_);
    eventListenerAttached_ = true;
  }

  void detachEventListener(facebook::react::UIManager &manager) {
    if (!eventListenerAttached_ || !eventListener_) return;
    manager.removeEventListener(eventListener_);
    eventListenerAttached_ = false;
  }

  void deactivateEvents() {
    routing_->active.store(false, std::memory_order_release);
    routing_->handlerInstalled.store(false, std::memory_order_release);
  }

  void setCommitLifecycleHandler(Runtime &runtime, const Value &handler) {
    storage(runtime).setProperty(
        runtime, "commitLifecycleHandler", Value(runtime, handler));
    commitLifecycleHandlerInstalled_ =
        handler.isObject() && handler.getObject(runtime).isFunction(runtime);
  }

  Value commitLifecycleHandler(Runtime &runtime) const {
    return storage(runtime).getProperty(runtime, "commitLifecycleHandler");
  }

  bool hasCommitLifecycleHandler() const {
    return commitLifecycleHandlerInstalled_;
  }

  bool active() const {
    return routing_->active.load(std::memory_order_acquire);
  }

 private:
  bool isPendingRetirement(int64_t handle) const {
    return std::any_of(
        retiredInstances_.begin(),
        retiredInstances_.end(),
        [handle](const RetiredInstances &retired) {
          return std::find(
                     retired.handles.begin(),
                     retired.handles.end(),
                     handle) != retired.handles.end();
        });
  }

  facebook::jsi::WeakObject storage_;
  std::shared_ptr<EventRoutingState> routing_;
  std::shared_ptr<const facebook::react::EventListener> eventListener_;
  bool eventListenerAttached_{false};
  std::unordered_set<int64_t> retainedHandles_;
  std::vector<RetiredInstances> retiredInstances_;
  int64_t nextResourceHandle_{1};
  std::unordered_map<int64_t, std::string> resourceKinds_;
  std::function<void()> runtimeRetirementHandler_;
  bool commitLifecycleHandlerInstalled_{false};
  AndroidUIWorkletRegistry uiWorklets_;
};

std::shared_ptr<facebook::react::EventListener> createEventListener(
    const std::shared_ptr<EventRoutingState> &routing,
    const std::shared_ptr<facebook::react::RuntimeScheduler> &runtimeScheduler,
    const std::weak_ptr<RuntimeState> &runtimeState) {
  std::weak_ptr<facebook::react::RuntimeScheduler> weakScheduler =
      runtimeScheduler;
  return std::make_shared<facebook::react::EventListener>(
      [routing, weakScheduler, runtimeState](
          const facebook::react::RawEvent &event) -> bool {
        auto family = event.shadowNodeFamily.lock();
        if (!family || family->getSurfaceId() !=
                routing->surface.load(std::memory_order_acquire)) {
          return false;
        }
        auto route = routing->route(family->getTag(), event.type);
        if (!route.has_value()) return false;
        if (!routing->active.load(std::memory_order_acquire) ||
            !routing->handlerInstalled.load(std::memory_order_acquire) ||
            route->empty() || !event.eventPayload) {
          return true;
        }
        auto scheduler = weakScheduler.lock();
        if (!scheduler) return true;

        const auto surface = family->getSurfaceId();
        const auto observedSequence =
            routing->sequence.load(std::memory_order_acquire);
        const auto timestamp =
            event.eventStartTimeStamp.toDOMHighResTimeStamp();
        const auto coalescible = event.isUnique;
        const auto payload = event.eventPayload;
        for (const auto &routedEvent : *route) {
          const auto node = routedEvent.node;
          const auto name = routedEvent.name;
          const auto priority =
              std::string(semanticEventPriority(name, event.category));
          const auto bubbles = eventBubbles(name);
          scheduler->scheduleWork(
              [routing,
               runtimeState,
               payload,
               surface,
               node,
               observedSequence,
               name,
               timestamp,
               priority,
               bubbles,
               coalescible](Runtime &runtime) {
                if (!routing->active.load(std::memory_order_acquire)) return;
                if (!routing->isSubscribed(node, name)) return;
                auto state = runtimeState.lock();
                if (!state) return;
                auto handlerValue = state->eventHandler(runtime);
                if (!handlerValue.isObject()) return;
                auto handlerObject = handlerValue.getObject(runtime);
                if (!handlerObject.isFunction(runtime)) return;

                Object nativeEvent(runtime);
                nativeEvent.setProperty(
                    runtime, "surface", static_cast<double>(surface));
                nativeEvent.setProperty(
                    runtime, "target", static_cast<double>(node));
                nativeEvent.setProperty(
                    runtime,
                    "observedSequence",
                    static_cast<double>(observedSequence));
                nativeEvent.setProperty(
                    runtime,
                    "name",
                    String::createFromUtf8(runtime, name));
                nativeEvent.setProperty(runtime, "timestamp", timestamp);
                nativeEvent.setProperty(
                    runtime,
                    "priority",
                    String::createFromUtf8(runtime, priority));
                nativeEvent.setProperty(runtime, "bubbles", bubbles);
                nativeEvent.setProperty(
                    runtime, "coalescible", coalescible);
                nativeEvent.setProperty(
                    runtime, "payload", payload->asJSIValue(runtime));
                handlerObject
                    .getFunction(runtime)
                    .call(runtime, nativeEvent);
              });
        }
        return true;
      });
}

struct CommitMountObservation final {
  int64_t surface;
  int64_t sequence;
  int64_t fabricRevision;
  double commitStartedAt;
  double commitStartedMonotonic;
  bool notifyLifecycle;
  std::optional<std::string> causalOperationId;
};

struct CommitFrameObservation final {
  std::weak_ptr<facebook::react::RuntimeScheduler> runtimeScheduler;
  std::weak_ptr<RuntimeState> runtimeState;
  std::shared_ptr<const CommitMountObservation> commit;
  double mountedAt;
  double mountedMonotonic;
};

constexpr size_t MaximumPendingFrameObservations = 256;
std::atomic<int64_t> nextFrameObservationToken{1};
std::mutex frameObservationMutex;
std::unordered_map<
    int64_t,
    std::shared_ptr<const CommitFrameObservation>>
    frameObservations;

void requestJavaCommitFrame(int64_t token);

int64_t retainFrameObservation(
    std::shared_ptr<const CommitFrameObservation> observation) {
  const auto token =
      nextFrameObservationToken.fetch_add(1, std::memory_order_relaxed);
  std::lock_guard lock(frameObservationMutex);
  if (frameObservations.size() >= MaximumPendingFrameObservations) {
    frameObservations.erase(frameObservations.begin());
  }
  frameObservations.emplace(token, std::move(observation));
  return token;
}

void discardFrameObservation(int64_t token) noexcept {
  std::lock_guard lock(frameObservationMutex);
  frameObservations.erase(token);
}

void onJavaCommitFrame(
    facebook::jni::alias_ref<jclass>,
    jlong token) {
  std::shared_ptr<const CommitFrameObservation> frame;
  {
    std::lock_guard lock(frameObservationMutex);
    const auto entry = frameObservations.find(token);
    if (entry == frameObservations.end()) return;
    frame = std::move(entry->second);
    frameObservations.erase(entry);
  }

  auto runtimeScheduler = frame->runtimeScheduler.lock();
  if (!runtimeScheduler) return;
  const auto frameStartedAt = wallClockMilliseconds();
  const auto frameStartedMonotonic = monotonicMilliseconds();
  const auto frameLatency = std::max(
      0.0,
      frameStartedMonotonic - frame->commit->commitStartedMonotonic);
  const auto mountToFrameLatency =
      std::max(0.0, frameStartedMonotonic - frame->mountedMonotonic);
  runtimeScheduler->scheduleWork(
      [runtimeState = frame->runtimeState,
       observation = frame->commit,
       mountedAt = frame->mountedAt,
       frameStartedAt,
       frameLatency,
       mountToFrameLatency](Runtime &runtime) {
        auto state = runtimeState.lock();
        if (!state || !state->active() ||
            !state->hasCommitLifecycleHandler()) {
          return;
        }
        auto handlerValue = state->commitLifecycleHandler(runtime);
        if (!handlerValue.isObject()) return;
        auto handlerObject = handlerValue.getObject(runtime);
        if (!handlerObject.isFunction(runtime)) return;

        Object event(runtime);
        event.setProperty(
            runtime,
            "type",
            String::createFromAscii(runtime, "commit-frame"));
        event.setProperty(
            runtime,
            "surface",
            static_cast<double>(observation->surface));
        event.setProperty(
            runtime,
            "sequence",
            static_cast<double>(observation->sequence));
        event.setProperty(
            runtime,
            "hostRevision",
            static_cast<double>(observation->fabricRevision));
        event.setProperty(runtime, "mountedAt", mountedAt);
        event.setProperty(runtime, "frameStartedAt", frameStartedAt);
        event.setProperty(runtime, "frameLatency", frameLatency);
        event.setProperty(
            runtime, "mountToFrameLatency", mountToFrameLatency);
        if (observation->causalOperationId.has_value()) {
          Object causalContext(runtime);
          causalContext.setProperty(
              runtime,
              "operationId",
              String::createFromUtf8(
                  runtime, *observation->causalOperationId));
          event.setProperty(
              runtime, "causalContext", std::move(causalContext));
        }
        handlerObject.getFunction(runtime).call(runtime, event);
      });
}

void onJavaUIWorkletFrame(
    facebook::jni::alias_ref<jclass>,
    jlong token,
    jlong frameTimeNanoseconds) {
  std::shared_ptr<AndroidUIWorkletState> state;
  {
    std::lock_guard lock(uiWorkletFrameMutex);
    const auto entry = uiWorkletFrames.find(token);
    if (entry == uiWorkletFrames.end()) return;
    state = std::move(entry->second);
    uiWorkletFrames.erase(entry);
  }

  bool continueAnimation = false;
  {
    std::lock_guard lock(state->mutex);
    if (!state->frameToken.has_value() || *state->frameToken != token) return;
    state->framePending = false;
    state->frameToken.reset();
    if (!state->active) return;
    try {
      auto nextInputs = state->inputs;
      auto nextTimingProgress = state->timingProgress;
      const auto recordsTimingFrame = state->timing.has_value();
      const auto recordsSpringFrame = state->spring.has_value();
      const auto recordsDecayFrame = state->decay.has_value();
      if (state->timing.has_value()) {
        auto &timing = *state->timing;
        if (!timing.startedAtNanoseconds.has_value()) {
          timing.startedAtNanoseconds = frameTimeNanoseconds;
        }
        const auto elapsedMilliseconds = static_cast<double>(
            frameTimeNanoseconds - *timing.startedAtNanoseconds) /
            1000000.0;
        const auto sample =
            timing.definition.evaluate(timing.from, elapsedMilliseconds);
        nextTimingProgress = sample.progress;
        nextInputs = sample.inputs;
        if (sample.settled) state->timing.reset();
      } else if (state->spring.has_value()) {
        auto &spring = *state->spring;
        if (!spring.startedAtNanoseconds.has_value()) {
          spring.startedAtNanoseconds = frameTimeNanoseconds;
        }
        const auto elapsedMilliseconds = static_cast<double>(
            frameTimeNanoseconds - *spring.startedAtNanoseconds) /
            1000000.0;
        const auto sample = spring.definition.evaluate(elapsedMilliseconds);
        nextInputs = solid_native::worklets::interpolateUIWorkletInputs(
            spring.from, spring.to, sample.position);
        state->springPosition = sample.position;
        state->springVelocity = sample.velocity;
        if (sample.settled) state->spring.reset();
      } else if (state->decay.has_value()) {
        auto &decay = *state->decay;
        if (!decay.startedAtNanoseconds.has_value()) {
          decay.startedAtNanoseconds = frameTimeNanoseconds;
        }
        const auto elapsedMilliseconds = static_cast<double>(
            frameTimeNanoseconds - *decay.startedAtNanoseconds) /
            1000000.0;
        const auto sample = decay.definition.evaluate(
            decay.initialSpeed, elapsedMilliseconds);
        nextInputs = decay.from;
        for (size_t index = 0; index < nextInputs.size(); ++index) {
          nextInputs.at(index) += decay.velocities.at(index) *
              sample.displacementFactorSeconds;
        }
        state->decayElapsedMilliseconds = elapsedMilliseconds;
        state->decaySpeed = sample.speed;
        if (sample.settled) state->decay.reset();
      }
      auto nextOutputs = state->graph.evaluate(nextInputs);
      if (recordsTimingFrame) {
        state->timingFrameStatistics.recordFrame(frameTimeNanoseconds);
      }
      if (recordsSpringFrame) {
        state->springFrameStatistics.recordFrame(frameTimeNanoseconds);
      }
      if (recordsDecayFrame) {
        state->decayFrameStatistics.recordFrame(frameTimeNanoseconds);
      }
      state->inputs = std::move(nextInputs);
      state->outputs = std::move(nextOutputs);
      state->timingProgress = nextTimingProgress;
      std::array<double, AndroidViewOutputCount> values;
      values.fill(std::numeric_limits<double>::quiet_NaN());
      for (size_t index = 0; index < state->outputs.size(); ++index) {
        values.at(static_cast<size_t>(state->channels.at(index))) =
            state->outputs.at(index).value;
      }
      state->sequence++;
      state->frameTimeNanoseconds = frameTimeNanoseconds;
      state->applied = applyJavaUIWorkletFrame(
          state->handle,
          state->targetTag,
          state->sequence,
          frameTimeNanoseconds,
          values);
      if (state->applied) state->appliedSequence = state->sequence;
      continueAnimation =
          state->timing.has_value() || state->spring.has_value() ||
          state->decay.has_value();
    } catch (...) {
      state->applied = false;
      state->timing.reset();
      state->spring.reset();
      state->decay.reset();
    }
  }
  if (continueAnimation) {
    try {
      scheduleUIWorkletFrame(state);
    } catch (...) {
      std::lock_guard lock(state->mutex);
      state->applied = false;
      state->timing.reset();
      state->spring.reset();
      state->decay.reset();
    }
  }
}

void onJavaUIWorkletPan(
    facebook::jni::alias_ref<jclass>,
    jlong token,
    jint phaseValue,
    jdouble translationX,
    jdouble translationY,
    jdouble timestamp,
    jdouble velocityX,
    jdouble velocityY) {
  std::shared_ptr<AndroidUIWorkletState> state;
  {
    std::lock_guard lock(uiWorkletPanMutex);
    const auto entry = uiWorkletPans.find(token);
    if (entry == uiWorkletPans.end()) return;
    state = entry->second;
  }

  bool scheduleReleaseDecay = false;
  {
    std::lock_guard lock(state->mutex);
    if (!state->active || !state->pan.has_value()) return;
    auto &pan = *state->pan;
    try {
      if (phaseValue < 0 || phaseValue > 3 ||
          !std::isfinite(translationX) || !std::isfinite(translationY) ||
          !std::isfinite(timestamp) || timestamp < 0 ||
          !std::isfinite(velocityX) || !std::isfinite(velocityY) ||
          (pan.timestamp.has_value() && timestamp < *pan.timestamp)) {
        throw std::invalid_argument(
            "The Android native UI worklet pan sample is invalid.");
      }
      const auto phase =
          static_cast<solid_native::worklets::UIWorkletPanGesturePhase>(
              phaseValue);
      if (phase ==
          solid_native::worklets::UIWorkletPanGesturePhase::Begin) {
        if (pan.active) {
          throw std::invalid_argument(
              "The Android native UI worklet pan is already active.");
        }
        pan.active = true;
        pan.originX = state->inputs.at(pan.definition.xInput);
        pan.originY = state->inputs.at(pan.definition.yInput);
        pan.timestamp = timestamp;
        state->timing.reset();
        state->timingProgress = 0;
        state->spring.reset();
        if (state->springPosition.has_value()) state->springPosition = 0;
        if (state->springVelocity.has_value()) state->springVelocity = 0;
        state->decay.reset();
        if (state->decayElapsedMilliseconds.has_value()) {
          state->decayElapsedMilliseconds = 0;
        }
        if (state->decaySpeed.has_value()) state->decaySpeed = 0;
        return;
      }
      if (!pan.active) {
        throw std::invalid_argument(
            "The Android native UI worklet pan is not active.");
      }
      if (phase ==
          solid_native::worklets::UIWorkletPanGesturePhase::Cancel) {
        pan.active = false;
        pan.timestamp = timestamp;
        return;
      }
      auto nextInputs = pan.definition.evaluateInputs(
          state->inputs,
          pan.originX,
          pan.originY,
          translationX,
          translationY);
      auto nextOutputs = state->graph.evaluate(nextInputs);
      std::optional<AndroidUIWorkletDecayState> releaseDecay;
      double releaseSpeed = 0;
      if (phase == solid_native::worklets::UIWorkletPanGesturePhase::End &&
          pan.definition.releaseDecay.has_value()) {
        if (std::abs(velocityX) >
                solid_native::worklets::MaximumUIWorkletDecayVelocity ||
            std::abs(velocityY) >
                solid_native::worklets::MaximumUIWorkletDecayVelocity) {
          throw std::invalid_argument(
              "The Android native UI worklet pan velocity is outside its bounded range.");
        }
        std::vector<double> velocities(state->inputs.size(), 0);
        velocities.at(pan.definition.xInput) = velocityX;
        velocities.at(pan.definition.yInput) = velocityY;
        releaseSpeed = std::max(std::abs(velocityX), std::abs(velocityY));
        const auto &definition = *pan.definition.releaseDecay;
        const auto terminal = definition.evaluate(
            releaseSpeed, definition.maximumDurationMilliseconds);
        auto terminalInputs = nextInputs;
        for (size_t index = 0; index < terminalInputs.size(); ++index) {
          terminalInputs.at(index) +=
              velocities.at(index) * terminal.displacementFactorSeconds;
        }
        // Reject a terminal graph failure before publishing the final pan.
        state->graph.evaluate(terminalInputs);
        releaseDecay = AndroidUIWorkletDecayState{
            .from = nextInputs,
            .velocities = std::move(velocities),
            .initialSpeed = releaseSpeed,
            .definition = definition,
        };
      }
      std::array<double, AndroidViewOutputCount> values;
      values.fill(std::numeric_limits<double>::quiet_NaN());
      for (size_t index = 0; index < nextOutputs.size(); ++index) {
        values.at(static_cast<size_t>(state->channels.at(index))) =
            nextOutputs.at(index).value;
      }
      state->inputs = std::move(nextInputs);
      state->outputs = std::move(nextOutputs);
      state->timing.reset();
      state->timingProgress = 0;
      state->spring.reset();
      if (state->springPosition.has_value()) state->springPosition = 0;
      if (state->springVelocity.has_value()) state->springVelocity = 0;
      state->decay = std::move(releaseDecay);
      if (state->decay.has_value()) {
        state->decayElapsedMilliseconds = 0;
        state->decaySpeed = releaseSpeed;
        state->decayFrameStatistics.reset();
        scheduleReleaseDecay = true;
      } else {
        if (state->decayElapsedMilliseconds.has_value()) {
          state->decayElapsedMilliseconds = 0;
        }
        if (state->decaySpeed.has_value()) state->decaySpeed = 0;
      }
      state->sequence++;
      state->frameTimeNanoseconds =
          static_cast<int64_t>(std::llround(timestamp * 1000000.0));
      state->applied = applyJavaUIWorkletFrame(
          state->handle,
          state->targetTag,
          state->sequence,
          state->frameTimeNanoseconds,
          values);
      if (state->applied) state->appliedSequence = state->sequence;
      pan.sequence++;
      pan.timestamp = timestamp;
      if (phase == solid_native::worklets::UIWorkletPanGesturePhase::End) {
        pan.active = false;
      }
    } catch (...) {
      pan.active = false;
      state->timing.reset();
      state->timingProgress = 0;
      state->spring.reset();
      if (state->springPosition.has_value()) state->springPosition = 0;
      if (state->springVelocity.has_value()) state->springVelocity = 0;
      state->decay.reset();
      if (state->decayElapsedMilliseconds.has_value()) {
        state->decayElapsedMilliseconds = 0;
      }
      if (state->decaySpeed.has_value()) state->decaySpeed = 0;
      state->applied = false;
    }
  }
  if (scheduleReleaseDecay) {
    try {
      scheduleUIWorkletFrame(state);
    } catch (...) {
      std::lock_guard lock(state->mutex);
      state->decay.reset();
      state->decayElapsedMilliseconds = 0;
      state->decaySpeed = 0;
      state->applied = false;
    }
  }
}

class MountObservationState final
    : public facebook::react::UIManagerMountHook {
 public:
  MountObservationState(
      std::shared_ptr<facebook::react::RuntimeScheduler> runtimeScheduler,
      std::weak_ptr<RuntimeState> runtimeState)
      : runtimeScheduler_(std::move(runtimeScheduler)),
        runtimeState_(std::move(runtimeState)) {}

  void attach(facebook::react::UIManager &manager, int32_t surface) {
    std::lock_guard registrationLock(registrationMutex_);
    {
      std::lock_guard lock(mutex_);
      if (attached_) {
        if (manager_ == &manager && surface_ == surface) return;
        throw std::logic_error(
            "The Android Fabric mount observer is already attached.");
      }
      manager_ = &manager;
      surface_ = surface;
      latestMountedRevision_ = 0;
      pending_.clear();
    }
    manager.registerMountHook(*this);
    {
      std::lock_guard lock(mutex_);
      attached_ = true;
    }
  }

  void detach() noexcept {
    std::lock_guard registrationLock(registrationMutex_);
    facebook::react::UIManager *manager = nullptr;
    {
      std::lock_guard lock(mutex_);
      if (!attached_) return;
      attached_ = false;
      manager = manager_;
      manager_ = nullptr;
      surface_ = 0;
      latestMountedRevision_ = 0;
      pending_.clear();
    }
    if (manager != nullptr) manager->unregisterMountHook(*this);
  }

  void enqueue(
      std::shared_ptr<const CommitMountObservation> observation) noexcept {
    int64_t mountedRevision = 0;
    {
      std::lock_guard lock(mutex_);
      if (!attached_) return;
      if (latestMountedRevision_ < observation->fabricRevision) {
        pending_.push_back(std::move(observation));
        return;
      }
      mountedRevision = latestMountedRevision_;
    }
    scheduleObservation(std::move(observation), mountedRevision);
  }

  void shadowTreeDidMount(
      const facebook::react::RootShadowNode::Shared &rootShadowNode,
      facebook::react::HighResTimeStamp) noexcept override {
    try {
      facebook::react::UIManager *manager = nullptr;
      int32_t surface = 0;
      {
        std::lock_guard lock(mutex_);
        if (!attached_ || rootShadowNode == nullptr ||
            rootShadowNode->getSurfaceId() != surface_) {
          return;
        }
        manager = manager_;
        surface = surface_;
      }

      int64_t mountedRevision = 0;
      manager->getShadowTreeRegistry().visit(
          surface,
          [&mountedRevision](const facebook::react::ShadowTree &shadowTree) {
            mountedRevision = shadowTree.getMountingCoordinator()
                                  ->getBaseRevision()
                                  .number;
          });
      if (mountedRevision <= 0) return;

      std::vector<std::shared_ptr<const CommitMountObservation>> ready;
      {
        std::lock_guard lock(mutex_);
        if (!attached_ || manager_ != manager || surface_ != surface) return;
        latestMountedRevision_ =
            std::max(latestMountedRevision_, mountedRevision);
        auto iterator = pending_.begin();
        while (iterator != pending_.end()) {
          if ((*iterator)->fabricRevision > latestMountedRevision_) {
            iterator++;
            continue;
          }
          ready.push_back(std::move(*iterator));
          iterator = pending_.erase(iterator);
        }
        mountedRevision = latestMountedRevision_;
      }

      for (auto &observation : ready) {
        scheduleObservation(std::move(observation), mountedRevision);
      }
    } catch (...) {
      // Mount hooks are noexcept. A later mount can still satisfy any pending
      // observation if Fabric was temporarily unavailable during teardown.
    }
  }

 private:
  void scheduleObservation(
      std::shared_ptr<const CommitMountObservation> observation,
      int64_t mountedRevision) noexcept {
    const auto mountedAt = wallClockMilliseconds();
    const auto mountedMonotonic = monotonicMilliseconds();
    const auto mountLatency = std::max(
        0.0,
        mountedMonotonic - observation->commitStartedMonotonic);
    runtimeScheduler_->scheduleWork(
        [runtimeState = runtimeState_,
         observation,
         mountedRevision,
         mountedAt,
         mountLatency](Runtime &runtime) {
          auto state = runtimeState.lock();
          if (!state) return;
          state->reclaimMountedInstances(runtime, mountedRevision);
          if (!observation->notifyLifecycle || !state->active() ||
              !state->hasCommitLifecycleHandler()) {
            return;
          }
          auto handlerValue = state->commitLifecycleHandler(runtime);
          if (!handlerValue.isObject()) return;
          auto handlerObject = handlerValue.getObject(runtime);
          if (!handlerObject.isFunction(runtime)) return;

          Object event(runtime);
          event.setProperty(
              runtime,
              "type",
              String::createFromAscii(runtime, "commit-mounted"));
          event.setProperty(
              runtime,
              "surface",
              static_cast<double>(observation->surface));
          event.setProperty(
              runtime,
              "sequence",
              static_cast<double>(observation->sequence));
          event.setProperty(
              runtime,
              "hostRevision",
              static_cast<double>(observation->fabricRevision));
          event.setProperty(
              runtime, "commitStartedAt", observation->commitStartedAt);
          event.setProperty(runtime, "mountedAt", mountedAt);
          event.setProperty(runtime, "mountLatency", mountLatency);
          if (observation->causalOperationId.has_value()) {
            Object causalContext(runtime);
            causalContext.setProperty(
                runtime,
                "operationId",
                String::createFromUtf8(
                    runtime, *observation->causalOperationId));
            event.setProperty(
                runtime, "causalContext", std::move(causalContext));
          }
          handlerObject.getFunction(runtime).call(runtime, event);
        });
    if (observation->notifyLifecycle) {
      const auto token = retainFrameObservation(
          std::make_shared<const CommitFrameObservation>(
              CommitFrameObservation{
                  .runtimeScheduler = runtimeScheduler_,
                  .runtimeState = runtimeState_,
                  .commit = observation,
                  .mountedAt = mountedAt,
                  .mountedMonotonic = mountedMonotonic,
              }));
      try {
        requestJavaCommitFrame(token);
      } catch (...) {
        discardFrameObservation(token);
      }
    }
  }

  std::mutex registrationMutex_;
  std::mutex mutex_;
  facebook::react::UIManager *manager_{nullptr};
  int32_t surface_{0};
  int64_t latestMountedRevision_{0};
  bool attached_{false};
  std::vector<std::shared_ptr<const CommitMountObservation>> pending_;
  std::shared_ptr<facebook::react::RuntimeScheduler> runtimeScheduler_;
  std::weak_ptr<RuntimeState> runtimeState_;
};

struct PreparedNodeIdentities final {
  NodeIdentityMap identities;
  std::vector<std::pair<int64_t, Value>> retainedValues;
};

class IdentityRetention final {
 public:
  IdentityRetention(
      Runtime &runtime,
      const std::shared_ptr<RuntimeState> &state,
      PreparedNodeIdentities &prepared)
      : runtime_(runtime), state_(state) {
    handles_.reserve(prepared.retainedValues.size());
    try {
      for (auto &[handle, value] : prepared.retainedValues) {
        if (state_->hasInstance(runtime_, handle)) {
          throw std::invalid_argument(
              "Node " + std::to_string(handle) +
              " already owns a JavaScript instance identity.");
        }
        state_->retainInstance(runtime_, handle, std::move(value));
        handles_.push_back(handle);
      }
    } catch (...) {
      rollback();
      throw;
    }
  }

  ~IdentityRetention() {
    if (!committed_) rollback();
  }

  void commit() {
    committed_ = true;
  }

 private:
  void rollback() {
    for (const auto handle : handles_) {
      state_->releaseInstance(runtime_, handle);
    }
    handles_.clear();
  }

  Runtime &runtime_;
  std::shared_ptr<RuntimeState> state_;
  std::vector<int64_t> handles_;
  bool committed_{false};
};

PreparedNodeIdentities prepareNodeIdentities(
    Runtime &runtime,
    const folly::dynamic &transaction,
    int64_t surface,
    const std::shared_ptr<RuntimeState> &state) {
  PreparedNodeIdentities prepared;
  if (!transaction.isObject() || transaction.count("mutations") == 0) {
    return prepared;
  }
  const auto &mutations = transaction.at("mutations");
  if (!mutations.isArray()) return prepared;

  auto objectConstructor =
      runtime.global().getPropertyAsObject(runtime, "Object");
  auto freeze = objectConstructor.getPropertyAsFunction(runtime, "freeze");
  for (const auto &mutation : mutations) {
    if (!mutation.isObject() || mutation.count("type") == 0 ||
        !mutation.at("type").isString()) {
      continue;
    }
    const auto &type = mutation.at("type").getString();
    if (type != "create-element" && type != "create-text") continue;
    if (mutation.count("node") == 0) continue;
    const auto node = dynamicInteger(mutation.at("node"));
    if (node <= 0 || prepared.identities.contains(node)) continue;
    if (state->hasInstance(runtime, node)) {
      throw std::invalid_argument(
          "Node " + std::to_string(node) +
          " cannot reuse a retained JavaScript instance identity.");
    }

    Object instance(runtime);
    instance.setProperty(runtime, "surface", static_cast<double>(surface));
    instance.setProperty(runtime, "node", static_cast<double>(node));
    freeze.call(runtime, instance);

    const auto tag = TransactionCoordinator::allocateFabricTag();
    Value retainedValue(runtime, instance);
    auto instanceHandle = std::make_shared<facebook::react::InstanceHandle>(
        runtime, retainedValue, tag);
    prepared.identities.emplace(
        node, NodeIdentity{.tag = tag, .instanceHandle = instanceHandle});
    prepared.retainedValues.emplace_back(
        node, Value(runtime, retainedValue));
  }
  return prepared;
}

std::vector<int64_t> deletedNodeHandles(
    const folly::dynamic &transaction) {
  std::vector<int64_t> handles;
  if (!transaction.isObject() || transaction.count("mutations") == 0) {
    return handles;
  }
  const auto &mutations = transaction.at("mutations");
  if (!mutations.isArray()) return handles;
  for (const auto &mutation : mutations) {
    if (!mutation.isObject() || mutation.count("type") == 0 ||
        !mutation.at("type").isString() ||
        mutation.at("type").getString() != "delete-node" ||
        mutation.count("node") == 0) {
      continue;
    }
    const auto node = dynamicInteger(mutation.at("node"));
    if (node > 0) handles.push_back(node);
  }
  return handles;
}

std::optional<std::string> causalOperationId(
    const folly::dynamic &transaction) {
  if (!transaction.isObject() || transaction.count("causalContext") == 0) {
    return std::nullopt;
  }
  const auto &context = transaction.at("causalContext");
  if (!context.isObject() || context.count("operationId") == 0 ||
      !context.at("operationId").isString()) {
    return std::nullopt;
  }
  return context.at("operationId").getString();
}

Object measurementObject(Runtime &runtime, const NodeMeasurement &measurement) {
  Object object(runtime);
  object.setProperty(runtime, "x", measurement.x);
  object.setProperty(runtime, "y", measurement.y);
  object.setProperty(runtime, "width", measurement.width);
  object.setProperty(runtime, "height", measurement.height);
  object.setProperty(runtime, "pageX", measurement.pageX);
  object.setProperty(runtime, "pageY", measurement.pageY);
  object.setProperty(
      runtime,
      "observedSequence",
      static_cast<double>(measurement.observedSequence));
  return object;
}

struct SurfaceSnapshot final {
  int32_t surface{0};
  std::shared_ptr<TransactionCoordinator> coordinator;
  std::shared_ptr<MountObservationState> mountObserver;
};

class BindingState final {
 public:
  uint64_t installRuntimeState(
      const std::shared_ptr<RuntimeState> &runtimeState) {
    std::shared_ptr<RuntimeState> previous;
    std::shared_ptr<MountObservationState> previousMountObserver;
    std::shared_ptr<TransactionCoordinator> previousCoordinator;
    uint64_t generation;
    {
      std::lock_guard lock(mutex_);
      previous = runtimeState_.lock();
      if (previous && previous != runtimeState) {
        previousCoordinator = coordinator_;
        previousMountObserver = std::move(mountObserver_);
      }
      generation = ++runtimeGeneration_;
      runtimeState_ = runtimeState;
    }
    if (previousMountObserver) previousMountObserver->detach();
    if (previous && previous != runtimeState) {
      previous->deactivateNativeWork();
      if (previousCoordinator) previousCoordinator->reset();
    }
    return generation;
  }

  void retireRuntime(uint64_t generation) {
    std::shared_ptr<MountObservationState> mountObserver;
    std::shared_ptr<TransactionCoordinator> coordinator;
    {
      std::lock_guard lock(mutex_);
      if (generation != runtimeGeneration_) return;
      runtimeState_.reset();
      mountObserver = std::move(mountObserver_);
      coordinator = coordinator_;
    }
    if (mountObserver) mountObserver->detach();
    // The logical tree owns JSI-backed Fabric InstanceHandles. Release it
    // from the retiring runtime's NativeState destructor, while Hermes is
    // still alive, rather than waiting for the replacement runtime install.
    if (coordinator) coordinator->reset();
  }

  void publishSurface(int32_t surface) {
    if (surface <= 0) {
      throw std::invalid_argument(
          "A published Fabric surface must be positive.");
    }
    std::lock_guard lock(mutex_);
    if (surface_ == surface && coordinator_) return;
    if (surface_ != 0) {
      throw std::logic_error(
          "Solid Native already owns a different Fabric surface.");
    }
    surface_ = surface;
    coordinator_ = std::make_shared<TransactionCoordinator>(surface);
  }

  void clearSurface(int32_t surface) {
    std::shared_ptr<MountObservationState> mountObserver;
    std::shared_ptr<RuntimeState> runtimeState;
    {
      std::lock_guard lock(mutex_);
      if (surface_ != surface) return;
      coordinator_.reset();
      surface_ = 0;
      mountObserver = mountObserver_;
      runtimeState = runtimeState_.lock();
    }
    if (mountObserver) mountObserver->detach();
    if (runtimeState) runtimeState->deactivateNativeWork();
  }

  void deactivateSurface(int32_t surface) {
    std::shared_ptr<MountObservationState> mountObserver;
    std::shared_ptr<RuntimeState> runtimeState;
    {
      std::lock_guard lock(mutex_);
      if (surface_ != surface) return;
      mountObserver = mountObserver_;
      runtimeState = runtimeState_.lock();
    }
    if (mountObserver) mountObserver->detach();
    if (runtimeState) runtimeState->deactivateNativeWork();
  }

  void installMountObserver(
      std::shared_ptr<MountObservationState> mountObserver) {
    std::shared_ptr<MountObservationState> previous;
    {
      std::lock_guard lock(mutex_);
      previous = std::exchange(mountObserver_, std::move(mountObserver));
    }
    if (previous) previous->detach();
  }

  SurfaceSnapshot snapshot() const {
    std::lock_guard lock(mutex_);
    return {
        .surface = surface_,
        .coordinator = coordinator_,
        .mountObserver = mountObserver_,
    };
  }

 private:
  mutable std::mutex mutex_;
  int32_t surface_{0};
  std::shared_ptr<TransactionCoordinator> coordinator_;
  std::shared_ptr<MountObservationState> mountObserver_;
  std::weak_ptr<RuntimeState> runtimeState_;
  uint64_t runtimeGeneration_{0};
};

SurfaceSnapshot requireSurface(
    Runtime &runtime,
    const std::shared_ptr<BindingState> &state) {
  auto snapshot = state->snapshot();
  if (snapshot.surface <= 0 || !snapshot.coordinator) {
    throw JSError(runtime, "The Solid Native Fabric surface is not ready.");
  }
  return snapshot;
}

void requestJavaSurfaceStop(int32_t surface) {
  facebook::jni::ThreadScope::WithClassLoader([surface] {
    static auto javaClass = facebook::jni::findClassStatic(
        "dev/solidnative/runtime/SolidNativeBindingsInstaller");
    static auto requestStop =
        javaClass->getStaticMethod<void(jint)>("requestSurfaceStop");
    requestStop(javaClass, surface);
  });
}

void requestJavaFatalError(
    int32_t surface,
    const std::string &name,
    const std::string &message) {
  facebook::jni::ThreadScope::WithClassLoader([surface, name, message] {
    static auto javaClass = facebook::jni::findClassStatic(
        "dev/solidnative/runtime/SolidNativeBindingsInstaller");
    static auto requestFatal = javaClass->getStaticMethod<void(
        jint,
        jstring,
        jstring)>("requestFatalError");
    auto javaName = facebook::jni::make_jstring(name);
    auto javaMessage = facebook::jni::make_jstring(message);
    requestFatal(
        javaClass, surface, javaName.get(), javaMessage.get());
  });
}

void requestJavaCommitFrame(int64_t token) {
  facebook::jni::ThreadScope::WithClassLoader([token] {
    static auto javaClass = facebook::jni::findClassStatic(
        "dev/solidnative/runtime/SolidNativeBindingsInstaller");
    static auto requestFrame =
        javaClass->getStaticMethod<void(jlong)>("requestCommitFrame");
    requestFrame(javaClass, token);
  });
}

void requestJavaUIWorkletFrame(int64_t token) {
  facebook::jni::ThreadScope::WithClassLoader([token] {
    static auto javaClass = facebook::jni::findClassStatic(
        "dev/solidnative/runtime/SolidNativeBindingsInstaller");
    static auto requestFrame =
        javaClass->getStaticMethod<void(jlong)>("requestUIWorkletFrame");
    requestFrame(javaClass, token);
  });
}

bool attachJavaUIWorkletPan(
    int64_t token,
    facebook::react::Tag targetTag) {
  bool attached = false;
  facebook::jni::ThreadScope::WithClassLoader([token, targetTag, &attached] {
    static auto javaClass = facebook::jni::findClassStatic(
        "dev/solidnative/runtime/SolidNativeBindingsInstaller");
    static auto attach = javaClass->getStaticMethod<jboolean(jlong, jint)>(
        "attachUIWorkletPanGesture");
    attached = attach(javaClass, token, targetTag);
  });
  return attached;
}

void detachJavaUIWorkletPan(int64_t token) noexcept {
  try {
    facebook::jni::ThreadScope::WithClassLoader([token] {
      static auto javaClass = facebook::jni::findClassStatic(
          "dev/solidnative/runtime/SolidNativeBindingsInstaller");
      static auto detach = javaClass->getStaticMethod<void(jlong)>(
          "detachUIWorkletPanGesture");
      detach(javaClass, token);
    });
  } catch (...) {
  }
}

bool applyJavaUIWorkletFrame(
    int64_t handle,
    facebook::react::Tag targetTag,
    int64_t sequence,
    int64_t frameTimeNanoseconds,
    const std::array<double, AndroidViewOutputCount> &values) {
  bool applied = false;
  facebook::jni::ThreadScope::WithClassLoader(
      [handle,
       targetTag,
       sequence,
       frameTimeNanoseconds,
       &values,
       &applied] {
        static auto javaClass = facebook::jni::findClassStatic(
            "dev/solidnative/runtime/SolidNativeBindingsInstaller");
        static auto applyFrame = javaClass->getStaticMethod<jboolean(
            jlong,
            jint,
            jlong,
            jlong,
            jdouble,
            jdouble,
            jdouble,
            jdouble,
            jdouble,
            jdouble)>("applyUIWorkletFrame");
        applied = applyFrame(
            javaClass,
            handle,
            targetTag,
            sequence,
            frameTimeNanoseconds,
            values.at(0),
            values.at(1),
            values.at(2),
            values.at(3),
            values.at(4),
            values.at(5));
      });
  return applied;
}

class SolidNativeBindingsInstaller final
    : public facebook::jni::HybridClass<
          SolidNativeBindingsInstaller,
          facebook::react::JBindingsInstaller> {
 public:
  static constexpr auto kJavaDescriptor =
      "Ldev/solidnative/runtime/SolidNativeBindingsInstaller;";

  static facebook::jni::local_ref<jhybriddata> initHybrid(
      facebook::jni::alias_ref<jclass>) {
    return makeCxxInstance();
  }

  static void registerNatives() {
    registerHybrid({
        makeNativeMethod("initHybrid", SolidNativeBindingsInstaller::initHybrid),
        makeNativeMethod(
            "publishSurface", SolidNativeBindingsInstaller::publishSurface),
        makeNativeMethod(
            "clearSurface", SolidNativeBindingsInstaller::clearSurface),
        makeNativeMethod(
            "deactivateSurface",
            SolidNativeBindingsInstaller::deactivateSurface),
    });
    javaClassLocal()->registerNatives({
        makeNativeMethod("onCommitFrame", onJavaCommitFrame),
        makeNativeMethod("onUIWorkletFrame", onJavaUIWorkletFrame),
        makeNativeMethod("onUIWorkletPan", onJavaUIWorkletPan),
    });
  }

  facebook::react::ReactInstance::BindingsInstallFunc getBindingsInstallFunc()
      override {
    auto bindingState = bindingState_;
    return [bindingState = std::move(bindingState)](Runtime &runtime) {
      const auto existing =
          runtime.global().getProperty(runtime, GlobalBindingName);
      if (!existing.isUndefined()) {
        throw JSError(
            runtime,
            "Solid Native cannot replace an existing __solidNativeHost "
            "binding.");
      }
      installEmptySurfaceStopHandler(runtime);

      Object host(runtime);
      Object runtimeStorage(runtime);
      runtimeStorage.setProperty(runtime, "instances", Object(runtime));
      runtimeStorage.setProperty(runtime, "resources", Object(runtime));
      auto routing = std::make_shared<EventRoutingState>();
      auto runtimeState = std::make_shared<RuntimeState>(
          runtime, runtimeStorage, routing);
      const auto runtimeGeneration =
          bindingState->installRuntimeState(runtimeState);
      std::weak_ptr<BindingState> weakBindingState = bindingState;
      runtimeState->setRuntimeRetirementHandler(
          [weakBindingState, runtimeGeneration] {
            auto state = weakBindingState.lock();
            if (state) state->retireRuntime(runtimeGeneration);
          });
      std::weak_ptr<RuntimeState> weakRuntimeState = runtimeState;
      host.setNativeState(runtime, runtimeState);

      auto objectConstructor =
          runtime.global().getPropertyAsObject(runtime, "Object");
      auto defineProperty =
          objectConstructor.getPropertyAsFunction(runtime, "defineProperty");
      Object runtimeStorageDescriptor(runtime);
      runtimeStorageDescriptor.setProperty(runtime, "value", runtimeStorage);
      runtimeStorageDescriptor.setProperty(runtime, "writable", false);
      runtimeStorageDescriptor.setProperty(runtime, "configurable", false);
      runtimeStorageDescriptor.setProperty(runtime, "enumerable", false);
      defineProperty.call(
          runtime,
          host,
          String::createFromAscii(runtime, "__runtimeStorage"),
          runtimeStorageDescriptor);

      host.setProperty(runtime, "contractVersion", HostContractVersion);
      host.setProperty(runtime, "backend", "react-native-fabric");
      host.setProperty(runtime, "backendVersion", ReactNativeVersion);
      host.setProperty(runtime, "platform", "android");

      host.setProperty(
          runtime,
          "getSurfaceInfo",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "getSurfaceInfo"),
              0,
              [bindingState, weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *,
                  size_t count) -> Value {
                if (count != 0) {
                  throw JSError(
                      runtime,
                      "getSurfaceInfo does not accept arguments.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto snapshot = bindingState->snapshot();
                Object info(runtime);
                info.setProperty(runtime, "ready", snapshot.surface > 0);
                info.setProperty(
                    runtime, "surface", static_cast<double>(snapshot.surface));
                info.setProperty(
                    runtime,
                    "sequence",
                    snapshot.coordinator
                        ? static_cast<double>(
                              snapshot.coordinator->lastSequence())
                        : 0.0);
                info.setProperty(
                    runtime,
                    "retainedNodeCount",
                    static_cast<double>(state->retainedNodeCount()));
                info.setProperty(
                    runtime,
                    "retainedResourceCount",
                    static_cast<double>(state->retainedResourceCount()));
                const auto uiWorkletActivity =
                    state->uiWorkletActivityCounts();
                info.setProperty(
                    runtime,
                    "activeUIWorkletCount",
                    static_cast<double>(uiWorkletActivity.first));
                info.setProperty(
                    runtime,
                    "pendingUIWorkletFrameCount",
                    static_cast<double>(uiWorkletActivity.second));
                return info;
              }));

      host.setProperty(
          runtime,
          "setEventHandler",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "setEventHandler"),
              1,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 1 ||
                    (!arguments[0].isNull() &&
                     (!arguments[0].isObject() ||
                      !arguments[0]
                           .getObject(runtime)
                           .isFunction(runtime)))) {
                  throw JSError(
                      runtime,
                      "setEventHandler requires exactly one function or "
                      "null.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                if (arguments[0].isNull()) {
                  const Value empty;
                  state->setEventHandler(runtime, empty);
                } else {
                  state->setEventHandler(runtime, arguments[0]);
                }
                return Value();
              }));

      host.setProperty(
          runtime,
          "setCommitLifecycleHandler",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "setCommitLifecycleHandler"),
              1,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 1 ||
                    (!arguments[0].isNull() &&
                     (!arguments[0].isObject() ||
                      !arguments[0]
                           .getObject(runtime)
                           .isFunction(runtime)))) {
                  throw JSError(
                      runtime,
                      "setCommitLifecycleHandler requires exactly one "
                      "function or null.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                if (arguments[0].isNull()) {
                  const Value empty;
                  state->setCommitLifecycleHandler(runtime, empty);
                } else {
                  state->setCommitLifecycleHandler(runtime, arguments[0]);
                }
                return Value();
              }));

      host.setProperty(
          runtime,
          "retainNativeResource",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "retainNativeResource"),
              2,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 2 || !arguments[1].isObject() ||
                    arguments[1].getObject(runtime).isFunction(runtime) ||
                    arguments[1].getObject(runtime).isArray(runtime)) {
                  throw JSError(
                      runtime,
                      "retainNativeResource requires a kind and one "
                      "non-array object.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto kind = requireResourceKind(runtime, arguments[0]);
                return Value(static_cast<double>(state->retainResource(
                    runtime, kind, arguments[1])));
              }));

      host.setProperty(
          runtime,
          "releaseNativeResource",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "releaseNativeResource"),
              1,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 1) {
                  throw JSError(
                      runtime,
                      "releaseNativeResource requires exactly one handle.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native resource handle",
                    true);
                state->releaseResource(runtime, handle);
                return Value();
              }));

      host.setProperty(
          runtime,
          "installUIWorklet",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "installUIWorklet"),
              2,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 2 || !arguments[1].isObject()) {
                  throw JSError(
                      runtime,
                      "installUIWorklet requires a target node and one graph object.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto target = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet target",
                    true);
                try {
                  return Value(static_cast<double>(
                      state->installUIWorklet(runtime, target, arguments[1])));
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "updateUIWorkletInputs",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "updateUIWorkletInputs"),
              3,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 3 || !arguments[1].isObject() ||
                    !arguments[1].getObject(runtime).isArray(runtime) ||
                    !arguments[2].isNumber()) {
                  throw JSError(
                      runtime,
                      "updateUIWorkletInputs requires a handle, input array, and timestamp.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                auto array = arguments[1].getObject(runtime).getArray(runtime);
                if (array.size(runtime) >
                    solid_native::worklets::MaximumUIWorkletInputs) {
                  throw JSError(
                      runtime, "The native UI worklet input vector is too large.");
                }
                std::vector<double> inputs;
                inputs.reserve(array.size(runtime));
                for (size_t index = 0; index < array.size(runtime); ++index) {
                  auto value = array.getValueAtIndex(runtime, index);
                  if (!value.isNumber() ||
                      !std::isfinite(value.getNumber())) {
                    throw JSError(
                        runtime,
                        "Native UI worklet inputs must be finite numbers.");
                  }
                  inputs.push_back(value.getNumber());
                }
                try {
                  state->updateUIWorklet(
                      handle,
                      std::move(inputs),
                      arguments[2].getNumber());
                  return Value();
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "animateUIWorkletInputs",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "animateUIWorkletInputs"),
              4,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 4 || !arguments[1].isObject() ||
                    !arguments[1].getObject(runtime).isArray(runtime) ||
                    !arguments[2].isNumber() || !arguments[3].isObject()) {
                  throw JSError(
                      runtime,
                      "animateUIWorkletInputs requires a handle, input array, timestamp, and timing object.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                auto array = arguments[1].getObject(runtime).getArray(runtime);
                if (array.size(runtime) >
                    solid_native::worklets::MaximumUIWorkletInputs) {
                  throw JSError(
                      runtime, "The native UI worklet input vector is too large.");
                }
                std::vector<double> inputs;
                inputs.reserve(array.size(runtime));
                for (size_t index = 0; index < array.size(runtime); ++index) {
                  auto value = array.getValueAtIndex(runtime, index);
                  if (!value.isNumber() ||
                      !std::isfinite(value.getNumber())) {
                    throw JSError(
                        runtime,
                        "Native UI worklet inputs must be finite numbers.");
                  }
                  inputs.push_back(value.getNumber());
                }
                try {
                  state->animateUIWorklet(
                      runtime,
                      handle,
                      std::move(inputs),
                      arguments[2].getNumber(),
                      arguments[3]);
                  return Value();
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "animateUIWorkletKeyframes",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "animateUIWorkletKeyframes"),
              3,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 3 || !arguments[1].isObject() ||
                    !arguments[1].getObject(runtime).isArray(runtime) ||
                    !arguments[2].isNumber()) {
                  throw JSError(
                      runtime,
                      "animateUIWorkletKeyframes requires a handle, keyframe array, and timestamp.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                try {
                  state->animateUIWorkletKeyframes(
                      runtime,
                      handle,
                      arguments[1],
                      arguments[2].getNumber());
                  return Value();
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "springUIWorkletInputs",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "springUIWorkletInputs"),
              4,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 4 || !arguments[1].isObject() ||
                    !arguments[1].getObject(runtime).isArray(runtime) ||
                    !arguments[2].isNumber() || !arguments[3].isObject()) {
                  throw JSError(
                      runtime,
                      "springUIWorkletInputs requires a handle, input array, timestamp, and spring object.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                auto array = arguments[1].getObject(runtime).getArray(runtime);
                if (array.size(runtime) >
                    solid_native::worklets::MaximumUIWorkletInputs) {
                  throw JSError(
                      runtime, "The native UI worklet input vector is too large.");
                }
                std::vector<double> inputs;
                inputs.reserve(array.size(runtime));
                for (size_t index = 0; index < array.size(runtime); ++index) {
                  auto value = array.getValueAtIndex(runtime, index);
                  if (!value.isNumber() ||
                      !std::isfinite(value.getNumber())) {
                    throw JSError(
                        runtime,
                        "Native UI worklet inputs must be finite numbers.");
                  }
                  inputs.push_back(value.getNumber());
                }
                try {
                  state->springUIWorklet(
                      runtime,
                      handle,
                      std::move(inputs),
                      arguments[2].getNumber(),
                      arguments[3]);
                  return Value();
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "decayUIWorkletInputs",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "decayUIWorkletInputs"),
              4,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 4 || !arguments[1].isObject() ||
                    !arguments[1].getObject(runtime).isArray(runtime) ||
                    !arguments[2].isNumber() || !arguments[3].isObject()) {
                  throw JSError(
                      runtime,
                      "decayUIWorkletInputs requires a handle, velocity array, timestamp, and decay object.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                auto array = arguments[1].getObject(runtime).getArray(runtime);
                if (array.size(runtime) >
                    solid_native::worklets::MaximumUIWorkletInputs) {
                  throw JSError(
                      runtime, "The native UI worklet velocity vector is too large.");
                }
                std::vector<double> velocities;
                velocities.reserve(array.size(runtime));
                for (size_t index = 0; index < array.size(runtime); ++index) {
                  auto value = array.getValueAtIndex(runtime, index);
                  if (!value.isNumber() ||
                      !std::isfinite(value.getNumber())) {
                    throw JSError(
                        runtime,
                        "Native UI worklet velocities must be finite numbers.");
                  }
                  velocities.push_back(value.getNumber());
                }
                try {
                  state->decayUIWorklet(
                      runtime,
                      handle,
                      std::move(velocities),
                      arguments[2].getNumber(),
                      arguments[3]);
                  return Value();
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "cancelUIWorkletAnimation",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "cancelUIWorkletAnimation"),
              2,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 2 || !arguments[1].isNumber()) {
                  throw JSError(
                      runtime,
                      "cancelUIWorkletAnimation requires a handle and timestamp.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                try {
                  const auto inputs = state->cancelUIWorkletAnimation(
                      handle, arguments[1].getNumber());
                  Array result(runtime, inputs.size());
                  for (size_t index = 0; index < inputs.size(); ++index) {
                    result.setValueAtIndex(runtime, index, inputs.at(index));
                  }
                  return result;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "attachUIWorkletPanGesture",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "attachUIWorkletPanGesture"),
              2,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 2 || !arguments[1].isObject()) {
                  throw JSError(
                      runtime,
                      "attachUIWorkletPanGesture requires a handle and one pan object.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                bool attached = false;
                try {
                  auto worklet =
                      state->attachUIWorkletPan(runtime, handle, arguments[1]);
                  int64_t token;
                  {
                    std::lock_guard lock(worklet->mutex);
                    if (!worklet->active || !worklet->pan.has_value()) {
                      throw std::runtime_error(
                          "The Android native UI worklet pan attachment was cancelled.");
                    }
                    token = worklet->pan->token;
                  }
                  if (!attachJavaUIWorkletPan(token, worklet->targetTag)) {
                    throw std::runtime_error(
                        "The Android native UI worklet pan target is not mounted.");
                  }
                  attached = true;
                  return Value();
                } catch (const JSError &) {
                  if (!attached) {
                    try {
                      state->detachUIWorkletPan(handle);
                    } catch (...) {
                    }
                  }
                  throw;
                } catch (const std::exception &error) {
                  if (!attached) {
                    try {
                      state->detachUIWorkletPan(handle);
                    } catch (...) {
                    }
                  }
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "detachUIWorkletPanGesture",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "detachUIWorkletPanGesture"),
              2,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 2 || !arguments[1].isNumber()) {
                  throw JSError(
                      runtime,
                      "detachUIWorkletPanGesture requires a handle and timestamp.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                try {
                  const auto inputs = state->releaseUIWorkletPan(
                      handle, arguments[1].getNumber());
                  Array result(runtime, inputs.size());
                  for (size_t index = 0; index < inputs.size(); ++index) {
                    result.setValueAtIndex(runtime, index, inputs.at(index));
                  }
                  return result;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "destroyUIWorklet",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "destroyUIWorklet"),
              1,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 1) {
                  throw JSError(
                      runtime,
                      "destroyUIWorklet requires exactly one handle.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                try {
                  state->destroyUIWorklet(handle);
                  return Value();
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "getUIWorkletInfo",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "getUIWorkletInfo"),
              1,
              [weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 1) {
                  throw JSError(
                      runtime,
                      "getUIWorkletInfo requires exactly one handle.");
                }
                auto runtimeState = weakRuntimeState.lock();
                if (!runtimeState) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto handle = requireSafeInteger(
                    runtime,
                    arguments[0],
                    "The native UI worklet handle",
                    true);
                try {
                  auto state = runtimeState->requireUIWorklet(handle);
                  std::lock_guard lock(state->mutex);
                  Object info(runtime);
                  info.setProperty(
                      runtime, "handle", static_cast<double>(state->handle));
                  info.setProperty(
                      runtime,
                      "target",
                      static_cast<double>(state->targetNode));
                  info.setProperty(
                      runtime,
                      "sequence",
                      static_cast<double>(state->sequence));
                  info.setProperty(
                      runtime,
                      "appliedSequence",
                      static_cast<double>(state->appliedSequence));
                  info.setProperty(runtime, "applied", state->applied);
                  info.setProperty(
                      runtime,
                      "frameTimeNanoseconds",
                      static_cast<double>(state->frameTimeNanoseconds));
                  if (state->hasTimestamp) {
                    info.setProperty(runtime, "timestamp", state->timestamp);
                  }
                  info.setProperty(
                      runtime, "timingActive", state->timing.has_value());
                  info.setProperty(
                      runtime, "timingProgress", state->timingProgress);
                  if (!state->timingFrameStatistics.empty()) {
                    info.setProperty(
                        runtime,
                        "timingFrameStatistics",
                        makeUIWorkletFrameStatistics(
                            runtime,
                            state->timingFrameStatistics.snapshot()));
                  }
                  if (state->springPosition.has_value() &&
                      state->springVelocity.has_value()) {
                    info.setProperty(
                        runtime,
                        "springActive",
                        state->spring.has_value());
                    info.setProperty(
                        runtime,
                        "springPosition",
                        *state->springPosition);
                    info.setProperty(
                        runtime,
                        "springVelocity",
                        *state->springVelocity);
                    if (!state->springFrameStatistics.empty()) {
                      info.setProperty(
                          runtime,
                          "springFrameStatistics",
                          makeUIWorkletFrameStatistics(
                              runtime,
                              state->springFrameStatistics.snapshot()));
                    }
                  }
                  if (state->decayElapsedMilliseconds.has_value() &&
                      state->decaySpeed.has_value()) {
                    info.setProperty(
                        runtime,
                        "decayActive",
                        state->decay.has_value());
                    info.setProperty(
                        runtime,
                        "decayElapsedMilliseconds",
                        *state->decayElapsedMilliseconds);
                    info.setProperty(
                        runtime,
                        "decaySpeed",
                        *state->decaySpeed);
                    if (!state->decayFrameStatistics.empty()) {
                      info.setProperty(
                          runtime,
                          "decayFrameStatistics",
                          makeUIWorkletFrameStatistics(
                              runtime,
                              state->decayFrameStatistics.snapshot()));
                    }
                  }
                  if (state->pan.has_value()) {
                    const auto &pan = *state->pan;
                    info.setProperty(runtime, "gestureAttached", true);
                    info.setProperty(runtime, "gestureActive", pan.active);
                    info.setProperty(
                        runtime,
                        "gestureSequence",
                        static_cast<double>(pan.sequence));
                    if (pan.timestamp.has_value()) {
                      info.setProperty(
                          runtime, "gestureTimestamp", *pan.timestamp);
                    }
                  }
                  Object outputs(runtime);
                  for (const auto &output : state->outputs) {
                    outputs.setProperty(
                        runtime, output.name.c_str(), output.value);
                  }
                  info.setProperty(runtime, "outputs", outputs);
                  return info;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "measure",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "measure"),
              2,
              [bindingState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count < 1 || count > 2) {
                  throw JSError(
                      runtime,
                      "measure requires a node and an optional commit "
                      "sequence.");
                }
                const auto node = requireSafeInteger(
                    runtime, arguments[0], "The measured node", true);
                const auto afterSequence = count == 2
                    ? requireSafeInteger(
                          runtime,
                          arguments[1],
                          "The measurement sequence",
                          false)
                    : 0;
                if (afterSequence < 0) {
                  throw JSError(
                      runtime,
                      "The measurement sequence must be non-negative.");
                }
                try {
                  auto snapshot = requireSurface(runtime, bindingState);
                  auto result = snapshot.coordinator->measure(
                      uiManager(runtime), node, afterSequence);
                  return measurementObject(runtime, result);
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      host.setProperty(
          runtime,
          "reportFatalError",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "reportFatalError"),
              2,
              [bindingState, weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 2) {
                  throw JSError(
                      runtime,
                      "reportFatalError requires exactly two arguments: name and message.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                const auto name = requireFatalErrorText(
                    runtime,
                    arguments[0],
                    "The fatal error name",
                    MaximumFatalErrorNameBytes);
                const auto message = requireFatalErrorText(
                    runtime,
                    arguments[1],
                    "The fatal error message",
                    MaximumFatalErrorMessageBytes);
                const auto snapshot = requireSurface(runtime, bindingState);
                requestJavaFatalError(snapshot.surface, name, message);
                return Value();
              }));

      host.setProperty(
          runtime,
          "destroySurface",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "destroySurface"),
              0,
              [bindingState, weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *,
                  size_t count) -> Value {
                if (count != 0) {
                  throw JSError(
                      runtime,
                      "destroySurface does not accept arguments.");
                }
                auto state = weakRuntimeState.lock();
                if (!state) {
                  throw JSError(
                      runtime, "The Solid Native runtime has stopped.");
                }
                auto snapshot = requireSurface(runtime, bindingState);
                if (!snapshot.coordinator->empty()) {
                  throw JSError(
                      runtime,
                      "Cannot destroy a Fabric surface with live nodes.");
                }
                if (state->activeUIWorkletCount() != 0) {
                  throw JSError(
                      runtime,
                      "Cannot destroy a Fabric surface with active native UI worklets.");
                }
                installEmptySurfaceStopHandler(runtime);
                if (snapshot.mountObserver) snapshot.mountObserver->detach();
                state->detachEventListener(uiManager(runtime));
                state->deactivateEvents();
                state->reclaimAllInstances(runtime);
                state->reclaimAllResources(runtime);
                requestJavaSurfaceStop(snapshot.surface);
                return Value();
              }));

      host.setProperty(
          runtime,
          "commit",
          Function::createFromHostFunction(
              runtime,
              PropNameID::forAscii(runtime, "commit"),
              1,
              [bindingState, weakRuntimeState](
                  Runtime &runtime,
                  const Value &,
                  const Value *arguments,
                  size_t count) -> Value {
                if (count != 1 || !arguments[0].isObject()) {
                  throw JSError(
                      runtime,
                      "commit requires exactly one transaction object.");
                }
                const auto commitStartedAt = wallClockMilliseconds();
                const auto commitStartedMonotonic =
                    monotonicMilliseconds();
                try {
                  auto state = weakRuntimeState.lock();
                  if (!state) {
                    throw JSError(
                        runtime, "The Solid Native runtime has stopped.");
                  }
                  auto snapshot = requireSurface(runtime, bindingState);
                  size_t valueCount = 0;
                  std::vector<Value> ancestors;
                  auto transaction = dynamicFromJSI(
                      runtime,
                      arguments[0],
                      "transaction",
                      0,
                      valueCount,
                      ancestors);
                  if (!transaction.isObject()) {
                    throw std::invalid_argument(
                        "The host transaction must be an object.");
                  }
                  const auto surface = transaction.count("surface") != 0
                      ? dynamicInteger(transaction.at("surface"))
                      : 0;
                  auto prepared = prepareNodeIdentities(
                      runtime, transaction, surface, state);
                  const auto deletedHandles =
                      deletedNodeHandles(transaction);
                  IdentityRetention retention(runtime, state, prepared);
                  const NativeResourceResolver resourceResolver =
                      [state](Runtime &runtime,
                              int64_t handle,
                              const std::string &kind) -> Value {
                    return state->resolveResource(runtime, handle, kind);
                  };
                  auto &manager = uiManager(runtime);
                  state->attachEventListener(manager);
                  if (!snapshot.mountObserver) {
                    throw std::runtime_error(
                        "The Android Fabric mount observer is unavailable.");
                  }
                  snapshot.mountObserver->attach(
                      manager, snapshot.surface);
                  const auto previousFabricRevision =
                      snapshot.coordinator->lastFabricRevision();
                  auto layoutRouteStage = state->stageLayoutRoutes(
                      transaction, prepared.identities);
                  int64_t sequence;
                  try {
                    sequence = snapshot.coordinator->apply(
                        manager,
                        transaction,
                        runtime,
                        prepared.identities,
                        resourceResolver);
                  } catch (...) {
                    state->rollbackLayoutRoutes(layoutRouteStage);
                    throw;
                  }
                  retention.commit();
                  state->cancelDeletedUIWorklets(deletedHandles);
                  state->publishCommit(
                      transaction, prepared.identities, sequence);
                  state->finishLayoutRoutes(layoutRouteStage);
                  const auto fabricRevision =
                      snapshot.coordinator->lastFabricRevision();
                  const auto producedFabricRevision =
                      fabricRevision > previousFabricRevision;
                  if (producedFabricRevision) {
                    state->retireInstances(fabricRevision, deletedHandles);
                    const auto notifyLifecycle =
                        state->hasCommitLifecycleHandler();
                    if (notifyLifecycle || !deletedHandles.empty()) {
                      snapshot.mountObserver->enqueue(
                          std::make_shared<const CommitMountObservation>(
                              CommitMountObservation{
                                  .surface = snapshot.surface,
                                  .sequence = sequence,
                                  .fabricRevision = fabricRevision,
                                  .commitStartedAt = commitStartedAt,
                                  .commitStartedMonotonic =
                                      commitStartedMonotonic,
                                  .notifyLifecycle = notifyLifecycle,
                                  .causalOperationId =
                                      causalOperationId(transaction),
                              }));
                    }
                  }

                  Object result(runtime);
                  result.setProperty(
                      runtime,
                      "surface",
                      static_cast<double>(snapshot.surface));
                  result.setProperty(
                      runtime, "sequence", static_cast<double>(sequence));
                  result.setProperty(runtime, "mounted", true);
                  if (producedFabricRevision) {
                    result.setProperty(
                        runtime,
                        "hostRevision",
                        static_cast<double>(fabricRevision));
                  }
                  return result;
                } catch (const JSError &) {
                  throw;
                } catch (const std::exception &error) {
                  throw JSError(runtime, error.what());
                }
              }));

      auto schedulerBinding =
          facebook::react::RuntimeSchedulerBinding::getBinding(runtime);
      if (!schedulerBinding) {
        throw JSError(
            runtime,
            "React Native did not install its RuntimeScheduler binding.");
      }
      auto runtimeScheduler = schedulerBinding->getRuntimeScheduler();
      if (!runtimeScheduler) {
        throw JSError(
            runtime, "React Native did not expose its RuntimeScheduler.");
      }
      auto eventListener = createEventListener(
          routing, runtimeScheduler, weakRuntimeState);
      runtimeState->setEventListener(eventListener);
      bindingState->installMountObserver(
          std::make_shared<MountObservationState>(
              runtimeScheduler, weakRuntimeState));

      auto freeze = objectConstructor.getPropertyAsFunction(runtime, "freeze");
      freeze.call(runtime, host);

      Object descriptor(runtime);
      descriptor.setProperty(runtime, "value", host);
      descriptor.setProperty(runtime, "writable", false);
      descriptor.setProperty(runtime, "configurable", false);
      descriptor.setProperty(runtime, "enumerable", false);
      defineProperty.call(
          runtime,
          runtime.global(),
          String::createFromAscii(runtime, GlobalBindingName),
          descriptor);
    };
  }

  void publishSurface(jint surface) {
    bindingState_->publishSurface(surface);
  }

  void clearSurface(jint surface) {
    bindingState_->clearSurface(surface);
  }

  void deactivateSurface(jint surface) {
    bindingState_->deactivateSurface(surface);
  }

 private:
  friend HybridBase;

  SolidNativeBindingsInstaller()
      : bindingState_(std::make_shared<BindingState>()) {}

  std::shared_ptr<BindingState> bindingState_;
};

} // namespace

void registerSolidNativeBindingsInstaller() {
  SolidNativeBindingsInstaller::registerNatives();
}

} // namespace solid_native::android
