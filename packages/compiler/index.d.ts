export interface SolidNativeSourceMap {
  readonly version: number;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
  file?: string;
  readonly [key: string]: unknown;
}

export interface SolidNativeTransformResult {
  readonly code: string;
  readonly map: SolidNativeSourceMap;
}

export declare const SOLID_NATIVE_BUILT_INS: readonly string[];
export declare const solidNativeCompilerCacheKey: string;

/** Runs the Solid-aware OXC universal JSX transform without erasing TypeScript. */
export declare function transformSolidNativeJsx(
  source: string,
  filename: string,
): SolidNativeTransformResult;

/** Runs Solid universal compilation, OXC TypeScript erasure, and map composition. */
export declare function compileSolidNativeModule(
  source: string,
  filename: string,
): SolidNativeTransformResult;
