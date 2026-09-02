import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const UI_AUTOMATION_TIMEOUT_HINT =
  "Solid Native application code did not launch: XCTest timed out while enabling device UI automation. Keep the iPhone unlocked and awake, verify that UI Automation remains enabled in Developer settings, reconnect USB, and restart the phone before retrying. The runner will not retry automatically because repeated XCTest handshakes can heat the device.";

export function describeXCTestFailure(summary) {
  const failures = summary?.testFailures;
  if (!Array.isArray(failures)) return undefined;
  const failureText = failures
    .flatMap((failure) =>
      failure !== null && typeof failure === "object"
        ? [failure.failureText, failure.testName]
        : [],
    )
    .filter((value) => typeof value === "string")
    .join("\n");
  return /timed out while enabling automation mode/iu.test(failureText)
    ? UI_AUTOMATION_TIMEOUT_HINT
    : undefined;
}

export async function printXCTestFailureHint(resultBundlePath) {
  if (typeof resultBundlePath !== "string" || resultBundlePath.trim() === "") {
    return false;
  }
  try {
    const { stdout } = await execFileAsync(
      "xcrun",
      [
        "xcresulttool",
        "get",
        "test-results",
        "summary",
        "--path",
        resultBundlePath,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const hint = describeXCTestFailure(JSON.parse(stdout));
    if (hint === undefined) return false;
    console.error(`\n${hint}`);
    return true;
  } catch {
    // This diagnostic must never replace xcodebuild's original failure.
    return false;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  await printXCTestFailureHint(process.argv[2]);
}
