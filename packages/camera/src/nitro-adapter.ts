export interface NitroModuleRegistry {
  getEnforcing(name: string): unknown;
}

export interface NitroRuntimeGlobals {
  readonly NitroModulesProxy?: unknown;
}

interface NitroInstaller {
  install(): unknown;
}

interface NitroProxy {
  readonly version: string;
  createHybridObject(name: string): unknown;
}

function isObjectLike(
  value: unknown,
): value is Readonly<Record<PropertyKey, unknown>> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function validateProxy(value: unknown, expectedVersion: string): NitroProxy {
  if (!isObjectLike(value)) {
    throw new TypeError("The installed Nitro Modules proxy must be an object.");
  }
  if (value.version !== expectedVersion) {
    throw new Error(
      `The native Nitro Modules runtime must be ${expectedVersion}; received ${String(value.version)}.`,
    );
  }
  if (typeof value.createHybridObject !== "function") {
    throw new TypeError(
      "The installed Nitro Modules proxy must create hybrid objects.",
    );
  }
  return value as unknown as NitroProxy;
}

/**
 * Installs and resolves one pinned Nitro HybridObject without evaluating the
 * package's React-facing barrel. The caller owns the exact native package pin.
 */
export function resolveNitroHybridObject<T>(
  registry: NitroModuleRegistry,
  globals: NitroRuntimeGlobals,
  expectedVersion: string,
  hybridObjectName: string,
): T {
  if (typeof registry?.getEnforcing !== "function") {
    throw new TypeError("The Nitro TurboModule registry is unavailable.");
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/u.test(expectedVersion)) {
    throw new TypeError("The expected Nitro Modules version is invalid.");
  }
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(hybridObjectName)) {
    throw new TypeError("The Nitro hybrid-object name is invalid.");
  }

  let installed = globals.NitroModulesProxy;
  if (installed === undefined) {
    const candidate = registry.getEnforcing("NitroModules");
    if (!isObjectLike(candidate) || typeof candidate.install !== "function") {
      throw new TypeError(
        "The NitroModules TurboModule must expose an install function.",
      );
    }
    const result = (candidate as unknown as NitroInstaller).install();
    if (typeof result === "string") {
      throw new Error(`The Nitro Modules runtime failed to install: ${result}`);
    }
    // Android's nullable String TurboModule return crosses JSI as null on
    // success, while iOS and deterministic adapters may expose undefined.
    if (result !== undefined && result !== null) {
      throw new TypeError(
        "The Nitro Modules installer returned an invalid result.",
      );
    }
    installed = globals.NitroModulesProxy;
    if (installed === undefined) {
      throw new Error(
        "The Nitro Modules installer did not publish its runtime proxy.",
      );
    }
  }

  const proxy = validateProxy(installed, expectedVersion);
  const hybridObject = proxy.createHybridObject(hybridObjectName);
  if (!isObjectLike(hybridObject)) {
    throw new TypeError(
      `Nitro did not create the ${hybridObjectName} hybrid object.`,
    );
  }
  return hybridObject as T;
}
