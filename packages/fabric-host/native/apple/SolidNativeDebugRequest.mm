#import "../fabric/SolidNativeDebugRequest.h"

#import <ReactCommon/RCTTurboModule.h>

#if __has_include(<SolidNativeAppSpec/SolidNativeAppSpec.h>)
#import <SolidNativeAppSpec/SolidNativeAppSpec.h>
#elif __has_include(<SolidNativeE2ESpec/SolidNativeE2ESpec.h>)
#import <SolidNativeE2ESpec/SolidNativeE2ESpec.h>
#else
#error "SolidNativeDebug requires the scaffolded Solid Native application Codegen spec."
#endif

using namespace facebook::react;

#ifndef SOLID_NATIVE_CAUSAL_DEBUG_ENABLED
#define SOLID_NATIVE_CAUSAL_DEBUG_ENABLED 0
#endif

#if DEBUG || SOLID_NATIVE_CAUSAL_DEBUG_ENABLED
#define SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE 1
#else
#define SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE 0
#endif

static NSString *const SolidNativeDebugModuleName = @"SolidNativeDebug";
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
static NSString *const SolidNativeDebugURLScheme = @"solid-native-debug";
static NSString *const SolidNativeDebugRequestIdKey = @"requestId";
static NSString *const SolidNativeDebugOperationKey = @"operation";
static NSString *const SolidNativeDebugSessionIdKey = @"sessionId";
static NSString *const SolidNativeDebugOperationCausalSnapshot = @"causal-snapshot";
static NSString *const SolidNativeDebugOperationDiagnosticsBegin = @"solid-diagnostics-begin";
static NSString *const SolidNativeDebugOperationDiagnosticsEnd = @"solid-diagnostics-end";
static NSString *const SolidNativeDebugResponseDirectory = @"solid-native-debug";
static NSUInteger const SolidNativeDebugMaximumPendingRequests = 8;
static NSUInteger const SolidNativeDebugMaximumSnapshotBytes = 16'777'216;

@class SolidNativeDebugModule;

static NSMutableOrderedSet<NSString *> *SolidNativeDebugPendingRequests(void)
{
  static NSMutableOrderedSet<NSString *> *requests;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    requests = [NSMutableOrderedSet orderedSet];
  });
  return requests;
}

static NSMutableOrderedSet<NSString *> *SolidNativeDebugPublishedRequests(void)
{
  static NSMutableOrderedSet<NSString *> *requests;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    requests = [NSMutableOrderedSet orderedSet];
  });
  return requests;
}

static NSMutableDictionary<NSString *, NSString *> *SolidNativeDebugPendingRequestOperations(void)
{
  static NSMutableDictionary<NSString *, NSString *> *operations;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    operations = [NSMutableDictionary dictionary];
  });
  return operations;
}

static NSMutableDictionary<NSString *, NSString *> *SolidNativeDebugPendingRequestSessions(void)
{
  static NSMutableDictionary<NSString *, NSString *> *sessions;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sessions = [NSMutableDictionary dictionary];
  });
  return sessions;
}

static BOOL SolidNativeDebugValidRequestId(NSString *requestId)
{
  if (requestId.length != 32) {
    return NO;
  }
  static NSCharacterSet *invalidCharacters;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    invalidCharacters = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
  });
  return [requestId rangeOfCharacterFromSet:invalidCharacters].location == NSNotFound;
}

static BOOL SolidNativeDebugValidOperation(NSString *operation)
{
  return [operation isEqualToString:SolidNativeDebugOperationCausalSnapshot] ||
      [operation isEqualToString:SolidNativeDebugOperationDiagnosticsBegin] ||
      [operation isEqualToString:SolidNativeDebugOperationDiagnosticsEnd];
}

static NSURL *SolidNativeDebugResponseDirectoryURL(void)
{
  NSURL *cache = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory
                                                      inDomains:NSUserDomainMask].firstObject;
  return [cache URLByAppendingPathComponent:SolidNativeDebugResponseDirectory isDirectory:YES];
}

static NSURL *SolidNativeDebugResponseURL(NSString *requestId)
{
  return [SolidNativeDebugResponseDirectoryURL()
      URLByAppendingPathComponent:[requestId stringByAppendingPathExtension:@"json"]
                      isDirectory:NO];
}

static void SolidNativeDebugRemoveUntrackedResponses(NSSet<NSString *> *retainedRequestIds)
{
  NSArray<NSURL *> *responses = [NSFileManager.defaultManager
      contentsOfDirectoryAtURL:SolidNativeDebugResponseDirectoryURL()
    includingPropertiesForKeys:@[ NSURLIsRegularFileKey ]
                       options:NSDirectoryEnumerationSkipsHiddenFiles
                         error:nil];
  for (NSURL *response in responses) {
    NSNumber *regularFile;
    if (![response getResourceValue:&regularFile forKey:NSURLIsRegularFileKey error:nil] || !regularFile.boolValue ||
        ![response.pathExtension isEqualToString:@"json"]) {
      continue;
    }
    NSString *requestId = response.URLByDeletingPathExtension.lastPathComponent;
    if (SolidNativeDebugValidRequestId(requestId) && ![retainedRequestIds containsObject:requestId]) {
      [NSFileManager.defaultManager removeItemAtURL:response error:nil];
    }
  }
}
#endif

@interface SolidNativeDebugModule : NativeSolidNativeDebugSpecBase <NativeSolidNativeDebugSpec>

+ (void)enqueueRequestId:(NSString *)requestId operation:(NSString *)operation sessionId:(NSString *)sessionId;
+ (void)acknowledgeRequestId:(NSString *)requestId;

@end

#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
static __weak SolidNativeDebugModule *SolidNativeDebugActiveModule;
#endif

@implementation SolidNativeDebugRequest

+ (BOOL)handleURL:(NSURL *)url
{
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
  if (![url.scheme isEqualToString:SolidNativeDebugURLScheme]) {
    return NO;
  }
  NSString *operation = url.host;
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  NSString *requestId;
  NSString *requestedOperation;
  NSString *sessionId;
  for (NSURLQueryItem *item in components.queryItems) {
    if ([item.name isEqualToString:SolidNativeDebugRequestIdKey]) {
      if (requestId != nil) {
        return NO;
      }
      requestId = item.value;
    } else if ([item.name isEqualToString:SolidNativeDebugOperationKey]) {
      if (requestedOperation != nil) {
        return NO;
      }
      requestedOperation = item.value;
    } else if ([item.name isEqualToString:SolidNativeDebugSessionIdKey]) {
      if (sessionId != nil) {
        return NO;
      }
      sessionId = item.value;
    } else {
      return NO;
    }
  }
  if (!SolidNativeDebugValidRequestId(requestId)) {
    return NO;
  }
  if ([operation isEqualToString:@"capture"]) {
    NSString *debugOperation = requestedOperation ?: SolidNativeDebugOperationCausalSnapshot;
    if (!SolidNativeDebugValidOperation(debugOperation)) {
      return NO;
    }
    if ([debugOperation isEqualToString:SolidNativeDebugOperationDiagnosticsEnd]) {
      if (!SolidNativeDebugValidRequestId(sessionId)) {
        return NO;
      }
    } else if (sessionId != nil) {
      return NO;
    }
    [SolidNativeDebugModule enqueueRequestId:requestId operation:debugOperation sessionId:sessionId];
    return YES;
  }
  if ([operation isEqualToString:@"ack"]) {
    if (requestedOperation != nil || sessionId != nil) {
      return NO;
    }
    [SolidNativeDebugModule acknowledgeRequestId:requestId];
    return YES;
  }
#else
  (void)url;
#endif
  return NO;
}

@end

@implementation SolidNativeDebugModule {
  BOOL _hasListeners;
  NSMutableOrderedSet<NSString *> *_outstandingRequestIds;
}

+ (NSString *)moduleName
{
  return SolidNativeDebugModuleName;
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  if ((self = [super init])) {
    _outstandingRequestIds = [NSMutableOrderedSet orderedSet];
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
    @synchronized(SolidNativeDebugModule.class) {
      SolidNativeDebugRemoveUntrackedResponses(
          [NSSet setWithArray:SolidNativeDebugPublishedRequests().array]);
    }
#endif
  }
  return self;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (void)setSnapshotListenerReady:(BOOL)ready
{
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
  _hasListeners = ready;
  @synchronized(SolidNativeDebugModule.class) {
    if (ready) {
      SolidNativeDebugActiveModule = self;
    } else if (SolidNativeDebugActiveModule == self) {
      SolidNativeDebugActiveModule = nil;
    }
  }
  if (ready) {
    [self flushPendingRequests];
  } else {
    [_outstandingRequestIds removeAllObjects];
  }
#else
  (void)ready;
#endif
}

- (void)invalidate
{
  [self setSnapshotListenerReady:NO];
}

+ (void)enqueueRequestId:(NSString *)requestId operation:(NSString *)operation sessionId:(NSString *)sessionId
{
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
  @synchronized(self) {
    NSMutableOrderedSet<NSString *> *requests = SolidNativeDebugPendingRequests();
    NSMutableDictionary<NSString *, NSString *> *operations = SolidNativeDebugPendingRequestOperations();
    NSMutableDictionary<NSString *, NSString *> *sessions = SolidNativeDebugPendingRequestSessions();
    [requests removeObject:requestId];
    [operations removeObjectForKey:requestId];
    [sessions removeObjectForKey:requestId];
    while (requests.count >= SolidNativeDebugMaximumPendingRequests) {
      NSString *evictedRequestId = requests.firstObject;
      [requests removeObjectAtIndex:0];
      [operations removeObjectForKey:evictedRequestId];
      [sessions removeObjectForKey:evictedRequestId];
    }
    [requests addObject:requestId];
    operations[requestId] = operation;
    if (sessionId != nil) {
      sessions[requestId] = sessionId;
    }
  }
  [NSFileManager.defaultManager removeItemAtURL:SolidNativeDebugResponseURL(requestId) error:nil];
  dispatch_async(dispatch_get_main_queue(), ^{
    SolidNativeDebugModule *module;
    @synchronized(self) {
      module = SolidNativeDebugActiveModule;
    }
    [module flushPendingRequests];
  });
#else
  (void)requestId;
  (void)operation;
  (void)sessionId;
#endif
}

+ (void)acknowledgeRequestId:(NSString *)requestId
{
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
  @synchronized(self) {
    [SolidNativeDebugPendingRequests() removeObject:requestId];
    [SolidNativeDebugPendingRequestOperations() removeObjectForKey:requestId];
    [SolidNativeDebugPendingRequestSessions() removeObjectForKey:requestId];
    [SolidNativeDebugPublishedRequests() removeObject:requestId];
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    SolidNativeDebugModule *module;
    @synchronized(self) {
      module = SolidNativeDebugActiveModule;
    }
    [module->_outstandingRequestIds removeObject:requestId];
    [NSFileManager.defaultManager removeItemAtURL:SolidNativeDebugResponseURL(requestId) error:nil];
  });
#else
  (void)requestId;
#endif
}

- (void)flushPendingRequests
{
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
  if (!_hasListeners) {
    return;
  }
  NSArray<NSString *> *requests;
  NSDictionary<NSString *, NSString *> *operations;
  NSDictionary<NSString *, NSString *> *sessions;
  @synchronized(SolidNativeDebugModule.class) {
    requests = [SolidNativeDebugPendingRequests().array copy];
    operations = [SolidNativeDebugPendingRequestOperations() copy];
    sessions = [SolidNativeDebugPendingRequestSessions() copy];
    [SolidNativeDebugPendingRequests() removeAllObjects];
    [SolidNativeDebugPendingRequestOperations() removeAllObjects];
    [SolidNativeDebugPendingRequestSessions() removeAllObjects];
  }
  for (NSString *requestId in requests) {
    while (_outstandingRequestIds.count >= SolidNativeDebugMaximumPendingRequests) {
      [_outstandingRequestIds removeObjectAtIndex:0];
    }
    [_outstandingRequestIds addObject:requestId];
    NSString *operation = operations[requestId] ?: SolidNativeDebugOperationCausalSnapshot;
    NSMutableDictionary<NSString *, NSString *> *event = [@{
      SolidNativeDebugRequestIdKey : requestId,
      SolidNativeDebugOperationKey : operation,
    } mutableCopy];
    NSString *sessionId = sessions[requestId];
    if (sessionId != nil) {
      event[SolidNativeDebugSessionIdKey] = sessionId;
    }
    [self emitOnSnapshotRequest:event];
  }
#endif
}

- (void)publishSnapshot:(NSString *)requestId
                payload:(NSString *)payload
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
#if SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE
  if (!SolidNativeDebugValidRequestId(requestId) || ![_outstandingRequestIds containsObject:requestId]) {
    reject(@"E_SOLID_NATIVE_DEBUG_REQUEST", @"Native debug request is invalid, unknown, or already settled.", nil);
    return;
  }
  [_outstandingRequestIds removeObject:requestId];
  NSData *bytes = [payload dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length == 0 || bytes.length > SolidNativeDebugMaximumSnapshotBytes) {
    reject(@"E_SOLID_NATIVE_DEBUG_PAYLOAD", @"Native debug response is empty or exceeds 16777216 UTF-8 bytes.", nil);
    return;
  }
  NSError *error;
  NSURL *directory = SolidNativeDebugResponseDirectoryURL();
  if (![NSFileManager.defaultManager createDirectoryAtURL:directory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:&error] ||
      ![bytes writeToURL:SolidNativeDebugResponseURL(requestId)
                 options:NSDataWritingAtomic
                   error:&error]) {
    reject(@"E_SOLID_NATIVE_DEBUG_WRITE", @"Could not publish the native debug response.", error);
    return;
  }
  @synchronized(SolidNativeDebugModule.class) {
    NSMutableOrderedSet<NSString *> *published = SolidNativeDebugPublishedRequests();
    [published removeObject:requestId];
    while (published.count >= SolidNativeDebugMaximumPendingRequests) {
      NSString *evictedRequestId = published.firstObject;
      [published removeObjectAtIndex:0];
      [NSFileManager.defaultManager removeItemAtURL:SolidNativeDebugResponseURL(evictedRequestId) error:nil];
    }
    [published addObject:requestId];
  }
  resolve(nil);
#else
  (void)requestId;
  (void)payload;
  (void)resolve;
  reject(@"E_SOLID_NATIVE_DEBUG_UNAVAILABLE", @"Native debug transport requires a debuggable build.", nil);
#endif
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeSolidNativeDebugSpecJSI>(params);
}

@end
