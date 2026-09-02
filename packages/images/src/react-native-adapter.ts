import { type ImageAdapter, type NormalizedImageRequest } from "./index.js";

export interface AndroidImageLoaderModule {
  getSize(uri: string): Promise<unknown>;
  getSizeWithHeaders(
    uri: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<unknown>;
  prefetchImage(uri: string, requestId: number): Promise<unknown>;
  abortRequest(requestId: number): void;
  queryCache(uris: readonly string[]): Promise<unknown>;
}

export interface IOSImageLoaderModule {
  getSize(uri: string): Promise<unknown>;
  getSizeWithHeaders(
    uri: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<unknown>;
  prefetchImage(uri: string): Promise<unknown>;
  queryCache(uris: readonly string[]): Promise<unknown>;
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

function requireFunctions(
  value: unknown,
  path: string,
  names: readonly string[],
): void {
  const candidate = record(value, path);
  for (const name of names) {
    if (typeof candidate[name] !== "function") {
      throw new TypeError(`${path} must provide ${name}().`);
    }
  }
}

function normalizedIOSDimensions(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(
      "The iOS ImageLoader getSize result must contain width and height.",
    );
  }
  return { width: value[0], height: value[1] };
}

/** @internal Translates React Native's Android-specific ImageLoader ABI. */
export function createAndroidImageAdapter(
  value: AndroidImageLoaderModule,
): ImageAdapter {
  requireFunctions(value, "Android ImageLoader", [
    "getSize",
    "getSizeWithHeaders",
    "prefetchImage",
    "abortRequest",
    "queryCache",
  ]);
  const module = value;
  return Object.freeze({
    platform: "android" as const,
    getDimensions(request: NormalizedImageRequest): Promise<unknown> {
      return request.headers === undefined
        ? module.getSize(request.uri)
        : module.getSizeWithHeaders(request.uri, request.headers);
    },
    prefetchImage(uri: string, requestId: number): Promise<unknown> {
      return module.prefetchImage(uri, requestId);
    },
    cancelPrefetch(requestId: number): void {
      module.abortRequest(requestId);
    },
    queryCache(uris: readonly string[]): Promise<unknown> {
      return module.queryCache(uris);
    },
  });
}

/** @internal Translates React Native's iOS-specific ImageLoader ABI. */
export function createIOSImageAdapter(
  value: IOSImageLoaderModule,
): ImageAdapter {
  requireFunctions(value, "iOS ImageLoader", [
    "getSize",
    "getSizeWithHeaders",
    "prefetchImage",
    "queryCache",
  ]);
  const module = value;
  return Object.freeze({
    platform: "ios" as const,
    async getDimensions(request: NormalizedImageRequest): Promise<unknown> {
      if (request.headers !== undefined) {
        return module.getSizeWithHeaders(request.uri, request.headers);
      }
      return normalizedIOSDimensions(await module.getSize(request.uri));
    },
    prefetchImage(uri: string): Promise<unknown> {
      return module.prefetchImage(uri);
    },
    cancelPrefetch(): void {
      // React Native 0.87 exposes no cancellation primitive on iOS. The public
      // operation still settles as cancelled and ignores the late native result.
    },
    queryCache(uris: readonly string[]): Promise<unknown> {
      return module.queryCache(uris);
    },
  });
}
