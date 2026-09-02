import { type NormalizedShareRequest, type ShareAdapter } from "./index.js";

export interface AndroidShareModule {
  share(
    content: Readonly<{ title?: string; message?: string }>,
    dialogTitle?: string,
  ): Promise<unknown>;
}

export interface IOSActionSheetManagerModule {
  showShareActionSheetWithOptions(
    options: Readonly<{
      message?: string;
      url?: string;
      subject?: string;
    }>,
    failureCallback: (error: unknown) => void,
    successCallback: (success: unknown, activityType?: unknown) => void,
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

function androidMessage(request: NormalizedShareRequest): string {
  if (request.message === undefined) {
    if (request.url === undefined) {
      throw new TypeError("Android sharing requires a message or URL.");
    }
    return request.url;
  }
  if (request.url === undefined) return request.message;
  return `${request.message}\n${request.url}`;
}

/** @internal Translation seam kept separate from React Native module lookup. */
export function createAndroidShareAdapter(
  value: AndroidShareModule,
): ShareAdapter {
  const candidate = record(value, "Android share module");
  if (typeof candidate.share !== "function") {
    throw new TypeError("Android share module must provide share().");
  }
  const module = value;
  return Object.freeze({
    platform: "android" as const,
    async showShareSheet(request: NormalizedShareRequest): Promise<unknown> {
      const nativeResult = await module.share(
        Object.freeze({
          ...(request.subject === undefined ? {} : { title: request.subject }),
          message: androidMessage(request),
        }),
        undefined,
      );
      const result = record(nativeResult, "Android ShareModule result");
      if (result.action !== "sharedAction") {
        throw new TypeError(
          "Android ShareModule returned an unknown share action.",
        );
      }
      return { action: "presented" };
    },
  });
}

function nativeShareError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.length > 0 && value.length <= 4_096) {
    return new Error(value);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const message = (value as Readonly<Record<string, unknown>>).message;
    if (
      typeof message === "string" &&
      message.length > 0 &&
      message.length <= 4_096
    ) {
      return new Error(message);
    }
  }
  return new Error("The iOS share sheet reported an invalid native error.");
}

/** @internal Translation seam kept separate from React Native module lookup. */
export function createIOSShareAdapter(
  value: IOSActionSheetManagerModule,
): ShareAdapter {
  const candidate = record(value, "iOS action sheet manager");
  if (typeof candidate.showShareActionSheetWithOptions !== "function") {
    throw new TypeError(
      "iOS action sheet manager must provide showShareActionSheetWithOptions().",
    );
  }
  const module = value;
  return Object.freeze({
    platform: "ios" as const,
    showShareSheet(request: NormalizedShareRequest): Promise<unknown> {
      const options = Object.freeze({
        ...(request.message === undefined ? {} : { message: request.message }),
        ...(request.url === undefined ? {} : { url: request.url }),
        ...(request.subject === undefined ? {} : { subject: request.subject }),
      });
      return new Promise((resolve, reject) => {
        let settled = false;
        const rejectOnce = (error: unknown): void => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        try {
          module.showShareActionSheetWithOptions(
            options,
            (error) => rejectOnce(nativeShareError(error)),
            (success, activityType) => {
              if (settled) return;
              if (typeof success !== "boolean") {
                rejectOnce(
                  new TypeError(
                    "iOS emitted an invalid share completion flag.",
                  ),
                );
                return;
              }
              settled = true;
              if (!success) {
                if (activityType !== undefined && activityType !== null) {
                  reject(
                    new TypeError(
                      "A dismissed iOS share must not include an activity type.",
                    ),
                  );
                  return;
                }
                resolve({ action: "dismissed" });
                return;
              }
              if (
                activityType !== undefined &&
                activityType !== null &&
                typeof activityType !== "string"
              ) {
                reject(
                  new TypeError("iOS emitted an invalid share activity type."),
                );
                return;
              }
              resolve({
                action: "completed",
                ...(typeof activityType === "string" ? { activityType } : {}),
              });
            },
          );
        } catch (error) {
          rejectOnce(error);
        }
      });
    },
  });
}
