import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function orders(source) {
  return [
    ...source.matchAll(
      /\{ id: "(ORD-\d+)", customer: "([^"]+)", amount: "(\$\d+)" \}/gu,
    ),
  ].map(([, id, customer, amount]) => ({ id, customer, amount }));
}

test("keeps the Solid and React mixed product workloads semantically matched", async () => {
  const [
    solid,
    solidEntry,
    baselineEntry,
    observedEntry,
    react,
    physicalScript,
  ] = await Promise.all([
    readFile(new URL("../product-workload-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../product-workload.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../product-workload-baseline.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../product-workload-observed.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../product-workload-control.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("./android-product-telemetry-test.sh", import.meta.url),
      "utf8",
    ),
  ]);
  const solidOrders = orders(solid);
  assert.equal(solidOrders.length, 12);
  assert.deepEqual(orders(react), solidOrders);

  for (const text of [
    "Fulfillment overview",
    "Orders processed ",
    "Active order ",
    "Priority reconciliation required",
    "Advance fulfillment workload",
    "Process next order",
    "Live order queue",
  ]) {
    assert.ok(solid.includes(text), `Solid workload omitted ${text}.`);
    assert.ok(react.includes(text), `React workload omitted ${text}.`);
  }
  assert.match(solid, /createSignal<OrderPhase>/u);
  assert.match(solid, /previousPhase\("settled"\)/u);
  assert.match(solid, /nextPhase\("active"\)/u);
  assert.match(react, /useState\(initialState\)/u);
  assert.match(react, /current\.phases\.map/u);
  assert.match(solid, /nextProcessed % 5 === 0/u);
  assert.match(react, /state\.processed % 5 === 0/u);
  assert.match(
    solidEntry,
    /runProductWorkload\(\{ variant: "solid-native" \}\)/u,
  );
  assert.match(
    baselineEntry,
    /runProductWorkload\(\{ variant: "baseline" \}\)/u,
  );
  assert.match(observedEntry, /createSampledCausalTelemetry/u);
  assert.match(observedEntry, /sampleRate: 1/u);
  for (const causalName of [
    "fulfillment.screen",
    "fulfillment.summary.output",
    "fulfillment.alert.output",
    "fulfillment.queue.output",
  ]) {
    assert.ok(
      solid.includes(causalName),
      `Solid workload omitted ${causalName}.`,
    );
  }
  assert.match(solid, /SOLID_NATIVE_PRODUCT_TELEMETRY_UPDATE/u);
  assert.match(solid, /SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT/u);
  assert.match(solid, /payloadValuesRetained: false/u);
  assert.match(physicalScript, /trap cleanup EXIT HUP INT TERM/u);
  assert.ok(
    physicalScript.indexOf('shell am force-stop "$app_id"') <
      physicalScript.indexOf("Verified 30 physical dashboard interactions"),
  );
  assert.ok(
    physicalScript.indexOf('uninstall "$app_id"') <
      physicalScript.indexOf("Verified 30 physical dashboard interactions"),
  );
});
