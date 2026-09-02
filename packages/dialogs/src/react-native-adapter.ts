import { type AlertAdapter, type NormalizedAlertRequest } from "./index.js";

interface AndroidDialogConstants {
  readonly buttonClicked: unknown;
  readonly dismissed: unknown;
  readonly buttonPositive: unknown;
  readonly buttonNegative: unknown;
  readonly buttonNeutral: unknown;
}

export interface AndroidDialogManagerModule {
  getConstants(): AndroidDialogConstants;
  showAlert(
    configuration: Readonly<Record<string, unknown>>,
    onError: (message: unknown) => void,
    onAction: (action: unknown, buttonKey?: unknown) => void,
  ): void;
}

export interface IOSAlertManagerModule {
  alertWithArgs(
    configuration: Readonly<Record<string, unknown>>,
    callback: (buttonKey: unknown, value?: unknown) => void,
  ): void;
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

function boundedNativeError(value: unknown): Error {
  const message =
    typeof value === "string" && value.length > 0 && value.length <= 4_096
      ? value
      : "The native Android alert manager reported an invalid error.";
  return new Error(message);
}

function finiteButtonKey(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer.`);
  }
  return value as number;
}

function iosButtonIndex(value: unknown, buttonCount: number): number {
  let index: number;
  if (Number.isSafeInteger(value)) {
    index = value as number;
  } else if (
    typeof value === "string" &&
    /^(?:0|[1-9][0-9]*)$/u.test(value) &&
    value.length <= 10
  ) {
    index = Number(value);
  } else {
    throw new TypeError("iOS emitted an invalid alert callback.");
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= buttonCount) {
    throw new TypeError("iOS emitted an invalid alert callback.");
  }
  return index;
}

/** @internal Translation seam kept separate from React Native module lookup. */
export function createAndroidAlertAdapter(
  value: AndroidDialogManagerModule,
): AlertAdapter {
  const candidate = record(value, "Android alert manager");
  if (
    typeof candidate.getConstants !== "function" ||
    typeof candidate.showAlert !== "function"
  ) {
    throw new TypeError(
      "Android alert manager must provide getConstants() and showAlert().",
    );
  }
  const module = value;
  const constants = record(
    module.getConstants(),
    "Android alert manager constants",
  ) as unknown as AndroidDialogConstants;
  if (
    typeof constants.buttonClicked !== "string" ||
    constants.buttonClicked.length === 0 ||
    typeof constants.dismissed !== "string" ||
    constants.dismissed.length === 0 ||
    constants.buttonClicked === constants.dismissed
  ) {
    throw new TypeError("Android alert action constants are invalid.");
  }
  const positive = finiteButtonKey(
    constants.buttonPositive,
    "Android positive alert button key",
  );
  const negative = finiteButtonKey(
    constants.buttonNegative,
    "Android negative alert button key",
  );
  const neutral = finiteButtonKey(
    constants.buttonNeutral,
    "Android neutral alert button key",
  );
  if (new Set([positive, negative, neutral]).size !== 3) {
    throw new TypeError("Android alert button constants must be distinct.");
  }
  return Object.freeze({
    platform: "android" as const,
    showAlert(request: NormalizedAlertRequest): Promise<unknown> {
      const buttons = [...request.buttons];
      const positiveButton = buttons.pop();
      const negativeButton = buttons.pop();
      const neutralButton = buttons.pop();
      const buttonByKey = new Map<number, string>();
      const configuration: Record<string, unknown> = {
        title: request.title ?? "",
        message: request.message ?? "",
        cancelable: request.cancelable,
      };
      if (neutralButton !== undefined) {
        configuration.buttonNeutral = neutralButton.text;
        buttonByKey.set(neutral, neutralButton.id);
      }
      if (negativeButton !== undefined) {
        configuration.buttonNegative = negativeButton.text;
        buttonByKey.set(negative, negativeButton.id);
      }
      if (positiveButton !== undefined) {
        configuration.buttonPositive = positiveButton.text;
        buttonByKey.set(positive, positiveButton.id);
      }
      Object.freeze(configuration);
      return new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = (result: unknown): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        const rejectOnce = (error: unknown): void => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        try {
          module.showAlert(
            configuration,
            (message) => rejectOnce(boundedNativeError(message)),
            (action, rawButtonKey) => {
              if (action === constants.dismissed) {
                resolveOnce({ action: "dismissed" });
                return;
              }
              if (action !== constants.buttonClicked) {
                rejectOnce(
                  new TypeError("Android emitted an unknown alert action."),
                );
                return;
              }
              let buttonKey: number;
              try {
                buttonKey = finiteButtonKey(
                  rawButtonKey,
                  "Android alert callback button key",
                );
              } catch (error) {
                rejectOnce(error);
                return;
              }
              const buttonId = buttonByKey.get(buttonKey);
              if (buttonId === undefined) {
                rejectOnce(
                  new TypeError(
                    "Android selected an unknown alert button key.",
                  ),
                );
                return;
              }
              resolveOnce({ action: "button", buttonId });
            },
          );
        } catch (error) {
          rejectOnce(error);
        }
      });
    },
  });
}

/** @internal Translation seam kept separate from React Native module lookup. */
export function createIOSAlertAdapter(
  value: IOSAlertManagerModule,
): AlertAdapter {
  const candidate = record(value, "iOS alert manager");
  if (typeof candidate.alertWithArgs !== "function") {
    throw new TypeError("iOS alert manager must provide alertWithArgs().");
  }
  const module = value;
  return Object.freeze({
    platform: "ios" as const,
    showAlert(request: NormalizedAlertRequest): Promise<unknown> {
      const cancelIndex = request.buttons.findIndex(
        (button) => button.style === "cancel",
      );
      const destructiveIndex = request.buttons.findIndex(
        (button) => button.style === "destructive",
      );
      const preferredIndex = request.buttons.findIndex(
        (button) => button.preferred,
      );
      const buttons = Object.freeze(
        request.buttons.map((button, index) =>
          Object.freeze({ [index]: button.text }),
        ),
      );
      const configuration = Object.freeze({
        title: request.title ?? "",
        ...(request.message === undefined ? {} : { message: request.message }),
        buttons,
        type: "default",
        ...(cancelIndex === -1 ? {} : { cancelButtonKey: String(cancelIndex) }),
        ...(destructiveIndex === -1
          ? {}
          : { destructiveButtonKey: String(destructiveIndex) }),
        ...(preferredIndex === -1
          ? {}
          : { preferredButtonKey: String(preferredIndex) }),
        ...(request.userInterfaceStyle === "system"
          ? {}
          : { userInterfaceStyle: request.userInterfaceStyle }),
      });
      return new Promise((resolve, reject) => {
        let settled = false;
        try {
          module.alertWithArgs(configuration, (rawButtonKey) => {
            if (settled) return;
            let index: number;
            try {
              index = iosButtonIndex(rawButtonKey, request.buttons.length);
            } catch (error) {
              settled = true;
              reject(error);
              return;
            }
            settled = true;
            resolve({
              action: "button",
              buttonId: request.buttons[index]!.id,
            });
          });
        } catch (error) {
          settled = true;
          reject(error);
        }
      });
    },
  });
}
