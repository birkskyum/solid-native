#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Renders a dependency-free terminal startup fallback after Fabric cannot own
// the screen. Release builds never expose the supplied diagnostic.
@interface SolidNativeStartupFailureView : NSObject

+ (void)showInContainerView:(UIView *)containerView
                      error:(nullable NSError *)error
    NS_SWIFT_NAME(show(in:error:));

@end

NS_ASSUME_NONNULL_END
