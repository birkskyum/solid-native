export const IMAGE_MAX_URI_LENGTH = 8_192;
export const IMAGE_MAX_HEADER_COUNT = 128;
export const IMAGE_MAX_HEADER_NAME_LENGTH = 256;
export const IMAGE_MAX_HEADER_VALUE_LENGTH = 8_192;
export const IMAGE_MAX_HEADER_CHARACTERS = 65_536;
export const IMAGE_MAX_CACHE_QUERY_URIS = 256;
export const IMAGE_MAX_DIMENSION = 1_000_000;

export type ImagePlatform = "android" | "ios";
export type ImageCacheLocation = "memory" | "disk" | "disk/memory";

export interface ImageRequest {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface NormalizedImageRequest {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ImageCacheEntry {
  readonly uri: string;
  readonly location: ImageCacheLocation | "none";
}

export interface ImageAdapter {
  readonly platform: ImagePlatform;
  getDimensions(request: NormalizedImageRequest): Promise<unknown>;
  prefetchImage(uri: string, requestId: number): Promise<unknown>;
  cancelPrefetch(requestId: number): void;
  queryCache(uris: readonly string[]): Promise<unknown>;
}

export interface ImagePrefetchHandle {
  readonly result: Promise<void>;
  cancel(): void;
}

export interface ImageService {
  readonly platform: ImagePlatform;
  getDimensions(request: string | ImageRequest): Promise<ImageDimensions>;
  prefetch(uri: string): ImagePrefetchHandle;
  queryCache(uris: readonly string[]): Promise<readonly ImageCacheEntry[]>;
}

export class ImagePrefetchCancelledError extends Error {
  constructor() {
    super("The image prefetch was cancelled.");
    this.name = "ImagePrefetchCancelledError";
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

function imageURI(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > IMAGE_MAX_URI_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError(
      `${path} must be a 1-${IMAGE_MAX_URI_LENGTH} character absolute URI without ASCII control characters.`,
    );
  }
  return value;
}

function normalizeHeaders(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const source = plainRecord(value, "Image headers");
  const entries = Object.entries(source);
  if (entries.length > IMAGE_MAX_HEADER_COUNT) {
    throw new RangeError(
      `Image headers must contain at most ${IMAGE_MAX_HEADER_COUNT} entries.`,
    );
  }
  let totalLength = 0;
  const headers: Record<string, string> = {};
  for (const [name, rawValue] of entries) {
    if (
      name.length === 0 ||
      name.length > IMAGE_MAX_HEADER_NAME_LENGTH ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)
    ) {
      throw new TypeError(
        `Image header names must be 1-${IMAGE_MAX_HEADER_NAME_LENGTH} character HTTP tokens.`,
      );
    }
    if (
      typeof rawValue !== "string" ||
      rawValue.length > IMAGE_MAX_HEADER_VALUE_LENGTH ||
      /[\u0000\r\n]/u.test(rawValue)
    ) {
      throw new TypeError(
        `Image header ${name} must be a string of at most ${IMAGE_MAX_HEADER_VALUE_LENGTH} characters without null bytes or line breaks.`,
      );
    }
    totalLength += name.length + rawValue.length;
    Object.defineProperty(headers, name, {
      configurable: false,
      enumerable: true,
      value: rawValue,
      writable: false,
    });
  }
  if (totalLength > IMAGE_MAX_HEADER_CHARACTERS) {
    throw new RangeError(
      `Image headers must contain at most ${IMAGE_MAX_HEADER_CHARACTERS} total characters.`,
    );
  }
  return Object.freeze(headers);
}

function normalizeRequest(
  value: string | ImageRequest,
): NormalizedImageRequest {
  if (typeof value === "string") {
    return Object.freeze({ uri: imageURI(value, "Image URI") });
  }
  const request = plainRecord(value, "Image request");
  const uri = imageURI(request.uri, "Image request URI");
  const headers = normalizeHeaders(request.headers);
  return Object.freeze({
    uri,
    ...(headers === undefined ? {} : { headers }),
  });
}

function dimensions(value: unknown): ImageDimensions {
  const candidate = plainRecord(value, "Native image dimensions");
  for (const key of ["width", "height"] as const) {
    const dimension = candidate[key];
    if (
      typeof dimension !== "number" ||
      !Number.isFinite(dimension) ||
      dimension <= 0 ||
      dimension > IMAGE_MAX_DIMENSION
    ) {
      throw new TypeError(
        `Native image ${key} must be a finite number greater than 0 and at most ${IMAGE_MAX_DIMENSION}.`,
      );
    }
  }
  return Object.freeze({
    width: candidate.width as number,
    height: candidate.height as number,
  });
}

function cacheLocation(value: unknown, uri: string): ImageCacheLocation {
  if (value === "memory" || value === "disk" || value === "disk/memory") {
    return value;
  }
  throw new TypeError(
    `Native image cache returned an invalid state for ${uri}.`,
  );
}

function normalizeCacheURIs(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > IMAGE_MAX_CACHE_QUERY_URIS) {
    throw new TypeError(
      `Image cache queries must be arrays containing at most ${IMAGE_MAX_CACHE_QUERY_URIS} URIs.`,
    );
  }
  return Object.freeze(
    value.map((uri, index) => imageURI(uri, `Image cache URI ${index}`)),
  );
}

function validateAdapter(value: ImageAdapter): ImageAdapter {
  const candidate = plainRecord(value, "Image adapter");
  if (candidate.platform !== "android" && candidate.platform !== "ios") {
    throw new TypeError("Image adapter platform must be android or ios.");
  }
  if (
    typeof candidate.getDimensions !== "function" ||
    typeof candidate.prefetchImage !== "function" ||
    typeof candidate.cancelPrefetch !== "function" ||
    typeof candidate.queryCache !== "function"
  ) {
    throw new TypeError(
      "Image adapter must provide getDimensions(), prefetchImage(), cancelPrefetch(), and queryCache().",
    );
  }
  return value;
}

/** Validates requests and every untrusted native asynchronous settlement. */
export function createImageService(adapterValue: ImageAdapter): ImageService {
  const adapter = validateAdapter(adapterValue);
  const activeRequestIds = new Set<number>();
  let nextRequestId = 1;

  const allocateRequestId = (): number => {
    for (let attempts = 0; attempts < 2_147_483_647; attempts++) {
      const candidate = nextRequestId;
      nextRequestId = candidate === 2_147_483_647 ? 1 : candidate + 1;
      if (!activeRequestIds.has(candidate)) {
        activeRequestIds.add(candidate);
        return candidate;
      }
    }
    throw new Error("No image prefetch request identifiers are available.");
  };

  return Object.freeze({
    platform: adapter.platform,
    async getDimensions(
      request: string | ImageRequest,
    ): Promise<ImageDimensions> {
      return dimensions(await adapter.getDimensions(normalizeRequest(request)));
    },
    prefetch(rawURI: string): ImagePrefetchHandle {
      const uri = imageURI(rawURI, "Image prefetch URI");
      const requestId = allocateRequestId();
      let active = true;
      let nativeStarted = false;
      let resolveResult!: () => void;
      let rejectResult!: (error: unknown) => void;
      const result = new Promise<void>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const finish = (): boolean => {
        if (!active) return false;
        active = false;
        activeRequestIds.delete(requestId);
        return true;
      };
      void Promise.resolve()
        .then(() => {
          if (!active) return undefined;
          nativeStarted = true;
          return adapter.prefetchImage(uri, requestId);
        })
        .then(
          (prefetched) => {
            if (!finish()) return;
            if (prefetched !== true) {
              rejectResult(
                new TypeError(
                  "Native image prefetch must settle with boolean true.",
                ),
              );
              return;
            }
            resolveResult();
          },
          (error: unknown) => {
            if (finish()) rejectResult(error);
          },
        );
      return Object.freeze({
        result,
        cancel(): void {
          if (!finish()) return;
          if (!nativeStarted) {
            rejectResult(new ImagePrefetchCancelledError());
            return;
          }
          try {
            adapter.cancelPrefetch(requestId);
          } catch (error) {
            rejectResult(error);
            return;
          }
          rejectResult(new ImagePrefetchCancelledError());
        },
      });
    },
    async queryCache(
      rawURIs: readonly string[],
    ): Promise<readonly ImageCacheEntry[]> {
      const uris = normalizeCacheURIs(rawURIs);
      const uniqueURIs = Object.freeze([...new Set(uris)]);
      const rawResult = plainRecord(
        await adapter.queryCache(uniqueURIs),
        "Native image cache result",
      );
      const requested = new Set(uniqueURIs);
      for (const [uri, location] of Object.entries(rawResult)) {
        if (!requested.has(uri)) {
          throw new TypeError(
            "Native image cache returned an unrequested URI.",
          );
        }
        cacheLocation(location, uri);
      }
      return Object.freeze(
        uris.map((uri) =>
          Object.freeze({
            uri,
            location: Object.prototype.hasOwnProperty.call(rawResult, uri)
              ? cacheLocation(rawResult[uri], uri)
              : "none",
          }),
        ),
      );
    },
  });
}
