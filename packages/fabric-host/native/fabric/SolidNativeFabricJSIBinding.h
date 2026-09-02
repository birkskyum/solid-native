#pragma once

#import <Foundation/Foundation.h>

namespace facebook::jsi {
class Runtime;
}

@class SolidNativeFabricSurface;

NS_ASSUME_NONNULL_BEGIN

typedef void (^SolidNativeFabricFatalErrorHandler)(
    NSString *name,
    NSString *message);

// Installs the production versioned JavaScript-to-Fabric transport. The binding
// never retains JSI values outside the runtime-owned host functions and may
// only be installed or invoked on React Native's JS thread.
@interface SolidNativeFabricJSIBinding : NSObject

- (void)installIntoRuntime:(facebook::jsi::Runtime &)runtime;

- (void)publishSurface:(SolidNativeFabricSurface *)surface;
- (void)markSurfaceReloading;
- (void)markSurfaceReady;
- (void)setFatalErrorHandler:
    (nullable SolidNativeFabricFatalErrorHandler)handler;
- (void)invalidate;

@end

NS_ASSUME_NONNULL_END
