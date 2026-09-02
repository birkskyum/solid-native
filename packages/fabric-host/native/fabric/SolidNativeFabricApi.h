#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <folly/dynamic.h>
#include <jsi/jsi.h>
#include <cxxreact/ReactNativeVersion.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/core/ShadowNode.h>

#if !defined(SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR) ||                       \
    !defined(SOLID_NATIVE_REACT_NATIVE_VERSION_MINOR) ||                       \
    !defined(SOLID_NATIVE_REACT_NATIVE_VERSION_PATCH)
#error "Solid Native requires an expected React Native runtime identity from the reviewed boundary manifest."
#endif

#if REACT_NATIVE_VERSION_MAJOR != SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR ||   \
    REACT_NATIVE_VERSION_MINOR != SOLID_NATIVE_REACT_NATIVE_VERSION_MINOR ||   \
    REACT_NATIVE_VERSION_PATCH != SOLID_NATIVE_REACT_NATIVE_VERSION_PATCH
#error "Solid Native's Fabric adapter does not match the selected React Native runtime."
#endif

#define SOLID_NATIVE_STRINGIFY_DETAIL(value) #value
#define SOLID_NATIVE_STRINGIFY(value) SOLID_NATIVE_STRINGIFY_DETAIL(value)
#define SOLID_NATIVE_REACT_NATIVE_RUNTIME_VERSION                              \
  SOLID_NATIVE_STRINGIFY(SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR) "."         \
      SOLID_NATIVE_STRINGIFY(SOLID_NATIVE_REACT_NATIVE_VERSION_MINOR) "."     \
          SOLID_NATIVE_STRINGIFY(SOLID_NATIVE_REACT_NATIVE_VERSION_PATCH)

namespace facebook::react {
class InstanceHandle;
class UIManager;
}

namespace facebook::jsi {
class Runtime;
}

namespace solid_native::fabric::react_native {

inline constexpr const char *ReactNativeVersion =
    SOLID_NATIVE_REACT_NATIVE_RUNTIME_VERSION;

using ShadowNode = facebook::react::ShadowNode;
using ShadowNodePtr = std::shared_ptr<const ShadowNode>;
using ShadowNodeList = std::vector<ShadowNodePtr>;
using NativeResourceResolver = std::function<facebook::jsi::Value(
    facebook::jsi::Runtime &,
    int64_t,
    const std::string &)>;

// This is the narrow renderer-operation layer inside the manifest-selected
// adapter. Platform installation, event interception, and mount observation
// also use pinned React Native APIs, but application-facing code never does.
class FabricApi final {
 public:
  static ShadowNodePtr createNode(
      facebook::react::UIManager &uiManager,
      facebook::react::Tag tag,
      const std::string &componentName,
      facebook::react::SurfaceId surfaceId,
      const folly::dynamic &props,
      std::shared_ptr<const facebook::react::InstanceHandle> instanceHandle,
      facebook::jsi::Runtime *runtime,
      const NativeResourceResolver *resourceResolver);

  static ShadowNodePtr cloneNode(
      facebook::react::UIManager &uiManager,
      const ShadowNode &node,
      std::shared_ptr<const ShadowNodeList> children,
      const folly::dynamic &props,
      facebook::jsi::Runtime *runtime,
      const NativeResourceResolver *resourceResolver);

  static void appendChild(
      facebook::react::UIManager &uiManager,
      const ShadowNodePtr &parent,
      const ShadowNodePtr &child);

  static void completeSurface(
      facebook::react::UIManager &uiManager,
      facebook::react::SurfaceId surfaceId,
      std::shared_ptr<ShadowNodeList> rootChildren);

  static int64_t currentRevisionNumber(
      facebook::react::UIManager &uiManager,
      facebook::react::SurfaceId surfaceId);

  static void dispatchCommand(
      facebook::react::UIManager &uiManager,
      const ShadowNodePtr &node,
      const std::string &command,
      const folly::dynamic &args);

  static void sendAccessibilityFocus(
      facebook::react::UIManager &uiManager,
      const ShadowNodePtr &node);
};

} // namespace solid_native::fabric::react_native

#undef SOLID_NATIVE_REACT_NATIVE_RUNTIME_VERSION
#undef SOLID_NATIVE_STRINGIFY
#undef SOLID_NATIVE_STRINGIFY_DETAIL
