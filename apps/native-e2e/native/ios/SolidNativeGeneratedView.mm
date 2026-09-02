#import "SolidNativeGeneratedView.h"

#import <react/renderer/components/SolidNativeE2ESpec/ComponentDescriptors.h>
#import <react/renderer/components/SolidNativeE2ESpec/Props.h>
#import <react/renderer/components/SolidNativeE2ESpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface SolidNativeGeneratedView () <RCTSolidNativeGeneratedViewViewProtocol>
@end

@implementation SolidNativeGeneratedView {
  UILabel *_labelView;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      SolidNativeGeneratedViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _props = SolidNativeGeneratedViewShadowNode::defaultSharedProps();
    _labelView = [[UILabel alloc] initWithFrame:self.bounds];
    _labelView.autoresizingMask =
        UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _labelView.font = [UIFont systemFontOfSize:15 weight:UIFontWeightSemibold];
    _labelView.textAlignment = NSTextAlignmentCenter;
    _labelView.textColor = UIColor.whiteColor;
    _labelView.userInteractionEnabled = NO;
    [self addSubview:_labelView];
  }
  return self;
}

- (void)updateProps:(const Props::Shared &)props
            oldProps:(const Props::Shared &)oldProps {
  const auto &oldViewProps =
      static_cast<const SolidNativeGeneratedViewProps &>(*_props);
  const auto &newViewProps =
      static_cast<const SolidNativeGeneratedViewProps &>(*props);
  if (oldViewProps.label != newViewProps.label) {
    _labelView.text = [NSString stringWithUTF8String:newViewProps.label.c_str()];
  }
  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle {
  [super prepareForRecycle];
  _labelView.text = @"";
}

@end
