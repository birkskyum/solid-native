#import "SolidNativeFabricSurface.h"

#import <React/RCTConstants.h>
#import <React/RCTFabricSurface.h>
#import <React/RCTScheduler.h>
#import <React/RCTSurfacePresenter.h>
#import <React/RCTSurfaceView.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTHost.h>

#include <exception>
#include <memory>
#include <stdexcept>

#include <react/renderer/scheduler/SurfaceHandler.h>
#include <react/renderer/mounting/MountingCoordinator.h>

#include "SolidNativeFabricTransactionCoordinator.h"

using solid_native::fabric::react_native::NativeResourceResolver;

namespace {

constexpr NSInteger MaxSurfaceStartAttempts = 2000;
constexpr int64_t SurfaceStartRetryNanoseconds = 5 * NSEC_PER_MSEC;

NSError *makeError(NSString *message) {
  return [NSError errorWithDomain:@"SolidNativeFabricSurface"
                             code:1
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

void finishOnMainQueue(
    SolidNativeFabricTransactionCompletion completion,
    NSDictionary<NSString *, id> *result,
    NSError *error) {
  dispatch_async(dispatch_get_main_queue(), ^{
    completion(result, error);
  });
}

BOOL isCommandTransaction(NSDictionary<NSString *, id> *transaction) {
  id mutationsValue = transaction[@"mutations"];
  if (![mutationsValue isKindOfClass:NSArray.class] ||
      [(NSArray *)mutationsValue count] != 1) {
    return NO;
  }
  id mutationValue = [(NSArray *)mutationsValue firstObject];
  return [mutationValue isKindOfClass:NSDictionary.class] &&
      [((NSDictionary *)mutationValue)[@"type"] isEqual:@"command"];
}

} // namespace

@interface SolidNativeFabricSurface ()
- (void)synchronizeSurfaceView;
- (void)updateLayoutConstraintsForView:(UIView *)view;
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

// RCTFabricSurface does not observe the frame of an arbitrary embedding view.
// Keep the package-owned view as the UIKit lifecycle boundary and forward each
// size or window-position change into Fabric's root layout constraints.
@interface SolidNativeFabricContainerView : UIView
@property(nonatomic, weak) SolidNativeFabricSurface *surface;
@end

@implementation SolidNativeFabricContainerView

- (void)layoutSubviews {
  [super layoutSubviews];
  [self.surface updateLayoutConstraintsForView:self];
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  [self.surface updateLayoutConstraintsForView:self];
}

- (void)traitCollectionDidChange:(UITraitCollection *)previousTraitCollection {
  [super traitCollectionDidChange:previousTraitCollection];
  if (RCTSharedApplication().applicationState == UIApplicationStateBackground) {
    return;
  }
  [[NSNotificationCenter defaultCenter]
      postNotificationName:RCTUserInterfaceStyleDidChangeNotification
                    object:self
                  userInfo:@{
                    RCTUserInterfaceStyleDidChangeNotificationTraitCollectionKey :
                        self.traitCollection,
                  }];
}

@end

@implementation SolidNativeFabricSurface {
  RCTHost *_host;
  RCTFabricSurface *_surface;
  UIView *_view;
  UIView *_surfaceView;
  CGSize _lastLayoutSize;
  CGPoint _lastViewportOffset;
  BOOL _hasLayoutConstraints;
  std::unique_ptr<solid_native::fabric::react_native::TransactionCoordinator>
      _coordinator;
}

- (instancetype)initWithHost:(RCTHost *)host size:(CGSize)size {
  if (self = [super init]) {
    NSAssert(
        NSThread.isMainThread,
        @"The Fabric surface must be created on the main thread.");
    _host = host;
    // RCTHost's convenience factory queues a second `start` after bundle
    // evaluation. Solid Native must start its empty surface before bundle
    // completion, and RCTFabricSurface 0.87 only guards the status before its
    // asynchronous start block. Two queued starts can therefore race inside
    // animation-driver setup. Constructing through the public surface API
    // leaves exactly one start owner while retaining presenter registration.
    _surface = [[RCTFabricSurface alloc]
        initWithSurfacePresenter:host.surfacePresenter
                      moduleName:@""
               initialProperties:@{}];
    [_surface setMinimumSize:size
                 maximumSize:size
              viewportOffset:CGPointZero];
    _lastLayoutSize = size;
    _lastViewportOffset = CGPointZero;
    _hasLayoutConstraints = YES;
    auto containerView = [[SolidNativeFabricContainerView alloc]
        initWithFrame:CGRectMake(0, 0, size.width, size.height)];
    containerView.surface = self;
    _view = containerView;
    _view.autoresizingMask =
        UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self synchronizeSurfaceView];
    _coordinator = std::make_unique<
        solid_native::fabric::react_native::TransactionCoordinator>(
        _surface.surfaceHandler.getSurfaceId());
  }
  return self;
}

- (UIView *)view {
  return _view;
}

- (void)updateLayoutConstraintsForView:(UIView *)view {
  NSAssert(
      NSThread.isMainThread,
      @"Fabric surface layout constraints must update on the main thread.");
  if (_surface == nil || view != _view) return;

  const auto size = view.bounds.size;
  if (!std::isfinite(size.width) || !std::isfinite(size.height) ||
      size.width <= 0 || size.height <= 0) {
    return;
  }
  const auto viewportOffset = view.window == nil
      ? CGPointZero
      : [view convertRect:view.bounds toView:view.window].origin;
  if (_hasLayoutConstraints &&
      CGSizeEqualToSize(_lastLayoutSize, size) &&
      CGPointEqualToPoint(_lastViewportOffset, viewportOffset)) {
    return;
  }

  [_surface setMinimumSize:size
               maximumSize:size
            viewportOffset:viewportOffset];
  _lastLayoutSize = size;
  _lastViewportOffset = viewportOffset;
  _hasLayoutConstraints = YES;
}

- (void)synchronizeSurfaceView {
  NSAssert(
      NSThread.isMainThread,
      @"The Fabric surface view must be synchronized on the main thread.");
  auto surfaceView = _surface.view;
  if (_surfaceView == surfaceView) return;
  [_surfaceView removeFromSuperview];
  _surfaceView = surfaceView;
  _surfaceView.frame = _view.bounds;
  _surfaceView.autoresizingMask =
      UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  [_view addSubview:_surfaceView];
}

- (NSInteger)surfaceId {
  return _surface.surfaceHandler.getSurfaceId();
}

- (int64_t)lastSequence {
  return _coordinator ? _coordinator->lastSequence() : 0;
}

- (BOOL)hasNoLogicalNodes {
  return !_coordinator || _coordinator->empty();
}

- (int64_t)mountedFabricRevision {
  if (_surface == nil) return 0;
  auto mountingCoordinator =
      _surface.surfaceHandler.getMountingCoordinator();
  return mountingCoordinator == nullptr
      ? 0
      : mountingCoordinator->getBaseRevision().number;
}

- (nullable UIView *)findComponentViewWithTag:(facebook::react::Tag)tag {
  NSAssert(
      NSThread.isMainThread,
      @"Fabric component views must be resolved on the main thread.");
  return [_host.surfacePresenter
      findComponentViewWithTag_DO_NOT_USE_DEPRECATED:tag];
}

- (void)addSolidNativeEventListener:
    (const std::shared_ptr<facebook::react::EventListener> &)listener {
  [_host.surfacePresenter.scheduler addEventListener:listener];
}

- (void)removeSolidNativeEventListener:
    (const std::shared_ptr<facebook::react::EventListener> &)listener {
  [_host.surfacePresenter.scheduler removeEventListener:listener];
}

- (NSDictionary<NSString *, id> *)
    applyTransactionSynchronously:(NSDictionary<NSString *, id> *)transaction
                            error:(NSError **)error {
  return [self applyTransactionSynchronously:transaction
                              nodeIdentities:nullptr
                                     runtime:nullptr
                           resourceResolver:nullptr
                                       error:error];
}

- (NSDictionary<NSString *, id> *)
    applyTransactionSynchronously:(NSDictionary<NSString *, id> *)transaction
                    nodeIdentities:
                        (const solid_native::fabric::react_native::NodeIdentityMap *)
                            nodeIdentities
                          runtime:(facebook::jsi::Runtime *)runtime
                 resourceResolver:
                     (const NativeResourceResolver *)resourceResolver
                             error:(NSError **)error {
  if (_surface.surfaceHandler.getStatus() !=
      facebook::react::SurfaceHandler::Status::Running) {
    if (error != nullptr) {
      *error = makeError(@"The Fabric surface is not running.");
    }
    return nil;
  }

  @try {
    try {
      auto scheduler = _host.surfacePresenter.scheduler;
      auto uiManager = scheduler.uiManager;
      if (!uiManager) {
        throw std::runtime_error(
            "React Native did not expose a Fabric UIManager.");
      }
      if (nodeIdentities != nullptr &&
          (runtime == nullptr || resourceResolver == nullptr)) {
        throw std::invalid_argument(
            "Application transactions require their owning JSI runtime and "
            "resource resolver.");
      }
      const auto sequence = nodeIdentities == nullptr
          ? _coordinator->apply(*uiManager, transaction)
          : _coordinator->apply(
                *uiManager,
                transaction,
                *runtime,
                *nodeIdentities,
                *resourceResolver);
      NSMutableDictionary<NSString *, id> *result = [@{
        @"surface" : @(self.surfaceId),
        @"sequence" : @(sequence),
        @"mounted" : @YES
      } mutableCopy];
      if (!isCommandTransaction(transaction)) {
        result[@"fabricRevision"] = @(_coordinator->lastFabricRevision());
      }
      return result;
    } catch (const std::exception &exception) {
      if (error != nullptr) {
        *error = makeError([NSString stringWithUTF8String:exception.what()]);
      }
      return nil;
    }
  } @catch (NSException *exception) {
    if (error != nullptr) *error = makeError(exception.reason);
    return nil;
  }
}

- (NSDictionary<NSString *, id> *)
    measureNodeSynchronously:(int64_t)node
               afterSequence:(int64_t)afterSequence
                       error:(NSError **)error {
  if (_surface.surfaceHandler.getStatus() !=
      facebook::react::SurfaceHandler::Status::Running) {
    if (error != nullptr) {
      *error = makeError(@"The Fabric surface is not running.");
    }
    return nil;
  }

  @try {
    try {
      auto uiManager = _host.surfacePresenter.scheduler.uiManager;
      if (!uiManager) {
        throw std::runtime_error(
            "React Native did not expose a Fabric UIManager.");
      }
      const auto measurement =
          _coordinator->measure(*uiManager, node, afterSequence);
      return @{
        @"x" : @(measurement.x),
        @"y" : @(measurement.y),
        @"width" : @(measurement.width),
        @"height" : @(measurement.height),
        @"pageX" : @(measurement.pageX),
        @"pageY" : @(measurement.pageY),
        @"observedSequence" : @(measurement.observedSequence)
      };
    } catch (const std::exception &exception) {
      if (error != nullptr) {
        *error = makeError([NSString stringWithUTF8String:exception.what()]);
      }
      return nil;
    }
  } @catch (NSException *exception) {
    if (error != nullptr) *error = makeError(exception.reason);
    return nil;
  }
}

- (void)applyTransaction:(NSDictionary<NSString *, id> *)transaction
               completion:(SolidNativeFabricTransactionCompletion)completion {
  NSDictionary<NSString *, id> *snapshot = [transaction copy];
  [self waitForRunningSurfaceWithAttempt:0
                             transaction:snapshot
                              completion:completion];
}

- (void)mountText:(NSString *)text
        completion:(SolidNativeFabricCompletion)completion {
  NSDictionary<NSString *, id> *transaction = @{
    @"contractVersion" : @1,
    @"surface" : @(self.surfaceId),
    @"sequence" : @1,
    @"priority" : @"normal",
    @"mutations" : @[
      @{
        @"type" : @"create-element",
        @"node" : @1,
        @"component" : @"RootView",
        @"props" : @{ @"style" : @{ @"flex" : @1 } }
      },
      @{
        @"type" : @"create-element",
        @"node" : @2,
        @"component" : @"Text",
        @"props" : @{}
      },
      @{ @"type" : @"create-text", @"node" : @3, @"text" : text },
      @{ @"type" : @"insert-child", @"parent" : @2, @"child" : @3 },
      @{ @"type" : @"insert-child", @"parent" : @1, @"child" : @2 }
    ]
  };
  [self applyTransaction:transaction
              completion:^(NSDictionary<NSString *, id> *result,
                           NSError *error) {
                completion(error);
              }];
}

- (void)updateText:(NSString *)text
         completion:(SolidNativeFabricCompletion)completion {
  NSDictionary<NSString *, id> *transaction = @{
    @"contractVersion" : @1,
    @"surface" : @(self.surfaceId),
    @"sequence" : @2,
    @"priority" : @"normal",
    @"mutations" : @[
      @{ @"type" : @"update-text", @"node" : @3, @"text" : text }
    ]
  };
  [self applyTransaction:transaction
              completion:^(NSDictionary<NSString *, id> *result,
                           NSError *error) {
                completion(error);
              }];
}

- (void)prepareEmptySurfaceForJSIOwnershipWithCompletion:
    (SolidNativeFabricCompletion)completion {
  // RCTHost buffers ordinary application-surface startup until the JavaScript
  // bundle has executed because a named surface calls AppRegistry. Solid
  // Native deliberately owns an empty surface, whose start path never enters
  // AppRegistry. Start it here so JavaScript bundle loading and native surface
  // readiness cannot wait on one another. RCTHost's later buffered start is
  // idempotent because RCTFabricSurface ignores an already-running surface.
  // A reload also clears RCTFabricSurface's cached RCTSurfaceView. Keep the
  // package-owned outer view stable while replacing that internal child before
  // Fabric attaches the restarted surface.
  [self synchronizeSurfaceView];
  [_surface start];
  NSDictionary<NSString *, id> *transaction = @{
    @"contractVersion" : @1,
    @"surface" : @(self.surfaceId),
    @"sequence" : @1,
    @"priority" : @"normal",
    @"mutations" : @[]
  };
  __weak SolidNativeFabricSurface *weakSelf = self;
  [self applyTransaction:transaction
              completion:^(NSDictionary<NSString *, id> *result,
                           NSError *error) {
                SolidNativeFabricSurface *strongSelf = weakSelf;
                if (error == nil && strongSelf != nil &&
                    strongSelf->_coordinator) {
                  strongSelf->_coordinator->reset();
                }
                completion(error);
              }];
}

- (void)resetForJSRuntimeReload {
  if (_coordinator) _coordinator->reset();
}

- (void)rebindToCurrentHostAfterJSRuntimeReload {
  NSAssert(
      NSThread.isMainThread,
      @"The Fabric surface must rebind on the main thread.");
  [_surface resetWithSurfacePresenter:_host.surfacePresenter];
  [self synchronizeSurfaceView];
}

- (void)prepareForJSIOwnershipWithCompletion:
    (SolidNativeFabricCompletion)completion {
  NSDictionary<NSString *, id> *transaction = @{
    @"contractVersion" : @1,
    @"surface" : @(self.surfaceId),
    @"sequence" : @2,
    @"priority" : @"normal",
    @"mutations" : @[
      @{ @"type" : @"remove-child", @"parent" : @2, @"child" : @3 },
      @{ @"type" : @"remove-child", @"parent" : @1, @"child" : @2 },
      @{ @"type" : @"delete-node", @"node" : @3 },
      @{ @"type" : @"delete-node", @"node" : @2 },
      @{ @"type" : @"delete-node", @"node" : @1 }
    ]
  };
  __weak SolidNativeFabricSurface *weakSelf = self;
  [self applyTransaction:transaction
              completion:^(NSDictionary<NSString *, id> *result,
                           NSError *error) {
                SolidNativeFabricSurface *strongSelf = weakSelf;
                if (error == nil && strongSelf != nil &&
                    strongSelf->_coordinator) {
                  strongSelf->_coordinator->reset();
                }
                completion(error);
              }];
}

- (void)stop {
  if (_coordinator) {
    _coordinator->reset();
  }
  if (_surface != nil &&
      _surface.surfaceHandler.getStatus() ==
          facebook::react::SurfaceHandler::Status::Running) {
    [_surface stop];
  }
}

- (void)dealloc {
  [self stop];
}

- (void)waitForRunningSurfaceWithAttempt:(NSInteger)attempt
                              transaction:
                                  (NSDictionary<NSString *, id> *)transaction
                               completion:
                                   (SolidNativeFabricTransactionCompletion)
                                       completion {
  __weak SolidNativeFabricSurface *weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
    SolidNativeFabricSurface *strongSelf = weakSelf;
    if (strongSelf == nil) {
      finishOnMainQueue(
          completion, nil, makeError(@"The Fabric surface was released."));
      return;
    }

    if (strongSelf->_surface.surfaceHandler.getStatus() !=
        facebook::react::SurfaceHandler::Status::Running) {
      if (attempt >= MaxSurfaceStartAttempts) {
        finishOnMainQueue(
            completion,
            nil,
            makeError(
                @"The empty Fabric surface did not start within ten seconds."));
        return;
      }
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW, SurfaceStartRetryNanoseconds),
          dispatch_get_main_queue(),
          ^{
            [strongSelf waitForRunningSurfaceWithAttempt:attempt + 1
                                              transaction:transaction
                                               completion:completion];
          });
      return;
    }

    NSError *error = nil;
    auto result =
        [strongSelf applyTransactionSynchronously:transaction error:&error];
    finishOnMainQueue(completion, result, error);
  });
}

@end
