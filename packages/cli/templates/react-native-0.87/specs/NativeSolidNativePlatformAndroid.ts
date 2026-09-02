import type { CodegenTypes, TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export type MemoryWarningEvent = {
  level: CodegenTypes.Int32;
};

export interface Spec extends TurboModule {
  readonly onMemoryWarning: CodegenTypes.EventEmitter<MemoryWarningEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>(
  "SolidNativePlatformAndroid",
);
