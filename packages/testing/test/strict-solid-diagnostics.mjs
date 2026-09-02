import { DEV } from "solid-js";

if (DEV?.diagnostics === undefined) {
  throw new Error(
    "The strict Solid diagnostics preload requires the development runtime.",
  );
}

const failures = [];
const unsubscribe = DEV.diagnostics.subscribe((diagnostic) => {
  if (diagnostic.severity === "warn" || diagnostic.severity === "error") {
    failures.push(diagnostic);
  }
});

process.once("beforeExit", () => {
  unsubscribe();
  if (failures.length === 0) return;
  process.exitCode = 1;
  for (const diagnostic of failures) {
    console.error(
      `[SOLID_DEVELOPMENT_DIAGNOSTIC] ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
});
