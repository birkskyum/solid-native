import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  correlateNativeSolidDiagnostics,
  parseCausalDebugSnapshot,
  type CausalDebugSnapshot,
  type TelemetryAttributes,
} from "@solid-native/observability";

import {
  inspectNativeCausalDebugSnapshot,
  NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT,
  readNativeCausalDebugSnapshotFile,
  readNativeCausalDebugSnapshotStream,
  type NativeCausalDebugInputStream,
} from "./causal-debug.js";
import { readNativeSolidDiagnosticsDebugFile } from "./solid-diagnostics-correlation.js";

export const NATIVE_CAUSAL_DEBUG_MAX_REPORT_BYTES = 33_554_432;

export interface CreateNativeCausalDebugReportOptions {
  /** Optional value-free Solid diagnostics artifact to correlate locally. */
  readonly diagnostics?: unknown;
  readonly includeAttributes?: boolean;
  readonly operationId?: string;
}

export interface CreateNativeCausalDebugReportFileOptions extends CreateNativeCausalDebugReportOptions {
  readonly diagnosticsPath?: string;
  readonly snapshotPath: string;
  readonly cwd?: string;
}

export interface WriteNativeCausalDebugReportFileOptions {
  /** Absolute path or a path relative to cwd. Existing files are never replaced. */
  readonly outputPath: string;
  /** A report returned by one of the create/capture report APIs. */
  readonly report: string;
  readonly cwd?: string;
}

interface NativeCausalDebugReportOperation {
  readonly operationId: string;
  readonly groupId: string;
  readonly name: string;
  readonly status: "active" | "ok" | "error" | "cancelled";
  readonly causes: readonly string[];
  readonly unresolvedCauseIds: readonly string[];
  readonly offset: number;
  readonly duration: number;
  readonly attributes?: Readonly<{
    readonly start: TelemetryAttributes;
    readonly finish?: TelemetryAttributes;
  }>;
}

interface NativeCausalDebugReportGroup {
  readonly groupId: string;
  readonly operationIds: readonly string[];
  readonly operationNames: readonly string[];
  readonly entryOperationIds: readonly string[];
  readonly terminalOperationIds: readonly string[];
  readonly unresolvedCauseIds: readonly string[];
  readonly operationCount: number;
  readonly activeOperationCount: number;
  readonly okOperationCount: number;
  readonly errorOperationCount: number;
  readonly cancelledOperationCount: number;
  readonly status: "active" | "ok" | "error" | "cancelled";
  readonly offset: number;
  readonly duration: number;
}

const REPORT_STYLE = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #07110f;
  color: #e7f4ef;
  --panel: #0d1b18;
  --panel-strong: #11241f;
  --line: #24423a;
  --muted: #92aaa2;
  --accent: #58e6b0;
  --accent-strong: #8af5ce;
  --error: #ff6b7d;
  --cancelled: #f7bf64;
  --active: #76a9ff;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: radial-gradient(circle at 15% -20%, #153b31 0, #07110f 38rem); }
button, input, select { font: inherit; }
header { padding: 2.4rem clamp(1rem, 4vw, 4rem) 1.25rem; border-bottom: 1px solid var(--line); }
.eyebrow { margin: 0 0 .5rem; color: var(--accent); font-size: .75rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.9rem, 5vw, 3.4rem); letter-spacing: -.045em; }
.subtitle { max-width: 56rem; margin: .8rem 0 0; color: var(--muted); line-height: 1.55; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; padding: 1rem clamp(1rem, 4vw, 4rem); margin: 0; }
.summary div { padding: .85rem 1rem; border: 1px solid var(--line); border-radius: .75rem; background: color-mix(in srgb, var(--panel) 90%, transparent); }
.summary dt { color: var(--muted); font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
.summary dd { margin: .35rem 0 0; font-size: 1.18rem; font-variant-numeric: tabular-nums; }
.diagnostics-panel { margin: 0 clamp(1rem, 4vw, 4rem) 1rem; padding: 1rem; border: 1px solid var(--line); border-radius: .85rem; background: var(--panel); }
.diagnostics-panel h2 { margin: 0; font-size: 1rem; }
.diagnostics-copy { margin: .45rem 0 .85rem; color: var(--muted); font-size: .82rem; line-height: 1.45; }
.diagnostics-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .65rem; }
.diagnostics-output { min-width: 0; padding: .75rem; border: 1px solid var(--line); border-radius: .65rem; background: var(--panel-strong); }
.diagnostics-output h3 { margin: 0 0 .4rem; color: var(--accent-strong); font-size: .86rem; overflow-wrap: anywhere; }
.diagnostics-output p { margin: .3rem 0; color: var(--muted); font-size: .76rem; line-height: 1.4; }
.diagnostics-frames { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .55rem; }
.controls { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; padding: 0 clamp(1rem, 4vw, 4rem) 1rem; }
.controls label { display: grid; gap: .35rem; color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; }
.controls input, .controls select { min-height: 2.6rem; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: .55rem; padding: .55rem .7rem; text-transform: none; letter-spacing: normal; }
.controls input { width: min(28rem, 72vw); }
.visible-count { color: var(--muted); font-size: .85rem; padding-bottom: .65rem; }
main { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(18rem, .85fr); gap: 1rem; padding: 0 clamp(1rem, 4vw, 4rem) 3rem; align-items: start; }
.panel { min-width: 0; border: 1px solid var(--line); border-radius: .85rem; background: var(--panel); overflow: hidden; }
.panel-heading { padding: .8rem 1rem; border-bottom: 1px solid var(--line); color: var(--muted); font-size: .78rem; letter-spacing: .09em; text-transform: uppercase; }
#operations, #groups { list-style: none; margin: 0; padding: 0; max-height: calc(100vh - 20rem); overflow: auto; }
[hidden] { display: none !important; }
.operation-row { border-bottom: 1px solid color-mix(in srgb, var(--line) 65%, transparent); }
.operation-row:last-child { border-bottom: 0; }
.operation-row[hidden] { display: none; }
.operation-button { width: 100%; border: 0; color: inherit; background: transparent; display: grid; grid-template-columns: minmax(9rem, 1.1fr) minmax(9rem, 1.4fr) auto; gap: .8rem; align-items: center; text-align: left; padding: .72rem 1rem; cursor: pointer; }
.operation-button:hover, .operation-button:focus-visible { background: var(--panel-strong); outline: none; }
.operation-button[aria-pressed="true"] { background: #18382f; box-shadow: inset .22rem 0 var(--accent); }
.operation-name { min-width: 0; }
.operation-name strong, .operation-name code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.operation-name strong { font-size: .86rem; }
.operation-name code { margin-top: .25rem; color: var(--muted); font-size: .71rem; }
.timeline { width: 100%; height: 1.15rem; overflow: visible; }
.timeline-track { fill: #193029; }
.timeline-bar { fill: var(--accent); }
.timeline-bar.event { fill: #55d6e8; }
.timeline-bar.computation { fill: #a888ff; }
.timeline-bar.commit { fill: #58e6b0; }
.timeline-bar.mount { fill: #e8cf62; }
.timeline-bar.frame { fill: #ff9e64; }
.timeline-bar.owner { fill: #e782ff; }
.timeline-bar.task { fill: #78a8ff; }
.timeline-bar.command, .timeline-bar.measure { fill: #ff79a7; }
.status { border: 1px solid var(--line); border-radius: 999px; padding: .25rem .45rem; color: var(--muted); font-size: .68rem; text-transform: uppercase; }
.status.error { color: var(--error); border-color: color-mix(in srgb, var(--error) 55%, var(--line)); }
.status.cancelled { color: var(--cancelled); }
.status.active { color: var(--active); }
#detail { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow: auto; padding: 1rem; }
#detail h2 { margin: 0; font-size: 1.12rem; }
#detail > code { display: block; margin: .4rem 0 1rem; color: var(--muted); overflow-wrap: anywhere; }
.detail-grid { display: grid; grid-template-columns: auto 1fr; gap: .45rem .8rem; margin: 0 0 1rem; font-size: .83rem; }
.detail-grid dt { color: var(--muted); }
.detail-grid dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.link-section { margin-top: 1rem; }
.link-section h3 { margin: 0 0 .5rem; color: var(--muted); font-size: .74rem; letter-spacing: .08em; text-transform: uppercase; }
.link-list { display: flex; flex-wrap: wrap; gap: .4rem; }
.causal-link { max-width: 100%; border: 1px solid var(--line); border-radius: .45rem; color: var(--accent-strong); background: var(--panel-strong); padding: .35rem .5rem; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.causal-link:hover, .causal-link:focus-visible { border-color: var(--accent); outline: none; }
.empty { color: var(--muted); font-size: .82rem; }
.warning { color: var(--cancelled); border-left: .2rem solid var(--cancelled); padding-left: .65rem; font-size: .82rem; line-height: 1.45; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: .7rem; border-radius: .55rem; background: #07110f; color: #cde1d9; font-size: .72rem; }
footer { padding: 0 clamp(1rem, 4vw, 4rem) 2rem; color: var(--muted); font-size: .78rem; }
@media (max-width: 820px) {
  main { grid-template-columns: 1fr; }
  #detail { position: static; max-height: none; }
  #operations, #groups { max-height: 55vh; }
  .operation-button { grid-template-columns: minmax(7rem, 1fr) minmax(7rem, 1fr) auto; }
}
`;

const REPORT_SCRIPT = `
(function () {
  "use strict";
  var encoded = document.getElementById("report-data").textContent.trim();
  var binary = atob(encoded);
  var bytes = new Uint8Array(binary.length);
  for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  var report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  var byId = new Map(report.operations.map(function (operation) { return [operation.operationId, operation]; }));
  var groupById = new Map(report.groups.map(function (group) { return [group.groupId, group]; }));
  var effects = new Map();
  report.operations.forEach(function (operation) {
    operation.causes.forEach(function (causeId) {
      if (!byId.has(causeId)) return;
      var values = effects.get(causeId) || [];
      values.push(operation.operationId);
      effects.set(causeId, values);
    });
  });

  function element(name, className, text) {
    var value = document.createElement(name);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = String(text);
    return value;
  }

  function metric(term, value) {
    var wrapper = element("div");
    wrapper.append(element("dt", "", term), element("dd", "", value));
    document.getElementById("summary").append(wrapper);
  }

  function capturedAt(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  metric("Captured", capturedAt(report.capturedAt));
  metric("Groups", report.groupCount);
  metric("Operations", report.operationCount);
  metric("Active", report.activeOperationCount);
  metric("Errors", report.statusCounts.error);
  metric("Evicted", report.evictedOperationCount);
  metric("Discarded", report.discardedRecordCount);
  if (report.diagnosticsCorrelation) {
    var correlation = report.diagnosticsCorrelation;
    metric("Solid reruns", correlation.rerunCount);
    metric("Native frame chains", correlation.outputs.reduce(function (total, output) { return total + output.completeNativeFrameChainCount; }, 0));
    var diagnosticsPanel = document.getElementById("diagnostics-correlation");
    diagnosticsPanel.hidden = false;
    diagnosticsPanel.append(
      element("h2", "", "Solid → native correlation"),
      element("p", "diagnostics-copy", "Static computation names are matched inside the bounded diagnostics window, then followed through retained commit, mount, and frame edges. Exact per-rerun join: no.")
    );
    var diagnosticsList = element("div", "diagnostics-list");
    correlation.outputs.forEach(function (output) {
      var card = element("article", "diagnostics-output");
      card.append(
        element("h3", "", output.name),
        element("p", "", output.rerunCount + " Solid reruns · " + output.nativeComputationOperationIds.length + " native computations · " + output.completeNativeFrameChainCount + " complete frame chains"),
        element("p", "", output.causeNames.length === 0 ? "No retained named causes" : "Named causes: " + output.causeNames.join(", "))
      );
      var frameLinks = element("div", "diagnostics-frames");
      output.nativeFrameOperationIds.filter(function (id) { return byId.has(id); }).forEach(function (id) {
        var button = element("button", "causal-link", id);
        button.type = "button";
        button.addEventListener("click", function () { select(id, true); });
        frameLinks.append(button);
      });
      if (frameLinks.childElementCount > 0) card.append(frameLinks);
      diagnosticsList.append(card);
    });
    diagnosticsPanel.append(diagnosticsList);
  }

  var span = report.span === 0 ? 1 : report.span;

  function timeline(offset, duration, kind, label) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "timeline");
    svg.setAttribute("viewBox", "0 0 100 1");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-label", label);
    var track = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    track.setAttribute("class", "timeline-track");
    track.setAttribute("x", "0");
    track.setAttribute("y", "0");
    track.setAttribute("width", "100");
    track.setAttribute("height", "1");
    var bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    var left = Math.max(0, Math.min(99.7, offset / span * 100));
    var width = Math.max(.3, Math.min(100 - left, duration / span * 100));
    bar.setAttribute("class", "timeline-bar " + kind);
    bar.setAttribute("x", String(left));
    bar.setAttribute("y", "0");
    bar.setAttribute("width", String(width));
    bar.setAttribute("height", "1");
    svg.append(track, bar);
    return svg;
  }

  function groupTitle(group) {
    var names = group.operationNames.map(function (name) { return name.replace("solid-native.", ""); });
    var omitted = Math.max(0, names.length - 4);
    var visible = names.slice(-4).join(" → ");
    return omitted === 0 ? visible : "+" + omitted + " earlier · " + visible;
  }

  var groupList = document.getElementById("groups");
  var groupRows = new Map();
  report.groups.forEach(function (group) {
    var row = element("li", "operation-row");
    var button = element("button", "operation-button");
    button.type = "button";
    button.dataset.groupId = group.groupId;
    button.setAttribute("aria-pressed", "false");
    var label = element("span", "operation-name");
    label.append(element("strong", "", groupTitle(group)), element("code", "", group.groupId));
    button.append(
      label,
      timeline(group.offset, group.duration, "", "Group starts " + group.offset + " ms after origin and spans " + group.duration + " ms"),
      element("span", "status " + group.status, group.status)
    );
    button.addEventListener("click", function () { selectGroup(group.groupId, true); });
    row.append(button);
    groupList.append(row);
    groupRows.set(group.groupId, { row: row, button: button });
  });

  var list = document.getElementById("operations");
  var rows = new Map();
  report.operations.forEach(function (operation) {
    var row = element("li", "operation-row");
    var button = element("button", "operation-button");
    button.type = "button";
    button.dataset.operationId = operation.operationId;
    button.setAttribute("aria-pressed", "false");

    var label = element("span", "operation-name");
    label.append(
      element("strong", "", operation.name.replace("solid-native.", "")),
      element("code", "", operation.operationId)
    );

    button.append(
      label,
      timeline(operation.offset, operation.duration, operation.name.replace("solid-native.", ""), "Starts " + operation.offset + " ms after origin and lasts " + operation.duration + " ms"),
      element("span", "status " + operation.status, operation.status)
    );
    button.addEventListener("click", function () { select(operation.operationId, true); });
    row.append(button);
    list.append(row);
    rows.set(operation.operationId, { row: row, button: button });
  });

  function closure(initial, next) {
    var seen = new Set();
    var queue = initial.slice();
    while (queue.length > 0) {
      var id = queue.shift();
      if (seen.has(id) || !byId.has(id)) continue;
      seen.add(id);
      next(id).forEach(function (candidate) { if (!seen.has(candidate)) queue.push(candidate); });
    }
    return seen;
  }

  function detailValue(list, term, value) {
    list.append(element("dt", "", term), element("dd", "", value));
  }

  function linkSection(parent, title, ids, onSelect) {
    var section = element("section", "link-section");
    section.append(element("h3", "", title));
    var links = element("div", "link-list");
    if (ids.length === 0) links.append(element("span", "empty", "None"));
    ids.forEach(function (id) {
      var button = element("button", "causal-link", id);
      button.type = "button";
      button.addEventListener("click", function () { onSelect(id); });
      links.append(button);
    });
    section.append(links);
    parent.append(section);
  }

  function renderDetail(operation) {
    var detail = document.getElementById("detail");
    detail.replaceChildren();
    detail.append(element("h2", "", operation.name), element("code", "", operation.operationId));
    var values = element("dl", "detail-grid");
    var ancestors = closure(operation.causes, function (id) { return byId.get(id).causes; });
    var descendants = closure(effects.get(operation.operationId) || [], function (id) { return effects.get(id) || []; });
    detailValue(values, "Status", operation.status);
    detailValue(values, "Start offset", operation.offset + " ms");
    detailValue(values, "Duration", operation.duration + " ms");
    detailValue(values, "Retained ancestors", ancestors.size);
    detailValue(values, "Retained descendants", descendants.size);
    detail.append(values);
    linkSection(detail, "Retained group", [operation.groupId], function (id) { selectGroup(id, true); });
    linkSection(detail, "Direct causes", operation.causes.filter(function (id) { return byId.has(id); }), function (id) { select(id, true); });
    linkSection(detail, "Direct effects", effects.get(operation.operationId) || [], function (id) { select(id, true); });
    if (operation.unresolvedCauseIds.length > 0) {
      detail.append(element("p", "warning", operation.unresolvedCauseIds.length + " direct cause ID(s) were evicted or came from another process: " + operation.unresolvedCauseIds.join(", ")));
    }
    if (operation.attributes) {
      var attributes = element("section", "link-section");
      attributes.append(element("h3", "", "Explicitly included attributes"));
      attributes.append(element("pre", "", JSON.stringify(operation.attributes, null, 2)));
      detail.append(attributes);
    }
  }

  function renderGroupDetail(group) {
    var detail = document.getElementById("detail");
    detail.replaceChildren();
    detail.append(element("h2", "", "Retained causal group"), element("code", "", group.groupId));
    var values = element("dl", "detail-grid");
    detailValue(values, "Operations", group.operationCount);
    detailValue(values, "Status", group.status);
    detailValue(values, "Start offset", group.offset + " ms");
    detailValue(values, "Span", group.duration + " ms");
    detailValue(values, "Active", group.activeOperationCount);
    detailValue(values, "OK", group.okOperationCount);
    detailValue(values, "Errors", group.errorOperationCount);
    detailValue(values, "Cancelled", group.cancelledOperationCount);
    detail.append(values);
    linkSection(detail, "Operations", group.operationIds, function (id) { select(id, true); });
    linkSection(detail, "Entries", group.entryOperationIds, function (id) { select(id, true); });
    linkSection(detail, "Terminals", group.terminalOperationIds, function (id) { select(id, true); });
    if (group.unresolvedCauseIds.length > 0) {
      detail.append(element("p", "warning", group.unresolvedCauseIds.length + " cause ID(s) were evicted or came from another process: " + group.unresolvedCauseIds.join(", ")));
    }
    detail.append(element("p", "empty", "The group ID is the earliest retained operation ID. It can change after eviction and is not a distributed trace ID."));
  }

  var selectedId;
  var selectedGroupId;
  function select(operationId, updateHash) {
    var operation = byId.get(operationId);
    if (!operation) return;
    if (selectedId && rows.has(selectedId)) rows.get(selectedId).button.setAttribute("aria-pressed", "false");
    if (selectedGroupId && groupRows.has(selectedGroupId)) groupRows.get(selectedGroupId).button.setAttribute("aria-pressed", "false");
    selectedGroupId = undefined;
    selectedId = operationId;
    rows.get(operationId).button.setAttribute("aria-pressed", "true");
    renderDetail(operation);
    if (updateHash) {
      try { history.replaceState(null, "", "#operation=" + encodeURIComponent(operationId)); } catch (_) {}
    }
  }

  function selectGroup(groupId, updateHash) {
    var group = groupById.get(groupId);
    if (!group) return;
    if (selectedId && rows.has(selectedId)) rows.get(selectedId).button.setAttribute("aria-pressed", "false");
    selectedId = undefined;
    if (selectedGroupId && groupRows.has(selectedGroupId)) groupRows.get(selectedGroupId).button.setAttribute("aria-pressed", "false");
    selectedGroupId = groupId;
    groupRows.get(groupId).button.setAttribute("aria-pressed", "true");
    renderGroupDetail(group);
    if (updateHash) {
      try { history.replaceState(null, "", "#group=" + encodeURIComponent(groupId)); } catch (_) {}
    }
  }

  var search = document.getElementById("search");
  var status = document.getElementById("status-filter");
  var view = document.getElementById("view-filter");
  function filter() {
    var query = search.value.trim().toLocaleLowerCase();
    var statusValue = status.value;
    var grouped = view.value === "groups";
    groupList.hidden = !grouped;
    list.hidden = grouped;
    var values = grouped ? report.groups : report.operations;
    var visible = 0;
    values.forEach(function (value) {
      var ids = grouped ? value.operationIds : [value.operationId];
      var names = grouped ? value.operationNames : [value.name];
      var matchesText = query === "" || ids.concat(names).some(function (candidate) { return candidate.toLocaleLowerCase().includes(query); });
      var matchesStatus = statusValue === "all" || value.status === statusValue;
      var row = grouped ? groupRows.get(value.groupId).row : rows.get(value.operationId).row;
      row.hidden = !(matchesText && matchesStatus);
      if (matchesText && matchesStatus) visible += 1;
    });
    document.getElementById("visible-count").textContent = visible + " of " + values.length + (grouped ? " groups" : " operations");
  }
  search.addEventListener("input", filter);
  status.addEventListener("change", filter);
  view.addEventListener("change", function () {
    if (view.value === "groups" && selectedId && byId.has(selectedId)) selectGroup(byId.get(selectedId).groupId, true);
    else if (view.value === "operations" && selectedGroupId && groupById.has(selectedGroupId)) {
      var ids = groupById.get(selectedGroupId).operationIds;
      if (ids.length > 0) select(ids[0], true);
    }
    filter();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
    }
  });
  window.addEventListener("hashchange", function () {
    var values = new URLSearchParams(location.hash.slice(1));
    var operationId = values.get("operation");
    var groupId = values.get("group");
    if (operationId) { view.value = "operations"; select(operationId, false); filter(); }
    else if (groupId) { view.value = "groups"; selectGroup(groupId, false); filter(); }
  });
  var hashValues = new URLSearchParams(location.hash.slice(1));
  var hashOperationId = hashValues.get("operation");
  var hashGroupId = hashValues.get("group");
  if (hashOperationId && byId.has(hashOperationId)) {
    view.value = "operations";
    select(hashOperationId, false);
  } else if (hashGroupId && groupById.has(hashGroupId)) {
    selectGroup(hashGroupId, false);
  } else if (report.selectedOperationId && byId.has(report.selectedOperationId)) {
    view.value = "operations";
    select(report.selectedOperationId, false);
  } else if (report.groups.length > 0) {
    selectGroup(report.groups[0].groupId, false);
  }
  filter();
})();
`;

function cspHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("base64");
}

function operationTiming(
  snapshot: CausalDebugSnapshot,
  operation: CausalDebugSnapshot["operations"][number],
): Readonly<{ duration: number; end: number }> {
  const duration =
    operation.duration ?? snapshot.capturedAt - operation.startedAt;
  const end = operation.startedAt + duration;
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(end)) {
    throw new RangeError(
      `Causal operation ${JSON.stringify(operation.operationId)} cannot be represented in the offline report timeline.`,
    );
  }
  return { duration, end };
}

/** Creates one offline, content-security-policy-locked causal debugger. */
export function createNativeCausalDebugReport(
  value: unknown,
  options: CreateNativeCausalDebugReportOptions = {},
): string {
  const snapshot = parseCausalDebugSnapshot(value);
  const diagnosticsCorrelation =
    options.diagnostics === undefined
      ? undefined
      : correlateNativeSolidDiagnostics(options.diagnostics, snapshot);
  const inspection = inspectNativeCausalDebugSnapshot(snapshot, options);
  const retainedIds = new Set(
    snapshot.operations.map((operation) => operation.operationId),
  );
  let retainedFlowCount = 0;
  const timings = new Map<
    string,
    Readonly<{ duration: number; end: number }>
  >();
  for (const operation of snapshot.operations) {
    timings.set(operation.operationId, operationTiming(snapshot, operation));
    for (const causeId of operation.causes) {
      if (!retainedIds.has(causeId)) continue;
      retainedFlowCount += 1;
      if (retainedFlowCount > NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT) {
        throw new RangeError(
          `The causal debug report exceeds ${NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT} retained flows.`,
        );
      }
    }
  }
  const origin = snapshot.operations.reduce(
    (minimum, operation) => Math.min(minimum, operation.startedAt),
    snapshot.capturedAt,
  );
  const end = snapshot.operations.reduce(
    (maximum, operation) =>
      Math.max(maximum, timings.get(operation.operationId)!.end),
    snapshot.capturedAt,
  );
  const span = end - origin;
  if (!Number.isFinite(span) || span < 0) {
    throw new RangeError(
      "The causal debug snapshot cannot be represented in the offline report timeline.",
    );
  }
  const groupIdByOperationId = new Map(
    inspection.groups.flatMap((group) =>
      group.operationIds.map((operationId) => [operationId, group.groupId]),
    ),
  );
  const operations: NativeCausalDebugReportOperation[] =
    snapshot.operations.map((operation) => {
      const timing = timings.get(operation.operationId)!;
      const offset = operation.startedAt - origin;
      if (!Number.isFinite(offset) || offset < 0) {
        throw new RangeError(
          `Causal operation ${JSON.stringify(operation.operationId)} has an invalid offline report offset.`,
        );
      }
      const groupId = groupIdByOperationId.get(operation.operationId);
      if (groupId === undefined) {
        throw new TypeError(
          `Causal operation ${JSON.stringify(operation.operationId)} has no retained report group.`,
        );
      }
      return {
        operationId: operation.operationId,
        groupId,
        name: operation.name,
        status: operation.status ?? "active",
        causes: operation.causes,
        unresolvedCauseIds: operation.causes.filter(
          (causeId) => !retainedIds.has(causeId),
        ),
        offset,
        duration: timing.duration,
        ...(options.includeAttributes === true
          ? {
              attributes: {
                start: operation.startAttributes,
                ...(operation.finishAttributes === undefined
                  ? {}
                  : { finish: operation.finishAttributes }),
              },
            }
          : {}),
      };
    });
  const groups: NativeCausalDebugReportGroup[] = inspection.groups.map(
    (group) => {
      const groupEnd = group.operationIds.reduce(
        (maximum, operationId) =>
          Math.max(maximum, timings.get(operationId)!.end),
        group.startedAt,
      );
      const offset = group.startedAt - origin;
      const duration = groupEnd - group.startedAt;
      if (
        !Number.isFinite(offset) ||
        offset < 0 ||
        !Number.isFinite(duration) ||
        duration < 0
      ) {
        throw new RangeError(
          `Causal group ${JSON.stringify(group.groupId)} cannot be represented in the offline report timeline.`,
        );
      }
      const status =
        group.errorOperationCount > 0
          ? "error"
          : group.activeOperationCount > 0
            ? "active"
            : group.cancelledOperationCount > 0
              ? "cancelled"
              : "ok";
      return {
        ...group,
        status,
        offset,
        duration,
      };
    },
  );
  const document = {
    kind: "solid-native.causal-debug-report",
    schemaVersion: 1,
    capturedAt: snapshot.capturedAt,
    origin,
    span,
    operationCount: inspection.operationCount,
    groupCount: groups.length,
    activeOperationCount: inspection.activeOperationCount,
    evictedOperationCount: inspection.evictedOperationCount,
    discardedRecordCount: inspection.discardedRecordCount,
    statusCounts: inspection.statusCounts,
    ...(options.operationId === undefined
      ? {}
      : { selectedOperationId: options.operationId }),
    ...(diagnosticsCorrelation === undefined ? {} : { diagnosticsCorrelation }),
    operations,
    groups,
  };
  const encoded = Buffer.from(JSON.stringify(document), "utf8").toString(
    "base64",
  );
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${cspHash(REPORT_SCRIPT)}'`,
    `style-src 'sha256-${cspHash(REPORT_STYLE)}'`,
    "base-uri 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join("; ");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Solid Native causal report</title>
<style>${REPORT_STYLE}</style>
</head>
<body>
<header>
  <p class="eyebrow">Solid Native · Offline debugger</p>
  <h1>Causal report</h1>
  <p class="subtitle">Follow native work from input and Solid computations through Fabric commits, mounts, and frame opportunities. This file makes no network requests.</p>
</header>
<dl class="summary" id="summary"></dl>
<section class="diagnostics-panel" id="diagnostics-correlation" aria-label="Solid to native diagnostics correlation" hidden></section>
<section class="controls" aria-label="Operation filters">
  <label>View<select id="view-filter"><option value="groups">Causal groups</option><option value="operations">Operations</option></select></label>
  <label>Search<input id="search" type="search" autocomplete="off" placeholder="Group, operation ID, or kind" aria-keyshortcuts="/"></label>
  <label>Status<select id="status-filter"><option value="all">All</option><option value="active">Active</option><option value="ok">OK</option><option value="error">Error</option><option value="cancelled">Cancelled</option></select></label>
  <span class="visible-count" id="visible-count"></span>
</section>
<main>
  <section class="panel" aria-label="Causal timeline"><div class="panel-heading">Timeline</div><ol id="groups"></ol><ol id="operations" hidden></ol></section>
  <aside class="panel" id="detail" aria-live="polite"><p class="empty">Select an operation to inspect its causal neighborhood.</p></aside>
</main>
<footer>${options.includeAttributes === true ? "Application-authored attributes were explicitly included." : "Application-authored attributes were excluded. Regenerate with --show-attributes only when their disclosure is intended."}${diagnosticsCorrelation === undefined ? "" : " Bounded static Solid diagnostics names were explicitly included; reactive values remain excluded."}</footer>
<div id="report-data" hidden>${encoded}</div>
<script>${REPORT_SCRIPT}</script>
</body>
</html>
`;
  if (Buffer.byteLength(html, "utf8") > NATIVE_CAUSAL_DEBUG_MAX_REPORT_BYTES) {
    throw new RangeError(
      `The causal debug report exceeds ${NATIVE_CAUSAL_DEBUG_MAX_REPORT_BYTES} bytes.`,
    );
  }
  return html;
}

export async function createNativeCausalDebugReportFile(
  options: CreateNativeCausalDebugReportFileOptions,
): Promise<string> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Causal debug report file options are required.");
  }
  if (
    options.diagnostics !== undefined &&
    options.diagnosticsPath !== undefined
  ) {
    throw new TypeError(
      "Causal debug report diagnostics and diagnosticsPath are mutually exclusive.",
    );
  }
  const [snapshot, fileDiagnostics] = await Promise.all([
    readNativeCausalDebugSnapshotFile(options.snapshotPath, options.cwd),
    options.diagnosticsPath === undefined
      ? undefined
      : readNativeSolidDiagnosticsDebugFile(
          options.diagnosticsPath,
          options.cwd,
        ),
  ]);
  return createNativeCausalDebugReport(snapshot, {
    ...(options.includeAttributes === undefined
      ? {}
      : { includeAttributes: options.includeAttributes }),
    ...(options.operationId === undefined
      ? {}
      : { operationId: options.operationId }),
    ...(options.diagnostics === undefined && fileDiagnostics === undefined
      ? {}
      : { diagnostics: options.diagnostics ?? fileDiagnostics }),
  });
}

export async function createNativeCausalDebugReportStream(
  stream: NativeCausalDebugInputStream,
  options: CreateNativeCausalDebugReportOptions = {},
): Promise<string> {
  return createNativeCausalDebugReport(
    await readNativeCausalDebugSnapshotStream(stream),
    options,
  );
}

/**
 * Publishes a generated report as a private, atomic, no-clobber local file.
 * The returned path is absolute so a CLI can identify the exact artifact.
 */
export async function writeNativeCausalDebugReportFile(
  options: WriteNativeCausalDebugReportFileOptions,
): Promise<string> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Causal debug report output options are required.");
  }
  if (
    typeof options.report !== "string" ||
    !options.report.startsWith("<!doctype html>") ||
    Buffer.byteLength(options.report, "utf8") >
      NATIVE_CAUSAL_DEBUG_MAX_REPORT_BYTES
  ) {
    throw new TypeError("The causal debug report output must be bounded HTML.");
  }
  if (
    typeof options.outputPath !== "string" ||
    options.outputPath.length === 0 ||
    options.outputPath.includes("\0")
  ) {
    throw new TypeError("The causal debug report output path is invalid.");
  }
  if (
    options.cwd !== undefined &&
    (typeof options.cwd !== "string" || options.cwd.length === 0)
  ) {
    throw new TypeError("The causal debug report output cwd is invalid.");
  }

  const outputPath = path.resolve(
    options.cwd ?? process.cwd(),
    options.outputPath,
  );
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.solid-native-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, options.report, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporaryPath, outputPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new TypeError(
          `The causal debug report output already exists at ${outputPath}; refusing to overwrite it.`,
        );
      }
      throw error;
    }
    return outputPath;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
