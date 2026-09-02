#import "SolidNativeFabricSmokeApplication.h"

#import <React/RCTBridge.h>
#import <React/RCTReactNativeFactory.h>
#import <React/RCTRootViewFactory.h>
#import <React/RCTSurfacePresenter.h>
#import <ReactCommon/RCTHost.h>
#import <React_RCTAppDelegate/RCTJSRuntimeConfiguratorProtocol.h>

#include <react/runtime/JSRuntimeFactoryCAPI.h>

#include <stdexcept>

#import "SolidNativeFabricJSIBinding.h"
#import "SolidNativeFabricSurface.h"

namespace {

constexpr NSInteger MaxHostStartAttempts = 500;
constexpr int64_t HostStartRetryNanoseconds = 10 * NSEC_PER_MSEC;
constexpr NSInteger MaxJSICommitAttempts = 500;
constexpr NSInteger MaxJSIEventCommitAttempts = 3000;
constexpr int64_t JSICommitRetryNanoseconds = 10 * NSEC_PER_MSEC;

NSError *hostStartError(void) {
  return [NSError
      errorWithDomain:@"SolidNativeFabricSmokeApplication"
                 code:1
             userInfo:@{
               NSLocalizedDescriptionKey :
                   @"The React Native host did not expose its Fabric scheduler within five seconds."
             }];
}

NSError *jsiCommitError(void) {
  return [NSError
      errorWithDomain:@"SolidNativeFabricSmokeApplication"
                 code:3
             userInfo:@{
               NSLocalizedDescriptionKey :
                   @"The JavaScript bundle did not commit transaction sequence 1 within five seconds."
             }];
}

NSError *jsiEventCommitError(void) {
  return [NSError
      errorWithDomain:@"SolidNativeFabricSmokeApplication"
                 code:5
             userInfo:@{
               NSLocalizedDescriptionKey :
                   @"The AppState event did not commit transaction sequence 2 within thirty seconds."
             }];
}

} // namespace

@interface SolidNativeFabricSmokeApplication () <RCTHostDelegate>
- (void)waitForJSIEventCommitWithAttempt:(NSInteger)attempt;
@end

@implementation SolidNativeFabricSmokeApplication {
  RCTReactNativeFactory *_factory;
  id<RCTReactNativeFactoryDelegate> _factoryDelegate;
  RCTHost *_host;
  UIView *_containerView;
  SolidNativeFabricSurface *_surface;
  SolidNativeFabricJSIBinding *_binding;
  SolidNativeFabricSmokeStatusHandler _statusHandler;
}

+ (instancetype)startWithFactory:(id)factory
                    containerView:(UIView *)containerView
                    launchOptions:(NSDictionary *)launchOptions
                     statusHandler:
                         (SolidNativeFabricSmokeStatusHandler)statusHandler {
  return [[self alloc] initWithFactory:factory
                         containerView:containerView
                         launchOptions:launchOptions
                          statusHandler:statusHandler];
}

- (instancetype)initWithFactory:(RCTReactNativeFactory *)factory
                    containerView:(UIView *)containerView
                    launchOptions:(NSDictionary *)launchOptions
                     statusHandler:
                         (SolidNativeFabricSmokeStatusHandler)statusHandler {
  if (self = [super init]) {
    NSAssert(NSThread.isMainThread, @"The smoke application must start on the main thread.");
    _factory = factory;
    _factoryDelegate = factory.delegate;
    _containerView = containerView;
    _statusHandler = [statusHandler copy];
    _binding = [[SolidNativeFabricJSIBinding alloc] init];

#ifndef RCT_REMOVE_LEGACY_MODULE_INTEROP
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

- (void)hostDidStart:(RCTHost *)host {
  [(id<RCTHostDelegate>)_factory hostDidStart:host];
}

- (void)host:(RCTHost *)host
    didInitializeRuntime:(facebook::jsi::Runtime &)runtime {
  try {
    [_binding installIntoRuntime:runtime];
    [self reportStatus:@"jsi-installed" error:nil];
  } catch (const std::exception &exception) {
    auto message = [NSString stringWithUTF8String:exception.what()];
    [self reportStatus:
              @"jsi-failed"
                error:[NSError
                          errorWithDomain:
                              @"SolidNativeFabricSmokeApplication"
                                     code:4
                                 userInfo:@{
                                   NSLocalizedDescriptionKey : message
                                 }]];
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
  if (_host.surfacePresenter.scheduler != nil) {
    [self mountSmokeSurface];
    return;
  }
  if (attempt >= MaxHostStartAttempts) {
    [self reportStatus:@"host-failed" error:hostStartError()];
    return;
  }

  __weak SolidNativeFabricSmokeApplication *weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, HostStartRetryNanoseconds),
      dispatch_get_main_queue(),
      ^{
        [weakSelf waitForHostWithAttempt:attempt + 1];
      });
}

- (void)mountSmokeSurface {
  [self reportStatus:@"host-started" error:nil];
  _surface = [[SolidNativeFabricSurface alloc]
      initWithHost:_host
              size:_containerView.bounds.size];
  [_binding publishSurface:_surface];
  _surface.view.frame = _containerView.bounds;
  [_containerView addSubview:_surface.view];

  __weak SolidNativeFabricSmokeApplication *weakSelf = self;
  [_surface mountText:@"Solid Native direct Fabric mount"
           completion:^(NSError *error) {
             SolidNativeFabricSmokeApplication *strongSelf = weakSelf;
             if (strongSelf == nil) {
               return;
             }
             [strongSelf
                 reportStatus:
                     error == nil ? @"mount-succeeded" : @"mount-failed"
                       error:error];
             if (error != nil) {
               return;
             }

             NSDictionary<NSString *, id> *invalidTransaction = @{
               @"contractVersion" : @1,
               @"surface" : @(strongSelf->_surface.surfaceId),
               @"sequence" : @2,
               @"priority" : @"normal",
               @"mutations" : @[
                 @{
                   @"type" : @"update-text",
                   @"node" : @3,
                   @"text" : @"This staged text must roll back"
                 },
                 @{
                   @"type" : @"insert-child",
                   @"parent" : @2,
                   @"child" : @2
                 }
               ]
             };
             [strongSelf->_surface
                 applyTransaction:invalidTransaction
                        completion:^(NSDictionary<NSString *, id> *result,
                                     NSError *rollbackError) {
                          [strongSelf
                              reportStatus:
                                  rollbackError != nil
                                      ? @"rollback-succeeded"
                                      : @"rollback-failed"
                                    error:rollbackError == nil
                                      ? [NSError
                                            errorWithDomain:
                                                @"SolidNativeFabricSmokeApplication"
                                                       code:2
                                                   userInfo:@{
                                                     NSLocalizedDescriptionKey :
                                                         @"The invalid transaction was accepted."
                                                   }]
                                      : nil];
                          if (rollbackError == nil) {
                            return;
                          }
                          [strongSelf->_surface
                              prepareForJSIOwnershipWithCompletion:
                                  ^(NSError *ownershipError) {
                                    [strongSelf
                                        reportStatus:
                                            ownershipError == nil
                                                ? @"jsi-ownership-ready"
                                                : @"jsi-ownership-failed"
                                              error:ownershipError];
                                    if (ownershipError != nil) return;
                                    [strongSelf->_binding markSurfaceReady];
                                    [strongSelf
                                        reportStatus:@"jsi-surface-ready"
                                               error:nil];
                                    [strongSelf
                                        waitForJSICommitWithAttempt:0];
                                  }];
                        }];
           }];
}

- (void)waitForJSICommitWithAttempt:(NSInteger)attempt {
  if (_surface.lastSequence >= 1) {
    [self reportStatus:@"jsi-update-succeeded" error:nil];
    [self waitForJSIEventCommitWithAttempt:0];
    return;
  }
  if (attempt >= MaxJSICommitAttempts) {
    [self reportStatus:@"jsi-update-failed" error:jsiCommitError()];
    return;
  }
  __weak SolidNativeFabricSmokeApplication *weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, JSICommitRetryNanoseconds),
      dispatch_get_main_queue(),
      ^{
        [weakSelf waitForJSICommitWithAttempt:attempt + 1];
      });
}

- (void)waitForJSIEventCommitWithAttempt:(NSInteger)attempt {
  if (_surface.lastSequence >= 2) {
    [self reportStatus:@"jsi-event-update-succeeded" error:nil];
    return;
  }
  if (attempt >= MaxJSIEventCommitAttempts) {
    [self reportStatus:@"jsi-event-update-failed" error:jsiEventCommitError()];
    return;
  }
  __weak SolidNativeFabricSmokeApplication *weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, JSICommitRetryNanoseconds),
      dispatch_get_main_queue(),
      ^{
        [weakSelf waitForJSIEventCommitWithAttempt:attempt + 1];
      });
}

- (void)reportStatus:(NSString *)status error:(NSError *)error {
  auto handler = _statusHandler;
  if (handler == nil) return;
  if (NSThread.isMainThread) {
    handler(status, error);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    handler(status, error);
  });
}

- (void)stop {
  [_binding invalidate];
  [_surface stop];
  [_surface.view removeFromSuperview];
  _surface = nil;
}

- (void)dealloc {
  [self stop];
}

@end
