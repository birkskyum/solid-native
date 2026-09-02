declare module "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter" {
  const emitter: unknown;
  export default emitter;
}

declare module "react-native/Libraries/TurboModule/TurboModuleRegistry" {
  export function get<T>(name: string): T | null;
  export function getEnforcing<T>(name: string): T;
}
