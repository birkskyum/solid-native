import type { CodegenTypes, TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export type ParsedFixturePayload = {
  readonly id: string;
  readonly note?: string | null;
};

export enum ParsedFixtureMode {
  Ready = "ready",
  Waiting = "waiting",
}

export interface Spec extends TurboModule {
  readonly onChanged: CodegenTypes.EventEmitter<ParsedFixturePayload>;
  readonly onUnknown?: CodegenTypes.EventEmitter<Object>;
  readonly getPayload: (
    key: string,
    fallback: ParsedFixturePayload | null,
  ) => Promise<ParsedFixturePayload | null>;
  readonly setMode: (mode: ParsedFixtureMode) => ParsedFixtureMode;
  readonly inspect: (value: Object) => Object;
  readonly optionalMethod?: (enabled: boolean) => void;
}

export default TurboModuleRegistry.get<Spec>("ParsedFixtureModule");
