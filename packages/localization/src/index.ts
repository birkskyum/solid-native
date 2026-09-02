export const LOCALIZATION_MAX_LOCALE_TAG_LENGTH = 128;

export type NativeLayoutDirection = "ltr" | "rtl";

export interface LocalizationSnapshot {
  readonly localeTag: string;
  readonly layoutDirection: NativeLayoutDirection;
  readonly swapsLeftAndRightInRTL: boolean;
}

export interface LocalizationAdapter {
  readSnapshot(): unknown;
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

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean.`);
  }
  return value;
}

function localeTag(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > LOCALIZATION_MAX_LOCALE_TAG_LENGTH ||
    !/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/u.test(value)
  ) {
    throw new TypeError(
      `Localization localeTag must be a language tag containing 1-${LOCALIZATION_MAX_LOCALE_TAG_LENGTH} ASCII letters, digits, hyphens, or underscores.`,
    );
  }
  return value.replaceAll("_", "-");
}

/** Reads and freezes the native startup locale and effective layout policy. */
export function readLocalizationSnapshot(
  adapter: LocalizationAdapter,
): LocalizationSnapshot {
  const candidate = record(adapter, "Localization adapter");
  if (typeof candidate.readSnapshot !== "function") {
    throw new TypeError("Localization adapter must provide readSnapshot().");
  }
  const snapshot = record(adapter.readSnapshot(), "Localization snapshot");
  const isRTL = boolean(snapshot.isRTL, "Localization snapshot.isRTL");
  return Object.freeze({
    localeTag: localeTag(snapshot.localeTag),
    layoutDirection: isRTL ? "rtl" : "ltr",
    swapsLeftAndRightInRTL: boolean(
      snapshot.swapsLeftAndRightInRTL,
      "Localization snapshot.swapsLeftAndRightInRTL",
    ),
  });
}
