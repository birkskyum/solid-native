#include "SolidNativeFabricApi.h"

#include <cmath>
#include <stdexcept>

#include <jsi/JSIDynamic.h>
#include <react/renderer/core/InstanceHandle.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/mounting/ShadowTree.h>
#include <react/renderer/uimanager/UIManager.h>

namespace solid_native::fabric::react_native {
namespace {

constexpr char NativeResourceReferenceKey[] = "__solidNativeResource";

const folly::dynamic *nativeResourcePayload(const folly::dynamic &value) {
  if (!value.isObject() || value.size() != 1 ||
      value.count(NativeResourceReferenceKey) == 0) {
    return nullptr;
  }
  const auto &payload = value.at(NativeResourceReferenceKey);
  if (!payload.isObject() || payload.size() != 2 ||
      payload.count("handle") == 0 || payload.count("kind") == 0) {
    throw std::invalid_argument(
        "A native resource reference has an invalid transport shape.");
  }
  return &payload;
}

facebook::jsi::Value rawPropsValue(
    facebook::jsi::Runtime &runtime,
    const folly::dynamic &props,
    const NativeResourceResolver *resourceResolver) {
  if (!props.isObject()) {
    throw std::invalid_argument("Fabric props must be an object.");
  }
  facebook::jsi::Object result(runtime);
  for (const auto &item : props.items()) {
    const auto name = item.first.asString();
    const auto *resource = nativeResourcePayload(item.second);
    if (resource == nullptr) {
      result.setProperty(
          runtime,
          name.c_str(),
          facebook::jsi::valueFromDynamic(runtime, item.second));
      continue;
    }
    if (resourceResolver == nullptr) {
      throw std::invalid_argument(
          "Native resource props require an owning JSI runtime registry.");
    }
    const auto &handleValue = resource->at("handle");
    const auto &kindValue = resource->at("kind");
    if ((!handleValue.isInt() && !handleValue.isDouble()) ||
        !kindValue.isString()) {
      throw std::invalid_argument(
          "A native resource reference has an invalid handle or kind.");
    }
    const auto handleNumber = handleValue.asDouble();
    if (!std::isfinite(handleNumber) ||
        std::trunc(handleNumber) != handleNumber || handleNumber <= 0 ||
        handleNumber > 9007199254740991.0) {
      throw std::invalid_argument(
          "A native resource reference handle must be a positive safe integer.");
    }
    result.setProperty(
        runtime,
        name.c_str(),
        (*resourceResolver)(
            runtime,
            static_cast<int64_t>(handleNumber),
            kindValue.getString()));
  }
  return result;
}

} // namespace

ShadowNodePtr FabricApi::createNode(
    facebook::react::UIManager &uiManager,
    facebook::react::Tag tag,
    const std::string &componentName,
    facebook::react::SurfaceId surfaceId,
    const folly::dynamic &props,
    std::shared_ptr<const facebook::react::InstanceHandle> instanceHandle,
    facebook::jsi::Runtime *runtime,
    const NativeResourceResolver *resourceResolver) {
  if (runtime != nullptr) {
    auto value = rawPropsValue(*runtime, props, resourceResolver);
    return uiManager.createNode(
        tag,
        componentName,
        surfaceId,
        facebook::react::RawProps{*runtime, value},
        std::move(instanceHandle));
  }

  // The native-only feasibility harness deliberately has no JavaScript
  // runtime. Keep RN's legacy dynamic mode isolated to that diagnostic path;
  // all application commits provide their owning JSI runtime above.
  return uiManager.createNode(
      tag,
      componentName,
      surfaceId,
      facebook::react::RawProps{props},
      std::move(instanceHandle));
}

ShadowNodePtr FabricApi::cloneNode(
    facebook::react::UIManager &uiManager,
    const ShadowNode &node,
    std::shared_ptr<const ShadowNodeList> children,
    const folly::dynamic &props,
    facebook::jsi::Runtime *runtime,
    const NativeResourceResolver *resourceResolver) {
  // Stateful Fabric views (notably TextInput and ScrollView) can advance their
  // ShadowNode state from the native mounting thread between Solid commits.
  // The coordinator deliberately retains immutable nodes for its own tree,
  // so rebase every application clone onto the newest mounted member of the
  // same family before changing props or children. Otherwise a controlled
  // update can fork from an obsolete TextInput event count and Fabric will
  // correctly reject the following setTextAndSelection command as stale.
  const auto newestNode = uiManager.getNewestCloneOfShadowNode(node);
  const auto &sourceNode = newestNode ? *newestNode : node;
  if (runtime != nullptr) {
    auto value = rawPropsValue(*runtime, props, resourceResolver);
    return uiManager.cloneNode(
        sourceNode,
        std::move(children),
        facebook::react::RawProps{*runtime, value});
  }

  return uiManager.cloneNode(
      sourceNode,
      std::move(children),
      facebook::react::RawProps{props});
}

void FabricApi::appendChild(
    facebook::react::UIManager &uiManager,
    const ShadowNodePtr &parent,
    const ShadowNodePtr &child) {
  uiManager.appendChild(parent, child);
}

void FabricApi::completeSurface(
    facebook::react::UIManager &uiManager,
    facebook::react::SurfaceId surfaceId,
    std::shared_ptr<ShadowNodeList> rootChildren) {
  uiManager.completeSurface(
      surfaceId,
      std::move(rootChildren),
      {
          .enableStateReconciliation = true,
          .mountSynchronously = true,
          .source = facebook::react::ShadowTree::CommitSource::Unknown,
      });
}

int64_t FabricApi::currentRevisionNumber(
    facebook::react::UIManager &uiManager,
    facebook::react::SurfaceId surfaceId) {
  int64_t revision = 0;
  const auto found = uiManager.getShadowTreeRegistry().visit(
      surfaceId, [&revision](const facebook::react::ShadowTree &shadowTree) {
        revision = shadowTree.getCurrentRevision().number;
      });
  if (!found) {
    throw std::runtime_error(
        "Fabric did not expose the committed surface revision.");
  }
  return revision;
}

void FabricApi::dispatchCommand(
    facebook::react::UIManager &uiManager,
    const ShadowNodePtr &node,
    const std::string &command,
    const folly::dynamic &args) {
  const auto newestNode = uiManager.getNewestCloneOfShadowNode(*node);
  uiManager.dispatchCommand(newestNode ? newestNode : node, command, args);
}

void FabricApi::sendAccessibilityFocus(
    facebook::react::UIManager &uiManager,
    const ShadowNodePtr &node) {
  const auto newestNode = uiManager.getNewestCloneOfShadowNode(*node);
  uiManager.sendAccessibilityEvent(newestNode ? newestNode : node, "focus");
}

} // namespace solid_native::fabric::react_native
