export const CLIPBOARD_MAX_TEXT_LENGTH = 1_048_576;

export interface ClipboardAdapter {
  readText(): Promise<unknown>;
  writeText(text: string): void;
}

export interface ClipboardService {
  readText(): Promise<string>;
  writeText(text: string): void;
  clear(): void;
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

function clipboardText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > CLIPBOARD_MAX_TEXT_LENGTH) {
    throw new TypeError(
      `${path} must be a string containing at most ${CLIPBOARD_MAX_TEXT_LENGTH} characters.`,
    );
  }
  return value;
}

/** Validates both application writes and untrusted native read settlements. */
export function createClipboardService(
  adapter: ClipboardAdapter,
): ClipboardService {
  const candidate = record(adapter, "Clipboard adapter");
  if (
    typeof candidate.readText !== "function" ||
    typeof candidate.writeText !== "function"
  ) {
    throw new TypeError(
      "Clipboard adapter must provide readText() and writeText().",
    );
  }
  return Object.freeze({
    async readText(): Promise<string> {
      return clipboardText(await adapter.readText(), "Native clipboard text");
    },
    writeText(text: string): void {
      adapter.writeText(clipboardText(text, "Clipboard text"));
    },
    clear(): void {
      adapter.writeText("");
    },
  });
}
