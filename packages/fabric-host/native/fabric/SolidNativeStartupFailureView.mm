#import "SolidNativeStartupFailureView.h"

namespace {

constexpr NSInteger FailureViewTag = 0x534e46;
#if DEBUG
constexpr NSUInteger MaxDiagnosticLength = 2048;
constexpr NSUInteger MaxDiagnosticNameLength = 128;

NSString *sanitizedBoundedString(NSString *value, NSUInteger maximumLength) {
  auto truncated = value.length > maximumLength;
  auto contentLength = truncated ? maximumLength - 1 : maximumLength;
  if (contentLength < value.length && contentLength > 0) {
    auto lastCharacter = [value characterAtIndex:contentLength - 1];
    if (lastCharacter >= 0xd800 && lastCharacter <= 0xdbff) {
      contentLength -= 1;
    }
  }
  auto bounded = value.length > contentLength
      ? [value substringToIndex:contentLength]
      : value;
  auto clean =
      [[bounded componentsSeparatedByCharactersInSet:
                NSCharacterSet.controlCharacterSet]
          componentsJoinedByString:@" "];
  return truncated ? [clean stringByAppendingString:@"…"] : clean;
}

NSString *boundedDiagnostic(NSError *error) {
  auto rawName = error.domain.length == 0 ? @"Error" : error.domain;
  auto rawMessage = error.localizedDescription.length == 0
      ? @"No diagnostic message was provided."
      : error.localizedDescription;
  auto name = sanitizedBoundedString(rawName, MaxDiagnosticNameLength);
  auto maximumMessageLength = MaxDiagnosticLength - name.length - 2;
  auto message = sanitizedBoundedString(rawMessage, maximumMessageLength);
  return [NSString stringWithFormat:@"%@: %@", name, message];
}
#endif

} // namespace

@implementation SolidNativeStartupFailureView

+ (void)showInContainerView:(UIView *)containerView error:(NSError *)error {
  NSAssert(
      NSThread.isMainThread,
      @"SolidNativeStartupFailureView must render on the main thread.");
  [[containerView viewWithTag:FailureViewTag] removeFromSuperview];

  auto genericMessage = @"Solid Native could not start.";
  NSString *message = genericMessage;
#if DEBUG
  if (error != nil) {
    message = [NSString
        stringWithFormat:@"%@\n\n%@", genericMessage, boundedDiagnostic(error)];
  }
#endif

  auto label = [[UILabel alloc] initWithFrame:containerView.bounds];
  label.tag = FailureViewTag;
  label.autoresizingMask =
      UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  label.backgroundColor = UIColor.systemBackgroundColor;
  label.textColor = UIColor.labelColor;
  label.font = [UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];
  label.numberOfLines = 0;
  label.textAlignment = NSTextAlignmentCenter;
  label.text = message;
  label.isAccessibilityElement = YES;
  label.accessibilityLabel = message;
  [containerView addSubview:label];
  UIAccessibilityPostNotification(UIAccessibilityScreenChangedNotification,
                                  label);
}

@end
