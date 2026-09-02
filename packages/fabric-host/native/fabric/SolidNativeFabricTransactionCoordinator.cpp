#include "SolidNativeFabricTransactionCoordinator.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <limits>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <folly/dynamic.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/core/InstanceHandle.h>
#include <react/renderer/dom/DOM.h>
#include <react/renderer/uimanager/UIManager.h>

#include "SolidNativeFabricApi.h"

namespace solid_native::fabric::react_native {
namespace {

using Handle = int64_t;
using NodeMap = std::unordered_map<Handle, struct NodeRecord>;

constexpr int64_t HostContractVersion = 1;
constexpr double MaximumSafeInteger = 9007199254740991.0;
constexpr size_t MaximumCausalOperationIdLength = 128;
std::atomic<facebook::react::Tag> NextFabricTag{2};

struct NodeRecord {
  enum class Kind { Element, Text };

  Kind kind{Kind::Element};
  Handle handle{0};
  std::string component;
  folly::dynamic props{folly::dynamic::object};
  std::string text;
  std::vector<std::string> eventListeners;
  std::optional<Handle> parent;
  std::vector<Handle> children;

  facebook::react::Tag tag{0};
  facebook::react::InstanceHandle::Shared instanceHandle;
  std::string fabricComponent;
  folly::dynamic fabricProps{folly::dynamic::object};
  std::vector<ShadowNodePtr> fabricChildren;
  ShadowNodePtr shadowNode;
};

struct Command {
  Handle node;
  std::string name;
  folly::dynamic args;
};

std::string pathMessage(
    const std::string &path,
    const std::string &message) {
  return path + ": " + message;
}

const folly::dynamic &requireObject(
    const folly::dynamic &value,
    const std::string &path) {
  if (!value.isObject()) {
    throw std::invalid_argument(pathMessage(path, "expected an object."));
  }
  return value;
}

const folly::dynamic &requireArray(
    const folly::dynamic &value,
    const std::string &path) {
  if (!value.isArray()) {
    throw std::invalid_argument(pathMessage(path, "expected an array."));
  }
  return value;
}

const folly::dynamic &requireMember(
    const folly::dynamic &object,
    const char *name,
    const std::string &path) {
  requireObject(object, path);
  if (object.count(name) == 0) {
    throw std::invalid_argument(pathMessage(path + "." + name, "is required."));
  }
  return object.at(name);
}

std::string requireString(
    const folly::dynamic &value,
    const std::string &path) {
  if (!value.isString()) {
    throw std::invalid_argument(pathMessage(path, "expected a string."));
  }
  return value.getString();
}

int64_t requireInteger(
    const folly::dynamic &value,
    const std::string &path,
    bool positive = false) {
  if (!value.isInt() && !value.isDouble()) {
    throw std::invalid_argument(pathMessage(path, "expected an integer."));
  }

  const double number = value.asDouble();
  if (!std::isfinite(number) || std::trunc(number) != number ||
      std::abs(number) > MaximumSafeInteger || (positive && number <= 0)) {
    throw std::invalid_argument(pathMessage(
        path,
        positive ? "expected a positive safe integer."
                 : "expected a safe integer."));
  }
  return static_cast<int64_t>(number);
}

void validateCausalContext(const folly::dynamic &transaction) {
  if (transaction.count("causalContext") == 0) return;
  const auto &context = requireObject(
      transaction.at("causalContext"), "transaction.causalContext");
  const auto operationId = requireString(
      requireMember(context, "operationId", "transaction.causalContext"),
      "transaction.causalContext.operationId");
  if (operationId.empty() ||
      operationId.size() > MaximumCausalOperationIdLength ||
      operationId.find('\0') != std::string::npos) {
    throw std::invalid_argument(pathMessage(
        "transaction.causalContext.operationId",
        "expected 1-128 characters without null bytes."));
  }
}

folly::dynamic requireProps(
    const folly::dynamic &value,
    const std::string &path) {
  return requireObject(value, path);
}

NodeRecord &requireNode(NodeMap &nodes, Handle handle, const char *operation) {
  auto iterator = nodes.find(handle);
  if (iterator == nodes.end()) {
    throw std::invalid_argument(
        std::string("Cannot ") + operation + ": node " +
        std::to_string(handle) + " does not exist.");
  }
  return iterator->second;
}

NodeRecord &requireElement(
    NodeMap &nodes,
    Handle handle,
    const char *operation) {
  auto &node = requireNode(nodes, handle, operation);
  if (node.kind != NodeRecord::Kind::Element) {
    throw std::invalid_argument(
        std::string("Cannot ") + operation + ": node " +
        std::to_string(handle) + " is a text node.");
  }
  return node;
}

const NodeRecord &requireNode(
    const NodeMap &nodes,
    Handle handle,
    const char *operation) {
  auto iterator = nodes.find(handle);
  if (iterator == nodes.end()) {
    throw std::invalid_argument(
        std::string("Cannot ") + operation + ": node " +
        std::to_string(handle) + " does not exist.");
  }
  return iterator->second;
}

std::string fabricComponentFor(const NodeRecord &node, const NodeMap &nodes) {
  if (node.kind == NodeRecord::Kind::Text) {
    return "RCTRawText";
  }
  if (node.component == "RootView" || node.component == "View" ||
      node.component == "Pressable") {
    return "RCTView";
  }
  if (node.component == "Text") {
    if (node.parent.has_value()) {
      const auto &parent = requireNode(nodes, *node.parent, "resolve text parent");
      if (parent.kind == NodeRecord::Kind::Element &&
          parent.component == "Text") {
        return "RCTVirtualText";
      }
    }
    return "RCTText";
  }
  if (node.component == "Image") return "RCTImageView";
  if (node.component == "ScrollView") {
#if defined(__ANDROID__)
    const auto horizontal = node.props.find("horizontal");
    if (horizontal != node.props.items().end() && horizontal->second.isBool() &&
        horizontal->second.asBool()) {
      return "AndroidHorizontalScrollView";
    }
#endif
    return "RCTScrollView";
  }
  if (node.component == "ScrollContentView") {
#if defined(__ANDROID__)
    if (node.parent.has_value()) {
      const auto &parent = requireNode(
          nodes, *node.parent, "resolve scroll content parent");
      const auto horizontal = parent.props.find("horizontal");
      if (parent.component == "ScrollView" &&
          horizontal != parent.props.items().end() &&
          horizontal->second.isBool() && horizontal->second.asBool()) {
        return "AndroidHorizontalScrollContentView";
      }
    }
    return "RCTView";
#else
    return "RCTScrollContentView";
#endif
  }
  if (node.component == "RefreshControl") {
#if defined(__ANDROID__)
    return "AndroidSwipeRefreshLayout";
#else
    return "PullToRefreshView";
#endif
  }
  if (node.component == "TextInput") {
#if defined(__ANDROID__)
    return "AndroidTextInput";
#else
    return "RCTTextInput";
#endif
  }
  if (node.component == "ActivityIndicator") {
#if defined(__ANDROID__)
    return "AndroidProgressBar";
#else
    return "ActivityIndicatorView";
#endif
  }
  if (node.component == "Switch") {
#if defined(__ANDROID__)
    return "AndroidSwitch";
#else
    return "Switch";
#endif
  }
  if (node.component == "Modal") return "ModalHostView";
  if (node.component == "Screen") {
#if defined(__ANDROID__)
    return "RNSScreen";
#else
    const auto presentation = node.props.find("stackPresentation");
    if (presentation != node.props.items().end() &&
        presentation->second.isString() &&
        presentation->second.getString() != "push") {
      return "RNSModalScreen";
    }
    return "RNSScreen";
#endif
  }
  if (node.component == "ScreenStack") return "RNSScreenStack";
  if (node.component == "ScreenHeader") {
    return "RNSScreenStackHeaderConfig";
  }
  if (node.component == "ScreenHeaderSubview") {
    return "RNSScreenStackHeaderSubview";
  }
  if (node.component == "TabsHost") {
#if defined(__ANDROID__)
    return "RNSTabsHostAndroid";
#else
    return "RNSTabsHostIOS";
#endif
  }
  if (node.component == "TabsScreen") {
#if defined(__ANDROID__)
    return "RNSTabsScreenAndroid";
#else
    return "RNSTabsScreenIOS";
#endif
  }

  // Generated Fabric component specs use their registered native name as the
  // public component name. Built-ins above retain their Solid-to-RN aliases;
  // every other descriptor is resolved by Fabric's generated registry.
  const auto isIdentifierStart = [](char value) {
    return (value >= 'A' && value <= 'Z') ||
        (value >= 'a' && value <= 'z') || value == '_';
  };
  const auto isIdentifierPart = [&](char value) {
    return isIdentifierStart(value) || (value >= '0' && value <= '9');
  };
  if (node.component.empty() || node.component.size() > 128 ||
      !isIdentifierStart(node.component.front()) ||
      !std::all_of(
          node.component.begin() + 1,
          node.component.end(),
          isIdentifierPart)) {
    throw std::invalid_argument(
        "Generated Fabric component names must be 1-128 identifier characters.");
  }
  return node.component;
}

std::string fabricCommandFor(
    const NodeRecord &node,
    const std::string &command) {
  if (node.component == "Switch" && command == "setValue") {
#if defined(__ANDROID__)
    return "setNativeValue";
#else
    return "setValue";
#endif
  }
  return command;
}

bool acceptsRawText(const NodeRecord &node) {
  return node.kind == NodeRecord::Kind::Element && node.component == "Text";
}

folly::dynamic fabricPropsFor(const NodeRecord &node) {
  if (node.kind == NodeRecord::Kind::Text) {
    return folly::dynamic::object("text", node.text);
  }

  folly::dynamic result = folly::dynamic::object;
  for (const auto &item : node.props.items()) {
    const auto &name = item.first.asString();
    if (name == "style") {
      if (!item.second.isObject()) {
        throw std::invalid_argument("The style prop must be an object.");
      }
      for (const auto &styleItem : item.second.items()) {
        result[styleItem.first] = styleItem.second;
      }
    } else {
      result[item.first] = item.second;
    }
  }
  if (node.component == "RootView" && result.find("flex") == result.items().end()) {
    result["flex"] = 1.0;
  }
  for (const auto &event : node.eventListeners) {
    if (event == "accessibilityAction") {
      result["onAccessibilityAction"] = true;
    }
    if (event == "accessibilityEscape") {
      result["onAccessibilityEscape"] = true;
    }
    if (event == "accessibilityTap") {
      result["onAccessibilityTap"] = true;
    }
    if (event == "magicTap") {
      result["onAccessibilityMagicTap"] = true;
    }
  }
  if (node.component == "View" || node.component == "Pressable" ||
      node.component == "RNCSafeAreaProvider" ||
      node.component == "RNCSafeAreaView") {
    for (const auto &event : node.eventListeners) {
      if (event == "layout") result["onLayout"] = true;
    }
  }
  if (node.component == "RNCSafeAreaProvider") {
    for (const auto &event : node.eventListeners) {
      if (event == "insetsChange") result["onInsetsChange"] = true;
    }
  }
  if (node.component == "Pressable" || node.component == "Text") {
    for (const auto &event : node.eventListeners) {
      if (event == "press") {
        result["onClick"] = true;
        result["onTouchEnd"] = true;
      }
      if (event == "pressIn") {
        result["onPointerDown"] = true;
        result["onTouchStart"] = true;
      }
      if (event == "pressMove") {
        result["onPointerMove"] = true;
        result["onTouchMove"] = true;
      }
      if (event == "pressOut") {
        result["onPointerUp"] = true;
        result["onTouchEnd"] = true;
      }
      if (event == "pressCancel") {
        result["onTouchCancel"] = true;
        result["onPointerCancel"] = true;
      }
      if (node.component == "Pressable" && event == "focus") {
        result["onFocus"] = true;
      }
      if (node.component == "Pressable" && event == "blur") {
        result["onBlur"] = true;
      }
      if (node.component == "Pressable" && event == "hoverIn") {
        result["onPointerEnter"] = true;
      }
      if (node.component == "Pressable" && event == "hoverOut") {
        result["onPointerLeave"] = true;
      }
    }
  }
  if (node.component == "TextInput") {
    for (const auto &event : node.eventListeners) {
      if (event == "contentSizeChange") result["onContentSizeChange"] = true;
      if (event == "scroll") result["onScroll"] = true;
#if defined(__ANDROID__)
      if (event == "keyPress") result["onKeyPress"] = true;
#endif
      if (event == "selectionChange") result["onSelectionChange"] = true;
    }
  }
#if defined(__ANDROID__)
  if (node.component == "ActivityIndicator") {
    // Android's ProgressBar chooses its platform style in the view
    // constructor and refuses to mount until styleAttr is supplied. Keep this
    // React Native backend detail out of the framework-neutral public props.
    result["styleAttr"] = "Normal";
    result["indeterminate"] = true;
  }
#endif
  if (node.component == "Switch") {
#if defined(__ANDROID__)
    const bool disabled = result.count("disabled") != 0 &&
        result["disabled"].isBool() && result["disabled"].getBool();
    const bool value = result.count("value") != 0 &&
        result["value"].isBool() && result["value"].getBool();
    result["enabled"] = !disabled;
    result["on"] = value;
    if (result.count("thumbColor") != 0) {
      result["thumbTintColor"] = result["thumbColor"];
    }
    if (result.count("trackColorForFalse") != 0 ||
        result.count("trackColorForTrue") != 0) {
      const char *name = value ? "trackColorForTrue" : "trackColorForFalse";
      if (result.count(name) != 0) result["trackTintColor"] = result[name];
    }
#else
    if (result.count("thumbColor") != 0) {
      result["thumbTintColor"] = result["thumbColor"];
    }
    if (result.count("trackColorForFalse") != 0) {
      result["tintColor"] = result["trackColorForFalse"];
    }
    if (result.count("trackColorForTrue") != 0) {
      result["onTintColor"] = result["trackColorForTrue"];
    }
    if (result.count("iosBackgroundColor") != 0) {
      result["backgroundColor"] = result["iosBackgroundColor"];
      if (result.count("borderRadius") == 0) result["borderRadius"] = 16;
    }
#endif
    result.erase("iosBackgroundColor");
    for (const auto &event : node.eventListeners) {
      if (event == "valueChange") result["onChange"] = true;
    }
  }
  if (node.component == "RefreshControl") {
    for (const auto &event : node.eventListeners) {
      if (event == "refresh") result["onRefresh"] = true;
    }
  }
  if (node.component == "Modal") {
    for (const auto &event : node.eventListeners) {
      if (event == "dismiss") result["onDismiss"] = true;
      if (event == "orientationChange") {
        result["onOrientationChange"] = true;
      }
      if (event == "requestClose") result["onRequestClose"] = true;
      if (event == "show") result["onShow"] = true;
    }
  }
  if (node.component == "Screen") {
    for (const auto &event : node.eventListeners) {
      if (event == "focus") result["onAppear"] = true;
      if (event == "blur") result["onDisappear"] = true;
      if (event == "dismiss") result["onDismissed"] = true;
      if (event == "gestureCancel") result["onGestureCancel"] = true;
      if (event == "nativeDismissCancel") {
        result["onNativeDismissCancelled"] = true;
      }
      if (event == "sheetDetentChange") {
        result["onSheetDetentChanged"] = true;
      }
    }
  }
  if (node.component == "ScreenStack") {
    for (const auto &event : node.eventListeners) {
      if (event == "transitionEnd") result["onFinishTransitioning"] = true;
    }
  }
  if (node.component == "ScreenHeader") {
    for (const auto &event : node.eventListeners) {
      if (event == "pressHeaderBarButtonItem") {
        result["onPressHeaderBarButtonItem"] = true;
      }
      if (event == "pressHeaderBarButtonMenuItem") {
        result["onPressHeaderBarButtonMenuItem"] = true;
      }
    }
  }
  if (node.component == "TabsHost") {
    for (const auto &event : node.eventListeners) {
      if (event == "tabSelected") result["onTabSelected"] = true;
      if (event == "tabSelectionRejected") {
        result["onTabSelectionRejected"] = true;
      }
      if (event == "tabSelectionPrevented") {
        result["onTabSelectionPrevented"] = true;
      }
      if (event == "moreTabSelected") result["onMoreTabSelected"] = true;
    }
  }
  if (node.component == "TabsScreen") {
    for (const auto &event : node.eventListeners) {
      if (event == "willAppear") result["onWillAppear"] = true;
      if (event == "didAppear") result["onDidAppear"] = true;
      if (event == "willDisappear") result["onWillDisappear"] = true;
      if (event == "didDisappear") result["onDidDisappear"] = true;
    }
  }
  return result;
}

bool supportsEvent(const NodeRecord &node, const std::string &event) {
  if (node.kind == NodeRecord::Kind::Element &&
      (event == "accessibilityAction" || event == "accessibilityEscape" ||
       event == "accessibilityTap" || event == "magicTap")) {
    return true;
  }
  if (node.component == "View" || node.component == "RNCSafeAreaView") {
    return event == "layout";
  }
  if (node.component == "RNCSafeAreaProvider") {
    return event == "insetsChange" || event == "layout";
  }
  if (node.component == "Text") return event == "press";
  if (node.component == "Image") return event == "error" || event == "load";
  if (node.component == "Pressable") {
    return event == "blur" || event == "focus" || event == "layout" ||
        event == "hoverIn" || event == "hoverOut" ||
        event == "longPress" || event == "press" ||
        event == "pressCancel" || event == "pressIn" ||
        event == "pressMove" || event == "pressOut";
  }
  if (node.component == "ScrollView") {
    return event == "scroll" || event == "scrollBeginDrag" ||
        event == "scrollEndDrag";
  }
  if (node.component == "RefreshControl") return event == "refresh";
  if (node.component == "TextInput") {
    return event == "blur" || event == "changeText" ||
        event == "contentSizeChange" || event == "endEditing" ||
        event == "focus" || event == "keyPress" || event == "scroll" ||
        event == "selectionChange" || event == "submitEditing";
  }
  if (node.component == "Switch") return event == "valueChange";
  if (node.component == "Modal") {
    return event == "dismiss" || event == "orientationChange" ||
        event == "requestClose" || event == "show";
  }
  if (node.component == "Screen") {
    return event == "blur" || event == "dismiss" || event == "focus" ||
        event == "gestureCancel" || event == "nativeDismissCancel" ||
        event == "sheetDetentChange";
  }
  if (node.component == "ScreenStack") return event == "transitionEnd";
  if (node.component == "ScreenHeader") {
    return event == "pressHeaderBarButtonItem" ||
        event == "pressHeaderBarButtonMenuItem";
  }
  if (node.component == "TabsHost") {
    return event == "tabSelected" || event == "tabSelectionRejected" ||
        event == "tabSelectionPrevented" || event == "moreTabSelected";
  }
  if (node.component == "TabsScreen") {
    return event == "willAppear" || event == "didAppear" ||
        event == "willDisappear" || event == "didDisappear";
  }
  return false;
}

folly::dynamic propsPatch(
    const folly::dynamic &previous,
    const folly::dynamic &next) {
  folly::dynamic patch = folly::dynamic::object;
  for (const auto &item : previous.items()) {
    if (next.find(item.first) == next.items().end()) {
      patch[item.first] = nullptr;
    }
  }
  for (const auto &item : next.items()) {
    const auto previousItem = previous.find(item.first);
    if (previousItem == previous.items().end() ||
        previousItem->second != item.second) {
      patch[item.first] = item.second;
    }
  }
  return patch;
}

facebook::react::Tag nextFabricTag() {
  return NextFabricTag.fetch_add(2, std::memory_order_relaxed);
}

bool sameChildren(
    const std::vector<ShadowNodePtr> &left,
    const std::vector<ShadowNodePtr> &right) {
  if (left.size() != right.size()) return false;
  return std::equal(left.begin(), left.end(), right.begin());
}

ShadowNodePtr materializeNode(
    Handle handle,
    NodeMap &nodes,
    facebook::react::UIManager &uiManager,
    facebook::react::SurfaceId surfaceId,
    facebook::jsi::Runtime *runtime,
    const NativeResourceResolver *resourceResolver,
    std::unordered_set<Handle> &visiting) {
  auto &node = requireNode(nodes, handle, "materialize node");
  if (!visiting.insert(handle).second) {
    throw std::invalid_argument("The staged native tree contains a cycle.");
  }

  std::vector<ShadowNodePtr> children;
  children.reserve(node.children.size());
  for (const auto child : node.children) {
    children.push_back(
        materializeNode(
            child,
            nodes,
            uiManager,
            surfaceId,
            runtime,
            resourceResolver,
            visiting));
  }
  visiting.erase(handle);

  const auto component = fabricComponentFor(node, nodes);
  const auto nextProps = fabricPropsFor(node);
  const bool mustCreate =
      !node.shadowNode || node.fabricComponent != component;

  if (mustCreate) {
    if (node.tag == 0) node.tag = nextFabricTag();
    auto shadowNode = FabricApi::createNode(
        uiManager,
        node.tag,
        component,
        surfaceId,
        nextProps,
        node.instanceHandle,
        runtime,
        resourceResolver);
    for (const auto &child : children) {
      FabricApi::appendChild(uiManager, shadowNode, child);
    }
    node.shadowNode = std::move(shadowNode);
  } else {
    const bool childrenChanged = !sameChildren(node.fabricChildren, children);
    const bool propsChanged = node.fabricProps != nextProps;
    if (childrenChanged || propsChanged) {
      std::shared_ptr<const ShadowNodeList> nextChildren;
      if (childrenChanged) {
        nextChildren = std::make_shared<const ShadowNodeList>(children);
      }
      node.shadowNode = FabricApi::cloneNode(
          uiManager,
          *node.shadowNode,
          std::move(nextChildren),
          propsChanged ? propsPatch(node.fabricProps, nextProps)
                       : folly::dynamic::object(),
          runtime,
          resourceResolver);
    }
  }

  node.fabricComponent = component;
  node.fabricProps = nextProps;
  node.fabricChildren = std::move(children);
  return node.shadowNode;
}

bool isMounted(const NodeRecord &node, const NodeMap &nodes) {
  const NodeRecord *current = &node;
  std::unordered_set<Handle> seen;
  while (true) {
    if (!seen.insert(current->handle).second) return false;
    if (!current->parent.has_value()) {
      return current->kind == NodeRecord::Kind::Element &&
          current->component == "RootView";
    }
    auto iterator = nodes.find(*current->parent);
    if (iterator == nodes.end()) return false;
    current = &iterator->second;
  }
}

} // namespace

class TransactionCoordinator::Impl {
 public:
  explicit Impl(facebook::react::SurfaceId surfaceId) : surfaceId_(surfaceId) {}

  int64_t apply(
      facebook::react::UIManager &uiManager,
      const folly::dynamic &transaction,
      facebook::jsi::Runtime *runtime,
      const NodeIdentityMap &nodeIdentities,
      const NativeResourceResolver *resourceResolver,
      bool requireNodeIdentities) {
    std::lock_guard lock(mutex_);
    if (transaction.isNull()) {
      throw std::invalid_argument("The host transaction is required.");
    }
    requireObject(transaction, "transaction");

    const auto contractVersion = requireInteger(
        requireMember(transaction, "contractVersion", "transaction"),
        "transaction.contractVersion");
    if (contractVersion != HostContractVersion) {
      throw std::invalid_argument(
          "Unsupported host contract version " +
          std::to_string(contractVersion) + "; expected " +
          std::to_string(HostContractVersion) + ".");
    }
    const auto surface = requireInteger(
        requireMember(transaction, "surface", "transaction"),
        "transaction.surface",
        true);
    if (surface != surfaceId_) {
      throw std::invalid_argument(
          "Transaction targets surface " + std::to_string(surface) +
          ", but this coordinator owns surface " +
          std::to_string(surfaceId_) + ".");
    }
    const auto sequence = requireInteger(
        requireMember(transaction, "sequence", "transaction"),
        "transaction.sequence",
        true);
    if (sequence <= sequence_) {
      throw std::invalid_argument(
          "Commit sequence " + std::to_string(sequence) +
          " must be greater than " + std::to_string(sequence_) + ".");
    }

    const auto priority = requireString(
        requireMember(transaction, "priority", "transaction"),
        "transaction.priority");
    if (priority != "immediate" && priority != "user-blocking" &&
        priority != "normal" && priority != "background") {
      throw std::invalid_argument("Unknown commit priority: " + priority + ".");
    }
    validateCausalContext(transaction);

    NodeMap staged = nodes_;
    std::vector<Command> commands;
    const auto &mutations = requireArray(
        requireMember(transaction, "mutations", "transaction"),
        "transaction.mutations");
    size_t index = 0;
    for (const auto &value : mutations) {
      const auto path =
          "transaction.mutations[" + std::to_string(index++) + "]";
      const auto &mutation = requireObject(value, path);
      const auto type = requireString(
          requireMember(mutation, "type", path), path + ".type");
      applyMutation(
          staged,
          commands,
          mutation,
          type,
          path,
          nodeIdentities,
          requireNodeIdentities);
    }

    if (!commands.empty()) {
      if (commands.size() != 1 || mutations.size() != 1) {
        throw std::invalid_argument(
            "A native command must be the only mutation in its transaction.");
      }
      auto &node = requireElement(staged, commands[0].node, "dispatch command");
      if (!node.shadowNode || !isMounted(node, staged)) {
        throw std::invalid_argument(
            "Cannot dispatch a command to an unmounted node.");
      }
      if (commands[0].name == "accessibilityFocus") {
        if (!commands[0].args.empty()) {
          throw std::invalid_argument(
              "The accessibilityFocus command does not accept arguments.");
        }
        FabricApi::sendAccessibilityFocus(uiManager, node.shadowNode);
      } else {
        FabricApi::dispatchCommand(
            uiManager,
            node.shadowNode,
            fabricCommandFor(node, commands[0].name),
            commands[0].args);
      }
      sequence_ = sequence;
      return sequence_;
    }

    std::vector<Handle> roots;
    for (const auto &[handle, node] : staged) {
      if (node.kind == NodeRecord::Kind::Element &&
          node.component == "RootView" && !node.parent.has_value()) {
        roots.push_back(handle);
      }
    }
    if (roots.size() > 1) {
      throw std::invalid_argument(
          "A Fabric surface cannot contain multiple RootView nodes.");
    }

    auto rootChildren = std::make_shared<ShadowNodeList>();
    if (!roots.empty()) {
      std::unordered_set<Handle> visiting;
      rootChildren->push_back(materializeNode(
          roots.front(),
          staged,
          uiManager,
          surfaceId_,
          runtime,
          resourceResolver,
          visiting));
    }
    FabricApi::completeSurface(uiManager, surfaceId_, rootChildren);
    const auto fabricRevision =
        FabricApi::currentRevisionNumber(uiManager, surfaceId_);

    nodes_ = std::move(staged);
    sequence_ = sequence;
    fabricRevision_ = fabricRevision;
    return sequence_;
  }

  NodeMeasurement measure(
      facebook::react::UIManager &uiManager,
      int64_t handle,
      int64_t afterSequence) {
    std::lock_guard lock(mutex_);
    if (handle <= 0) {
      throw std::invalid_argument(
          "A measured node must be a positive safe integer.");
    }
    if (afterSequence < 0) {
      throw std::invalid_argument(
          "A measurement sequence must be a non-negative safe integer.");
    }
    if (afterSequence > sequence_) {
      throw std::invalid_argument(
          "Measurement requires sequence " + std::to_string(afterSequence) +
          ", but the latest committed sequence is " +
          std::to_string(sequence_) + ".");
    }

    auto &node = requireElement(nodes_, handle, "measure");
    if (!node.shadowNode || !isMounted(node, nodes_)) {
      throw std::invalid_argument("Cannot measure an unmounted node.");
    }
    auto currentRevision =
        uiManager.getShadowTreeRevisionProvider()->getCurrentRevision(
            surfaceId_);
    if (!currentRevision) {
      throw std::runtime_error(
          "Fabric does not have a current revision for this surface.");
    }
    const auto rect = facebook::react::dom::measure(
        currentRevision, *node.shadowNode);
    return NodeMeasurement{
        .x = rect.x,
        .y = rect.y,
        .width = rect.width,
        .height = rect.height,
        .pageX = rect.pageX,
        .pageY = rect.pageY,
        .observedSequence = sequence_};
  }

  void reset() {
    std::lock_guard lock(mutex_);
    nodes_.clear();
    sequence_ = 0;
    fabricRevision_ = 0;
  }

  int64_t lastSequence() const {
    std::lock_guard lock(mutex_);
    return sequence_;
  }

  int64_t lastFabricRevision() const {
    std::lock_guard lock(mutex_);
    return fabricRevision_;
  }

  bool empty() const {
    std::lock_guard lock(mutex_);
    return nodes_.empty();
  }

 private:
  static void applyMutation(
      NodeMap &nodes,
      std::vector<Command> &commands,
      const folly::dynamic &mutation,
      const std::string &type,
      const std::string &path,
      const NodeIdentityMap &nodeIdentities,
      bool requireNodeIdentities) {
    const auto memberPath = path + ".node";
    if (type == "create-element") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      if (nodes.contains(handle)) {
        throw std::invalid_argument(
            "Node " + std::to_string(handle) + " already exists.");
      }
      const auto component = requireString(
          requireMember(mutation, "component", path), path + ".component");
      NodeRecord node;
      node.kind = NodeRecord::Kind::Element;
      node.handle = handle;
      node.component = component;
      node.props = requireProps(
          requireMember(mutation, "props", path), path + ".props");
      // Resolve eagerly so unsupported public components fail before any
      // Fabric shadow node is created.
      (void)fabricComponentFor(node, nodes);
      const auto identity = nodeIdentities.find(handle);
      if (identity != nodeIdentities.end()) {
        if (identity->second.tag <= 0 || !identity->second.instanceHandle) {
          throw std::invalid_argument(
              "Node " + std::to_string(handle) +
              " has an invalid Fabric instance identity.");
        }
        node.tag = identity->second.tag;
        node.instanceHandle = identity->second.instanceHandle;
      } else if (requireNodeIdentities) {
        throw std::invalid_argument(
            "Node " + std::to_string(handle) +
            " is missing its Fabric instance identity.");
      }
      nodes.emplace(handle, std::move(node));
      return;
    }
    if (type == "create-text") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      if (nodes.contains(handle)) {
        throw std::invalid_argument(
            "Node " + std::to_string(handle) + " already exists.");
      }
      NodeRecord node;
      node.kind = NodeRecord::Kind::Text;
      node.handle = handle;
      node.text = requireString(
          requireMember(mutation, "text", path), path + ".text");
      const auto identity = nodeIdentities.find(handle);
      if (identity != nodeIdentities.end()) {
        if (identity->second.tag <= 0 || !identity->second.instanceHandle) {
          throw std::invalid_argument(
              "Node " + std::to_string(handle) +
              " has an invalid Fabric instance identity.");
        }
        node.tag = identity->second.tag;
        node.instanceHandle = identity->second.instanceHandle;
      } else if (requireNodeIdentities) {
        throw std::invalid_argument(
            "Node " + std::to_string(handle) +
            " is missing its Fabric instance identity.");
      }
      nodes.emplace(handle, std::move(node));
      return;
    }
    if (type == "update-props") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      auto &node = requireElement(nodes, handle, "update props");
      auto props = requireProps(
          requireMember(mutation, "props", path), path + ".props");
      const auto &removed = requireArray(
          requireMember(mutation, "removedProps", path),
          path + ".removedProps");
      size_t removedIndex = 0;
      for (const auto &value : removed) {
        const auto name = requireString(
            value,
            path + ".removedProps[" +
                std::to_string(removedIndex++) + "]");
        node.props.erase(name);
      }
      for (const auto &item : props.items()) {
        node.props[item.first] = item.second;
      }
      return;
    }
    if (type == "update-text") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      auto &node = requireNode(nodes, handle, "update text");
      if (node.kind != NodeRecord::Kind::Text) {
        throw std::invalid_argument(
            "Cannot update text on an element node.");
      }
      node.text = requireString(
          requireMember(mutation, "text", path), path + ".text");
      return;
    }
    if (type == "update-event-listeners") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      auto &node = requireElement(nodes, handle, "update event listeners");
      const auto &events = requireArray(
          requireMember(mutation, "events", path), path + ".events");
      std::vector<std::string> nextEvents;
      nextEvents.reserve(events.size());
      std::string previous;
      size_t eventIndex = 0;
      for (const auto &value : events) {
        const auto event = requireString(
            value,
            path + ".events[" + std::to_string(eventIndex++) + "]");
        if (event.empty()) {
          throw std::invalid_argument("Event listener names cannot be empty.");
        }
        if (!previous.empty() && event <= previous) {
          throw std::invalid_argument(
              "Event listener names must be sorted and unique.");
        }
        if (!supportsEvent(node, event)) {
          throw std::invalid_argument(
              "Component " + node.component + " does not define event " +
              event + ".");
        }
        nextEvents.push_back(event);
        previous = event;
      }
      node.eventListeners = std::move(nextEvents);
      return;
    }
    if (type == "insert-child") {
      const auto parentHandle = requireInteger(
          requireMember(mutation, "parent", path), path + ".parent", true);
      const auto childHandle = requireInteger(
          requireMember(mutation, "child", path), path + ".child", true);
      auto &parent = requireElement(nodes, parentHandle, "insert child");
      auto &child = requireNode(nodes, childHandle, "insert child");
      if (parentHandle == childHandle) {
        throw std::invalid_argument("A node cannot be its own parent.");
      }
      for (const NodeRecord *ancestor = &parent; ancestor != nullptr;) {
        if (ancestor->handle == childHandle) {
          throw std::invalid_argument(
              "The child insertion would create a cycle.");
        }
        ancestor = ancestor->parent.has_value()
            ? &requireNode(nodes, *ancestor->parent, "resolve ancestor")
            : nullptr;
      }
      if (child.kind == NodeRecord::Kind::Text && !acceptsRawText(parent)) {
        throw std::invalid_argument(
            "Raw text children are only valid inside Text.");
      }
      if (child.kind == NodeRecord::Kind::Element &&
          child.component == "RootView") {
        throw std::invalid_argument("RootView cannot be inserted into a node.");
      }

      size_t beforeIndex = parent.children.size();
      if (mutation.count("before") != 0) {
        const auto before = requireInteger(
            mutation.at("before"), path + ".before", true);
        auto iterator =
            std::find(parent.children.begin(), parent.children.end(), before);
        if (iterator == parent.children.end()) {
          throw std::invalid_argument(
              "The before-node is not a child of the requested parent.");
        }
        beforeIndex = static_cast<size_t>(iterator - parent.children.begin());
      }

      if (child.parent.has_value()) {
        auto &oldParent =
            requireElement(nodes, *child.parent, "move child from parent");
        auto iterator = std::find(
            oldParent.children.begin(), oldParent.children.end(), childHandle);
        if (iterator == oldParent.children.end()) {
          throw std::invalid_argument("The child has inconsistent parent state.");
        }
        const auto oldIndex =
            static_cast<size_t>(iterator - oldParent.children.begin());
        oldParent.children.erase(iterator);
        if (oldParent.handle == parent.handle && oldIndex < beforeIndex) {
          beforeIndex--;
        }
      }
      parent.children.insert(parent.children.begin() + beforeIndex, childHandle);
      child.parent = parentHandle;
      return;
    }
    if (type == "remove-child") {
      const auto parentHandle = requireInteger(
          requireMember(mutation, "parent", path), path + ".parent", true);
      const auto childHandle = requireInteger(
          requireMember(mutation, "child", path), path + ".child", true);
      auto &parent = requireElement(nodes, parentHandle, "remove child");
      auto &child = requireNode(nodes, childHandle, "remove child");
      auto iterator =
          std::find(parent.children.begin(), parent.children.end(), childHandle);
      if (iterator == parent.children.end() || child.parent != parentHandle) {
        throw std::invalid_argument(
            "The requested node is not a child of the requested parent.");
      }
      parent.children.erase(iterator);
      child.parent.reset();
      return;
    }
    if (type == "delete-node") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      auto &node = requireNode(nodes, handle, "delete node");
      if (node.parent.has_value() || !node.children.empty()) {
        throw std::invalid_argument(
            "A node must be detached and childless before deletion.");
      }
      nodes.erase(handle);
      return;
    }
    if (type == "command") {
      const auto handle = requireInteger(
          requireMember(mutation, "node", path), memberPath, true);
      (void)requireElement(nodes, handle, "dispatch command");
      commands.push_back({
          .node = handle,
          .name = requireString(
              requireMember(mutation, "command", path), path + ".command"),
          .args = requireArray(
              requireMember(mutation, "args", path), path + ".args"),
      });
      return;
    }

    throw std::invalid_argument("Unknown host mutation type: " + type + ".");
  }

  const facebook::react::SurfaceId surfaceId_;
  mutable std::mutex mutex_;
  int64_t sequence_{0};
  int64_t fabricRevision_{0};
  NodeMap nodes_;
};

TransactionCoordinator::TransactionCoordinator(int32_t surfaceId)
    : impl_(std::make_unique<Impl>(surfaceId)) {}

TransactionCoordinator::~TransactionCoordinator() = default;

int64_t TransactionCoordinator::apply(
    facebook::react::UIManager &uiManager,
    const folly::dynamic &transaction) {
  return impl_->apply(uiManager, transaction, nullptr, {}, nullptr, false);
}

int64_t TransactionCoordinator::apply(
    facebook::react::UIManager &uiManager,
    const folly::dynamic &transaction,
    facebook::jsi::Runtime &runtime,
    const NodeIdentityMap &nodeIdentities,
    const NativeResourceResolver &resourceResolver) {
  return impl_->apply(
      uiManager,
      transaction,
      &runtime,
      nodeIdentities,
      &resourceResolver,
      true);
}

NodeMeasurement TransactionCoordinator::measure(
    facebook::react::UIManager &uiManager,
    int64_t node,
    int64_t afterSequence) {
  return impl_->measure(uiManager, node, afterSequence);
}

facebook::react::Tag TransactionCoordinator::allocateFabricTag() {
  return nextFabricTag();
}

bool TransactionCoordinator::empty() const {
  return impl_->empty();
}

int64_t TransactionCoordinator::lastFabricRevision() const {
  return impl_->lastFabricRevision();
}

int64_t TransactionCoordinator::lastSequence() const {
  return impl_->lastSequence();
}

void TransactionCoordinator::reset() {
  impl_->reset();
}

} // namespace solid_native::fabric::react_native
