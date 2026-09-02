declare module "react-native/Libraries/TurboModule/TurboModuleRegistry" {
  export function get<T>(name: string): T | null;
  export function getEnforcing<T>(name: string): T;
}
