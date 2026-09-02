import {
  readLocalizationSnapshot,
  type LocalizationSnapshot,
} from "./index.js";

export interface ReactNativeI18nManagerModule {
  getConstants(): unknown;
}

export type DefaultLocaleReader = () => unknown;

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function defaultLocale(): unknown {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

/** @internal Translation seam kept separate from native module lookup. */
export function readReactNativeLocalizationSnapshot(
  value: ReactNativeI18nManagerModule,
  readDefaultLocale: DefaultLocaleReader = defaultLocale,
): LocalizationSnapshot {
  const module = record(value, "React Native I18nManager module");
  if (typeof module.getConstants !== "function") {
    throw new TypeError(
      "React Native I18nManager module must provide getConstants().",
    );
  }
  if (typeof readDefaultLocale !== "function") {
    throw new TypeError("Default locale reader must be a function.");
  }
  return readLocalizationSnapshot({
    readSnapshot() {
      const constants = record(
        value.getConstants(),
        "React Native I18nManager constants",
      );
      const nativeLocale = constants.localeIdentifier;
      return {
        isRTL: constants.isRTL,
        localeTag:
          typeof nativeLocale === "string" && nativeLocale.length > 0
            ? nativeLocale
            : readDefaultLocale(),
        swapsLeftAndRightInRTL: constants.doLeftAndRightSwapInRTL,
      };
    },
  });
}
