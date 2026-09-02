export const ALERT_MAX_TITLE_LENGTH = 512;
export const ALERT_MAX_MESSAGE_LENGTH = 4_096;
export const ALERT_MAX_BUTTON_ID_LENGTH = 128;
export const ALERT_MAX_BUTTON_TEXT_LENGTH = 256;
export const ALERT_MAX_IOS_BUTTONS = 32;
export const ALERT_MAX_ANDROID_BUTTONS = 3;

export type AlertPlatform = "android" | "ios";
export type AlertButtonStyle = "default" | "cancel" | "destructive";
export type AlertUserInterfaceStyle = "system" | "light" | "dark";

export interface AlertButton {
  readonly id: string;
  readonly text: string;
  readonly style?: AlertButtonStyle;
  readonly preferred?: boolean;
}

export interface AlertRequest {
  readonly title?: string;
  readonly message?: string;
  readonly buttons?: readonly AlertButton[];
  /** Android-only outside-tap and Back dismissal. */
  readonly cancelable?: boolean;
  /** iOS-only explicit dialog appearance. */
  readonly userInterfaceStyle?: AlertUserInterfaceStyle;
}

export interface NormalizedAlertButton {
  readonly id: string;
  readonly text: string;
  readonly style: AlertButtonStyle;
  readonly preferred: boolean;
}

export interface NormalizedAlertRequest {
  readonly title?: string;
  readonly message?: string;
  readonly buttons: readonly NormalizedAlertButton[];
  readonly cancelable: boolean;
  readonly userInterfaceStyle: AlertUserInterfaceStyle;
}

export type AlertResult =
  | {
      readonly action: "button";
      readonly buttonId: string;
    }
  | {
      readonly action: "dismissed";
    };

export interface AlertAdapter {
  readonly platform: AlertPlatform;
  showAlert(request: NormalizedAlertRequest): Promise<unknown>;
}

export interface AlertService {
  readonly platform: AlertPlatform;
  show(request: AlertRequest): Promise<AlertResult>;
}

export class AlertPresentationInProgressError extends Error {
  constructor() {
    super("Another native alert presentation is still in progress.");
    this.name = "AlertPresentationInProgressError";
  }
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedString(
  value: unknown,
  path: string,
  maximumLength: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    const minimum = allowEmpty ? 0 : 1;
    throw new TypeError(
      `${path} must be a ${minimum}-${maximumLength} character string without null bytes.`,
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : boundedString(value, path, maximumLength, true);
}

function alertButton(value: unknown, index: number): NormalizedAlertButton {
  const button = plainRecord(value, `Alert button ${index}`);
  const style = button.style ?? "default";
  if (style !== "default" && style !== "cancel" && style !== "destructive") {
    throw new TypeError(
      `Alert button ${index}.style must be default, cancel, or destructive.`,
    );
  }
  const preferred = button.preferred ?? false;
  if (typeof preferred !== "boolean") {
    throw new TypeError(`Alert button ${index}.preferred must be a boolean.`);
  }
  return Object.freeze({
    id: boundedString(
      button.id,
      `Alert button ${index}.id`,
      ALERT_MAX_BUTTON_ID_LENGTH,
    ),
    text: boundedString(
      button.text,
      `Alert button ${index}.text`,
      ALERT_MAX_BUTTON_TEXT_LENGTH,
    ),
    style,
    preferred,
  });
}

function normalizeAlertRequest(
  value: AlertRequest,
  platform: AlertPlatform,
): NormalizedAlertRequest {
  const request = plainRecord(value, "Alert request");
  const title = optionalString(
    request.title,
    "Alert title",
    ALERT_MAX_TITLE_LENGTH,
  );
  const message = optionalString(
    request.message,
    "Alert message",
    ALERT_MAX_MESSAGE_LENGTH,
  );
  if ((title ?? "").length === 0 && (message ?? "").length === 0) {
    throw new TypeError("An alert requires a non-empty title or message.");
  }
  const rawButtons =
    request.buttons === undefined
      ? [{ id: "ok", text: "OK" }]
      : request.buttons;
  if (!Array.isArray(rawButtons) || rawButtons.length === 0) {
    throw new TypeError("Alert buttons must be a non-empty array.");
  }
  const maximumButtons =
    platform === "android" ? ALERT_MAX_ANDROID_BUTTONS : ALERT_MAX_IOS_BUTTONS;
  if (rawButtons.length > maximumButtons) {
    throw new RangeError(
      `${platform === "android" ? "Android" : "iOS"} alerts support at most ${maximumButtons} buttons.`,
    );
  }
  const buttons = Object.freeze(rawButtons.map(alertButton));
  const ids = new Set<string>();
  let cancelButtons = 0;
  let destructiveButtons = 0;
  let preferredButtons = 0;
  for (const button of buttons) {
    if (ids.has(button.id)) {
      throw new TypeError(
        `Alert button id ${JSON.stringify(button.id)} is duplicated.`,
      );
    }
    ids.add(button.id);
    if (button.style === "cancel") cancelButtons++;
    if (button.style === "destructive") destructiveButtons++;
    if (button.preferred) preferredButtons++;
  }
  if (cancelButtons > 1) {
    throw new TypeError("An alert can contain at most one cancel button.");
  }
  if (preferredButtons > 1) {
    throw new TypeError("An alert can contain at most one preferred button.");
  }
  if (platform === "ios" && destructiveButtons > 1) {
    throw new TypeError(
      "The iOS alert manager supports at most one destructive button.",
    );
  }
  const cancelable = request.cancelable ?? false;
  if (typeof cancelable !== "boolean") {
    throw new TypeError("Alert cancelable must be a boolean.");
  }
  if (platform === "ios" && cancelable) {
    throw new TypeError(
      "Cancelable outside-tap and Back alerts are Android-only.",
    );
  }
  const userInterfaceStyle = request.userInterfaceStyle ?? "system";
  if (
    userInterfaceStyle !== "system" &&
    userInterfaceStyle !== "light" &&
    userInterfaceStyle !== "dark"
  ) {
    throw new TypeError(
      "Alert userInterfaceStyle must be system, light, or dark.",
    );
  }
  if (platform === "android" && userInterfaceStyle !== "system") {
    throw new TypeError("Explicit alert userInterfaceStyle is iOS-only.");
  }
  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    ...(message === undefined ? {} : { message }),
    buttons,
    cancelable,
    userInterfaceStyle,
  });
}

function alertResult(
  value: unknown,
  request: NormalizedAlertRequest,
): AlertResult {
  const result = plainRecord(value, "Native alert result");
  if (result.action === "dismissed") {
    if (result.buttonId !== undefined) {
      throw new TypeError(
        "A dismissed native alert result must not contain a button id.",
      );
    }
    return Object.freeze({ action: "dismissed" });
  }
  if (result.action !== "button") {
    throw new TypeError(
      "A native alert result action must be button or dismissed.",
    );
  }
  const buttonId = boundedString(
    result.buttonId,
    "Native alert result button id",
    ALERT_MAX_BUTTON_ID_LENGTH,
  );
  if (!request.buttons.some((button) => button.id === buttonId)) {
    throw new TypeError("The native alert selected an unknown button id.");
  }
  return Object.freeze({ action: "button", buttonId });
}

/** Validates all dialog input and untrusted native callback results. */
export function createAlertService(adapter: AlertAdapter): AlertService {
  const candidate = plainRecord(adapter, "Alert adapter");
  if (candidate.platform !== "android" && candidate.platform !== "ios") {
    throw new TypeError("Alert adapter platform must be android or ios.");
  }
  if (typeof candidate.showAlert !== "function") {
    throw new TypeError("Alert adapter must provide showAlert().");
  }
  const platform = candidate.platform;
  let presentationActive = false;
  return Object.freeze({
    platform,
    async show(request: AlertRequest) {
      const normalized = normalizeAlertRequest(request, platform);
      if (presentationActive) {
        throw new AlertPresentationInProgressError();
      }
      presentationActive = true;
      try {
        const result = await adapter.showAlert(normalized);
        return alertResult(result, normalized);
      } finally {
        presentationActive = false;
      }
    },
  });
}
