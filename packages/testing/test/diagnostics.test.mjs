import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Pressable, Text } from "@solid-native/core";
import { DEV, createComponent, createSignal } from "solid-js";

import {
  NATIVE_DIAGNOSTICS_MAX_BUDGET_FILE_BYTES,
  NativeDiagnosticsAssertionError,
  assertNativeDiagnosticsBudgetFile,
  captureNativeDiagnostics,
  expectNativeCommitBudget,
  expectNoDiagnostics,
  expectNoWaste,
  parseNativeDiagnosticsBudgetFile,
  serializeNativeDiagnosticsArtifact,
} from "../dist/diagnostics.js";

const developmentOnly = { skip: DEV === undefined };

test(
  "joins official Solid diagnostics to exact native commits",
  developmentOnly,
  async () => {
    let screen;
    const capture = await captureNativeDiagnostics(
      async ({ render }) => {
        const [count, setCount] = createSignal(0, { name: "counter" });
        screen = await render(
          () =>
            createComponent(Pressable, {
              accessibilityLabel: "Increment",
              onPress: () => setCount((value) => value + 1),
              get children() {
                return createComponent(Text, {
                  get children() {
                    return `Count: ${String(count())}`;
                  },
                });
              },
            }),
          { surface: { name: "diagnostic-counter" } },
        );
        await screen.press(screen.getByLabelText("Increment"));
        screen.getByText("Count: 1");
        return "updated";
      },
      { scenario: "counter press" },
    );

    assert.equal(capture.result, "updated");
    assert.equal(screen.disposed, true);
    assert.equal(Object.isFrozen(capture), true);
    assert.equal(Object.isFrozen(capture.artifact), true);
    assert.equal(capture.artifact.formatVersion, 0);
    assert.equal(capture.artifact.solid.formatVersion, 1);
    assert.equal(capture.artifact.solid.scenario, "counter press");
    assert.deepEqual(capture.artifact.solid.diagnostics, []);
    assert.deepEqual(
      capture.artifact.solid.attribution.reruns.map((rerun) => ({
        kind: rerun.nodeKind,
        causes: rerun.causes.map((cause) => ({
          kind: cause.kind,
          name: cause.name,
        })),
        changed: rerun.changed,
      })),
      [
        {
          kind: "effect",
          causes: [{ kind: "write", name: "counter" }],
          changed: true,
        },
      ],
    );
    assert.deepEqual(
      capture.artifact.renders.map((render) => ({
        renderId: render.renderId,
        surfaceName: render.surfaceName,
        commitCount: render.commitCount,
        mutationCount: render.mutationCount,
        commits: render.commits.map((commit) => ({
          sequence: commit.sequence,
          priority: commit.priority,
          mutationCount: commit.mutationCount,
          mutationCounts: commit.mutationCounts,
        })),
      })),
      [
        {
          renderId: 1,
          surfaceName: "diagnostic-counter",
          commitCount: 3,
          mutationCount: 16,
          commits: [
            {
              sequence: 1,
              priority: "normal",
              mutationCount: 8,
              mutationCounts: {
                "create-element": 3,
                "create-text": 1,
                "insert-child": 3,
                "update-event-listeners": 1,
              },
            },
            {
              sequence: 2,
              priority: "user-blocking",
              mutationCount: 1,
              mutationCounts: { "update-text": 1 },
            },
            {
              sequence: 3,
              priority: "normal",
              mutationCount: 7,
              mutationCounts: {
                "delete-node": 4,
                "remove-child": 3,
              },
            },
          ],
        },
      ],
    );

    expectNoDiagnostics(capture.artifact.solid);
    expectNoWaste(capture.artifact.solid);
    expectNativeCommitBudget(capture.artifact, {
      maxCommits: 3,
      maxMutations: 16,
      maxCommitsPerRender: 3,
      maxMutationsPerCommit: 8,
    });
    const checkedInBudget = parseNativeDiagnosticsBudgetFile(
      await readFile(
        new URL("./diagnostics-budget.json", import.meta.url),
        "utf8",
      ),
    );
    assertNativeDiagnosticsBudgetFile(capture.artifact, checkedInBudget);
    assert.throws(
      () => expectNativeCommitBudget(capture.artifact, { maxCommits: 2 }),
      (error) =>
        error instanceof NativeDiagnosticsAssertionError &&
        /commits 3 > 2/u.test(error.message),
    );
    assert.equal(
      JSON.parse(serializeNativeDiagnosticsArtifact(capture.artifact))
        .commitCount,
      3,
    );
  },
);

test(
  "parses and fails closed on malformed or unbudgeted native diagnostic policies",
  developmentOnly,
  async () => {
    const { artifact } = await captureNativeDiagnostics(
      async ({ render }) => {
        await render(() => createComponent(Text, { children: "Budgeted" }));
      },
      { scenario: "budget parser" },
    );
    const policy = parseNativeDiagnosticsBudgetFile(`{
      "formatVersion": 1,
      "scenarios": {
        "budget parser": {
          "maxReruns": 0,
          "maxWastedRuns": 0,
          "scopes": { "/^named-/": 0 },
          "native": {
            "maxCommits": 2,
            "maxMutations": 10,
            "maxCommitsPerRender": 2,
            "maxMutationsPerCommit": 5
          }
        }
      }
    }`);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.scenarios), true);
    assert.equal(Object.isFrozen(policy.scenarios["budget parser"]), true);
    assert.equal(
      Object.isFrozen(policy.scenarios["budget parser"].native),
      true,
    );
    const prototypeNames = parseNativeDiagnosticsBudgetFile(
      '{"formatVersion":1,"scenarios":{"__proto__":{"scopes":{"__proto__":0}}}}',
    );
    assert.equal(Object.getPrototypeOf(prototypeNames.scenarios), null);
    assert.equal(Object.hasOwn(prototypeNames.scenarios, "__proto__"), true);
    assert.equal(
      Object.getPrototypeOf(prototypeNames.scenarios.__proto__.scopes),
      null,
    );
    assertNativeDiagnosticsBudgetFile(artifact, policy);
    assert.throws(
      () =>
        assertNativeDiagnosticsBudgetFile(
          artifact,
          parseNativeDiagnosticsBudgetFile(
            '{"formatVersion":1,"scenarios":{"another scenario":{}}}',
          ),
        ),
      (error) =>
        error instanceof NativeDiagnosticsAssertionError &&
        /No native diagnostics budget is defined/u.test(error.message),
    );
    assert.throws(
      () =>
        assertNativeDiagnosticsBudgetFile(
          artifact,
          parseNativeDiagnosticsBudgetFile(
            '{"formatVersion":1,"scenarios":{"budget parser":{"native":{"maxCommits":1}}}}',
          ),
        ),
      /Native commit budget exceeded: commits 2 > 1/u,
    );
    for (const invalid of [
      "not json",
      '{"formatVersion":0,"scenarios":{}}',
      '{"formatVersion":1,"scenarios":[],"extra":true}',
      '{"formatVersion":1,"scenarios":{"bad\\nname":{}}}',
      '{"formatVersion":1,"scenarios":{"scenario":{"unknown":0}}}',
      '{"formatVersion":1,"scenarios":{"scenario":{"allow":["A","A"]}}}',
      '{"formatVersion":1,"scenarios":{"scenario":{"scopes":{"/[a-/":1}}}}',
      '{"formatVersion":1,"scenarios":{"scenario":{"native":{"maxCommits":-1}}}}',
    ]) {
      assert.throws(() => parseNativeDiagnosticsBudgetFile(invalid));
    }
    assert.throws(
      () =>
        parseNativeDiagnosticsBudgetFile(
          "x".repeat(NATIVE_DIAGNOSTICS_MAX_BUDGET_FILE_BYTES + 1),
        ),
      /exceeds 1048576 UTF-8 bytes/u,
    );
  },
);

test(
  "cleans every native render when a diagnostic scenario fails",
  developmentOnly,
  async () => {
    const screens = [];
    const failure = new Error("scenario failed");
    await assert.rejects(
      () =>
        captureNativeDiagnostics(async ({ render }) => {
          screens.push(
            await render(() => createComponent(Text, { children: "First" })),
          );
          screens.push(
            await render(() => createComponent(Text, { children: "Second" })),
          );
          throw failure;
        }),
      failure,
    );
    assert.deepEqual(
      screens.map((screen) => screen.disposed),
      [true, true],
    );
  },
);

test(
  "bounds native diagnostic capture before retaining scenario work",
  developmentOnly,
  async () => {
    await assert.rejects(
      () =>
        captureNativeDiagnostics(
          async ({ render }) => {
            await render(() => createComponent(Text, { children: "First" }));
            await render(() => createComponent(Text, { children: "Second" }));
          },
          { maxRenders: 1 },
        ),
      /at most 1 renders/u,
    );
    await assert.rejects(
      () => captureNativeDiagnostics(async () => {}, { maxRenders: 0 }),
      /maxRenders must be a safe integer/u,
    );
    await assert.rejects(
      () =>
        captureNativeDiagnostics(async () => {}, {
          scenario: "x".repeat(129),
        }),
      /scenario must contain 1-128 characters/u,
    );
  },
);
