#pragma once

#import <UIKit/UIKit.h>

@class RCTHost;

NS_ASSUME_NONNULL_BEGIN

typedef void (^SolidNativeFabricCompletion)(NSError *_Nullable error);
typedef void (^SolidNativeFabricTransactionCompletion)(
    NSDictionary<NSString *, id> *_Nullable result,
    NSError *_Nullable error);

// Owns the empty Fabric surface used by the production application and the
// native-only feasibility harness. Application transactions arrive through the
// versioned JSI envelope; the text helpers exist only for the retained proof.
@interface SolidNativeFabricSurface : NSObject

- (instancetype)initWithHost:(RCTHost *)host size:(CGSize)size;

@property(nonatomic, strong, readonly) UIView *view;
@property(nonatomic, assign, readonly) NSInteger surfaceId;
@property(nonatomic, assign, readonly) int64_t lastSequence;

- (nullable NSDictionary<NSString *, id> *)
    applyTransactionSynchronously:(NSDictionary<NSString *, id> *)transaction
                            error:(NSError *_Nullable *_Nullable)error;

- (void)applyTransaction:(NSDictionary<NSString *, id> *)transaction
               completion:(SolidNativeFabricTransactionCompletion)completion;

- (void)mountText:(NSString *)text
        completion:(SolidNativeFabricCompletion)completion;

- (void)updateText:(NSString *)text
         completion:(SolidNativeFabricCompletion)completion;

// Publishes one empty Fabric revision, then resets the native coordinator so
// JavaScript owns node allocation and starts at commit sequence 1.
- (void)prepareEmptySurfaceForJSIOwnershipWithCompletion:
    (SolidNativeFabricCompletion)completion;

// React Native owns the platform surface across a development runtime reload.
// Drop only the coordinator identities inherited from the retired JS runtime;
// the replacement runtime will begin again at node and commit sequence 1.
- (void)resetForJSRuntimeReload;

// RCTHost only rebinds surfaces created through its AppRegistry-oriented
// factory. This host creates its empty surface directly so it can start before
// the JavaScript bundle completes; explicitly attach it to the replacement
// presenter after a runtime reload.
- (void)rebindToCurrentHostAfterJSRuntimeReload;

// Removes the native-only proof tree and resets the transaction sequence so
// the installed JSI runtime owns node allocation and commit sequence 1.
- (void)prepareForJSIOwnershipWithCompletion:
    (SolidNativeFabricCompletion)completion;

- (void)stop;

@end

NS_ASSUME_NONNULL_END
