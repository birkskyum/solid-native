import { createClipboardService, type ClipboardService } from "./index.js";

export interface ReactNativeClipboardModule {
  getString(): Promise<unknown>;
  setString(text: string): void;
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** @internal Translation seam kept separate from native module lookup. */
export function createReactNativeClipboardAdapter(
  value: ReactNativeClipboardModule,
): ClipboardService {
  const module = record(value, "React Native Clipboard module");
  if (
    typeof module.getString !== "function" ||
    typeof module.setString !== "function"
  ) {
    throw new TypeError(
      "React Native Clipboard module must provide getString() and setString().",
    );
  }
  return createClipboardService({
    readText: () => value.getString(),
    writeText: (text) => value.setString(text),
  });
}
