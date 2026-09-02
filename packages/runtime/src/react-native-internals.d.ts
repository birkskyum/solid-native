declare module "react-native/Libraries/EventEmitter/NativeEventEmitter" {
  const NativeEventEmitter: unknown;
  export default NativeEventEmitter;
}

declare module "react-native/Libraries/Components/Keyboard/Keyboard" {
  const Keyboard: unknown;
  export default Keyboard;
}

declare module "react-native/Libraries/Utilities/BackHandler" {
  const BackHandler: unknown;
  export default BackHandler;
}

declare module "react-native/Libraries/Utilities/Dimensions" {
  const Dimensions: unknown;
  export default Dimensions;
}

declare module "react-native/Libraries/Utilities/Appearance" {
  export function addChangeListener(
    listener: (event: unknown) => void,
  ): unknown;
  export function getColorScheme(): unknown;
  export function setColorScheme(scheme: unknown): void;
}

declare module "react-native/Libraries/TurboModule/TurboModuleRegistry" {
  export function get<T>(name: string): T | null;
  export function getEnforcing<T>(name: string): T;
}
