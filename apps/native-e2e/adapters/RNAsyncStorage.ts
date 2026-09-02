// Created from `solid-native adapter create RNAsyncStorage`, then narrowed to
// the E2E application's reviewed storage policy. This file is app-owned.

import type { KeyValueStorage } from "@solid-native/storage";
import { createAsyncStorage3KeyValueStorage } from "@solid-native/storage/async-storage-3";
import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";

import {
  requireRNAsyncStorageNativeModule,
  type RNAsyncStorageNativeModule,
} from "../generated/SolidNativeBindings";

export interface GeneratedRNAsyncStorageOptions {
  readonly databaseName: string;
  readonly prefix?: string;
}

/**
 * Resolves the exact generated RNAsyncStorage ABI and hands only its three
 * reviewed methods to the wrapper-free Solid Native storage adapter.
 */
export function createGeneratedRNAsyncStorageKeyValueStorage(
  options: GeneratedRNAsyncStorageOptions,
): KeyValueStorage {
  const native: RNAsyncStorageNativeModule =
    requireRNAsyncStorageNativeModule(TurboModuleRegistry);
  return createAsyncStorage3KeyValueStorage(native, options);
}
