#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Routes one CoreDevice payload URL into the debuggable causal snapshot module. */
@interface SolidNativeDebugRequest : NSObject

+ (BOOL)handleURL:(NSURL *)url NS_SWIFT_NAME(handle(url:));

@end

NS_ASSUME_NONNULL_END
