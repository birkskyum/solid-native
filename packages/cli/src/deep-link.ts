import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defaultNativeAndroidLogCommandRunner,
  parseAndroidPackageUid,
  parseAuthorizedAndroidDevices,
  type NativeAndroidLogCommandResult,
  type NativeAndroidLogCommandRunner,
} from "./android-logs.js";
import {
  parseNativeIosInstalledApplication,
  type NativeIosInstalledApplication,
} from "./ios-logs.js";

const COMMAND_TIMEOUT_MS = 20_000;
const DISCOVERY_TIMEOUT_MS = 12_000;
const CORE_DEVICE_TIMEOUT_SECONDS = 15;
const MAX_CORE_DEVICE_RESULT_BYTES = 1024 * 1024;
const CORE_DEVICE_RESULT_PLACEHOLDER = "<temporary-coredevice-result.json>";
const ANDROID_PACKAGE_NAME =
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const IOS_BUNDLE_IDENTIFIER =
  /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;
const ABSOLUTE_URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export type NativeDeepLinkMode = "preserve" | "cold";
export type NativeDeepLinkCommandResult = NativeAndroidLogCommandResult;
export type NativeDeepLinkCommandRunner = NativeAndroidLogCommandRunner;

export interface NativeDeepLinkDependencies {
  readonly hostPlatform: NodeJS.Platform;
  readonly runCommand: NativeDeepLinkCommandRunner;
}

interface NativeDeepLinkOptionsBase {
  readonly url: string;
  readonly cold?: boolean;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<NativeDeepLinkDependencies>;
}

export interface NativeAndroidDeepLinkOptions extends NativeDeepLinkOptionsBase {
  readonly platform: "android";
  readonly packageName: string;
  readonly serial?: string;
}

export interface NativeIosDeepLinkOptions extends NativeDeepLinkOptionsBase {
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
}

export type NativeDeepLinkOptions =
  NativeAndroidDeepLinkOptions | NativeIosDeepLinkOptions;

interface NativeDeepLinkPlanBase {
  readonly schemaVersion: 0;
  readonly operation: "open-deep-link";
  readonly url: string;
  readonly mode: NativeDeepLinkMode;
  readonly terminatesExistingApplication: boolean;
  readonly cwd: string;
}

export interface NativeAndroidDeepLinkPlan extends NativeDeepLinkPlanBase {
  readonly platform: "android";
  readonly packageName: string;
  readonly serial: string;
  readonly uid: number;
  readonly command: "adb";
  readonly args: readonly string[];
}

export interface NativeIosDeepLinkPlan extends NativeDeepLinkPlanBase {
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly application: NativeIosInstalledApplication;
  readonly command: "xcrun";
  /** Includes one placeholder replaced by the executor's private result path. */
  readonly args: readonly string[];
}

export type NativeDeepLinkPlan =
  NativeAndroidDeepLinkPlan | NativeIosDeepLinkPlan;

interface NativeDeepLinkExecutionBase {
  readonly schemaVersion: 0;
  readonly operation: "open-deep-link";
  readonly url: string;
  readonly mode: NativeDeepLinkMode;
  readonly terminatesExistingApplication: boolean;
}

export interface NativeAndroidDeepLinkExecution extends NativeDeepLinkExecutionBase {
  readonly platform: "android";
  readonly packageName: string;
  readonly serial: string;
  readonly activity: string;
  readonly launchState: string;
}

export interface NativeIosDeepLinkExecution extends NativeDeepLinkExecutionBase {
  readonly platform: "ios";
  readonly bundleIdentifier: string;
  readonly device: string;
  readonly processIdentifier: number;
}

export type NativeDeepLinkExecution =
  NativeAndroidDeepLinkExecution | NativeIosDeepLinkExecution;

export type NativeDeepLinkExecutor = (
  plan: NativeDeepLinkPlan,
  context: {
    readonly env: NodeJS.ProcessEnv;
    readonly runCommand: NativeDeepLinkCommandRunner;
  },
) => Promise<NativeDeepLinkExecution>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertApplicationIdentifier(
  identifier: string,
  platform: "android" | "ios",
): void {
  const pattern =
    platform === "android" ? ANDROID_PACKAGE_NAME : IOS_BUNDLE_IDENTIFIER;
  if (identifier.length > 255 || !pattern.test(identifier)) {
    throw new TypeError(
      `${platform === "android" ? "Android" : "iOS"} deep links require a valid dotted application identifier, received ${JSON.stringify(identifier)}.`,
    );
  }
}

function assertDeviceIdentifier(
  identifier: string,
  platform: "android" | "ios",
): void {
  if (
    identifier.length === 0 ||
    identifier.length > 256 ||
    /[\s\0]/u.test(identifier)
  ) {
    throw new TypeError(
      `${platform === "android" ? "Android" : "iOS"} device identifiers must be 1-256 non-whitespace characters.`,
    );
  }
}

function assertDeepLink(url: string): void {
  if (
    Buffer.byteLength(url, "utf8") > 4_096 ||
    url.length === 0 ||
    !ABSOLUTE_URL_SCHEME.test(url) ||
    /[\0-\x20\x7f]/u.test(url)
  ) {
    throw new TypeError(
      "Deep links must be absolute URLs of at most 4096 UTF-8 bytes without whitespace or control characters.",
    );
  }
  try {
    new URL(url);
  } catch {
    throw new TypeError("Deep links must be valid absolute URLs.");
  }
}

function commandFailure(
  operation: string,
  result: NativeDeepLinkCommandResult,
  timeoutMs: number,
): TypeError {
  if (result.timedOut) {
    return new TypeError(
      `${operation} did not finish within ${String(timeoutMs / 1_000)} seconds. Confirm the device is wired, unlocked, and authorized.`,
    );
  }
  if (result.errorCode === "ENOENT") {
    return new TypeError(
      `${operation} could not start its platform tool. Install Android platform-tools or Xcode and put the selected tool on PATH.`,
    );
  }
  const detail = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new TypeError(
    detail === undefined
      ? `${operation} failed without diagnostic output.`
      : `${operation} failed: ${detail}`,
  );
}

async function runCommand(
  runner: NativeDeepLinkCommandRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
  command: string,
  args: readonly string[],
  operation: string,
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<NativeDeepLinkCommandResult> {
  const result = await runner(command, args, { cwd, env, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut) {
    throw commandFailure(operation, result, timeoutMs);
  }
  return result;
}

async function createAndroidPlan(
  options: NativeAndroidDeepLinkOptions,
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: NativeDeepLinkCommandRunner,
): Promise<NativeAndroidDeepLinkPlan> {
  assertApplicationIdentifier(options.packageName, "android");
  let serial = options.serial;
  if (serial === undefined) {
    const result = await runCommand(
      runner,
      cwd,
      env,
      "adb",
      ["devices"],
      "Android device discovery",
    );
    const devices = parseAuthorizedAndroidDevices(result.stdout);
    if (devices.length !== 1) {
      throw new TypeError(
        `Expected exactly one authorized Android device; found ${String(devices.length)}. Pass --serial ID when more than one device is attached.`,
      );
    }
    serial = devices[0];
  }
  if (serial === undefined) {
    throw new TypeError("Android device discovery returned no serial.");
  }
  assertDeviceIdentifier(serial, "android");
  const state = await runCommand(
    runner,
    cwd,
    env,
    "adb",
    ["-s", serial, "get-state"],
    `Android device ${serial}`,
  );
  if (state.stdout.trim() !== "device") {
    throw new TypeError(
      `Android device ${serial} is unavailable or not authorized.`,
    );
  }
  const packageResult = await runCommand(
    runner,
    cwd,
    env,
    "adb",
    [
      "-s",
      serial,
      "shell",
      "cmd",
      "package",
      "list",
      "packages",
      "-U",
      options.packageName,
    ],
    `Android package lookup for ${options.packageName}`,
  );
  const uid = parseAndroidPackageUid(packageResult.stdout, options.packageName);
  if (uid === undefined) {
    throw new TypeError(
      `Android package ${options.packageName} is not installed exactly once on ${serial}.`,
    );
  }
  const cold = options.cold === true;
  return {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "android",
    packageName: options.packageName,
    serial,
    uid,
    url: options.url,
    mode: cold ? "cold" : "preserve",
    terminatesExistingApplication: cold,
    cwd,
    command: "adb",
    args: [
      "-s",
      serial,
      "shell",
      "am",
      "start-activity",
      "-W",
      "--user",
      "current",
      ...(cold ? ["-S"] : []),
      "-a",
      "android.intent.action.VIEW",
      "-c",
      "android.intent.category.BROWSABLE",
      "-d",
      options.url,
      "-p",
      options.packageName,
    ],
  };
}

async function createIosPlan(
  options: NativeIosDeepLinkOptions,
  cwd: string,
  env: NodeJS.ProcessEnv,
  runner: NativeDeepLinkCommandRunner,
): Promise<NativeIosDeepLinkPlan> {
  assertApplicationIdentifier(options.bundleIdentifier, "ios");
  assertDeviceIdentifier(options.device, "ios");
  const hostPlatform = options.dependencies?.hostPlatform ?? process.platform;
  if (hostPlatform !== "darwin") {
    throw new TypeError(
      `iOS deep links require macOS and Xcode; received ${hostPlatform}.`,
    );
  }
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-deep-link-plan-"),
  );
  const resultPath = path.join(directory, "applications.json");
  try {
    await runCommand(
      runner,
      cwd,
      env,
      "xcrun",
      [
        "devicectl",
        "device",
        "info",
        "apps",
        "--device",
        options.device,
        "--bundle-id",
        options.bundleIdentifier,
        "--quiet",
        "--timeout",
        "10",
        "--json-output",
        resultPath,
      ],
      `CoreDevice application lookup for ${options.bundleIdentifier}`,
    );
    let source: string;
    try {
      source = await readFile(resultPath, "utf8");
    } catch {
      throw new TypeError(
        "CoreDevice application lookup succeeded without writing its required JSON result.",
      );
    }
    const application = parseNativeIosInstalledApplication(
      source,
      options.bundleIdentifier,
    );
    const cold = options.cold === true;
    return {
      schemaVersion: 0,
      operation: "open-deep-link",
      platform: "ios",
      bundleIdentifier: options.bundleIdentifier,
      device: options.device,
      application,
      url: options.url,
      mode: cold ? "cold" : "preserve",
      terminatesExistingApplication: cold,
      cwd,
      command: "xcrun",
      args: [
        "devicectl",
        "device",
        "process",
        "launch",
        "--device",
        options.device,
        ...(cold ? ["--terminate-existing"] : []),
        "--payload-url",
        options.url,
        "--quiet",
        "--timeout",
        String(CORE_DEVICE_TIMEOUT_SECONDS),
        "--json-output",
        CORE_DEVICE_RESULT_PLACEHOLDER,
        options.bundleIdentifier,
      ],
    };
  } finally {
    await rm(directory, { recursive: true });
  }
}

export async function createNativeDeepLinkPlan(
  options: NativeDeepLinkOptions,
): Promise<NativeDeepLinkPlan> {
  if (!isRecord(options)) {
    throw new TypeError("Deep-link plan options must be an object.");
  }
  if (options.platform !== "android" && options.platform !== "ios") {
    throw new TypeError("Deep-link plans require an ios or android platform.");
  }
  if (options.cold !== undefined && typeof options.cold !== "boolean") {
    throw new TypeError("Deep-link cold mode must be a boolean when supplied.");
  }
  assertDeepLink(options.url);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const dependencyRunner = options.dependencies?.runCommand;
  if (
    dependencyRunner !== undefined &&
    typeof dependencyRunner !== "function"
  ) {
    throw new TypeError("The deep-link command runner is invalid.");
  }
  const runner = dependencyRunner ?? defaultNativeAndroidLogCommandRunner;
  return options.platform === "android"
    ? createAndroidPlan(options, cwd, env, runner)
    : createIosPlan(options, cwd, env, runner);
}

export function parseNativeAndroidDeepLinkExecution(
  source: string,
  plan: NativeAndroidDeepLinkPlan,
): NativeAndroidDeepLinkExecution {
  const statuses = [];
  const activities = [];
  const launchStates = [];
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const status = /^Status:\s*(\S+)$/u.exec(trimmed)?.[1];
    if (status !== undefined) statuses.push(status);
    const activity = /^Activity:\s*(\S+)$/u.exec(trimmed)?.[1];
    if (activity !== undefined) activities.push(activity);
    const launchState =
      /^LaunchState:\s*([A-Z][A-Z0-9_]{0,23}(?: \([0-9]{1,6}\))?)$/u.exec(
        trimmed,
      )?.[1];
    if (launchState !== undefined) launchStates.push(launchState);
  }
  const activity = activities[0];
  const launchState = launchStates[0];
  if (
    statuses.length !== 1 ||
    statuses[0] !== "ok" ||
    activities.length !== 1 ||
    activity === undefined ||
    !activity.startsWith(`${plan.packageName}/`) ||
    launchStates.length !== 1 ||
    launchState === undefined
  ) {
    throw new TypeError(
      `Android did not confirm that ${plan.packageName} handled the deep link.`,
    );
  }
  return {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "android",
    packageName: plan.packageName,
    serial: plan.serial,
    url: plan.url,
    mode: plan.mode,
    terminatesExistingApplication: plan.terminatesExistingApplication,
    activity,
    launchState,
  };
}

export function parseNativeIosDeepLinkExecution(
  source: string,
  plan: NativeIosDeepLinkPlan,
): NativeIosDeepLinkExecution {
  if (Buffer.byteLength(source, "utf8") > MAX_CORE_DEVICE_RESULT_BYTES) {
    throw new RangeError(
      `CoreDevice launch result exceeds ${String(MAX_CORE_DEVICE_RESULT_BYTES)} bytes.`,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch {
    throw new TypeError("CoreDevice returned invalid launch JSON.");
  }
  if (
    !isRecord(document) ||
    !isRecord(document.info) ||
    document.info.outcome !== "success" ||
    "error" in document ||
    !isRecord(document.result) ||
    !isRecord(document.result.process) ||
    !Number.isSafeInteger(document.result.process.processIdentifier) ||
    Number(document.result.process.processIdentifier) <= 0 ||
    !isRecord(document.result.launchOptions) ||
    document.result.launchOptions.terminateExistingInstances !==
      plan.terminatesExistingApplication
  ) {
    throw new TypeError(
      `CoreDevice did not confirm the requested ${plan.mode} deep-link launch for ${plan.bundleIdentifier}.`,
    );
  }
  return {
    schemaVersion: 0,
    operation: "open-deep-link",
    platform: "ios",
    bundleIdentifier: plan.bundleIdentifier,
    device: plan.device,
    url: plan.url,
    mode: plan.mode,
    terminatesExistingApplication: plan.terminatesExistingApplication,
    processIdentifier: Number(document.result.process.processIdentifier),
  };
}

export const defaultNativeDeepLinkExecutor: NativeDeepLinkExecutor = async (
  plan,
  context,
) => {
  if (plan.platform === "android") {
    const result = await runCommand(
      context.runCommand,
      plan.cwd,
      context.env,
      plan.command,
      plan.args,
      `Android deep-link delivery to ${plan.packageName}`,
      COMMAND_TIMEOUT_MS,
    );
    return parseNativeAndroidDeepLinkExecution(result.stdout, plan);
  }

  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-ios-deep-link-run-"),
  );
  const resultPath = path.join(directory, "launch.json");
  try {
    const placeholderIndex = plan.args.indexOf(CORE_DEVICE_RESULT_PLACEHOLDER);
    if (
      placeholderIndex < 0 ||
      plan.args.lastIndexOf(CORE_DEVICE_RESULT_PLACEHOLDER) !== placeholderIndex
    ) {
      throw new TypeError(
        "The iOS deep-link plan has no unique CoreDevice result placeholder.",
      );
    }
    const args = [...plan.args];
    args[placeholderIndex] = resultPath;
    await runCommand(
      context.runCommand,
      plan.cwd,
      context.env,
      plan.command,
      args,
      `iOS deep-link delivery to ${plan.bundleIdentifier}`,
      COMMAND_TIMEOUT_MS,
    );
    let source: string;
    try {
      source = await readFile(resultPath, "utf8");
    } catch {
      throw new TypeError(
        "CoreDevice launch succeeded without writing its required JSON result.",
      );
    }
    return parseNativeIosDeepLinkExecution(source, plan);
  } finally {
    await rm(directory, { recursive: true });
  }
};

export function executeNativeDeepLinkPlan(
  plan: NativeDeepLinkPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly runCommand?: NativeDeepLinkCommandRunner;
    readonly executor?: NativeDeepLinkExecutor;
  } = {},
): Promise<NativeDeepLinkExecution> {
  const executor = options.executor ?? defaultNativeDeepLinkExecutor;
  return executor(plan, {
    env: options.env ?? process.env,
    runCommand: options.runCommand ?? defaultNativeAndroidLogCommandRunner,
  });
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_./:@%+=,<>-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", `'\\''`)}'`;
}

export function formatNativeDeepLinkPlan(plan: NativeDeepLinkPlan): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}
