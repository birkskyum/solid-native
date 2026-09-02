export interface SolidNativeMetroResolverContext {
  readonly dev: boolean;
  readonly resolveRequest: (
    context: SolidNativeMetroResolverContext,
    moduleName: string,
    platform: string | null,
  ) => unknown;
}

export type SolidNativeMetroResolver = (
  context: SolidNativeMetroResolverContext,
  moduleName: string,
  platform: string | null,
) => unknown;

/** Absolute path to Solid Native's package-owned Metro transform worker. */
export declare const solidNativeTransformWorkerPath: string;

/**
 * Matches application JavaScript/TypeScript modules that must trigger a full
 * runtime reload instead of entering React Refresh's component heuristics.
 */
export declare function createSolidNativeFullReloadPattern(
  projectRoot: string,
): RegExp;

/**
 * Creates a Metro resolver that pins Solid and its signal graph to one browser
 * runtime selected by Metro's development mode.
 */
export declare function createSolidNativeMetroResolver(
  projectRoot: string,
): SolidNativeMetroResolver;
