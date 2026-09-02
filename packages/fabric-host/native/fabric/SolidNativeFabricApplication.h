#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^SolidNativeFabricStatusHandler)(
    NSString *status,
    NSError *_Nullable error);

// Owns one React Native host, one empty Fabric surface, and the Solid Native
// JSI binding. Start and stop this application on the main thread. The factory
// parameter remains `id` so Swift callers do not need to import RCTHost's
// Objective-C++ declaration.
@interface SolidNativeFabricApplication : NSObject

+ (instancetype)startWithFactory:(id)factory
                    containerView:(UIView *)containerView
                    launchOptions:(nullable NSDictionary *)launchOptions
                     statusHandler:
                         (nullable SolidNativeFabricStatusHandler)statusHandler;

// Requests the same in-process runtime replacement used by React Native's
// development reload command. The application process and empty Fabric
// surface remain owned by this object across the replacement.
- (void)requestDevelopmentReload;

- (void)stop;

@end

NS_ASSUME_NONNULL_END
