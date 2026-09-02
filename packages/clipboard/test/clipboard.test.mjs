import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIPBOARD_MAX_TEXT_LENGTH,
  createClipboardService,
} from "../dist/index.js";

function memoryAdapter(initialText = "") {
  return {
    text: initialText,
    async readText() {
      return this.text;
    },
    writeText(text) {
      this.text = text;
    },
  };
}

test("reads, writes, and clears bounded clipboard text", async () => {
  const adapter = memoryAdapter("native text");
  const clipboard = createClipboardService(adapter);

  assert.equal(await clipboard.readText(), "native text");
  clipboard.writeText("Solid text");
  assert.equal(adapter.text, "Solid text");
  clipboard.writeText("");
  assert.equal(adapter.text, "");
  clipboard.writeText("again");
  clipboard.clear();
  assert.equal(adapter.text, "");
  assert.ok(Object.isFrozen(clipboard));
});

test("rejects malformed adapters", () => {
  assert.throws(() => createClipboardService(null), /must be an object/u);
  assert.throws(
    () => createClipboardService({ readText() {}, writeText: true }),
    /readText\(\) and writeText\(\)/u,
  );
  assert.throws(
    () => createClipboardService({ readText: true, writeText() {} }),
    /readText\(\) and writeText\(\)/u,
  );
});

test("rejects malformed or unbounded application writes", () => {
  const clipboard = createClipboardService(memoryAdapter());
  assert.throws(() => clipboard.writeText(null), /must be a string/u);
  assert.throws(
    () => clipboard.writeText("x".repeat(CLIPBOARD_MAX_TEXT_LENGTH + 1)),
    /at most 1048576/u,
  );
});

test("rejects malformed or unbounded native reads", async () => {
  const adapter = memoryAdapter();
  const clipboard = createClipboardService(adapter);
  adapter.text = null;
  await assert.rejects(clipboard.readText(), /must be a string/u);
  adapter.text = "x".repeat(CLIPBOARD_MAX_TEXT_LENGTH + 1);
  await assert.rejects(clipboard.readText(), /at most 1048576/u);
});

test("preserves native read and write failures", async () => {
  const readError = new Error("native read failed");
  const writeError = new Error("native write failed");
  const clipboard = createClipboardService({
    readText() {
      return Promise.reject(readError);
    },
    writeText() {
      throw writeError;
    },
  });

  await assert.rejects(clipboard.readText(), readError);
  assert.throws(() => clipboard.writeText("x"), writeError);
  assert.throws(() => clipboard.clear(), writeError);
});
