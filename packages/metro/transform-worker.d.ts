import type { Buffer } from "node:buffer";

/** Delegates to Metro after applying Solid Native's OXC transform when needed. */
export declare function transform(
  config: unknown,
  projectRoot: string,
  filename: string,
  data: Buffer,
  options: unknown,
): Promise<unknown>;

/** Returns the cache identity for the worker, compiler, and Metro options. */
export declare function getCacheKey(config: unknown, options: unknown): string;
