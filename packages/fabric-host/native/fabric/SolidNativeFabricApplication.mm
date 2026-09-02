#import "SolidNativeFabricApplication.h"

#import <React/RCTBridge.h>
#import <React/RCTReloadCommand.h>
#import <React/RCTReactNativeFactory.h>
#import <React/RCTRootViewFactory.h>
#import <React/RCTSurfacePresenter.h>
#import <ReactCommon/RCTHost.h>
#import <React_RCTAppDelegate/RCTJSRuntimeConfiguratorProtocol.h>

#include <react/runtime/JSRuntimeFactoryCAPI.h>

#include <atomic>
#include <stdexcept>

#import "SolidNativeFabricJSIBinding.h"
#import "SolidNativeFabricSurface.h"
#import "SolidNativeStartupFailureView.h"

namespace {

constexpr NSInteger MaxHostStartAttempts = 500;
constexpr int64_t HostStartRetryNanoseconds = 10 * NSEC_PER_MSEC;

NSError *hostStartError(void) {
  return [NSError
      errorWithDomain:@"SolidNativeFabricApplication"
                 code:1
             userInfo:@{
               NSLocalizedDescriptionKey :
                   @"The React Native host did not expose its Fabric scheduler within five seconds."
             }];
}

} // namespace

@interface SolidNativeFabricApplication () <RCTHostDelegate>
- (void)handleFatalErrorWithName:(NSString *)name
                         message:(NSString *)message;
- (void)prepareSurfaceForJSIOwnership:(SolidNativeFabricSurface *)surface
                           generation:(NSUInteger)generation;
@end

@implementation SolidNativeFabricApplication {
  RCTReactNativeFactory *_factory;
  id<RCTReactNativeFactoryDelegate> _factoryDelegate;
  RCTHost *_host;
  UIView *_containerView;
  SolidNativeFabricSurface *_surface;
  SolidNativeFabricJSIBinding *_binding;
  SolidNativeFabricStatusHandler _statusHandler;
  std::atomic<bool> _stopped;
  NSUInteger _surfacePreparationGeneration;
}

+ (instancetype)startWithFactory:(id)factory
                    containerView:(UIView *)containerView
                    launchOptions:(NSDictionary *)launchOptions
                     statusHandler:
                         (SolidNativeFabricStatusHandler)statusHandler {
  return [[self alloc] initWithFactory:factory
                         containerView:containerView
                         launchOptions:launchOptions
                          statusHandler:statusHandler];
}

- (instancetype)initWithFactory:(RCTReactNativeFactory *)factory
                    containerView:(UIView *)containerView
                    launchOptions:(NSDictionary *)launchOptions
                     statusHandler:
                         (SolidNativeFabricStatusHandler)statusHandler {
  if (self = [super init]) {
    NSAssert(
        NSThread.isMainThread,
        @"The Solid Native application must start on the main thread.");
    NSParameterAssert(factory != nil);
    NSParameterAssert(factory.delegate != nil);
    NSParameterAssert(containerView != nil);
    _stopped.store(false, std::memory_order_release);
    _factory = factory;
    _factoryDelegate = factory.delegate;
    _containerView = containerView;
    _statusHandler = [statusHandler copy];
    _binding = [[SolidNativeFabricJSIBinding alloc] init];
    __weak SolidNativeFabricApplication *weakSelf = self;
    [_binding setFatalErrorHandler:^(NSString *name, NSString *message) {
      [weakSelf handleFatalErrorWithName:name message:message];
    }];

#ifndef RCT_REMOVE_LEGACY_MODULE_INTEROP
    // RCTRootViewFactory enables this before constructing its RCTHost. Solid
    // Native owns the host directly, so preserve the same bridgeless-module
    // contract for linked RCTBridgeModule dependencies before the manager takes
    // its registration snapshot.
    RCTEnableTurboModuleInterop(YES);
#endif

    __weak id<RCTReactNativeFactoryDelegate> weakFactoryDelegate =
        _factoryDelegate;
    _host = [[RCTHost alloc]
        initWithBundleURLProvider:^NSURL *() {
          return [weakFactoryDelegate bundleURL];
        }
        hostDelegate:self
        turboModuleManagerDelegate:(id<RCTTurboModuleManagerDelegate>)_factory
        jsEngineProvider:
            ^std::shared_ptr<facebook::react::JSRuntimeFactory>() {
              auto factoryRef =
                  [weakFactoryDelegate createJSRuntimeFactory];
              if (factoryRef == nullptr) {
                throw std::runtime_error(
                    "The React Native factory did not create a JavaScript runtime factory.");
              }
              return std::shared_ptr<facebook::react::JSRuntimeFactory>(
                  reinterpret_cast<facebook::react::JSRuntimeFactory *>(
                      factoryRef),
                  [](facebook::react::JSRuntimeFactory *runtimeFactory) {
                    js_runtime_factory_destroy(
                        reinterpret_cast<JSRuntimeFactoryRef>(runtimeFactory));
                  });
            }
        launchOptions:launchOptions
        bundleConfiguration:_factory.bundleConfiguration
        devMenuConfiguration:_factory.devMenuConfiguration];
    _factory.rootViewFactory.reactHost = _host;
    [_host start];
    [self waitForHostWithAttempt:0];
  }
  return self;
}

- (void)handleFatalErrorWithName:(NSString *)name
                         message:(NSString *)message {
  if (_stopped.load(std::memory_order_acquire)) return;
  auto containerView = _containerView;
  if (containerView == nil) return;
  auto error = [NSError
      errorWithDomain:name
                 code:3
             userInfo:@{NSLocalizedDescriptionKey : message}];
  [self reportStatus:@"runtime-failed" error:error];
  [self stop];
  [SolidNativeStartupFailureView showInContainerView:containerView error:error];
}

- (void)hostDidStart:(RCTHost *)host {
  [(id<RCTHostDelegate>)_factory hostDidStart:host];
  if (_stopped.load(std::memory_order_acquire) || _surface == nil) return;

  // RCTHost calls this again before it resets attached surfaces for a
  // development reload. Hide the retiring surface from the replacement
  // runtime immediately, then let RCTHost finish its synchronous reset before
  // starting and republishing our empty surface on the main queue.
  [_binding markSurfaceReloading];
  auto surface = _surface;
  const auto generation = ++_surfacePreparationGeneration;
  __weak SolidNativeFabricApplication *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    SolidNativeFabricApplication *strongSelf = weakSelf;
    if (strongSelf == nil ||
        strongSelf->_stopped.load(std::memory_order_acquire) ||
        strongSelf->_surface != surface ||
        strongSelf->_surfacePreparationGeneration != generation) {
      return;
    }
    [surface rebindToCurrentHostAfterJSRuntimeReload];
    [strongSelf prepareSurfaceForJSIOwnership:surface
                                   generation:generation];
  });
}

- (void)host:(RCTHost *)host
    didInitializeRuntime:(facebook::jsi::Runtime &)runtime {
  if (_stopped.load(std::memory_order_acquire)) return;
  auto binding = _binding;
  if (binding == nil) return;
  try {
    [binding installIntoRuntime:runtime];
    if (_stopped.load(std::memory_order_acquire)) {
      [binding invalidate];
      return;
    }
    [self reportStatus:@"jsi-installed" error:nil];
  } catch (const std::exception &exception) {
    auto message = [NSString stringWithUTF8String:exception.what()] ?:
        @"The Solid Native JSI binding failed to install.";
    [self reportStatus:
              @"jsi-failed"
                error:[NSError
                          errorWithDomain:@"SolidNativeFabricApplication"
                                     code:2
                                 userInfo:@{
                                   NSLocalizedDescriptionKey : message
                                 }]];
    __weak SolidNativeFabricApplication *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf stop];
    });
    throw;
  }
}

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] ||
      [_factory respondsToSelector:selector];
}

- (id)forwardingTargetForSelector:(SEL)selector {
  if ([_factory respondsToSelector:selector]) return _factory;
  return [super forwardingTargetForSelector:selector];
}

- (void)waitForHostWithAttempt:(NSInteger)attempt {
  if (_stopped.load(std::memory_order_acquire)) return;
  if (_host.surfacePresenter.scheduler != nil) {
    [self mountApplicationSurface];
    return;
  }
  if (attempt >= MaxHostStartAttempts) {
    [self reportStatus:@"host-failed" error:hostStartError()];
    [self stop];
    return;
  }

  __weak SolidNativeFabricApplication *weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, HostStartRetryNanoseconds),
      dispatch_get_main_queue(),
      ^{
        [weakSelf waitForHostWithAttempt:attempt + 1];
      });
}

- (void)mountApplicationSurface {
  if (_stopped.load(std::memory_order_acquire)) return;
  [self reportStatus:@"host-started" error:nil];
  _surface = [[SolidNativeFabricSurface alloc]
      initWithHost:_host
              size:_containerView.bounds.size];
  [_binding publishSurface:_surface];
  _surface.view.frame = _containerView.bounds;
  [_containerView addSubview:_surface.view];

  const auto generation = ++_surfacePreparationGeneration;
  [self prepareSurfaceForJSIOwnership:_surface generation:generation];
}

- (void)prepareSurfaceForJSIOwnership:(SolidNativeFabricSurface *)surface
                           generation:(NSUInteger)generation {
  __weak SolidNativeFabricApplication *weakSelf = self;
  [surface prepareEmptySurfaceForJSIOwnershipWithCompletion:
                ^(NSError *error) {
                  SolidNativeFabricApplication *strongSelf = weakSelf;
                  if (strongSelf == nil ||
                      strongSelf->_stopped.load(std::memory_order_acquire) ||
                      strongSelf->_surface != surface ||
                      strongSelf->_surfacePreparationGeneration != generation) {
                    return;
                  }
                  if (error != nil) {
                    [strongSelf reportStatus:@"jsi-surface-failed"
                                       error:error];
                    [strongSelf stop];
                    return;
                  }
                  [strongSelf->_binding markSurfaceReady];
                  [strongSelf reportStatus:@"jsi-surface-ready" error:nil];
                }];
}

- (void)reportStatus:(NSString *)status error:(NSError *)error {
  if (NSThread.isMainThread) {
    if (_stopped.load(std::memory_order_acquire)) return;
    auto handler = _statusHandler;
    if (handler == nil) return;
    handler(status, error);
    return;
  }
  __weak SolidNativeFabricApplication *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    SolidNativeFabricApplication *strongSelf = weakSelf;
    if (strongSelf == nil ||
        strongSelf->_stopped.load(std::memory_order_acquire)) {
      return;
    }
    auto handler = strongSelf->_statusHandler;
    if (handler == nil) return;
    handler(status, error);
  });
}

- (void)requestDevelopmentReload {
  NSAssert(
      NSThread.isMainThread,
      @"A Solid Native development reload must be requested on the main thread.");
  if (_stopped.load(std::memory_order_acquire) || _host == nil) return;
  RCTTriggerReloadCommandListeners(@"Solid Native development reload");
}

- (void)stop {
  if (_stopped.load(std::memory_order_acquire)) return;
  NSAssert(
      NSThread.isMainThread,
      @"The Solid Native application must stop on the main thread.");
  if (_stopped.exchange(true, std::memory_order_acq_rel)) return;
  [_binding setFatalErrorHandler:nil];
  [_binding invalidate];
  [_surface stop];
  [_surface.view removeFromSuperview];
  _surface = nil;
  if (_factory.rootViewFactory.reactHost == _host) {
    _factory.rootViewFactory.reactHost = nil;
  }
  _host = nil;
  _binding = nil;
  _containerView = nil;
  _statusHandler = nil;
}

- (void)dealloc {
  [self stop];
}

@end
