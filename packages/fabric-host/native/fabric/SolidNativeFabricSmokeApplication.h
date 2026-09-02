#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^SolidNativeFabricSmokeStatusHandler)(
    NSString *status,
    NSError *_Nullable error);

// Owns the disposable React Native host used by the native smoke proof. The
// factory parameter is intentionally `id` so Swift callers do not need to
// import React Native's Objective-C++ RCTHost declaration.
@interface SolidNativeFabricSmokeApplication : NSObject

+ (instancetype)startWithFactory:(id)factory
                    containerView:(UIView *)containerView
                    launchOptions:(nullable NSDictionary *)launchOptions
                     statusHandler:
                         (SolidNativeFabricSmokeStatusHandler)statusHandler;

- (void)stop;

@end

NS_ASSUME_NONNULL_END
