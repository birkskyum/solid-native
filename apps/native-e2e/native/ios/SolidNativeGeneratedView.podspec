require 'json'

application = JSON.parse(
  File.read(File.join(__dir__, '..', '..', 'package.json'))
)
react_native_release = application.fetch('dependencies').fetch('react-native')
unless /\A\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\z/.match?(react_native_release)
  raise 'SolidNativeGeneratedView requires an exact react-native application dependency'
end

Pod::Spec.new do |spec|
  spec.name = 'SolidNativeGeneratedView'
  spec.version = '0.0.0'
  spec.summary = 'Generated Fabric component proof for Solid Native.'
  spec.homepage = 'https://github.com/solid-native/solid-native'
  spec.license = { :type => 'UNLICENSED' }
  spec.author = 'Solid Native contributors'
  spec.source = { :path => '.' }
  spec.platform = :ios, '15.1'
  spec.source_files = '*.{h,mm}'
  spec.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'DEFINES_MODULE' => 'YES'
  }

  spec.dependency 'React-RCTFabric', "= #{react_native_release}"
  spec.dependency 'ReactCodegen', "= #{react_native_release}"
end
