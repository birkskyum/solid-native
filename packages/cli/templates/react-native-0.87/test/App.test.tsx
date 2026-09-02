/** @jsxImportSource @solid-native/core */
import assert from "node:assert/strict";
import test from "node:test";

import type {
  NetworkService,
  NetworkTextObserver,
  NetworkTextRequest,
  NetworkTextResult,
} from "@solid-native/networking";
import { renderNative, type NativeTestRender } from "@solid-native/testing";
import {
  captureNativeDiagnostics,
  expectNativeCommitBudget,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget,
} from "@solid-native/testing/diagnostics";
import { DEV } from "solid-js";

import { App } from "../src/App.tsx";

let capturedRequest: NetworkTextRequest | undefined;
let observer: NetworkTextObserver | undefined;
let resolveRequest!: (result: NetworkTextResult) => void;
let cancellationCount = 0;

const testNetwork: NetworkService = {
  platform: "android",
  requestText(request, nextObserver) {
    capturedRequest = request;
    observer = nextObserver;
    const result = new Promise<NetworkTextResult>((resolve) => {
      resolveRequest = resolve;
    });
    return {
      result,
      cancel() {
        cancellationCount += 1;
      },
    };
  },
};

async function exerciseApplication(screen: NativeTestRender): Promise<void> {
  screen.getByLabelText("Press count: 0");
  const counterCheckpoint = screen.commitCheckpoint();
  await screen.press(screen.getByRole("button", { name: "Increment counter" }));
  assert.equal(
    screen.getByLabelText("Press count: 1").textContent,
    "Press count: 1",
  );
  const counterCommit = screen.getCommit({
    afterSequence: counterCheckpoint,
    priority: "user-blocking",
    mutationTypes: ["update-text", "update-props"],
  });
  assert.equal(
    screen.getMutation({
      type: "update-text",
      afterSequence: counterCheckpoint,
    }).commit.sequence,
    counterCommit.sequence,
  );

  const requestCheckpoint = screen.commitCheckpoint();
  await screen.press(
    screen.getByRole("button", { name: "Check native network" }),
  );
  screen.getByText("Starting bounded native request…");
  screen.getMutation({
    type: "update-text",
    afterSequence: requestCheckpoint,
    priority: "user-blocking",
  });
  assert.equal(capturedRequest?.url, "https://example.com/");
  assert.equal(capturedRequest?.maxResponseCharacters, 131_072);

  const activeObserver = observer;
  assert.ok(activeObserver);
  const response = {
    status: 200,
    url: "https://example.com/",
    headers: { "content-type": "text/plain" },
  };
  const responseCheckpoint = screen.commitCheckpoint();
  const responseVisible = screen.findByText("Native response status: 200");
  queueMicrotask(() => activeObserver.onResponse?.(response));
  await responseVisible;
  screen.getMutation({
    type: "update-text",
    afterSequence: responseCheckpoint,
  });

  const chunkCheckpoint = screen.commitCheckpoint();
  const chunkVisible = screen.findByText("Native chunk 1: 12 characters");
  queueMicrotask(() =>
    activeObserver.onChunk?.({
      sequence: 1,
      text: "hello native",
      loaded: 12,
      total: 12,
    }),
  );
  await chunkVisible;
  screen.getMutation({
    type: "update-text",
    afterSequence: chunkCheckpoint,
  });
  resolveRequest({
    response,
    chunkCount: 1,
    receivedCharacters: 12,
  });
  await Promise.resolve();
  await Promise.resolve();
}

test("updates and streams through the Solid-owned native application", async () => {
  if (DEV === undefined) {
    const screen = await renderNative(() => <App network={testNetwork} />);
    try {
      await exerciseApplication(screen);
    } finally {
      await screen.cleanup();
    }
    assert.equal(cancellationCount, 0);
    screen.assertDisposed();
    return;
  }

  const { artifact, result: screen } = await captureNativeDiagnostics(
    async ({ render }) => {
      const rendered = await render(() => <App network={testNetwork} />);
      await exerciseApplication(rendered);
      return rendered;
    },
    { scenario: "starter counter and native network stream" },
  );

  assert.equal(cancellationCount, 0);
  screen.assertDisposed();
  expectNoDiagnostics(artifact.solid);
  expectNoWaste(artifact.solid);
  expectRerunBudget(artifact.solid, 6);
  expectNativeCommitBudget(artifact, {
    maxCommits: 6,
    maxMutations: 105,
    maxCommitsPerRender: 6,
    maxMutationsPerCommit: 48,
  });
});
