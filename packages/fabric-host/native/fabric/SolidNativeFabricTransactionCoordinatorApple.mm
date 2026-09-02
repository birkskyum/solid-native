#include "SolidNativeFabricTransactionCoordinator.h"

#import <Foundation/Foundation.h>

#include <cmath>
#include <stdexcept>
#include <string>

namespace solid_native::fabric::react_native {
namespace {

constexpr double MaximumSafeInteger = 9007199254740991.0;

std::string utf8(NSString *value) {
  const char *characters = value.UTF8String;
  if (characters == nullptr) {
    throw std::invalid_argument("A transaction string is not valid UTF-8.");
  }
  return characters;
}

std::string pathMessage(NSString *path, NSString *message) {
  return utf8([NSString stringWithFormat:@"%@: %@", path, message]);
}

folly::dynamic dynamicFromObject(id value, NSString *path) {
  if (value == nil || value == NSNull.null) return nullptr;
  if ([value isKindOfClass:NSString.class]) {
    return utf8((NSString *)value);
  }
  if ([value isKindOfClass:NSNumber.class]) {
    if (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) {
      return [(NSNumber *)value boolValue] == YES;
    }
    const double number = [(NSNumber *)value doubleValue];
    if (!std::isfinite(number)) {
      throw std::invalid_argument(
          pathMessage(path, @"numbers must be finite."));
    }
    if (std::trunc(number) == number &&
        std::abs(number) <= MaximumSafeInteger) {
      return static_cast<int64_t>(number);
    }
    return number;
  }
  if ([value isKindOfClass:NSArray.class]) {
    folly::dynamic result = folly::dynamic::array;
    NSUInteger index = 0;
    for (id child in (NSArray *)value) {
      result.push_back(dynamicFromObject(
          child,
          [path stringByAppendingFormat:@"[%lu]", (unsigned long)index++]));
    }
    return result;
  }
  if ([value isKindOfClass:NSDictionary.class]) {
    folly::dynamic result = folly::dynamic::object;
    for (id key in (NSDictionary *)value) {
      if (![key isKindOfClass:NSString.class]) {
        throw std::invalid_argument(
            pathMessage(path, @"object keys must be strings."));
      }
      NSString *name = (NSString *)key;
      result[utf8(name)] = dynamicFromObject(
          [(NSDictionary *)value objectForKey:key],
          [path stringByAppendingFormat:@".%@", name]);
    }
    return result;
  }
  throw std::invalid_argument(
      pathMessage(path, @"contains a non-transport-safe value."));
}

} // namespace

int64_t TransactionCoordinator::apply(
    facebook::react::UIManager &uiManager,
    NSDictionary<NSString *, id> *transaction) {
  return apply(
      uiManager, dynamicFromObject(transaction, @"transaction"));
}

int64_t TransactionCoordinator::apply(
    facebook::react::UIManager &uiManager,
    NSDictionary<NSString *, id> *transaction,
    facebook::jsi::Runtime &runtime,
    const NodeIdentityMap &nodeIdentities,
    const NativeResourceResolver &resourceResolver) {
  return apply(
      uiManager,
      dynamicFromObject(transaction, @"transaction"),
      runtime,
      nodeIdentities,
      resourceResolver);
}

} // namespace solid_native::fabric::react_native
