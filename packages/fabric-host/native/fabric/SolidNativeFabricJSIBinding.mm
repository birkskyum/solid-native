#import "SolidNativeFabricJSIBinding.h"

#import "SolidNativeFabricSurface.h"

#import <QuartzCore/QuartzCore.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <folly/dynamic.h>
#include <jsi/jsi.h>
#include <react/renderer/core/InstanceHandle.h>
#include <react/renderer/core/EventListener.h>
#include <react/renderer/core/RawEvent.h>
#include <react/renderer/core/ShadowNodeFamily.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>

#include "SolidNativeFabricTransactionCoordinator.h"
#include "../worklets/SolidNativeUIWorklet.h"

@interface SolidNativeDisplayLinkObserver : NSObject
- (instancetype)initWithCallback:(BOOL (^)(CADisplayLink *))callback;
- (void)start;
- (void)invalidate;
@end

@implementation SolidNativeDisplayLinkObserver {
  CADisplayLink *_displayLink;
  BOOL (^_callback)(CADisplayLink *);
}

- (instancetype)initWithCallback:(BOOL (^)(CADisplayLink *))callback {
  if (self = [super init]) {
    _callback = [callback copy];
  }
  return self;
}

- (void)start {
  if (_callback == nil || _displayLink != nil) return;
  _displayLink = [CADisplayLink displayLinkWithTarget:self
                                             selector:@selector(onDisplayLink:)];
  const auto maximumFramesPerSecond =
      static_cast<float>(UIScreen.mainScreen.maximumFramesPerSecond);
  _displayLink.preferredFrameRateRange = CAFrameRateRangeMake(
      std::min(30.0F, maximumFramesPerSecond),
      maximumFramesPerSecond,
      maximumFramesPerSecond);
  [_displayLink addToRunLoop:NSRunLoop.mainRunLoop
                     forMode:NSRunLoopCommonModes];
}

- (void)onDisplayLink:(CADisplayLink *)displayLink {
  auto callback = _callback;
  if (callback != nil && callback(displayLink)) return;
  [self invalidate];
}

- (void)invalidate {
  _callback = nil;
  [_displayLink invalidate];
  _displayLink = nil;
}

@end

@interface SolidNativePanGestureObserver : NSObject <UIGestureRecognizerDelegate>
- (instancetype)initWithView:(UIView *)view
                    callback:(void (^)(NSInteger,
                                       CGFloat,
                                       CGFloat,
                                       NSTimeInterval,
                                       CGFloat,
                                       CGFloat))callback;
- (void)invalidate;
@end

@implementation SolidNativePanGestureObserver {
  __weak UIView *_view;
  UIPanGestureRecognizer *_recognizer;
  void (^_callback)(NSInteger, CGFloat, CGFloat, NSTimeInterval, CGFloat, CGFloat);
}

- (instancetype)initWithView:(UIView *)view
                    callback:(void (^)(NSInteger,
                                       CGFloat,
                                       CGFloat,
                                       NSTimeInterval,
                                       CGFloat,
                                       CGFloat))callback {
  if (self = [super init]) {
    _view = view;
    _callback = [callback copy];
    _recognizer = [[UIPanGestureRecognizer alloc]
        initWithTarget:self
                action:@selector(onPan:)];
    _recognizer.minimumNumberOfTouches = 1;
    _recognizer.maximumNumberOfTouches = 1;
    _recognizer.cancelsTouchesInView = NO;
    _recognizer.delegate = self;
    [view addGestureRecognizer:_recognizer];
  }
  return self;
}

- (void)onPan:(UIPanGestureRecognizer *)recognizer {
  auto callback = _callback;
  if (callback == nil) return;
  NSInteger phase;
  switch (recognizer.state) {
    case UIGestureRecognizerStateBegan:
      phase = 0;
      break;
    case UIGestureRecognizerStateChanged:
      phase = 1;
      break;
    case UIGestureRecognizerStateEnded:
      phase = 2;
      break;
    case UIGestureRecognizerStateCancelled:
    case UIGestureRecognizerStateFailed:
      phase = 3;
      break;
    default:
      return;
  }
  UIView *coordinateView = recognizer.view.superview ?: recognizer.view;
  const auto translation = [recognizer translationInView:coordinateView];
  const auto velocity = [recognizer velocityInView:coordinateView];
  callback(
      phase,
      translation.x,
      translation.y,
      CACurrentMediaTime() * 1000.0,
      velocity.x,
      velocity.y);
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:
        (UIGestureRecognizer *)otherGestureRecognizer {
  return YES;
}

- (void)invalidate {
  _callback = nil;
  auto view = _view;
  if (view != nil && _recognizer != nil) {
    [view removeGestureRecognizer:_recognizer];
  }
  _recognizer.delegate = nil;
  _recognizer = nil;
  _view = nil;
}

@end

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
using solid_native::fabric::react_native::NativeResourceResolver;
using solid_native::fabric::react_native::ReactNativeVersion;
using solid_native::fabric::react_native::TransactionCoordinator;

constexpr char GlobalBindingName[] = "__solidNativeHost";
constexpr char ReactNativeStopSurfaceGlobal[] = "RN$stopSurface";
constexpr int HostContractVersion = 1;
constexpr size_t MaximumTransportDepth = 64;
constexpr size_t MaximumTransportValues = 100000;
constexpr size_t MaximumRetainedResources = 64;
constexpr size_t MaximumResourceKindLength = 128;
constexpr size_t MaximumActiveUIWorklets = 256;
constexpr size_t MaximumFatalErrorNameBytes = 512;
constexpr size_t MaximumFatalErrorMessageBytes = 8192;
constexpr NSUInteger MaximumUIWorkletMountAttempts = 300;
constexpr NSUInteger MaximumMountObservationAttempts = 2000;
constexpr int64_t MountObservationRetryNanoseconds = 5 * NSEC_PER_MSEC;

std::string utf8(NSString *value);
folly::dynamic dynamicFromJSI(
    Runtime &runtime,
    const Value &value,
    const std::string &path,
    size_t depth,
    size_t &valueCount,
    std::vector<Value> &ancestors);

void installEmptySurfaceStopCompatibility(Runtime &runtime) {
  auto global = runtime.global();
  if (!global.getProperty(runtime, ReactNativeStopSurfaceGlobal)
           .isUndefined()) {
    return;
  }

  // React Native exposes startEmptySurface, but UIManager::stopSurface still
  // unconditionally calls the React renderer's RN$stopSurface global. Solid
  // Native has no React root to unmount. Supply the missing empty-surface stop
  // half without replacing a renderer-owned function when one exists.
  global.setProperty(
      runtime,
      ReactNativeStopSurfaceGlobal,
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, ReactNativeStopSurfaceGlobal),
          1,
          [](Runtime &,
             const Value &,
             const Value *,
             size_t) { return Value::undefined(); }));
}

struct RoutedEvent final {
  int64_t node;
  std::string name;
};

std::vector<std::string> semanticEventNames(const std::string &nativeName) {
  auto name = nativeName;
  // EventEmitter::dispatchEvent normalizes native names such as touchEnd to
  // topTouchEnd before Scheduler EventListeners observe them. Keep routing
  // independent of that legacy React prefix so platform adapters can use the
  // native event names they actually emit.
  if (name.size() > 3 && name.compare(0, 3, "top") == 0) {
    name = name.substr(3);
    if (!name.empty() && name[0] >= 'A' && name[0] <= 'Z') {
      name[0] = static_cast<char>(name[0] - 'A' + 'a');
    }
  }
  if (name == "click") return {"press"};
  // React Native's JavaScript Pressability layer normally synthesizes click
  // semantics from these iOS touch events. Solid owns that layer here, so one
  // native release can fan out to both pressOut and press subscribers.
  if (name == "touchStart" || name == "pointerDown") {
    return {"pressIn"};
  }
  if (name == "touchMove" || name == "pointerMove") {
    return {"pressMove"};
  }
  if (name == "pointerEnter") return {"hoverIn"};
  if (name == "pointerLeave") return {"hoverOut"};
  if (name == "touchEnd") return {"pressOut", "press"};
  if (name == "touchCancel" || name == "pointerCancel") {
    return {"pressCancel"};
  }
  if (name == "pointerUp") return {"pressOut"};
  // TextInput and Switch both inherit React Native's generic `change` event.
  // Route both portable candidates; the node's declared subscription selects
  // the one that is semantically valid for that component.
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
  // Android's corresponding legacy path categorizes coalescible Image
  // completion events as Continuous. Normalize resource completion at this
  // framework-neutral boundary so both platform adapters expose one contract.
  // Screen visibility notifications likewise should not inherit user-input
  // scheduling semantics from the backend emitter.
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

void installEmptySurfaceStopHandler(Runtime &runtime) {
  auto global = runtime.global();
  auto existing = global.getProperty(runtime, "RN$stopSurface");
  if (existing.isObject() &&
      existing.getObject(runtime).isFunction(runtime)) {
    return;
  }

  // React Native 0.87 starts an empty-module Surface through
  // UIManager::startEmptySurface, so ReactFabric never installs its global
  // stop function. SurfaceHandler::stop nevertheless calls the same global.
  // Solid already committed the empty tree; this handler completes that
  // React-only half of the stop contract without loading ReactFabric.
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

enum class IOSViewOutput : size_t {
  Opacity = 0,
  TranslateX = 1,
  TranslateY = 2,
  ScaleX = 3,
  ScaleY = 4,
  Rotation = 5,
};

constexpr size_t IOSViewOutputCount = 6;

IOSViewOutput requireIOSViewOutput(const std::string &name) {
  if (name == "opacity") return IOSViewOutput::Opacity;
  if (name == "translateX") return IOSViewOutput::TranslateX;
  if (name == "translateY") return IOSViewOutput::TranslateY;
  if (name == "scaleX") return IOSViewOutput::ScaleX;
  if (name == "scaleY") return IOSViewOutput::ScaleY;
  if (name == "rotation") return IOSViewOutput::Rotation;
  throw std::invalid_argument(
      "iOS native view worklets do not support output channel " + name +
      ".");
}

struct IOSUIWorkletTimingState final {
  std::vector<double> from;
  solid_native::worklets::UIWorkletTimingSequence definition;
  std::optional<int64_t> startedAtNanoseconds;
};

struct IOSUIWorkletSpringState final {
  std::vector<double> from;
  std::vector<double> to;
  solid_native::worklets::UIWorkletSpring definition;
  std::optional<int64_t> startedAtNanoseconds;
};

struct IOSUIWorkletDecayState final {
  std::vector<double> from;
  std::vector<double> velocities;
  double initialSpeed;
  solid_native::worklets::UIWorkletDecay definition;
  std::optional<int64_t> startedAtNanoseconds;
};

struct IOSUIWorkletPanState final {
  solid_native::worklets::UIWorkletPanGesture definition;
  bool active{false};
  double originX{0};
  double originY{0};
  int64_t sequence{0};
  std::optional<double> timestamp;
};

struct IOSUIWorkletState final {
  IOSUIWorkletState(
      int64_t handleValue,
      int64_t targetNodeValue,
      facebook::react::Tag targetTagValue,
      solid_native::worklets::UIWorkletGraph graphValue,
      std::vector<IOSViewOutput> channelValues)
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
  const std::vector<IOSViewOutput> channels;
  std::vector<double> inputs;
  std::vector<solid_native::worklets::UIWorkletOutputValue> outputs;
  bool active{true};
  bool framePending{false};
  uint64_t frameGeneration{0};
  bool hasTimestamp{false};
  double timestamp{0};
  int64_t sequence{0};
  int64_t appliedSequence{0};
  int64_t frameTimeNanoseconds{0};
  NSUInteger mountAttempts{0};
  std::optional<IOSUIWorkletTimingState> timing;
  double timingProgress{0};
  solid_native::worklets::UIWorkletFrameStatistics timingFrameStatistics;
  std::optional<IOSUIWorkletSpringState> spring;
  std::optional<double> springPosition;
  std::optional<double> springVelocity;
  solid_native::worklets::UIWorkletFrameStatistics springFrameStatistics;
  std::optional<IOSUIWorkletDecayState> decay;
  std::optional<double> decayElapsedMilliseconds;
  std::optional<double> decaySpeed;
  solid_native::worklets::UIWorkletFrameStatistics decayFrameStatistics;
  std::optional<IOSUIWorkletPanState> pan;
  __strong SolidNativeDisplayLinkObserver *frameObserver{nil};
  __strong SolidNativePanGestureObserver *panObserver{nil};
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

void invalidateIOSUIWorkletPanObserver(
    SolidNativePanGestureObserver *observer) {
  if (observer == nil) return;
  if (NSThread.isMainThread) {
    [observer invalidate];
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [observer invalidate];
  });
}

void invalidateIOSUIWorkletFrameObserver(
    SolidNativeDisplayLinkObserver *observer) {
  if (observer == nil) return;
  if (NSThread.isMainThread) {
    [observer invalidate];
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [observer invalidate];
  });
}

void deactivateIOSUIWorklet(
    const std::shared_ptr<IOSUIWorkletState> &state) {
  SolidNativeDisplayLinkObserver *frameObserver = nil;
  SolidNativePanGestureObserver *observer = nil;
  {
    std::lock_guard lock(state->mutex);
    state->active = false;
    state->framePending = false;
    state->frameGeneration++;
    if (state->pan.has_value()) state->pan->active = false;
    frameObserver = state->frameObserver;
    state->frameObserver = nil;
    observer = state->panObserver;
    state->panObserver = nil;
  }
  invalidateIOSUIWorkletFrameObserver(frameObserver);
  invalidateIOSUIWorkletPanObserver(observer);
}

std::atomic<int64_t> nextIOSUIWorkletHandle{1};

class IOSUIWorkletRegistry final {
 public:
  std::shared_ptr<IOSUIWorkletState> install(
      int64_t targetNode,
      facebook::react::Tag targetTag,
      solid_native::worklets::UIWorkletGraph graph) {
    std::vector<IOSViewOutput> channels;
    channels.reserve(graph.outputNames().size());
    for (const auto &name : graph.outputNames()) {
      channels.push_back(requireIOSViewOutput(name));
    }
    graph.evaluate(graph.initialInputs());
    const auto handle =
        nextIOSUIWorkletHandle.fetch_add(1, std::memory_order_relaxed);
    if (handle <= 0 || handle > 9007199254740991LL) {
      throw std::runtime_error(
          "The iOS UI worklet handle space is exhausted.");
    }
    auto state = std::make_shared<IOSUIWorkletState>(
        handle,
        targetNode,
        targetTag,
        std::move(graph),
        std::move(channels));
    {
      std::lock_guard lock(mutex_);
      if (active_.size() >= MaximumActiveUIWorklets) {
        throw std::runtime_error("The iOS UI worklet registry is full.");
      }
      active_.emplace(handle, state);
      issued_.insert(handle);
    }
    return state;
  }

  std::shared_ptr<IOSUIWorkletState> update(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The iOS UI worklet input vector is owned by its native pan gesture.");
      }
      if (!std::isfinite(timestamp) || timestamp < 0) {
        throw std::invalid_argument(
            "UI worklet timestamps must be finite and non-negative.");
      }
      if (state->hasTimestamp && timestamp < state->timestamp) {
        throw std::invalid_argument(
            "UI worklet input timestamps must be monotonic.");
      }
      // Evaluate the complete candidate before publishing any input.
      state->graph.evaluate(inputs);
      state->inputs = std::move(inputs);
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      state->mountAttempts = 0;
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
    return state;
  }

  std::shared_ptr<IOSUIWorkletState> animate(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp,
      solid_native::worklets::UIWorkletTiming timing) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The iOS UI worklet input vector is owned by its native pan gesture.");
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
      state->timing = IOSUIWorkletTimingState{
          .from = state->inputs,
          .definition = {
              .keyframes = std::move(keyframes),
              .totalDurationMilliseconds = timing.durationMilliseconds,
          },
      };
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      state->mountAttempts = 0;
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
    return state;
  }

  std::shared_ptr<IOSUIWorkletState> animateKeyframes(
      int64_t handle,
      solid_native::worklets::UIWorkletTimingSequence keyframes,
      double timestamp) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The iOS UI worklet input vector is owned by its native pan gesture.");
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
      state->timing = IOSUIWorkletTimingState{
          .from = state->inputs,
          .definition = std::move(keyframes),
      };
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      state->mountAttempts = 0;
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
    return state;
  }

  std::shared_ptr<IOSUIWorkletState> spring(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp,
      solid_native::worklets::UIWorkletSpring spring) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The iOS UI worklet input vector is owned by its native pan gesture.");
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
      state->spring = IOSUIWorkletSpringState{
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
      state->mountAttempts = 0;
    }
    return state;
  }

  std::shared_ptr<IOSUIWorkletState> decay(
      int64_t handle,
      std::vector<double> velocities,
      double timestamp,
      solid_native::worklets::UIWorkletDecay decay) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The iOS UI worklet input vector is owned by its native pan gesture.");
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
      // Reject a terminal graph failure before replacing another driver.
      state->graph.evaluate(terminalInputs);
      state->timing.reset();
      state->timingProgress = 0;
      state->timingFrameStatistics.reset();
      state->spring.reset();
      state->springPosition.reset();
      state->springVelocity.reset();
      state->springFrameStatistics.reset();
      state->decay = IOSUIWorkletDecayState{
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
      state->mountAttempts = 0;
    }
    return state;
  }

  std::vector<double> cancelAnimation(int64_t handle, double timestamp) {
    auto state = requireActive(handle);
    SolidNativeDisplayLinkObserver *frameObserver = nil;
    std::vector<double> inputs;
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
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
        state->frameGeneration++;
        frameObserver = state->frameObserver;
        state->frameObserver = nil;
      }
      inputs = state->inputs;
    }
    invalidateIOSUIWorkletFrameObserver(frameObserver);
    return inputs;
  }

  std::shared_ptr<IOSUIWorkletState> attachPan(
      int64_t handle,
      solid_native::worklets::UIWorkletPanGesture pan) {
    auto state = requireActive(handle);
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
      }
      if (state->pan.has_value()) {
        throw std::invalid_argument(
            "The iOS UI worklet graph already owns a native pan gesture.");
      }
      state->pan = IOSUIWorkletPanState{.definition = std::move(pan)};
    }
    return state;
  }

  void detachPan(int64_t handle) {
    auto state = requireActive(handle);
    SolidNativePanGestureObserver *observer = nil;
    {
      std::lock_guard lock(state->mutex);
      if (state->pan.has_value()) state->pan->active = false;
      state->pan.reset();
      observer = state->panObserver;
      state->panObserver = nil;
    }
    invalidateIOSUIWorkletPanObserver(observer);
  }

  std::vector<double> releasePan(int64_t handle, double timestamp) {
    auto state = requireActive(handle);
    SolidNativeDisplayLinkObserver *frameObserver = nil;
    SolidNativePanGestureObserver *panObserver = nil;
    std::vector<double> inputs;
    {
      std::lock_guard lock(state->mutex);
      if (!state->active) {
        throw std::invalid_argument(
            "The iOS UI worklet graph is no longer active.");
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
            "The iOS UI worklet graph does not own a native pan gesture.");
      }
      const auto hadDriver = state->timing.has_value() ||
          state->spring.has_value() || state->decay.has_value();
      state->pan->active = false;
      state->pan.reset();
      panObserver = state->panObserver;
      state->panObserver = nil;
      state->timing.reset();
      state->spring.reset();
      if (state->springVelocity.has_value()) state->springVelocity = 0;
      state->decay.reset();
      if (state->decaySpeed.has_value()) state->decaySpeed = 0;
      state->timestamp = timestamp;
      state->hasTimestamp = true;
      if (hadDriver) {
        state->framePending = false;
        state->frameGeneration++;
        frameObserver = state->frameObserver;
        state->frameObserver = nil;
      }
      inputs = state->inputs;
    }
    invalidateIOSUIWorkletFrameObserver(frameObserver);
    invalidateIOSUIWorkletPanObserver(panObserver);
    return inputs;
  }

  void destroy(int64_t handle) {
    std::shared_ptr<IOSUIWorkletState> state;
    {
      std::lock_guard lock(mutex_);
      if (issued_.erase(handle) == 0) {
        throw std::invalid_argument(
            "Unknown iOS UI worklet graph handle " +
            std::to_string(handle) + ".");
      }
      const auto entry = active_.find(handle);
      if (entry != active_.end()) {
        state = std::move(entry->second);
        active_.erase(entry);
      }
    }
    if (state) deactivateIOSUIWorklet(state);
  }

  void cancelNode(int64_t targetNode) {
    std::vector<std::shared_ptr<IOSUIWorkletState>> cancelled;
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
      deactivateIOSUIWorklet(state);
    }
  }

  void cancelAll() {
    std::vector<std::shared_ptr<IOSUIWorkletState>> cancelled;
    {
      std::lock_guard lock(mutex_);
      for (const auto &[_, state] : active_) cancelled.push_back(state);
      active_.clear();
      issued_.clear();
    }
    for (const auto &state : cancelled) {
      deactivateIOSUIWorklet(state);
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

  std::shared_ptr<IOSUIWorkletState> requireActive(int64_t handle) const {
    std::lock_guard lock(mutex_);
    const auto entry = active_.find(handle);
    if (entry == active_.end()) {
      throw std::invalid_argument(
          "Unknown or cancelled iOS UI worklet graph handle " +
          std::to_string(handle) + ".");
    }
    return entry->second;
  }

 private:
  mutable std::mutex mutex_;
  std::unordered_map<int64_t, std::shared_ptr<IOSUIWorkletState>> active_;
  std::unordered_set<int64_t> issued_;
};

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
    const auto eventsEntry = eventsByNode_.find(node);
    return eventsEntry != eventsByNode_.end() &&
        eventsEntry->second.contains(name);
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
      NSDictionary<NSString *, id> *transaction,
      const NodeIdentityMap &identities) {
    LayoutRouteStage stage;
    std::unordered_map<int64_t, std::unordered_set<std::string>> layoutEvents;
    id mutationsValue = transaction[@"mutations"];
    if ([mutationsValue isKindOfClass:NSArray.class]) {
      for (id value in (NSArray *)mutationsValue) {
        if (![value isKindOfClass:NSDictionary.class]) continue;
        auto mutation = (NSDictionary<NSString *, id> *)value;
        if (![mutation[@"type"] isEqual:@"update-event-listeners"] ||
            ![mutation[@"node"] isKindOfClass:NSNumber.class] ||
            ![mutation[@"events"] isKindOfClass:NSArray.class]) {
          continue;
        }
        std::unordered_set<std::string> events;
        for (id eventValue in (NSArray *)mutation[@"events"]) {
          if ([eventValue isKindOfClass:NSString.class]) {
            events.insert(utf8((NSString *)eventValue));
          }
        }
        const auto node = [(NSNumber *)mutation[@"node"] longLongValue];
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
    id surfaceValue = transaction[@"surface"];
    id sequenceValue = transaction[@"sequence"];
    if ([surfaceValue isKindOfClass:NSNumber.class]) {
      surface.store(
          [(NSNumber *)surfaceValue longLongValue], std::memory_order_release);
    }
    if ([sequenceValue isKindOfClass:NSNumber.class]) {
      sequence.store(
          [(NSNumber *)sequenceValue longLongValue],
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
      NSDictionary<NSString *, id> *transaction,
      const NodeIdentityMap &identities,
      int64_t committedSequence) {
    std::lock_guard lock(mutex_);
    for (const auto &[node, identity] : identities) {
      nodesByTag_[identity.tag] = node;
      tagsByNode_[node] = identity.tag;
    }

    id mutationsValue = transaction[@"mutations"];
    if ([mutationsValue isKindOfClass:NSArray.class]) {
      for (id value in (NSArray *)mutationsValue) {
        if (![value isKindOfClass:NSDictionary.class]) continue;
        auto mutation = (NSDictionary<NSString *, id> *)value;
        id typeValue = mutation[@"type"];
        if (![typeValue isKindOfClass:NSString.class]) continue;
        if ([(NSString *)typeValue isEqualToString:@"insert-child"] ||
            [(NSString *)typeValue isEqualToString:@"remove-child"]) {
          id parentValue = mutation[@"parent"];
          id childValue = mutation[@"child"];
          if (![parentValue isKindOfClass:NSNumber.class] ||
              ![childValue isKindOfClass:NSNumber.class]) {
            continue;
          }
          const auto parent = [(NSNumber *)parentValue longLongValue];
          const auto child = [(NSNumber *)childValue longLongValue];
          if ([(NSString *)typeValue isEqualToString:@"insert-child"]) {
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
        id nodeValue = mutation[@"node"];
        if (![nodeValue isKindOfClass:NSNumber.class]) continue;
        const auto node = [(NSNumber *)nodeValue longLongValue];
        if ([(NSString *)typeValue isEqualToString:@"delete-node"]) {
          eventsByNode_.erase(node);
          parentsByNode_.erase(node);
          continue;
        }
        if (![(NSString *)typeValue
                isEqualToString:@"update-event-listeners"]) {
          continue;
        }
        std::unordered_set<std::string> events;
        id eventsValue = mutation[@"events"];
        if ([eventsValue isKindOfClass:NSArray.class]) {
          for (id eventValue in (NSArray *)eventsValue) {
            if ([eventValue isKindOfClass:NSString.class]) {
              events.insert(utf8((NSString *)eventValue));
            }
          }
        }
        eventsByNode_[node] = std::move(events);
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

struct RetiredInstances final {
  int64_t fabricRevision;
  std::vector<int64_t> handles;
};

struct CommitMountObservation final {
  int64_t surface;
  int64_t sequence;
  int64_t fabricRevision;
  double commitStartedAt;
  double commitStartedMonotonic;
  bool notifyLifecycle;
  std::optional<std::string> causalOperationId;
};

class RuntimeState final : public facebook::jsi::NativeState {
 public:
  RuntimeState(
      Runtime &runtime,
      const Object &storage,
      std::shared_ptr<EventRoutingState> routing)
      : storage_(runtime, storage), routing_(std::move(routing)) {}

  ~RuntimeState() override {
    uiWorklets_.cancelAll();
    routing_->active.store(false, std::memory_order_release);
    routing_->handlerInstalled.store(false, std::memory_order_release);
    commitLifecycleHandlerInstalled_.store(false, std::memory_order_release);
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
    return resources(runtime).getProperty(runtime, keyFor(handle).c_str());
  }

  void releaseResource(Runtime &runtime, int64_t handle) {
    if (resourceKinds_.erase(handle) == 0) {
      throw std::invalid_argument(
          "Native resource " + std::to_string(handle) +
          " is not retained.");
    }
    resources(runtime).deleteProperty(runtime, keyFor(handle).c_str());
  }

  void reclaimAllResources(Runtime &runtime) {
    const auto handles = resourceKinds_;
    for (const auto &[handle, _] : handles) {
      resources(runtime).deleteProperty(runtime, keyFor(handle).c_str());
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
    retainedNodeCount_++;
  }

  void releaseInstance(Runtime &runtime, int64_t handle) {
    if (retainedHandles_.erase(handle) == 0) return;
    uiWorklets_.cancelNode(handle);
    const auto key = std::to_string(handle);
    instances(runtime).deleteProperty(runtime, key.c_str());
    retainedNodeCount_--;
    routing_->reclaimNode(handle);
  }

  size_t retainedNodeCount() const {
    return retainedNodeCount_;
  }

  std::shared_ptr<IOSUIWorkletState> installUIWorklet(
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

  std::shared_ptr<IOSUIWorkletState> updateUIWorklet(
      int64_t handle,
      std::vector<double> inputs,
      double timestamp) {
    return uiWorklets_.update(handle, std::move(inputs), timestamp);
  }

  std::shared_ptr<IOSUIWorkletState> animateUIWorklet(
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
    return uiWorklets_.animate(
        handle,
        std::move(inputs),
        timestamp,
        solid_native::worklets::UIWorkletTiming::parse(timing));
  }

  std::shared_ptr<IOSUIWorkletState> animateUIWorkletKeyframes(
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
    return uiWorklets_.animateKeyframes(
        handle,
        solid_native::worklets::UIWorkletTimingSequence::parse(
            keyframes, state->graph.inputCount()),
        timestamp);
  }

  std::shared_ptr<IOSUIWorkletState> springUIWorklet(
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
    return uiWorklets_.spring(
        handle,
        std::move(inputs),
        timestamp,
        solid_native::worklets::UIWorkletSpring::parse(spring));
  }

  std::shared_ptr<IOSUIWorkletState> decayUIWorklet(
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
    return uiWorklets_.decay(
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

  std::shared_ptr<IOSUIWorkletState> attachUIWorkletPan(
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

  std::shared_ptr<IOSUIWorkletState> requireUIWorklet(
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
      int64_t mountedFabricRevision,
      const std::shared_ptr<EventRoutingState> &routing) {
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

  void reclaimAllInstances(
      Runtime &runtime,
      const std::shared_ptr<EventRoutingState> &routing) {
    const std::vector<int64_t> handles(
        retainedHandles_.begin(), retainedHandles_.end());
    for (const auto handle : handles) {
      releaseInstance(runtime, handle);
    }
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

  void setCommitLifecycleHandler(Runtime &runtime, const Value &handler) {
    storage(runtime).setProperty(
        runtime, "commitLifecycleHandler", Value(runtime, handler));
    commitLifecycleHandlerInstalled_.store(
        handler.isObject() && handler.getObject(runtime).isFunction(runtime),
        std::memory_order_release);
  }

  Value commitLifecycleHandler(Runtime &runtime) const {
    return storage(runtime).getProperty(runtime, "commitLifecycleHandler");
  }

  bool hasCommitLifecycleHandler() const {
    return commitLifecycleHandlerInstalled_.load(std::memory_order_acquire);
  }

 private:
  static std::string keyFor(int64_t handle) {
    return std::to_string(handle);
  }

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
  size_t retainedNodeCount_{0};
  std::unordered_set<int64_t> retainedHandles_;
  std::vector<RetiredInstances> retiredInstances_;
  int64_t nextResourceHandle_{1};
  std::unordered_map<int64_t, std::string> resourceKinds_;
  std::atomic<bool> commitLifecycleHandlerInstalled_{false};
  IOSUIWorkletRegistry uiWorklets_;
  std::function<void()> runtimeRetirementHandler_;
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
    if (committed_) return;
    rollback();
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

std::string utf8(NSString *value) {
  const char *characters = value.UTF8String;
  if (characters == nullptr) {
    throw std::invalid_argument("A native string is not valid UTF-8.");
  }
  return characters;
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

int64_t requireSafeInteger(
    Runtime &runtime,
    const Value &value,
    const char *name,
    bool positive) {
  if (!value.isNumber()) {
    throw JSError(runtime, std::string(name) + " must be an integer.");
  }
  const auto number = value.getNumber();
  if (!std::isfinite(number) || std::trunc(number) != number ||
      std::abs(number) > 9007199254740991.0 || (positive && number <= 0)) {
    throw JSError(
        runtime,
        std::string(name) +
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
        std::string{name} +
            " must be a bounded non-empty string without null bytes.");
  }
  return text;
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
    auto nameString =
        names.getValueAtIndex(runtime, index).getString(runtime);
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

id foundationFromDynamic(const folly::dynamic &value) {
  switch (value.type()) {
    case folly::dynamic::NULLT:
      return NSNull.null;
    case folly::dynamic::BOOL:
      return @(value.getBool());
    case folly::dynamic::DOUBLE:
      return @(value.getDouble());
    case folly::dynamic::INT64:
      return @(value.getInt());
    case folly::dynamic::STRING:
      return [NSString stringWithUTF8String:value.getString().c_str()];
    case folly::dynamic::ARRAY: {
      NSMutableArray *array =
          [NSMutableArray arrayWithCapacity:value.size()];
      for (const auto &child : value) {
        [array addObject:foundationFromDynamic(child)];
      }
      return array;
    }
    case folly::dynamic::OBJECT: {
      NSMutableDictionary<NSString *, id> *dictionary =
          [NSMutableDictionary dictionaryWithCapacity:value.size()];
      for (const auto &item : value.items()) {
        if (!item.first.isString()) {
          throw std::invalid_argument(
              "The host transaction contains a non-string object key.");
        }
        auto key =
            [NSString stringWithUTF8String:item.first.getString().c_str()];
        dictionary[key] = foundationFromDynamic(item.second);
      }
      return dictionary;
    }
  }
  throw std::invalid_argument("Unsupported host transaction value.");
}

Object surfaceInfoObject(
    Runtime &runtime,
    NSDictionary<NSString *, id> *snapshot,
    size_t retainedNodeCount,
    size_t retainedResourceCount,
    size_t activeUIWorkletCount,
    size_t pendingUIWorkletFrameCount) {
  Object result(runtime);
  result.setProperty(
      runtime, "ready", [snapshot[@"ready"] boolValue] == YES);
  result.setProperty(
      runtime, "surface", [snapshot[@"surface"] doubleValue]);
  result.setProperty(
      runtime, "sequence", [snapshot[@"sequence"] doubleValue]);
  result.setProperty(
      runtime, "retainedNodeCount", static_cast<double>(retainedNodeCount));
  result.setProperty(
      runtime,
      "retainedResourceCount",
      static_cast<double>(retainedResourceCount));
  result.setProperty(
      runtime,
      "activeUIWorkletCount",
      static_cast<double>(activeUIWorkletCount));
  result.setProperty(
      runtime,
      "pendingUIWorkletFrameCount",
      static_cast<double>(pendingUIWorkletFrameCount));
  return result;
}

Object commitResultObject(
    Runtime &runtime,
    NSDictionary<NSString *, id> *result) {
  Object object(runtime);
  object.setProperty(runtime, "surface", [result[@"surface"] doubleValue]);
  object.setProperty(runtime, "sequence", [result[@"sequence"] doubleValue]);
  object.setProperty(
      runtime, "mounted", [result[@"mounted"] boolValue] == YES);
  id fabricRevision = result[@"fabricRevision"];
  if ([fabricRevision isKindOfClass:NSNumber.class]) {
    object.setProperty(
        runtime,
        "hostRevision",
        [(NSNumber *)fabricRevision doubleValue]);
  }
  return object;
}

std::optional<std::string> commitCausalOperationId(
    NSDictionary<NSString *, id> *transaction) {
  id contextValue = transaction[@"causalContext"];
  if (![contextValue isKindOfClass:NSDictionary.class]) return std::nullopt;
  id operationIdValue = ((NSDictionary *)contextValue)[@"operationId"];
  if (![operationIdValue isKindOfClass:NSString.class]) return std::nullopt;
  return utf8((NSString *)operationIdValue);
}

Object measurementObject(
    Runtime &runtime,
    NSDictionary<NSString *, id> *measurement) {
  Object object(runtime);
  object.setProperty(runtime, "x", [measurement[@"x"] doubleValue]);
  object.setProperty(runtime, "y", [measurement[@"y"] doubleValue]);
  object.setProperty(
      runtime, "width", [measurement[@"width"] doubleValue]);
  object.setProperty(
      runtime, "height", [measurement[@"height"] doubleValue]);
  object.setProperty(runtime, "pageX", [measurement[@"pageX"] doubleValue]);
  object.setProperty(runtime, "pageY", [measurement[@"pageY"] doubleValue]);
  object.setProperty(
      runtime,
      "observedSequence",
      [measurement[@"observedSequence"] doubleValue]);
  return object;
}

std::vector<int64_t> deletedNodeHandles(
    NSDictionary<NSString *, id> *transaction) {
  std::vector<int64_t> handles;
  id mutationsValue = transaction[@"mutations"];
  if (![mutationsValue isKindOfClass:NSArray.class]) return handles;
  for (id value in (NSArray *)mutationsValue) {
    if (![value isKindOfClass:NSDictionary.class]) continue;
    auto mutation = (NSDictionary<NSString *, id> *)value;
    if (![mutation[@"type"] isEqual:@"delete-node"] ||
        ![mutation[@"node"] isKindOfClass:NSNumber.class]) {
      continue;
    }
    handles.push_back([(NSNumber *)mutation[@"node"] longLongValue]);
  }
  return handles;
}

PreparedNodeIdentities prepareNodeIdentities(
    Runtime &runtime,
    NSDictionary<NSString *, id> *transaction,
    int64_t surface,
    const std::shared_ptr<RuntimeState> &state) {
  PreparedNodeIdentities prepared;
  id mutationsValue = transaction[@"mutations"];
  if (![mutationsValue isKindOfClass:NSArray.class]) return prepared;

  for (id value in (NSArray *)mutationsValue) {
    if (![value isKindOfClass:NSDictionary.class]) continue;
    auto mutation = (NSDictionary<NSString *, id> *)value;
    id typeValue = mutation[@"type"];
    if (![typeValue isKindOfClass:NSString.class]) continue;
    NSString *type = (NSString *)typeValue;
    if (![type isEqualToString:@"create-element"] &&
        ![type isEqualToString:@"create-text"]) {
      continue;
    }

    id nodeValue = mutation[@"node"];
    if (![nodeValue isKindOfClass:NSNumber.class] ||
        CFGetTypeID((__bridge CFTypeRef)nodeValue) == CFBooleanGetTypeID()) {
      continue;
    }
    const double nodeNumber = [(NSNumber *)nodeValue doubleValue];
    if (!std::isfinite(nodeNumber) || std::trunc(nodeNumber) != nodeNumber ||
        nodeNumber <= 0 || nodeNumber > 9007199254740991.0) {
      continue;
    }
    const auto node = static_cast<int64_t>(nodeNumber);
    if (prepared.identities.contains(node)) continue;
    if (state->hasInstance(runtime, node)) {
      throw std::invalid_argument(
          "Node " + std::to_string(node) +
          " cannot reuse a retained JavaScript instance identity.");
    }

    Object instance(runtime);
    instance.setProperty(runtime, "surface", static_cast<double>(surface));
    instance.setProperty(runtime, "node", static_cast<double>(node));
    auto objectConstructor =
        runtime.global().getPropertyAsObject(runtime, "Object");
    auto freeze = objectConstructor.getPropertyAsFunction(runtime, "freeze");
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
        const auto timestamp = event.eventStartTimeStamp.toDOMHighResTimeStamp();
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
                auto handler = handlerObject.getFunction(runtime);
                handler.call(runtime, nativeEvent);
              });
        }
        return true;
      });
}

} // namespace

@interface SolidNativeFabricSurface (SolidNativeJSIIdentities)
- (nullable NSDictionary<NSString *, id> *)
    applyTransactionSynchronously:(NSDictionary<NSString *, id> *)transaction
                    nodeIdentities:
                        (const solid_native::fabric::react_native::NodeIdentityMap *)
                            nodeIdentities
                          runtime:(facebook::jsi::Runtime *)runtime
                 resourceResolver:
                     (const NativeResourceResolver *)resourceResolver
                             error:(NSError *_Nullable *_Nullable)error;
- (void)addSolidNativeEventListener:
    (const std::shared_ptr<facebook::react::EventListener> &)listener;
- (void)removeSolidNativeEventListener:
    (const std::shared_ptr<facebook::react::EventListener> &)listener;
- (nullable NSDictionary<NSString *, id> *)
    measureNodeSynchronously:(int64_t)node
               afterSequence:(int64_t)afterSequence
                       error:(NSError *_Nullable *_Nullable)error;
- (BOOL)hasNoLogicalNodes;
- (int64_t)mountedFabricRevision;
- (nullable UIView *)findComponentViewWithTag:(facebook::react::Tag)tag;
@end

@interface SolidNativeFabricJSIBinding ()
- (BOOL)reportFatalErrorWithName:(NSString *)name
                         message:(NSString *)message;
- (NSDictionary<NSString *, id> *)surfaceSnapshot;
- (nullable NSDictionary<NSString *, id> *)
    applyTransaction:(NSDictionary<NSString *, id> *)transaction
       nodeIdentities:
           (const solid_native::fabric::react_native::NodeIdentityMap *)nodeIdentities
              runtime:(facebook::jsi::Runtime *)runtime
     resourceResolver:(const NativeResourceResolver *)resourceResolver
                error:(NSError *_Nullable *_Nullable)error;
- (nullable NSDictionary<NSString *, id> *)
    measureNode:(int64_t)node
    afterSequence:(int64_t)afterSequence
            error:(NSError *_Nullable *_Nullable)error;
- (BOOL)destroySurface:(NSError *_Nullable *_Nullable)error;
- (void)scheduleUIWorkletFrame:
    (std::shared_ptr<IOSUIWorkletState>)worklet;
- (void)attachUIWorkletPanGesture:
    (std::shared_ptr<IOSUIWorkletState>)worklet;
- (BOOL)applyUIWorkletFrame:(const IOSUIWorkletState &)worklet
                     values:
                         (const std::array<double, IOSViewOutputCount> &)values;
- (void)scheduleMountObservation:
    (std::shared_ptr<const CommitMountObservation>)observation;
- (void)pollMountObservation:
            (std::shared_ptr<const CommitMountObservation>)observation
                       surface:(SolidNativeFabricSurface *)surface
              runtimeScheduler:
                  (std::shared_ptr<facebook::react::RuntimeScheduler>)
                      runtimeScheduler
                  runtimeState:(std::weak_ptr<RuntimeState>)runtimeState
                       routing:(std::shared_ptr<EventRoutingState>)routing
                       attempt:(NSUInteger)attempt;
- (void)retireRuntimeGeneration:(uint64_t)generation;
@end

@implementation SolidNativeFabricJSIBinding {
  NSLock *_lock;
  SolidNativeFabricSurface *_surface;
  SolidNativeFabricSurface *_eventSurface;
  BOOL _surfaceReady;
  BOOL _invalidated;
  BOOL _runtimeInstalled;
  uint64_t _runtimeGeneration;
  std::shared_ptr<EventRoutingState> _routing;
  std::weak_ptr<RuntimeState> _runtimeState;
  std::shared_ptr<facebook::react::RuntimeScheduler> _runtimeScheduler;
  std::shared_ptr<facebook::react::EventListener> _eventListener;
  SolidNativeFabricFatalErrorHandler _fatalErrorHandler;
}

- (instancetype)init {
  if (self = [super init]) {
    _lock = [[NSLock alloc] init];
    _routing = std::make_shared<EventRoutingState>();
  }
  return self;
}

- (void)installIntoRuntime:(Runtime &)runtime {
  const auto existing = runtime.global().getProperty(runtime, GlobalBindingName);
  if (!existing.isUndefined()) {
    throw JSError(
        runtime,
        "Solid Native cannot replace an existing __solidNativeHost binding.");
  }

  installEmptySurfaceStopCompatibility(runtime);

  std::shared_ptr<EventRoutingState> previousRouting;
  std::shared_ptr<RuntimeState> previousRuntimeState;
  std::shared_ptr<facebook::react::EventListener> previousEventListener;
  SolidNativeFabricSurface *previousEventSurface = nil;
  SolidNativeFabricSurface *surface = nil;
  BOOL replacingRuntime = NO;
  uint64_t runtimeGeneration = 0;
  [_lock lock];
  replacingRuntime = _runtimeInstalled;
  _runtimeInstalled = YES;
  runtimeGeneration = ++_runtimeGeneration;
  previousRouting = _routing;
  previousRuntimeState = _runtimeState.lock();
  previousEventListener = _eventListener;
  previousEventSurface = _eventSurface;
  surface = _surface;
  _routing = std::make_shared<EventRoutingState>();
  auto routing = _routing;
  _eventSurface = nil;
  _eventListener.reset();
  _runtimeScheduler.reset();
  _runtimeState.reset();
  [_lock unlock];
  previousRouting->active.store(false, std::memory_order_release);
  previousRouting->handlerInstalled.store(false, std::memory_order_release);
  if (previousRuntimeState) previousRuntimeState->cancelAllUIWorklets();
  if (previousEventSurface != nil && previousEventListener) {
    [previousEventSurface removeSolidNativeEventListener:previousEventListener];
  }
  if (replacingRuntime && previousRuntimeState && surface != nil) {
    [surface resetForJSRuntimeReload];
  }

  SolidNativeFabricJSIBinding *binding = self;
  Object host(runtime);
  Object runtimeStorage(runtime);
  runtimeStorage.setProperty(runtime, "instances", Object(runtime));
  runtimeStorage.setProperty(runtime, "resources", Object(runtime));
  auto runtimeState =
      std::make_shared<RuntimeState>(runtime, runtimeStorage, routing);
  __weak SolidNativeFabricJSIBinding *weakBinding = self;
  runtimeState->setRuntimeRetirementHandler(
      [weakBinding, runtimeGeneration] {
        SolidNativeFabricJSIBinding *binding = weakBinding;
        if (binding != nil) {
          [binding retireRuntimeGeneration:runtimeGeneration];
        }
      });
  std::weak_ptr<RuntimeState> weakRuntimeState = runtimeState;
  host.setNativeState(runtime, runtimeState);
  Object runtimeStorageDescriptor(runtime);
  runtimeStorageDescriptor.setProperty(runtime, "value", runtimeStorage);
  runtimeStorageDescriptor.setProperty(runtime, "writable", false);
  runtimeStorageDescriptor.setProperty(runtime, "configurable", false);
  runtimeStorageDescriptor.setProperty(runtime, "enumerable", false);
  host.setProperty(runtime, "contractVersion", HostContractVersion);
  host.setProperty(runtime, "backend", "react-native-fabric");
  host.setProperty(runtime, "backendVersion", ReactNativeVersion);
  host.setProperty(runtime, "platform", "ios");

  auto schedulerBinding =
      facebook::react::RuntimeSchedulerBinding::getBinding(runtime);
  if (!schedulerBinding) {
    throw JSError(
        runtime, "React Native did not install its RuntimeScheduler binding.");
  }
  auto runtimeScheduler = schedulerBinding->getRuntimeScheduler();
  if (!runtimeScheduler) {
    throw JSError(
        runtime, "React Native did not expose its RuntimeScheduler.");
  }
  auto eventListener = createEventListener(
      routing, runtimeScheduler, weakRuntimeState);
  [_lock lock];
  _runtimeState = weakRuntimeState;
  _runtimeScheduler = runtimeScheduler;
  _eventListener = eventListener;
  auto surfaceForEvents = _surface;
  if (surfaceForEvents != nil) _eventSurface = surfaceForEvents;
  [_lock unlock];
  if (surfaceForEvents != nil) {
    [surfaceForEvents addSolidNativeEventListener:eventListener];
  }

  auto objectConstructor =
      runtime.global().getPropertyAsObject(runtime, "Object");
  auto defineProperty =
      objectConstructor.getPropertyAsFunction(runtime, "defineProperty");
  defineProperty.call(
      runtime,
      host,
      String::createFromAscii(runtime, "__runtimeStorage"),
      runtimeStorageDescriptor);

  host.setProperty(
      runtime,
      "getSurfaceInfo",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "getSurfaceInfo"),
          0,
          [binding, weakRuntimeState, routing](Runtime &runtime,
                    const Value &,
                    const Value *,
                    size_t count) -> Value {
            if (count != 0) {
              throw JSError(
                  runtime, "getSurfaceInfo does not accept arguments.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            auto snapshot = [binding surfaceSnapshot];
            routing->surface.store(
                [snapshot[@"surface"] longLongValue],
                std::memory_order_release);
            routing->sequence.store(
                [snapshot[@"sequence"] longLongValue],
                std::memory_order_release);
            const auto uiWorkletActivity =
                runtimeState->uiWorkletActivityCounts();
            return surfaceInfoObject(
                runtime,
                snapshot,
                runtimeState->retainedNodeCount(),
                runtimeState->retainedResourceCount(),
                uiWorkletActivity.first,
                uiWorkletActivity.second);
          }));
  host.setProperty(
      runtime,
      "setEventHandler",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "setEventHandler"),
          1,
          [weakRuntimeState](Runtime &runtime,
                             const Value &,
                             const Value *arguments,
                             size_t count) -> Value {
            if (count != 1 ||
                (!arguments[0].isNull() &&
                 (!arguments[0].isObject() ||
                  !arguments[0].getObject(runtime).isFunction(runtime)))) {
              throw JSError(
                  runtime,
                  "setEventHandler requires exactly one function or null.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            if (arguments[0].isNull()) {
              const Value empty;
              runtimeState->setEventHandler(runtime, empty);
            } else {
              runtimeState->setEventHandler(runtime, arguments[0]);
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
          [weakRuntimeState](Runtime &runtime,
                             const Value &,
                             const Value *arguments,
                             size_t count) -> Value {
            if (count != 1 ||
                (!arguments[0].isNull() &&
                 (!arguments[0].isObject() ||
                  !arguments[0].getObject(runtime).isFunction(runtime)))) {
              throw JSError(
                  runtime,
                  "setCommitLifecycleHandler requires exactly one function "
                  "or null.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            if (arguments[0].isNull()) {
              const Value empty;
              runtimeState->setCommitLifecycleHandler(runtime, empty);
            } else {
              runtimeState->setCommitLifecycleHandler(runtime, arguments[0]);
            }
            return Value();
          }));
  host.setProperty(
      runtime,
      "measure",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "measure"),
          2,
          [binding](Runtime &runtime,
                    const Value &,
                    const Value *arguments,
                    size_t count) -> Value {
            if (count < 1 || count > 2) {
              throw JSError(
                  runtime,
                  "measure requires a node and an optional commit sequence.");
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
            NSError *error = nil;
            auto result = [binding measureNode:node
                                 afterSequence:afterSequence
                                         error:&error];
            if (result == nil) {
              throw JSError(runtime, utf8(error.localizedDescription));
            }
            return measurementObject(runtime, result);
          }));
  host.setProperty(
      runtime,
      "retainNativeResource",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "retainNativeResource"),
          2,
          [weakRuntimeState](Runtime &runtime,
                             const Value &,
                             const Value *arguments,
                             size_t count) -> Value {
            if (count != 2 || !arguments[1].isObject() ||
                arguments[1].getObject(runtime).isFunction(runtime) ||
                arguments[1].getObject(runtime).isArray(runtime)) {
              throw JSError(
                  runtime,
                  "retainNativeResource requires a kind and one non-array "
                  "object.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            const auto kind = requireResourceKind(runtime, arguments[0]);
            return Value(static_cast<double>(runtimeState->retainResource(
                runtime, kind, arguments[1])));
          }));
  host.setProperty(
      runtime,
      "releaseNativeResource",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "releaseNativeResource"),
          1,
          [weakRuntimeState](Runtime &runtime,
                             const Value &,
                             const Value *arguments,
                             size_t count) -> Value {
            if (count != 1) {
              throw JSError(
                  runtime,
                  "releaseNativeResource requires exactly one handle.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            const auto handle = requireSafeInteger(
                runtime, arguments[0], "The native resource handle", true);
            runtimeState->releaseResource(runtime, handle);
            return Value();
          }));
  host.setProperty(
      runtime,
      "installUIWorklet",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "installUIWorklet"),
          2,
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 2 || !arguments[1].isObject()) {
              throw JSError(
                  runtime,
                  "installUIWorklet requires a target node and one graph "
                  "object.");
            }
            auto state = weakRuntimeState.lock();
            if (!state) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            const auto target = requireSafeInteger(
                runtime,
                arguments[0],
                "The native UI worklet target",
                true);
            try {
              auto worklet =
                  state->installUIWorklet(runtime, target, arguments[1]);
              [binding scheduleUIWorkletFrame:worklet];
              return Value(static_cast<double>(worklet->handle));
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
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 3 || !arguments[1].isObject() ||
                !arguments[1].getObject(runtime).isArray(runtime) ||
                !arguments[2].isNumber()) {
              throw JSError(
                  runtime,
                  "updateUIWorkletInputs requires a handle, input array, "
                  "and timestamp.");
            }
            auto state = weakRuntimeState.lock();
            if (!state) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
                  runtime,
                  "The native UI worklet input vector is too large.");
            }
            std::vector<double> inputs;
            inputs.reserve(array.size(runtime));
            for (size_t index = 0; index < array.size(runtime); ++index) {
              auto value = array.getValueAtIndex(runtime, index);
              if (!value.isNumber() || !std::isfinite(value.getNumber())) {
                throw JSError(
                    runtime,
                    "Native UI worklet inputs must be finite numbers.");
              }
              inputs.push_back(value.getNumber());
            }
            try {
              auto worklet = state->updateUIWorklet(
                  handle,
                  std::move(inputs),
                  arguments[2].getNumber());
              [binding scheduleUIWorkletFrame:worklet];
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
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 4 || !arguments[1].isObject() ||
                !arguments[1].getObject(runtime).isArray(runtime) ||
                !arguments[2].isNumber() || !arguments[3].isObject()) {
              throw JSError(
                  runtime,
                  "animateUIWorkletInputs requires a handle, input array, "
                  "timestamp, and timing object.");
            }
            auto state = weakRuntimeState.lock();
            if (!state) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
                  runtime,
                  "The native UI worklet input vector is too large.");
            }
            std::vector<double> inputs;
            inputs.reserve(array.size(runtime));
            for (size_t index = 0; index < array.size(runtime); ++index) {
              auto value = array.getValueAtIndex(runtime, index);
              if (!value.isNumber() || !std::isfinite(value.getNumber())) {
                throw JSError(
                    runtime,
                    "Native UI worklet inputs must be finite numbers.");
              }
              inputs.push_back(value.getNumber());
            }
            try {
              auto worklet = state->animateUIWorklet(
                  runtime,
                  handle,
                  std::move(inputs),
                  arguments[2].getNumber(),
                  arguments[3]);
              [binding scheduleUIWorkletFrame:worklet];
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
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 3 || !arguments[1].isObject() ||
                !arguments[1].getObject(runtime).isArray(runtime) ||
                !arguments[2].isNumber()) {
              throw JSError(
                  runtime,
                  "animateUIWorkletKeyframes requires a handle, keyframe "
                  "array, and timestamp.");
            }
            auto state = weakRuntimeState.lock();
            if (!state) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            const auto handle = requireSafeInteger(
                runtime,
                arguments[0],
                "The native UI worklet handle",
                true);
            try {
              auto worklet = state->animateUIWorkletKeyframes(
                  runtime,
                  handle,
                  arguments[1],
                  arguments[2].getNumber());
              [binding scheduleUIWorkletFrame:worklet];
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
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 4 || !arguments[1].isObject() ||
                !arguments[1].getObject(runtime).isArray(runtime) ||
                !arguments[2].isNumber() || !arguments[3].isObject()) {
              throw JSError(
                  runtime,
                  "springUIWorkletInputs requires a handle, input array, "
                  "timestamp, and spring object.");
            }
            auto state = weakRuntimeState.lock();
            if (!state) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
                  runtime,
                  "The native UI worklet input vector is too large.");
            }
            std::vector<double> inputs;
            inputs.reserve(array.size(runtime));
            for (size_t index = 0; index < array.size(runtime); ++index) {
              auto value = array.getValueAtIndex(runtime, index);
              if (!value.isNumber() || !std::isfinite(value.getNumber())) {
                throw JSError(
                    runtime,
                    "Native UI worklet inputs must be finite numbers.");
              }
              inputs.push_back(value.getNumber());
            }
            try {
              auto worklet = state->springUIWorklet(
                  runtime,
                  handle,
                  std::move(inputs),
                  arguments[2].getNumber(),
                  arguments[3]);
              [binding scheduleUIWorkletFrame:worklet];
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
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 4 || !arguments[1].isObject() ||
                !arguments[1].getObject(runtime).isArray(runtime) ||
                !arguments[2].isNumber() || !arguments[3].isObject()) {
              throw JSError(
                  runtime,
                  "decayUIWorkletInputs requires a handle, velocity array, "
                  "timestamp, and decay object.");
            }
            auto state = weakRuntimeState.lock();
            if (!state) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
                  runtime,
                  "The native UI worklet velocity vector is too large.");
            }
            std::vector<double> velocities;
            velocities.reserve(array.size(runtime));
            for (size_t index = 0; index < array.size(runtime); ++index) {
              auto value = array.getValueAtIndex(runtime, index);
              if (!value.isNumber() || !std::isfinite(value.getNumber())) {
                throw JSError(
                    runtime,
                    "Native UI worklet velocities must be finite numbers.");
              }
              velocities.push_back(value.getNumber());
            }
            try {
              auto worklet = state->decayUIWorklet(
                  runtime,
                  handle,
                  std::move(velocities),
                  arguments[2].getNumber(),
                  arguments[3]);
              [binding scheduleUIWorkletFrame:worklet];
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
          [weakRuntimeState](Runtime &runtime,
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
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
          [binding, weakRuntimeState](Runtime &runtime,
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
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
              [binding attachUIWorkletPanGesture:worklet];
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
          [weakRuntimeState](Runtime &runtime,
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
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
          [weakRuntimeState](Runtime &runtime,
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
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
          [weakRuntimeState](Runtime &runtime,
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
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            const auto handle = requireSafeInteger(
                runtime,
                arguments[0],
                "The native UI worklet handle",
                true);
            try {
              auto worklet = runtimeState->requireUIWorklet(handle);
              std::lock_guard lock(worklet->mutex);
              Object info(runtime);
              info.setProperty(
                  runtime, "handle", static_cast<double>(worklet->handle));
              info.setProperty(
                  runtime, "target", static_cast<double>(worklet->targetNode));
              info.setProperty(
                  runtime, "sequence", static_cast<double>(worklet->sequence));
              info.setProperty(
                  runtime,
                  "appliedSequence",
                  static_cast<double>(worklet->appliedSequence));
              info.setProperty(runtime, "applied", worklet->applied);
              info.setProperty(
                  runtime,
                  "frameTimeNanoseconds",
                  static_cast<double>(worklet->frameTimeNanoseconds));
              if (worklet->hasTimestamp) {
                info.setProperty(runtime, "timestamp", worklet->timestamp);
              }
              info.setProperty(
                  runtime, "timingActive", worklet->timing.has_value());
              info.setProperty(
                  runtime, "timingProgress", worklet->timingProgress);
              if (!worklet->timingFrameStatistics.empty()) {
                info.setProperty(
                    runtime,
                    "timingFrameStatistics",
                    makeUIWorkletFrameStatistics(
                        runtime,
                        worklet->timingFrameStatistics.snapshot()));
              }
              if (worklet->springPosition.has_value() &&
                  worklet->springVelocity.has_value()) {
                info.setProperty(
                    runtime,
                    "springActive",
                    worklet->spring.has_value());
                info.setProperty(
                    runtime,
                    "springPosition",
                    *worklet->springPosition);
                info.setProperty(
                    runtime,
                    "springVelocity",
                    *worklet->springVelocity);
                if (!worklet->springFrameStatistics.empty()) {
                  info.setProperty(
                      runtime,
                      "springFrameStatistics",
                      makeUIWorkletFrameStatistics(
                          runtime,
                          worklet->springFrameStatistics.snapshot()));
                }
              }
              if (worklet->decayElapsedMilliseconds.has_value() &&
                  worklet->decaySpeed.has_value()) {
                info.setProperty(
                    runtime,
                    "decayActive",
                    worklet->decay.has_value());
                info.setProperty(
                    runtime,
                    "decayElapsedMilliseconds",
                    *worklet->decayElapsedMilliseconds);
                info.setProperty(
                    runtime,
                    "decaySpeed",
                    *worklet->decaySpeed);
                if (!worklet->decayFrameStatistics.empty()) {
                  info.setProperty(
                      runtime,
                      "decayFrameStatistics",
                      makeUIWorkletFrameStatistics(
                          runtime,
                          worklet->decayFrameStatistics.snapshot()));
                }
              }
              if (worklet->pan.has_value()) {
                const auto &pan = *worklet->pan;
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
              for (const auto &output : worklet->outputs) {
                outputs.setProperty(runtime, output.name.c_str(), output.value);
              }
              info.setProperty(runtime, "outputs", outputs);
              return info;
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
          [binding, weakRuntimeState](Runtime &runtime,
                                      const Value &,
                                      const Value *arguments,
                                      size_t count) -> Value {
            if (count != 2) {
              throw JSError(
                  runtime,
                  "reportFatalError requires exactly two arguments: name and message.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
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
            auto nativeName = [NSString stringWithUTF8String:name.c_str()];
            auto nativeMessage =
                [NSString stringWithUTF8String:message.c_str()];
            if (nativeName == nil || nativeMessage == nil ||
                ![binding reportFatalErrorWithName:nativeName
                                           message:nativeMessage]) {
              throw JSError(
                  runtime,
                  "The native shell did not accept the terminal error.");
            }
            return Value();
          }));
  host.setProperty(
      runtime,
      "destroySurface",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "destroySurface"),
          0,
          [binding, weakRuntimeState, routing](
              Runtime &runtime,
              const Value &,
              const Value *,
              size_t count) -> Value {
            if (count != 0) {
              throw JSError(
                  runtime, "destroySurface does not accept arguments.");
            }
            auto runtimeState = weakRuntimeState.lock();
            if (!runtimeState) {
              throw JSError(runtime, "The Solid Native runtime has stopped.");
            }
            if (runtimeState->activeUIWorkletCount() != 0) {
              throw JSError(
                  runtime,
                  "Cannot destroy a Fabric surface with active native UI "
                  "worklets.");
            }
            installEmptySurfaceStopHandler(runtime);
            NSError *error = nil;
            if (![binding destroySurface:&error]) {
              throw JSError(runtime, utf8(error.localizedDescription));
            }
            runtimeState->reclaimAllInstances(runtime, routing);
            runtimeState->reclaimAllResources(runtime);
            return Value();
          }));
  host.setProperty(
      runtime,
      "commit",
      Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "commit"),
          1,
          [binding, weakRuntimeState, routing](Runtime &runtime,
                    const Value &,
                    const Value *arguments,
                    size_t count) -> Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw JSError(
                  runtime, "commit requires exactly one transaction object.");
            }
            const auto commitStartedAt =
                [NSDate date].timeIntervalSince1970 * 1000.0;
            const auto commitStartedMonotonic = CACurrentMediaTime() * 1000.0;

            try {
              auto runtimeState = weakRuntimeState.lock();
              if (!runtimeState) {
                throw JSError(runtime, "The Solid Native runtime has stopped.");
              }
              size_t valueCount = 0;
              std::vector<Value> ancestors;
              auto dynamic = dynamicFromJSI(
                  runtime,
                  arguments[0],
                  "transaction",
                  0,
                  valueCount,
                  ancestors);
              id transaction = foundationFromDynamic(dynamic);
              if (![transaction isKindOfClass:NSDictionary.class]) {
                throw std::invalid_argument(
                    "The host transaction must be an object.");
              }
              auto transactionDictionary =
                  (NSDictionary<NSString *, id> *)transaction;
              id surfaceValue = transactionDictionary[@"surface"];
              const auto surface =
                  [surfaceValue isKindOfClass:NSNumber.class]
                  ? [(NSNumber *)surfaceValue longLongValue]
                  : 0;
              auto prepared = prepareNodeIdentities(
                  runtime,
                  transactionDictionary,
                  surface,
                  runtimeState);
              const auto deletedHandles =
                  deletedNodeHandles(transactionDictionary);
              IdentityRetention retention(runtime, runtimeState, prepared);
              const NativeResourceResolver resourceResolver =
                  [runtimeState](Runtime &runtime,
                                 int64_t handle,
                                 const std::string &kind) -> Value {
                return runtimeState->resolveResource(runtime, handle, kind);
              };
              auto layoutRouteStage = routing->stageLayoutRoutes(
                  transactionDictionary, prepared.identities);
              NSError *error = nil;
              auto result = [binding
                  applyTransaction:
                      transactionDictionary
                     nodeIdentities:&prepared.identities
                            runtime:&runtime
                   resourceResolver:&resourceResolver
                              error:&error];
              if (result == nil) {
                routing->rollbackLayoutRoutes(layoutRouteStage);
                throw JSError(runtime, utf8(error.localizedDescription));
              }
              retention.commit();
              runtimeState->cancelDeletedUIWorklets(deletedHandles);
              routing->publishCommit(
                  transactionDictionary,
                  prepared.identities,
                  [result[@"sequence"] longLongValue]);
              routing->finishLayoutRoutes(layoutRouteStage);
              id fabricRevisionValue = result[@"fabricRevision"];
              if ([fabricRevisionValue isKindOfClass:NSNumber.class]) {
                const auto fabricRevision =
                    [(NSNumber *)fabricRevisionValue longLongValue];
                runtimeState->retireInstances(
                    fabricRevision, deletedHandles);
                const auto notifyLifecycle =
                    runtimeState->hasCommitLifecycleHandler();
                if (notifyLifecycle || !deletedHandles.empty()) {
                  auto observation =
                      std::make_shared<const CommitMountObservation>(
                          CommitMountObservation{
                              .surface = surface,
                              .sequence =
                                  [result[@"sequence"] longLongValue],
                              .fabricRevision = fabricRevision,
                              .commitStartedAt = commitStartedAt,
                              .commitStartedMonotonic =
                                  commitStartedMonotonic,
                              .notifyLifecycle = notifyLifecycle,
                              .causalOperationId = commitCausalOperationId(
                                  transactionDictionary),
                          });
                  [binding scheduleMountObservation:std::move(observation)];
                }
              }
              return commitResultObject(runtime, result);
            } catch (const JSError &) {
              throw;
            } catch (const std::exception &error) {
              throw JSError(runtime, error.what());
            }
          }));

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
}

- (void)retireRuntimeGeneration:(uint64_t)generation {
  std::shared_ptr<EventRoutingState> routing;
  std::shared_ptr<facebook::react::EventListener> eventListener;
  SolidNativeFabricSurface *eventSurface = nil;
  SolidNativeFabricSurface *surface = nil;
  [_lock lock];
  if (generation != _runtimeGeneration) {
    [_lock unlock];
    return;
  }
  routing = _routing;
  eventListener = _eventListener;
  eventSurface = _eventSurface;
  surface = _surface;
  _eventSurface = nil;
  _eventListener.reset();
  _runtimeScheduler.reset();
  _runtimeState.reset();
  [_lock unlock];

  routing->active.store(false, std::memory_order_release);
  routing->handlerInstalled.store(false, std::memory_order_release);
  if (eventSurface != nil && eventListener) {
    [eventSurface removeSolidNativeEventListener:eventListener];
  }
  // Fabric InstanceHandles retain JSI WeakObjects. Release the logical tree
  // from the retiring NativeState destructor, before Hermes tears them down.
  if (surface != nil) [surface resetForJSRuntimeReload];
}

- (void)publishSurface:(SolidNativeFabricSurface *)surface {
  [_lock lock];
  auto previousEventSurface = _eventSurface;
  auto eventListener = _eventListener;
  _surface = surface;
  _eventSurface = eventListener ? surface : nil;
  _surfaceReady = NO;
  _invalidated = NO;
  _routing->active.store(true, std::memory_order_release);
  _routing->surface.store(surface.surfaceId, std::memory_order_release);
  [_lock unlock];
  if (previousEventSurface != nil && eventListener) {
    [previousEventSurface removeSolidNativeEventListener:eventListener];
  }
  if (eventListener) {
    [surface addSolidNativeEventListener:eventListener];
  }
}

- (void)markSurfaceReloading {
  [_lock lock];
  if (!_invalidated && _surface != nil) _surfaceReady = NO;
  [_lock unlock];
}

- (void)markSurfaceReady {
  [_lock lock];
  if (!_invalidated && _surface != nil) _surfaceReady = YES;
  [_lock unlock];
}

- (void)setFatalErrorHandler:(SolidNativeFabricFatalErrorHandler)handler {
  [_lock lock];
  _fatalErrorHandler = [handler copy];
  [_lock unlock];
}

- (BOOL)reportFatalErrorWithName:(NSString *)name
                         message:(NSString *)message {
  SolidNativeFabricFatalErrorHandler handler = nil;
  [_lock lock];
  if (!_invalidated) handler = [_fatalErrorHandler copy];
  [_lock unlock];
  if (handler == nil) return NO;
  dispatch_async(dispatch_get_main_queue(), ^{
    handler(name, message);
  });
  return YES;
}

- (NSDictionary<NSString *, id> *)surfaceSnapshot {
  [_lock lock];
  const BOOL ready = !_invalidated && _surfaceReady && _surface != nil;
  const NSInteger surface = ready ? _surface.surfaceId : 0;
  const int64_t sequence = ready ? _surface.lastSequence : 0;
  auto snapshot = @{
    @"ready" : @(ready),
    @"surface" : @(surface),
    @"sequence" : @(sequence)
  };
  [_lock unlock];
  return snapshot;
}

- (nullable NSDictionary<NSString *, id> *)
    applyTransaction:(NSDictionary<NSString *, id> *)transaction
       nodeIdentities:(const NodeIdentityMap *)nodeIdentities
              runtime:(facebook::jsi::Runtime *)runtime
     resourceResolver:(const NativeResourceResolver *)resourceResolver
                error:(NSError **)error {
  [_lock lock];
  if (_invalidated || !_surfaceReady || _surface == nil) {
    if (error != nullptr) {
      *error = [NSError
          errorWithDomain:@"SolidNativeFabricJSIBinding"
                     code:1
                 userInfo:@{
                   NSLocalizedDescriptionKey :
                       @"The Solid Native Fabric surface is not ready."
                 }];
    }
    [_lock unlock];
    return nil;
  }
  auto result = [_surface applyTransactionSynchronously:transaction
                                         nodeIdentities:nodeIdentities
                                                runtime:runtime
                                      resourceResolver:resourceResolver
                                                  error:error];
  [_lock unlock];
  return result;
}

- (nullable NSDictionary<NSString *, id> *)
    measureNode:(int64_t)node
    afterSequence:(int64_t)afterSequence
            error:(NSError **)error {
  [_lock lock];
  if (_invalidated || !_surfaceReady || _surface == nil) {
    if (error != nullptr) {
      *error = [NSError
          errorWithDomain:@"SolidNativeFabricJSIBinding"
                     code:1
                 userInfo:@{
                   NSLocalizedDescriptionKey :
                       @"The Solid Native Fabric surface is not ready."
                 }];
    }
    [_lock unlock];
    return nil;
  }
  auto result = [_surface measureNodeSynchronously:node
                                     afterSequence:afterSequence
                                             error:error];
  [_lock unlock];
  return result;
}

- (void)scheduleUIWorkletFrame:
    (std::shared_ptr<IOSUIWorkletState>)worklet {
  uint64_t frameGeneration;
  {
    std::lock_guard lock(worklet->mutex);
    if (!worklet->active || worklet->framePending) return;
    worklet->framePending = true;
    frameGeneration = ++worklet->frameGeneration;
  }

  __weak SolidNativeFabricJSIBinding *weakBinding = self;
  std::weak_ptr<IOSUIWorkletState> weakWorklet = worklet;
  dispatch_async(dispatch_get_main_queue(), ^{
    SolidNativeFabricJSIBinding *binding = weakBinding;
    if (binding == nil) {
      std::lock_guard lock(worklet->mutex);
      if (worklet->frameGeneration == frameGeneration) {
        worklet->framePending = false;
      }
      return;
    }
    auto observer = [[SolidNativeDisplayLinkObserver alloc]
        initWithCallback:^(CADisplayLink *displayLink) {
          auto frameWorklet = weakWorklet.lock();
          SolidNativeFabricJSIBinding *frameBinding = weakBinding;
          if (frameWorklet == nullptr || frameBinding == nil) {
            if (frameWorklet != nullptr) {
              std::lock_guard lock(frameWorklet->mutex);
              if (frameWorklet->frameGeneration == frameGeneration) {
                frameWorklet->framePending = false;
                frameWorklet->frameObserver = nil;
              }
            }
            return NO;
          }
          BOOL scheduleNextFrame = NO;
          {
            std::lock_guard lock(frameWorklet->mutex);
            if (frameWorklet->frameGeneration != frameGeneration) return NO;
            if (!frameWorklet->active) {
              frameWorklet->framePending = false;
              frameWorklet->frameObserver = nil;
              return NO;
            }
            try {
              auto nextInputs = frameWorklet->inputs;
              auto nextTimingProgress = frameWorklet->timingProgress;
              const auto recordsTimingFrame = frameWorklet->timing.has_value();
              const auto recordsSpringFrame = frameWorklet->spring.has_value();
              const auto recordsDecayFrame = frameWorklet->decay.has_value();
              const auto nextFrameTimeNanoseconds = static_cast<int64_t>(
                  std::llround(displayLink.timestamp * 1000000000.0));
              if (frameWorklet->timing.has_value()) {
                auto &timing = *frameWorklet->timing;
                if (!timing.startedAtNanoseconds.has_value()) {
                  timing.startedAtNanoseconds = nextFrameTimeNanoseconds;
                }
                const auto elapsedMilliseconds = static_cast<double>(
                    nextFrameTimeNanoseconds -
                    *timing.startedAtNanoseconds) /
                    1000000.0;
                const auto sample =
                    timing.definition.evaluate(timing.from, elapsedMilliseconds);
                nextTimingProgress = sample.progress;
                nextInputs = sample.inputs;
                if (sample.settled) frameWorklet->timing.reset();
              } else if (frameWorklet->spring.has_value()) {
                auto &spring = *frameWorklet->spring;
                if (!spring.startedAtNanoseconds.has_value()) {
                  spring.startedAtNanoseconds = nextFrameTimeNanoseconds;
                }
                const auto elapsedMilliseconds = static_cast<double>(
                    nextFrameTimeNanoseconds -
                    *spring.startedAtNanoseconds) /
                    1000000.0;
                const auto sample =
                    spring.definition.evaluate(elapsedMilliseconds);
                nextInputs =
                    solid_native::worklets::interpolateUIWorkletInputs(
                        spring.from, spring.to, sample.position);
                frameWorklet->springPosition = sample.position;
                frameWorklet->springVelocity = sample.velocity;
                if (sample.settled) frameWorklet->spring.reset();
              } else if (frameWorklet->decay.has_value()) {
                auto &decay = *frameWorklet->decay;
                if (!decay.startedAtNanoseconds.has_value()) {
                  decay.startedAtNanoseconds = nextFrameTimeNanoseconds;
                }
                const auto elapsedMilliseconds = static_cast<double>(
                    nextFrameTimeNanoseconds -
                    *decay.startedAtNanoseconds) /
                    1000000.0;
                const auto sample = decay.definition.evaluate(
                    decay.initialSpeed, elapsedMilliseconds);
                nextInputs = decay.from;
                for (size_t index = 0; index < nextInputs.size(); ++index) {
                  nextInputs.at(index) += decay.velocities.at(index) *
                      sample.displacementFactorSeconds;
                }
                frameWorklet->decayElapsedMilliseconds = elapsedMilliseconds;
                frameWorklet->decaySpeed = sample.speed;
                if (sample.settled) frameWorklet->decay.reset();
              }
              auto nextOutputs = frameWorklet->graph.evaluate(nextInputs);
              if (recordsTimingFrame) {
                frameWorklet->timingFrameStatistics.recordFrame(
                    nextFrameTimeNanoseconds);
              }
              if (recordsSpringFrame) {
                frameWorklet->springFrameStatistics.recordFrame(
                    nextFrameTimeNanoseconds);
              }
              if (recordsDecayFrame) {
                frameWorklet->decayFrameStatistics.recordFrame(
                    nextFrameTimeNanoseconds);
              }
              frameWorklet->inputs = std::move(nextInputs);
              frameWorklet->outputs = std::move(nextOutputs);
              frameWorklet->timingProgress = nextTimingProgress;
              frameWorklet->frameTimeNanoseconds = nextFrameTimeNanoseconds;
              std::array<double, IOSViewOutputCount> values;
              values.fill(std::numeric_limits<double>::quiet_NaN());
              for (size_t index = 0;
                   index < frameWorklet->outputs.size();
                   ++index) {
                values.at(
                    static_cast<size_t>(frameWorklet->channels.at(index))) =
                    frameWorklet->outputs.at(index).value;
              }
              frameWorklet->sequence++;
              frameWorklet->applied = [frameBinding
                  applyUIWorkletFrame:*frameWorklet
                                  values:values];
              if (frameWorklet->applied) {
                frameWorklet->appliedSequence = frameWorklet->sequence;
                frameWorklet->mountAttempts = 0;
                scheduleNextFrame =
                    frameWorklet->timing.has_value() ||
                    frameWorklet->spring.has_value() ||
                    frameWorklet->decay.has_value();
              } else {
                frameWorklet->mountAttempts++;
                scheduleNextFrame =
                    frameWorklet->mountAttempts <
                    MaximumUIWorkletMountAttempts;
              }
            } catch (...) {
              frameWorklet->applied = false;
              frameWorklet->timing.reset();
              frameWorklet->spring.reset();
              frameWorklet->decay.reset();
            }
            frameWorklet->framePending = scheduleNextFrame;
            if (!scheduleNextFrame) frameWorklet->frameObserver = nil;
          }
          return scheduleNextFrame;
        }];
    {
      std::lock_guard lock(worklet->mutex);
      if (!worklet->active || !worklet->framePending ||
          worklet->frameGeneration != frameGeneration) {
        return;
      }
      worklet->frameObserver = observer;
    }
    [observer start];
  });
}

- (void)attachUIWorkletPanGesture:
    (std::shared_ptr<IOSUIWorkletState>)worklet {
  __block std::string error;
  __weak SolidNativeFabricJSIBinding *weakBinding = self;
  void (^attach)(void) = ^{
    SolidNativeFabricJSIBinding *binding = weakBinding;
    if (binding == nil) {
      error = "The iOS native UI worklet binding has stopped.";
      return;
    }
    [binding->_lock lock];
    auto surface = (!binding->_invalidated && binding->_surfaceReady)
        ? binding->_surface
        : nil;
    [binding->_lock unlock];
    if (surface == nil) {
      error = "The iOS native UI worklet surface is unavailable.";
      return;
    }
    auto view = [surface findComponentViewWithTag:worklet->targetTag];
    if (view == nil || view.window == nil) {
      error = "The iOS native UI worklet pan target is not mounted.";
      return;
    }

    std::weak_ptr<IOSUIWorkletState> weakWorklet = worklet;
    auto observer = [[SolidNativePanGestureObserver alloc]
        initWithView:view
            callback:^(NSInteger phaseValue, CGFloat translationX,
                       CGFloat translationY, NSTimeInterval timestamp,
                       CGFloat velocityX, CGFloat velocityY) {
              auto state = weakWorklet.lock();
              SolidNativeFabricJSIBinding *strongBinding = weakBinding;
              if (!state || strongBinding == nil)
                return;
              BOOL scheduleReleaseDecay = NO;
              {
                std::lock_guard lock(state->mutex);
                if (!state->active || !state->pan.has_value())
                  return;
                auto &pan = *state->pan;
                try {
                  if (phaseValue < 0 || phaseValue > 3 ||
                      !std::isfinite(static_cast<double>(translationX)) ||
                      !std::isfinite(static_cast<double>(translationY)) ||
                      !std::isfinite(static_cast<double>(velocityX)) ||
                      !std::isfinite(static_cast<double>(velocityY)) ||
                      !std::isfinite(timestamp) || timestamp < 0 ||
                      (pan.timestamp.has_value() &&
                       timestamp < *pan.timestamp)) {
                    throw std::invalid_argument(
                        "The iOS native UI worklet pan sample is invalid.");
                  }
                  const auto phase = static_cast<
                      solid_native::worklets::UIWorkletPanGesturePhase>(
                      phaseValue);
                  if (phase ==
                      solid_native::worklets::UIWorkletPanGesturePhase::Begin) {
                    if (pan.active) {
                      throw std::invalid_argument(
                          "The iOS native UI worklet pan is already active.");
                    }
                    pan.active = true;
                    pan.originX = state->inputs.at(pan.definition.xInput);
                    pan.originY = state->inputs.at(pan.definition.yInput);
                    pan.timestamp = timestamp;
                    state->timing.reset();
                    state->timingProgress = 0;
                    state->spring.reset();
                    if (state->springPosition.has_value()) {
                      state->springPosition = 0;
                    }
                    if (state->springVelocity.has_value()) {
                      state->springVelocity = 0;
                    }
                    state->decay.reset();
                    if (state->decayElapsedMilliseconds.has_value()) {
                      state->decayElapsedMilliseconds = 0;
                    }
                    if (state->decaySpeed.has_value())
                      state->decaySpeed = 0;
                    return;
                  }
                  if (!pan.active) {
                    throw std::invalid_argument(
                        "The iOS native UI worklet pan is not active.");
                  }
                  if (phase == solid_native::worklets::
                                   UIWorkletPanGesturePhase::Cancel) {
                    pan.active = false;
                    pan.timestamp = timestamp;
                    return;
                  }
                  auto nextInputs = pan.definition.evaluateInputs(
                      state->inputs, pan.originX, pan.originY,
                      static_cast<double>(translationX),
                      static_cast<double>(translationY));
                  auto nextOutputs = state->graph.evaluate(nextInputs);
                  std::optional<IOSUIWorkletDecayState> releaseDecay;
                  double releaseSpeed = 0;
                  if (phase == solid_native::worklets::
                                   UIWorkletPanGesturePhase::End &&
                      pan.definition.releaseDecay.has_value()) {
                    const auto xVelocity = static_cast<double>(velocityX);
                    const auto yVelocity = static_cast<double>(velocityY);
                    if (std::abs(xVelocity) >
                            solid_native::worklets::
                                MaximumUIWorkletDecayVelocity ||
                        std::abs(yVelocity) >
                            solid_native::worklets::
                                MaximumUIWorkletDecayVelocity) {
                      throw std::invalid_argument(
                          "The iOS native UI worklet pan velocity is outside "
                          "its bounded range.");
                    }
                    std::vector<double> velocities(state->inputs.size(), 0);
                    velocities.at(pan.definition.xInput) = xVelocity;
                    velocities.at(pan.definition.yInput) = yVelocity;
                    releaseSpeed =
                        std::max(std::abs(xVelocity), std::abs(yVelocity));
                    const auto &definition = *pan.definition.releaseDecay;
                    const auto terminal = definition.evaluate(
                        releaseSpeed, definition.maximumDurationMilliseconds);
                    auto terminalInputs = nextInputs;
                    for (size_t index = 0; index < terminalInputs.size();
                         ++index) {
                      terminalInputs.at(index) +=
                          velocities.at(index) *
                          terminal.displacementFactorSeconds;
                    }
                    // Reject a terminal graph failure before publishing the
                    // pan.
                    state->graph.evaluate(terminalInputs);
                    releaseDecay = IOSUIWorkletDecayState{
                        .from = nextInputs,
                        .velocities = std::move(velocities),
                        .initialSpeed = releaseSpeed,
                        .definition = definition,
                    };
                  }
                  std::array<double, IOSViewOutputCount> values;
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
                  if (state->springPosition.has_value()) {
                    state->springPosition = 0;
                  }
                  if (state->springVelocity.has_value()) {
                    state->springVelocity = 0;
                  }
                  state->decay = std::move(releaseDecay);
                  if (state->decay.has_value()) {
                    state->decayElapsedMilliseconds = 0;
                    state->decaySpeed = releaseSpeed;
                    state->decayFrameStatistics.reset();
                    scheduleReleaseDecay = YES;
                  } else {
                    if (state->decayElapsedMilliseconds.has_value()) {
                      state->decayElapsedMilliseconds = 0;
                    }
                    if (state->decaySpeed.has_value())
                      state->decaySpeed = 0;
                  }
                  state->sequence++;
                  state->frameTimeNanoseconds =
                      static_cast<int64_t>(std::llround(timestamp * 1000000.0));
                  state->applied = [strongBinding applyUIWorkletFrame:*state
                                                               values:values];
                  if (state->applied) {
                    state->appliedSequence = state->sequence;
                  }
                  pan.sequence++;
                  pan.timestamp = timestamp;
                  if (phase ==
                      solid_native::worklets::UIWorkletPanGesturePhase::End) {
                    pan.active = false;
                  }
                } catch (...) {
                  pan.active = false;
                  state->timing.reset();
                  state->timingProgress = 0;
                  state->spring.reset();
                  if (state->springPosition.has_value()) {
                    state->springPosition = 0;
                  }
                  if (state->springVelocity.has_value()) {
                    state->springVelocity = 0;
                  }
                  state->decay.reset();
                  if (state->decayElapsedMilliseconds.has_value()) {
                    state->decayElapsedMilliseconds = 0;
                  }
                  if (state->decaySpeed.has_value())
                    state->decaySpeed = 0;
                  state->applied = false;
                }
              }
              if (scheduleReleaseDecay) {
                [strongBinding scheduleUIWorkletFrame:state];
              }
            }];
    {
      std::lock_guard lock(worklet->mutex);
      if (!worklet->active || !worklet->pan.has_value() ||
          worklet->panObserver != nil) {
        [observer invalidate];
        error = "The iOS native UI worklet pan attachment was cancelled.";
        return;
      }
      worklet->panObserver = observer;
    }
  };
  if (NSThread.isMainThread) {
    attach();
  } else {
    dispatch_sync(dispatch_get_main_queue(), attach);
  }
  if (!error.empty()) throw std::runtime_error(error);
}

- (BOOL)applyUIWorkletFrame:(const IOSUIWorkletState &)worklet
                     values:
                         (const std::array<double, IOSViewOutputCount> &)values {
  NSAssert(
      NSThread.isMainThread,
      @"Native UI worklet frames must run on the main thread.");
  for (const auto value : values) {
    if (!std::isnan(value) && !std::isfinite(value)) return NO;
  }
  const auto opacity = values.at(static_cast<size_t>(IOSViewOutput::Opacity));
  if (!std::isnan(opacity) && (opacity < 0 || opacity > 1)) return NO;

  [_lock lock];
  auto surface = (!_invalidated && _surfaceReady) ? _surface : nil;
  [_lock unlock];
  if (surface == nil) return NO;
  auto view = [surface findComponentViewWithTag:worklet.targetTag];
  if (view == nil || view.window == nil) return NO;

  if (!std::isnan(opacity)) view.alpha = static_cast<CGFloat>(opacity);
  const auto translateX =
      values.at(static_cast<size_t>(IOSViewOutput::TranslateX));
  const auto translateY =
      values.at(static_cast<size_t>(IOSViewOutput::TranslateY));
  const auto scaleX = values.at(static_cast<size_t>(IOSViewOutput::ScaleX));
  const auto scaleY = values.at(static_cast<size_t>(IOSViewOutput::ScaleY));
  const auto rotation =
      values.at(static_cast<size_t>(IOSViewOutput::Rotation));
  const bool ownsTransform = !std::isnan(translateX) ||
      !std::isnan(translateY) || !std::isnan(scaleX) ||
      !std::isnan(scaleY) || !std::isnan(rotation);
  if (ownsTransform) {
    auto transform = CGAffineTransformIdentity;
    transform = CGAffineTransformTranslate(
        transform,
        static_cast<CGFloat>(std::isnan(translateX) ? 0 : translateX),
        static_cast<CGFloat>(std::isnan(translateY) ? 0 : translateY));
    transform = CGAffineTransformScale(
        transform,
        static_cast<CGFloat>(std::isnan(scaleX) ? 1 : scaleX),
        static_cast<CGFloat>(std::isnan(scaleY) ? 1 : scaleY));
    transform = CGAffineTransformRotate(
        transform,
        static_cast<CGFloat>(
            (std::isnan(rotation) ? 0 : rotation) * M_PI / 180.0));
    view.transform = transform;
    if (!CGAffineTransformEqualToTransform(view.transform, transform)) {
      return NO;
    }
  }
  if (!std::isnan(opacity) &&
      std::abs(static_cast<double>(view.alpha) - opacity) > 0.000001) {
    return NO;
  }
  return YES;
}

- (void)scheduleMountObservation:
    (std::shared_ptr<const CommitMountObservation>)observation {
  [_lock lock];
  if (_invalidated || _surface == nil || !_runtimeScheduler) {
    [_lock unlock];
    return;
  }
  auto surface = _surface;
  auto runtimeScheduler = _runtimeScheduler;
  auto runtimeState = _runtimeState;
  auto routing = _routing;
  [_lock unlock];

  __weak SolidNativeFabricJSIBinding *weakBinding = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    [weakBinding pollMountObservation:observation
                              surface:surface
                     runtimeScheduler:runtimeScheduler
                         runtimeState:runtimeState
                              routing:routing
                              attempt:0];
  });
}

- (void)pollMountObservation:
            (std::shared_ptr<const CommitMountObservation>)observation
                       surface:(SolidNativeFabricSurface *)surface
              runtimeScheduler:
                  (std::shared_ptr<facebook::react::RuntimeScheduler>)
                      runtimeScheduler
                  runtimeState:(std::weak_ptr<RuntimeState>)runtimeState
                       routing:(std::shared_ptr<EventRoutingState>)routing
                       attempt:(NSUInteger)attempt {
  [_lock lock];
  const BOOL active = !_invalidated && _surface == surface;
  [_lock unlock];
  if (!active) return;

  const auto mountedFabricRevision = [surface mountedFabricRevision];
  if (mountedFabricRevision >= observation->fabricRevision) {
    const auto mountedAt = [NSDate date].timeIntervalSince1970 * 1000.0;
    const auto mountedMonotonic = CACurrentMediaTime() * 1000.0;
    const auto mountLatency = std::max(
        0.0,
        mountedMonotonic - observation->commitStartedMonotonic);
    runtimeScheduler->scheduleWork(
        [runtimeState,
         routing,
         observation,
         mountedFabricRevision,
         mountedAt,
         mountLatency](Runtime &runtime) {
          auto state = runtimeState.lock();
          if (!state) return;
          state->reclaimMountedInstances(
              runtime, mountedFabricRevision, routing);
          if (!observation->notifyLifecycle ||
              !routing->active.load(std::memory_order_acquire) ||
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
          auto handler = handlerObject.getFunction(runtime);
          handler.call(runtime, event);
        });
    if (observation->notifyLifecycle) {
      auto frameObserver = [[SolidNativeDisplayLinkObserver alloc]
          initWithCallback:^(CADisplayLink *) {
            const auto frameStartedAt =
                [NSDate date].timeIntervalSince1970 * 1000.0;
            const auto frameStartedMonotonic =
                CACurrentMediaTime() * 1000.0;
            const auto frameLatency = std::max(
                0.0,
                frameStartedMonotonic -
                    observation->commitStartedMonotonic);
            const auto mountToFrameLatency = std::max(
                0.0, frameStartedMonotonic - mountedMonotonic);
            runtimeScheduler->scheduleWork(
                [runtimeState,
                 routing,
                 observation,
                 mountedAt,
                 frameStartedAt,
                 frameLatency,
                 mountToFrameLatency](Runtime &runtime) {
                  auto state = runtimeState.lock();
                  if (!state ||
                      !routing->active.load(std::memory_order_acquire) ||
                      !state->hasCommitLifecycleHandler()) {
                    return;
                  }
                  auto handlerValue =
                      state->commitLifecycleHandler(runtime);
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
                  event.setProperty(
                      runtime, "frameStartedAt", frameStartedAt);
                  event.setProperty(
                      runtime, "frameLatency", frameLatency);
                  event.setProperty(
                      runtime,
                      "mountToFrameLatency",
                      mountToFrameLatency);
                  if (observation->causalOperationId.has_value()) {
                    Object causalContext(runtime);
                    causalContext.setProperty(
                        runtime,
                        "operationId",
                        String::createFromUtf8(
                            runtime,
                            *observation->causalOperationId));
                    event.setProperty(
                        runtime,
                        "causalContext",
                        std::move(causalContext));
                  }
                  handlerObject.getFunction(runtime).call(runtime, event);
                });
            return NO;
          }];
      [frameObserver start];
    }
    return;
  }

  if (attempt + 1 >= MaximumMountObservationAttempts) {
    NSLog(
        @"Solid Native timed out waiting for Fabric revision %lld on surface "
         "%lld.",
        static_cast<long long>(observation->fabricRevision),
        static_cast<long long>(observation->surface));
    runtimeScheduler->scheduleWork(
        [runtimeState, routing, mountedFabricRevision](Runtime &runtime) {
          auto state = runtimeState.lock();
          if (!state) return;
          state->reclaimMountedInstances(
              runtime, mountedFabricRevision, routing);
        });
    return;
  }

  __weak SolidNativeFabricJSIBinding *weakBinding = self;
  dispatch_after(
      dispatch_time(
          DISPATCH_TIME_NOW, MountObservationRetryNanoseconds),
      dispatch_get_main_queue(),
      ^{
        [weakBinding pollMountObservation:observation
                                  surface:surface
                         runtimeScheduler:runtimeScheduler
                             runtimeState:runtimeState
                                  routing:routing
                                  attempt:attempt + 1];
      });
}

- (BOOL)destroySurface:(NSError **)error {
  [_lock lock];
  if (_invalidated || !_surfaceReady || _surface == nil) {
    if (error != nullptr) {
      *error = [NSError
          errorWithDomain:@"SolidNativeFabricJSIBinding"
                     code:1
                 userInfo:@{
                   NSLocalizedDescriptionKey :
                       @"The Solid Native Fabric surface is not ready."
                 }];
    }
    [_lock unlock];
    return NO;
  }
  if (![_surface hasNoLogicalNodes]) {
    if (error != nullptr) {
      *error = [NSError
          errorWithDomain:@"SolidNativeFabricJSIBinding"
                     code:2
                 userInfo:@{
                   NSLocalizedDescriptionKey :
                       @"Cannot destroy a Fabric surface with live nodes."
                 }];
    }
    [_lock unlock];
    return NO;
  }

  auto surface = _surface;
  auto eventSurface = _eventSurface;
  auto eventListener = _eventListener;
  _invalidated = YES;
  _surfaceReady = NO;
  _surface = nil;
  _eventSurface = nil;
  _routing->active.store(false, std::memory_order_release);
  _routing->handlerInstalled.store(false, std::memory_order_release);
  _runtimeState.reset();
  _runtimeScheduler.reset();
  _eventListener.reset();
  [_lock unlock];

  if (eventSurface != nil && eventListener) {
    [eventSurface removeSolidNativeEventListener:eventListener];
  }
  [surface stop];
  return YES;
}

- (void)invalidate {
  [_lock lock];
  auto eventSurface = _eventSurface;
  auto eventListener = _eventListener;
  auto runtimeState = _runtimeState.lock();
  _invalidated = YES;
  _surfaceReady = NO;
  _surface = nil;
  _eventSurface = nil;
  _routing->active.store(false, std::memory_order_release);
  _routing->handlerInstalled.store(false, std::memory_order_release);
  _runtimeState.reset();
  _runtimeScheduler.reset();
  _eventListener.reset();
  [_lock unlock];
  if (runtimeState) runtimeState->cancelAllUIWorklets();
  if (eventSurface != nil && eventListener) {
    [eventSurface removeSolidNativeEventListener:eventListener];
  }
}

@end
