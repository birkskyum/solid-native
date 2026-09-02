#pragma once

#include <cstdint>
#include <memory>
#include <unordered_map>

#include <folly/dynamic.h>
#include <react/renderer/core/ReactPrimitives.h>

#include "SolidNativeFabricApi.h"

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#endif

namespace facebook::react {
class InstanceHandle;
class UIManager;
}

namespace facebook::jsi {
class Runtime;
}

namespace solid_native::fabric::react_native {

struct NodeIdentity final {
  facebook::react::Tag tag;
  std::shared_ptr<const facebook::react::InstanceHandle> instanceHandle;
};

using NodeIdentityMap = std::unordered_map<int64_t, NodeIdentity>;

struct NodeMeasurement final {
  double x;
  double y;
  double width;
  double height;
  double pageX;
  double pageY;
  int64_t observedSequence;
};

// Applies the versioned Solid Native host transaction envelope to one Fabric
// surface. The coordinator owns the logical tree and only swaps it after the
// entire mutation list has validated and Fabric has accepted the root commit.
class TransactionCoordinator final {
 public:
  explicit TransactionCoordinator(int32_t surfaceId);
  ~TransactionCoordinator();

  TransactionCoordinator(const TransactionCoordinator &) = delete;
  TransactionCoordinator &operator=(const TransactionCoordinator &) = delete;

  int64_t apply(
      facebook::react::UIManager &uiManager,
      const folly::dynamic &transaction);
  int64_t apply(
      facebook::react::UIManager &uiManager,
      const folly::dynamic &transaction,
      facebook::jsi::Runtime &runtime,
      const NodeIdentityMap &nodeIdentities,
      const NativeResourceResolver &resourceResolver);
#ifdef __OBJC__
  int64_t apply(
      facebook::react::UIManager &uiManager,
      NSDictionary<NSString *, id> *transaction);
  int64_t apply(
      facebook::react::UIManager &uiManager,
      NSDictionary<NSString *, id> *transaction,
      facebook::jsi::Runtime &runtime,
      const NodeIdentityMap &nodeIdentities,
      const NativeResourceResolver &resourceResolver);
#endif
  NodeMeasurement measure(
      facebook::react::UIManager &uiManager,
      int64_t node,
      int64_t afterSequence);
  static facebook::react::Tag allocateFabricTag();
  bool empty() const;
  int64_t lastFabricRevision() const;
  int64_t lastSequence() const;
  void reset();

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

} // namespace solid_native::fabric::react_native
