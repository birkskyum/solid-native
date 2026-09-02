import type { SolidNativeSchemaAudit } from "@solid-native/codegen";

interface NativeCompatibilitySchemaAudit extends SolidNativeSchemaAudit {
  readonly inputs: readonly Readonly<{
    origin: "application" | "dependency";
    kind: "all" | "components" | "modules";
    libraryName: string;
    packageName: string;
    packageVersion?: string;
  }>[];
}

export type NativeCompatibilityPlatform = "android" | "ios";
export type NativeCompatibilitySurfaceKind =
  "component" | "interface-only-component" | "module";
export type NativeCompatibilityEvidenceLevel =
  | "schema-discovered"
  | "binding-generated"
  | "native-integrated"
  | "device-verified";

export interface NativeCompatibilityEvidence {
  readonly path: string;
  readonly sha256: string;
}

export interface NativeCompatibilityClaim {
  readonly kind: NativeCompatibilitySurfaceKind;
  readonly name: string;
  readonly platform: NativeCompatibilityPlatform;
  readonly evidenceLevel: NativeCompatibilityEvidenceLevel;
  readonly evidence: readonly NativeCompatibilityEvidence[];
}

export interface NativeCompatibilityPackage {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly libraryName: string;
  readonly codegenKind: "all" | "components" | "modules";
  readonly claims: readonly NativeCompatibilityClaim[];
}

export interface NativeCompatibilityCatalog {
  readonly schemaVersion: 0;
  readonly packages: readonly NativeCompatibilityPackage[];
}

export type NativeCompatibilityClaimStatus =
  | "consistent"
  | "input-mismatch"
  | "surface-missing"
  | "platform-excluded"
  | "evidence-missing"
  | "evidence-mismatch";

export interface NativeCompatibilityCheckedClaim extends NativeCompatibilityClaim {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly libraryName: string;
  readonly status: NativeCompatibilityClaimStatus;
  readonly message: string;
}

export interface NativeCompatibilityUnclaimedSurface {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly libraryName: string;
  readonly kind: NativeCompatibilitySurfaceKind;
  readonly name: string;
  readonly platform: NativeCompatibilityPlatform;
}

export interface NativeCompatibilityCatalogReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly catalogFile: string;
  readonly platform: "all" | NativeCompatibilityPlatform;
  readonly packages: readonly Readonly<{
    packageName: string;
    packageVersion: string;
    libraryName: string;
    codegenKind: "all" | "components" | "modules";
  }>[];
  readonly claims: readonly NativeCompatibilityCheckedClaim[];
  readonly unclaimedSurfaces: readonly NativeCompatibilityUnclaimedSurface[];
  readonly summary: Readonly<{
    consistent: number;
    failed: number;
    unclaimed: number;
  }>;
}

export interface VerifyNativeCompatibilityCatalogOptions {
  readonly catalogFile: string;
  readonly platform: "all" | NativeCompatibilityPlatform;
  readonly packageAudits: readonly Readonly<{
    packageName: string;
    audits: Readonly<
      Partial<
        Record<NativeCompatibilityPlatform, NativeCompatibilitySchemaAudit>
      >
    >;
  }>[];
  readonly evidenceSha256: (reference: string) => Promise<string | undefined>;
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const EXACT_SEMVER =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const EVIDENCE_REFERENCE = /^[A-Za-z0-9_@./+-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_PACKAGES = 64;
const MAX_CLAIMS = 2_048;
const MAX_EVIDENCE_REFERENCES = 16;

function record(
  value: unknown,
  location: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${location} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${location} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  location: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${location} contains unknown field ${key}.`);
    }
  }
}

function requiredString(
  value: unknown,
  location: string,
  pattern: RegExp,
  maximumLength = 128,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    !pattern.test(value)
  ) {
    throw new TypeError(`${location} is invalid.`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  location: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new TypeError(
      `${location} must be one of ${choices.map((choice) => JSON.stringify(choice)).join(", ")}.`,
    );
  }
  return value as T;
}

function evidenceReference(value: unknown, location: string): string {
  const reference = requiredString(value, location, EVIDENCE_REFERENCE, 512);
  if (
    reference.startsWith("/") ||
    reference.includes("//") ||
    reference.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError(
      `${location} must be a portable application-relative path.`,
    );
  }
  return reference;
}

function parseEvidence(
  value: unknown,
  location: string,
): NativeCompatibilityEvidence {
  const source = record(value, location);
  exactKeys(source, ["path", "sha256"], location);
  return Object.freeze({
    path: evidenceReference(source.path, `${location}.path`),
    sha256: requiredString(source.sha256, `${location}.sha256`, SHA256, 64),
  });
}

/** Validates one portable, content-addressed compatibility evidence entry. */
export function parseNativeCompatibilityEvidence(
  value: unknown,
): NativeCompatibilityEvidence {
  return parseEvidence(value, "Compatibility evidence");
}

function parseClaim(
  value: unknown,
  location: string,
): NativeCompatibilityClaim {
  const source = record(value, location);
  exactKeys(
    source,
    ["kind", "name", "platform", "evidenceLevel", "evidence"],
    location,
  );
  const kind = oneOf(
    source.kind,
    ["component", "interface-only-component", "module"] as const,
    `${location}.kind`,
  );
  const evidenceLevel = oneOf(
    source.evidenceLevel,
    [
      "schema-discovered",
      "binding-generated",
      "native-integrated",
      "device-verified",
    ] as const,
    `${location}.evidenceLevel`,
  );
  if (
    kind === "interface-only-component" &&
    evidenceLevel === "binding-generated"
  ) {
    throw new TypeError(
      `${location} cannot claim a generated binding for an interface-only component.`,
    );
  }
  const evidenceSource = source.evidence;
  if (
    !Array.isArray(evidenceSource) ||
    evidenceSource.length > MAX_EVIDENCE_REFERENCES
  ) {
    throw new TypeError(
      `${location}.evidence must contain at most ${String(MAX_EVIDENCE_REFERENCES)} paths.`,
    );
  }
  const evidence = evidenceSource.map((entry, index) =>
    parseEvidence(entry, `${location}.evidence[${String(index)}]`),
  );
  if (new Set(evidence.map((entry) => entry.path)).size !== evidence.length) {
    throw new TypeError(`${location}.evidence contains duplicate paths.`);
  }
  if (evidenceLevel === "schema-discovered" && evidence.length !== 0) {
    throw new TypeError(
      `${location}.evidence must be empty for schema-discovered claims.`,
    );
  }
  if (evidenceLevel !== "schema-discovered" && evidence.length === 0) {
    throw new TypeError(
      `${location}.evidence requires at least one application proof path for ${evidenceLevel}.`,
    );
  }
  return Object.freeze({
    kind,
    name: requiredString(source.name, `${location}.name`, IDENTIFIER),
    platform: oneOf(
      source.platform,
      ["android", "ios"] as const,
      `${location}.platform`,
    ),
    evidenceLevel,
    evidence: Object.freeze(evidence),
  });
}

function parsePackage(
  value: unknown,
  location: string,
): NativeCompatibilityPackage {
  const source = record(value, location);
  exactKeys(
    source,
    ["packageName", "packageVersion", "libraryName", "codegenKind", "claims"],
    location,
  );
  if (
    !Array.isArray(source.claims) ||
    source.claims.length === 0 ||
    source.claims.length > MAX_CLAIMS
  ) {
    throw new TypeError(
      `${location}.claims must contain 1-${String(MAX_CLAIMS)} entries.`,
    );
  }
  const claims = source.claims.map((claim, index) =>
    parseClaim(claim, `${location}.claims[${String(index)}]`),
  );
  const claimKeys = claims.map(
    (claim) => `${claim.platform}\0${claim.kind}\0${claim.name}`,
  );
  if (new Set(claimKeys).size !== claimKeys.length) {
    throw new TypeError(
      `${location}.claims contains duplicate surface claims.`,
    );
  }
  return Object.freeze({
    packageName: requiredString(
      source.packageName,
      `${location}.packageName`,
      PACKAGE_NAME,
      214,
    ),
    packageVersion: requiredString(
      source.packageVersion,
      `${location}.packageVersion`,
      EXACT_SEMVER,
    ),
    libraryName: requiredString(
      source.libraryName,
      `${location}.libraryName`,
      IDENTIFIER,
    ),
    codegenKind: oneOf(
      source.codegenKind,
      ["all", "components", "modules"] as const,
      `${location}.codegenKind`,
    ),
    claims: Object.freeze(claims),
  });
}

/** Parses a bounded, exact-version compatibility catalog without trusting it. */
export function parseNativeCompatibilityCatalog(
  source: string,
): NativeCompatibilityCatalog {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > MAX_CATALOG_BYTES
  ) {
    throw new TypeError(
      `The compatibility catalog must not exceed ${String(MAX_CATALOG_BYTES)} bytes.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new TypeError(
      `The compatibility catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const catalog = record(value, "Compatibility catalog");
  exactKeys(catalog, ["schemaVersion", "packages"], "Compatibility catalog");
  if (catalog.schemaVersion !== 0) {
    throw new TypeError("Compatibility catalog schemaVersion must be 0.");
  }
  if (
    !Array.isArray(catalog.packages) ||
    catalog.packages.length === 0 ||
    catalog.packages.length > MAX_PACKAGES
  ) {
    throw new TypeError(
      `Compatibility catalog packages must contain 1-${String(MAX_PACKAGES)} entries.`,
    );
  }
  const packages = catalog.packages.map((entry, index) =>
    parsePackage(entry, `Compatibility catalog packages[${String(index)}]`),
  );
  const packageNames = packages.map((entry) => entry.packageName);
  if (new Set(packageNames).size !== packageNames.length) {
    throw new TypeError("Compatibility catalog contains duplicate packages.");
  }
  const totalClaims = packages.reduce(
    (total, entry) => total + entry.claims.length,
    0,
  );
  if (totalClaims > MAX_CLAIMS) {
    throw new TypeError(
      `Compatibility catalog must not exceed ${String(MAX_CLAIMS)} claims.`,
    );
  }
  return Object.freeze({
    schemaVersion: 0,
    packages: Object.freeze(packages),
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function surfaceExists(
  audit: NativeCompatibilitySchemaAudit,
  claim: NativeCompatibilityClaim,
): boolean {
  if (claim.kind === "component") {
    return audit.components.some((component) => component.name === claim.name);
  }
  if (claim.kind === "interface-only-component") {
    return audit.interfaceOnlyComponents.includes(claim.name);
  }
  return audit.modules.some((module) => module.name === claim.name);
}

function surfaceIsExcluded(
  audit: NativeCompatibilitySchemaAudit,
  claim: NativeCompatibilityClaim,
): boolean {
  return claim.kind === "module"
    ? audit.platformExcludedModules.includes(claim.name)
    : audit.platformExcludedComponents.includes(claim.name);
}

function packageInputMatches(
  audit: NativeCompatibilitySchemaAudit,
  entry: NativeCompatibilityPackage,
): boolean {
  return audit.inputs.some(
    (input) =>
      input.origin === "dependency" &&
      input.packageName === entry.packageName &&
      input.packageVersion === entry.packageVersion &&
      input.libraryName === entry.libraryName &&
      input.kind === entry.codegenKind,
  );
}

async function checkClaim(
  entry: NativeCompatibilityPackage,
  claim: NativeCompatibilityClaim,
  audit: NativeCompatibilitySchemaAudit,
  evidenceSha256: (reference: string) => Promise<string | undefined>,
): Promise<NativeCompatibilityCheckedClaim> {
  let status: NativeCompatibilityClaimStatus;
  let message: string;
  if (!packageInputMatches(audit, entry)) {
    status = "input-mismatch";
    message =
      "The installed package version or Codegen identity does not match the catalog.";
  } else if (surfaceIsExcluded(audit, claim)) {
    status = "platform-excluded";
    message =
      "The Codegen schema excludes this surface on the claimed platform.";
  } else if (!surfaceExists(audit, claim)) {
    status = "surface-missing";
    message = "The claimed surface is absent from its audited schema category.";
  } else {
    const evidence = await Promise.all(
      claim.evidence.map(async (reference) => ({
        actual: await evidenceSha256(reference.path),
        expected: reference.sha256,
        path: reference.path,
      })),
    );
    const missing = evidence
      .filter(({ actual }) => actual === undefined)
      .map((entry) => entry.path);
    const mismatched = evidence
      .filter(
        ({ actual, expected }) => actual !== undefined && actual !== expected,
      )
      .map((entry) => entry.path);
    if (missing.length > 0) {
      status = "evidence-missing";
      message = `Application-local evidence is missing: ${missing.join(", ")}.`;
    } else if (mismatched.length > 0) {
      status = "evidence-mismatch";
      message = `Application-local evidence does not match its reviewed SHA-256 digest: ${mismatched.join(", ")}.`;
    } else {
      status = "consistent";
      message =
        claim.evidenceLevel === "schema-discovered"
          ? "The exact installed schema contains this surface."
          : "The exact installed schema and every declared evidence digest match.";
    }
  }
  return Object.freeze({
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    libraryName: entry.libraryName,
    ...claim,
    status,
    message,
  });
}

function unclaimedSurfaces(
  catalog: NativeCompatibilityCatalog,
  packageAudits: VerifyNativeCompatibilityCatalogOptions["packageAudits"],
  claims: readonly NativeCompatibilityCheckedClaim[],
): readonly NativeCompatibilityUnclaimedSurface[] {
  const claimed = new Set(
    claims.map(
      (claim) =>
        `${claim.packageName}\0${claim.platform}\0${claim.kind}\0${claim.name}`,
    ),
  );
  const result: NativeCompatibilityUnclaimedSurface[] = [];
  for (const entry of catalog.packages) {
    const packageAudit = packageAudits.find(
      (candidate) => candidate.packageName === entry.packageName,
    );
    if (packageAudit === undefined) continue;
    for (const platform of ["android", "ios"] as const) {
      const audit = packageAudit.audits[platform];
      if (audit === undefined) continue;
      const surfaces: Array<
        Readonly<{ kind: NativeCompatibilitySurfaceKind; name: string }>
      > = [
        ...audit.components.map((component) => ({
          kind: "component" as const,
          name: component.name,
        })),
        ...audit.interfaceOnlyComponents.map((name) => ({
          kind: "interface-only-component" as const,
          name,
        })),
        ...audit.modules.map((module) => ({
          kind: "module" as const,
          name: module.name,
        })),
      ];
      for (const surface of surfaces) {
        if (
          surface.kind === "module"
            ? audit.platformExcludedModules.includes(surface.name)
            : audit.platformExcludedComponents.includes(surface.name)
        ) {
          continue;
        }
        if (
          !claimed.has(
            `${entry.packageName}\0${platform}\0${surface.kind}\0${surface.name}`,
          )
        ) {
          result.push(
            Object.freeze({
              packageName: entry.packageName,
              packageVersion: entry.packageVersion,
              libraryName: entry.libraryName,
              ...surface,
              platform,
            }),
          );
        }
      }
    }
  }
  return Object.freeze(
    result.sort((left, right) =>
      compareText(
        `${left.packageName}\0${left.platform}\0${left.kind}\0${left.name}`,
        `${right.packageName}\0${right.platform}\0${right.kind}\0${right.name}`,
      ),
    ),
  );
}

/** Reconciles reviewed support claims with fresh installed-schema audits. */
export async function verifyNativeCompatibilityCatalog(
  catalog: NativeCompatibilityCatalog,
  options: VerifyNativeCompatibilityCatalogOptions,
): Promise<NativeCompatibilityCatalogReport> {
  const platforms =
    options.platform === "all"
      ? (["android", "ios"] as const)
      : ([options.platform] as const);
  for (const entry of catalog.packages) {
    const packageAudit = options.packageAudits.find(
      (candidate) => candidate.packageName === entry.packageName,
    );
    if (packageAudit === undefined) {
      throw new TypeError(
        `A package-isolated schema audit is required for ${entry.packageName}.`,
      );
    }
    for (const platform of platforms) {
      if (packageAudit.audits[platform] === undefined) {
        throw new TypeError(
          `A ${platform} schema audit is required for ${entry.packageName}.`,
        );
      }
    }
  }
  const selectedClaims = catalog.packages
    .flatMap((entry) =>
      entry.claims
        .filter((claim) => platforms.includes(claim.platform))
        .map((claim) => ({ entry, claim })),
    )
    .sort((left, right) =>
      compareText(
        `${left.entry.packageName}\0${left.claim.platform}\0${left.claim.kind}\0${left.claim.name}`,
        `${right.entry.packageName}\0${right.claim.platform}\0${right.claim.kind}\0${right.claim.name}`,
      ),
    );
  const checkedClaims: NativeCompatibilityCheckedClaim[] = [];
  for (const { entry, claim } of selectedClaims) {
    const packageAudit = options.packageAudits.find(
      (candidate) => candidate.packageName === entry.packageName,
    )!;
    checkedClaims.push(
      await checkClaim(
        entry,
        claim,
        packageAudit.audits[claim.platform]!,
        options.evidenceSha256,
      ),
    );
  }
  const claims = Object.freeze(checkedClaims);
  const unclaimed = unclaimedSurfaces(catalog, options.packageAudits, claims);
  const failed = claims.filter((claim) => claim.status !== "consistent").length;
  const packageInputs = catalog.packages.map((entry) =>
    Object.freeze({
      packageName: entry.packageName,
      packageVersion: entry.packageVersion,
      libraryName: entry.libraryName,
      codegenKind: entry.codegenKind,
    }),
  );
  return Object.freeze({
    schemaVersion: 0,
    ok: failed === 0,
    catalogFile: options.catalogFile,
    platform: options.platform,
    packages: Object.freeze(packageInputs),
    claims: Object.freeze(claims),
    unclaimedSurfaces: unclaimed,
    summary: Object.freeze({
      consistent: claims.length - failed,
      failed,
      unclaimed: unclaimed.length,
    }),
  });
}

export function formatNativeCompatibilityCatalogReport(
  report: NativeCompatibilityCatalogReport,
): string {
  const lines = [
    `${report.ok ? "PASS" : "FAIL"} compatibility catalog ${report.catalogFile}`,
    `Claims: ${String(report.summary.consistent)} consistent, ${String(report.summary.failed)} failed, ${String(report.summary.unclaimed)} discovered but unclaimed`,
  ];
  for (const claim of report.claims) {
    lines.push(
      `${claim.status === "consistent" ? "PASS" : "FAIL"} [${claim.platform}] ${claim.packageName}@${claim.packageVersion} ${claim.kind} ${claim.name}: ${claim.evidenceLevel}`,
    );
    if (claim.status !== "consistent") lines.push(`  ${claim.message}`);
  }
  return lines.join("\n");
}
