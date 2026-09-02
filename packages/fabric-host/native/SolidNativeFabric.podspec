require "json"

boundary = JSON.parse(
  File.read(File.join(__dir__, "react-native-boundary.json"))
)
react_native_release = boundary.fetch("reactNativeVersion")
react_native_runtime_match = /\A(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\z/.match(
  react_native_release
)
unless react_native_runtime_match
  raise "SolidNativeFabric requires an exact React Native release in react-native-boundary.json"
end
react_native_runtime_parts = react_native_runtime_match.captures

Pod::Spec.new do |spec|
  spec.name = "SolidNativeFabric"
  spec.version = "0.0.0"
  spec.summary = "Version-pinned React Native Fabric boundary for Solid Native."
  spec.homepage = "https://github.com/solid-native/solid-native"
  spec.license = { :type => "UNLICENSED" }
  spec.author = "Solid Native contributors"
  spec.source = { :path => "." }
  spec.platform = :ios, "15.1"
  spec.source_files = [
    "apple/SolidNativeDebugRequest.mm",
    "fabric/SolidNativeDebugRequest.h",
    "fabric/SolidNativeFabricApi.cpp",
    "fabric/SolidNativeFabricApi.h",
    "fabric/SolidNativeFabricApplication.h",
    "fabric/SolidNativeFabricApplication.mm",
    "fabric/SolidNativeFabricJSIBinding.h",
    "fabric/SolidNativeFabricJSIBinding.mm",
    "fabric/SolidNativeFabricSurface.h",
    "fabric/SolidNativeFabricSurface.mm",
    "fabric/SolidNativeFabricTransactionCoordinator.cpp",
    "fabric/SolidNativeFabricTransactionCoordinator.h",
    "fabric/SolidNativeFabricTransactionCoordinatorApple.mm",
    "fabric/SolidNativeStartupFailureView.h",
    "fabric/SolidNativeStartupFailureView.mm",
    "worklets/SolidNativeUIWorklet.cpp"
  ]
  spec.preserve_paths = "worklets/SolidNativeUIWorklet.h"
  spec.public_header_files = [
    "fabric/SolidNativeDebugRequest.h",
    "fabric/SolidNativeFabricApplication.h",
    "fabric/SolidNativeStartupFailureView.h"
  ]
  spec.private_header_files = [
    "fabric/SolidNativeFabricApi.h",
    "fabric/SolidNativeFabricJSIBinding.h",
    "fabric/SolidNativeFabricSurface.h",
    "fabric/SolidNativeFabricTransactionCoordinator.h"
  ]
  spec.header_mappings_dir = "fabric"
  spec.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "DEFINES_MODULE" => "YES",
    "GCC_PREPROCESSOR_DEFINITIONS" => [
      "$(inherited)",
      "SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR=#{react_native_runtime_parts[0]}",
      "SOLID_NATIVE_REACT_NATIVE_VERSION_MINOR=#{react_native_runtime_parts[1]}",
      "SOLID_NATIVE_REACT_NATIVE_VERSION_PATCH=#{react_native_runtime_parts[2]}"
    ].join(" ")
  }

  # Deliberately narrow and version-pinned. The reviewed boundary manifest is
  # the single native source of truth for both Pod resolution and the C++
  # compile guard above.
  spec.dependency "React-Fabric/core", "= #{react_native_release}"
  spec.dependency "React-Fabric/mounting", "= #{react_native_release}"
  spec.dependency "React-Fabric/uimanager", "= #{react_native_release}"
  spec.dependency "React-RCTFabric", "= #{react_native_release}"
  spec.dependency "React-RuntimeApple", "= #{react_native_release}"
  spec.dependency "ReactCodegen"
  spec.dependency "React-jsi", "= #{react_native_release}"
  spec.dependency "RCT-Folly"
end
