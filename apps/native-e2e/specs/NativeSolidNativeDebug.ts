import type { CodegenTypes, TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export type NativeDebugRequest = {
  requestId: string;
  operation: string;
  sessionId?: string;
};

export interface Spec extends TurboModule {
  readonly onSnapshotRequest: CodegenTypes.EventEmitter<NativeDebugRequest>;
  setSnapshotListenerReady(ready: boolean): void;
  publishSnapshot(requestId: string, payload: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("SolidNativeDebug");
