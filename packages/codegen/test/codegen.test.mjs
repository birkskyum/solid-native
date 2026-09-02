import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  combineReactNativeCodegenSchemas,
  createSolidNativeComponentDescriptors,
  createSolidNativeModuleDescriptors,
  createSolidNativeSchemaAudit,
  generateSolidNativeBindingsModule,
  generateSolidNativeComponentModule,
  generateSolidNativeTurboModuleAdapterScaffold,
  generateSolidNativeTurboModuleBindings,
} from "../dist/index.js";

const voidFunction = (params = []) => ({
  type: "FunctionTypeAnnotation",
  params,
  returnTypeAnnotation: { type: "VoidTypeAnnotation" },
});

const component = (options = {}) => ({
  extendsProps: [
    {
      type: "ReactNativeBuiltInType",
      knownTypeName: "ReactNativeCoreViewProps",
    },
  ],
  events: [],
  props: [],
  commands: [],
  ...options,
});

function typeScriptDiagnostics(source) {
  const fileName = "/solid-native-generated.ts";
  const options = {
    exactOptionalPropertyTypes: true,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (candidate) =>
    candidate === fileName || fileExists(candidate);
  host.readFile = (candidate) =>
    candidate === fileName ? source : readFile(candidate);
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreate) =>
    candidate === fileName
      ? ts.createSourceFile(candidate, source, languageVersion, true)
      : getSourceFile(candidate, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
}

test("projects validated Codegen components into deterministic host descriptors", () => {
  const schema = {
    modules: {
      FixtureView: {
        type: "Component",
        components: {
          FixtureView: component({
            events: [
              {
                name: "onValueChange",
                optional: true,
                bubblingType: "bubble",
                typeAnnotation: { type: "EventTypeAnnotation" },
              },
              {
                name: "onReady",
                optional: true,
                bubblingType: "direct",
                typeAnnotation: { type: "EventTypeAnnotation" },
              },
            ],
            props: [
              {
                name: "label",
                optional: true,
                typeAnnotation: {
                  type: "StringTypeAnnotation",
                  default: "",
                },
              },
            ],
            commands: [
              {
                name: "setValue",
                optional: false,
                typeAnnotation: voidFunction([
                  {
                    name: "value",
                    optional: false,
                    typeAnnotation: { type: "StringTypeAnnotation" },
                  },
                  {
                    name: "animated",
                    optional: false,
                    typeAnnotation: { type: "BooleanTypeAnnotation" },
                  },
                ]),
              },
            ],
          }),
        },
      },
    },
  };

  const descriptors = createSolidNativeComponentDescriptors(schema, {
    rawTextComponents: ["FixtureView"],
  });
  assert.deepEqual(descriptors, [
    {
      name: "FixtureView",
      acceptsRawText: true,
      bubblingEvents: ["valueChange"],
      directEvents: ["ready"],
      commands: { setValue: ["value", "animated"] },
    },
  ]);
  assert.ok(Object.isFrozen(descriptors));
  assert.ok(Object.isFrozen(descriptors[0].commands.setValue));

  const source = generateSolidNativeComponentModule(schema, {
    rawTextComponents: ["FixtureView"],
  });
  assert.match(
    source,
    /export interface FixtureViewNativeProps extends NativeElementProps/u,
  );
  assert.match(source, /readonly "label"\?: string;/u);
  assert.match(source, /readonly "onReady"\?: \(event:/u);
  assert.match(source, /export const FixtureViewNativeCommands/u);
  assert.match(
    source,
    /node\.dispatchCommand\("setValue", argument0, argument1\)/u,
  );
  assert.match(source, /FixtureViewNativeDescriptor/u);
  assert.doesNotMatch(source, /from ["']react(?:-native)?["']/u);
  assert.equal(
    source,
    generateSolidNativeComponentModule(schema, {
      rawTextComponents: ["FixtureView"],
    }),
  );
});

test("combines TypeScript component specs through the pinned React Native parser", () => {
  const schema = combineReactNativeCodegenSchemas(
    [fileURLToPath(new URL("fixtures", import.meta.url))],
    { libraryName: "FixtureSpec", platform: "android" },
  );
  assert.deepEqual(
    createSolidNativeComponentDescriptors(schema).map(({ name }) => name),
    ["ParsedFixtureView"],
  );
  assert.deepEqual(
    createSolidNativeModuleDescriptors(schema).map(({ name }) => name),
    ["ParsedFixtureModule"],
  );
  assert.throws(
    () => combineReactNativeCodegenSchemas([]),
    /requires 1-256 source paths/u,
  );
  assert.throws(
    () =>
      combineReactNativeCodegenSchemas(["fixture"], {
        libraryName: "not-a-library-name",
      }),
    /libraryName must be a 1-128 character identifier/u,
  );
});

test("emits React-free raw TurboModule ABI bindings and audit metadata", () => {
  const schema = combineReactNativeCodegenSchemas(
    [fileURLToPath(new URL("fixtures", import.meta.url))],
    { libraryName: "FixtureSpec" },
  );
  const descriptors = createSolidNativeModuleDescriptors(schema);
  assert.deepEqual(descriptors, [
    {
      name: "ParsedFixtureModule",
      requiredMethods: ["getPayload", "inspect", "setMode"],
      optionalMethods: ["optionalMethod"],
      requiredEventEmitters: ["onChanged"],
      optionalEventEmitters: ["onUnknown"],
      unknownValueMembers: ["inspect", "onUnknown"],
    },
  ]);
  assert.ok(Object.isFrozen(descriptors));
  assert.ok(Object.isFrozen(descriptors[0]));
  assert.ok(Object.isFrozen(descriptors[0].unknownValueMembers));

  const source = generateSolidNativeTurboModuleBindings(schema);
  assert.match(
    source,
    /export type ParsedFixtureModuleABIParsedFixturePayload/u,
  );
  assert.match(source, /"ready" \| "waiting"/u);
  assert.match(source, /export interface ParsedFixtureModuleNativeModule/u);
  assert.match(
    source,
    /Promise<\(ParsedFixtureModuleABIParsedFixturePayload\) \| null>/u,
  );
  assert.match(
    source,
    /readonly "inspect": \(argument0: Readonly<Record<string, unknown>>\)/u,
  );
  assert.match(source, /resolveParsedFixtureModuleNativeModule/u);
  assert.match(source, /requireParsedFixtureModuleNativeModule/u);
  assert.match(source, /unknownValueMembers: \["inspect","onUnknown"\]/u);
  assert.doesNotMatch(source, /from ["']react(?:-native)?["']/u);
  assert.equal(source, generateSolidNativeTurboModuleBindings(schema));
  assert.deepEqual(
    typeScriptDiagnostics(
      `${source}\nconst registry = {\n  get<T extends object>(): T | null { return null; },\n  getEnforcing<T extends object>(): T { throw new Error("missing"); },\n};\nrequireParsedFixtureModuleNativeModule(registry);\n`,
    ),
    [],
  );
});

test("scaffolds policy-gated Solid-owned TurboModule adapters", async () => {
  const schema = combineReactNativeCodegenSchemas(
    [fileURLToPath(new URL("fixtures", import.meta.url))],
    { libraryName: "FixtureSpec" },
  );
  const source = generateSolidNativeTurboModuleAdapterScaffold(schema, {
    moduleName: "ParsedFixtureModule",
    bindingsImport: "./FixtureBindings.js",
  });
  assert.match(source, /This file is application-owned and safe to edit/u);
  assert.match(
    source,
    /Native method outputs intentionally remain unknown until policy code validates them/u,
  );
  assert.match(source, /interface ParsedFixtureModuleAdapterPolicy/u);
  assert.match(
    source,
    /policy\.methods\["getPayload"\]\(nativeMember_getPayload/u,
  );
  assert.match(
    source,
    /createNativeEventAccessor\(nativeMember_onChanged, policy\.events\["onChanged"\]\)/u,
  );
  assert.match(source, /\.\.\.\(nativeMember_optionalMethod === undefined/u);
  assert.doesNotMatch(source, /\bany\b/u);
  assert.equal(
    source,
    generateSolidNativeTurboModuleAdapterScaffold(schema, {
      moduleName: "ParsedFixtureModule",
      bindingsImport: "./FixtureBindings.js",
    }),
  );

  const binding = generateSolidNativeTurboModuleBindings(schema);
  const withoutImports = source
    .replace(/import \{[\s\S]*?\} from "@solid-native\/core";\n/u, "")
    .replace(
      /import type \{ ParsedFixtureModuleNativeModule \} from "\.\/FixtureBindings\.js";\n/u,
      "",
    );
  const coreContract = `
interface NativeEventAccessorOptions<TNative, TValue> {
  readonly name: string;
  readonly decode: (event: TNative) => TValue;
}
function createNativeEventAccessor<TNative, TValue>(
  emitter: (listener: (event: TNative) => void) => { remove(): void },
  options: NativeEventAccessorOptions<TNative, TValue>,
): () => TValue | undefined {
  let current: TValue | undefined;
  emitter((event) => { current = options.decode(event); });
  return () => current;
}
`;
  const combined = `${binding}\n${coreContract}\n${withoutImports}`;
  assert.deepEqual(typeScriptDiagnostics(combined), []);
  const javascript = ts.transpileModule(combined, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual(javascript.diagnostics, []);
  const generated = await import(
    `data:text/javascript;base64,${Buffer.from(javascript.outputText).toString("base64")}`
  );
  let changedListener;
  const native = {
    marker: "native-this",
    async getPayload(key, fallback) {
      assert.equal(this.marker, "native-this");
      return fallback?.note === undefined
        ? { id: key }
        : { id: key, note: fallback.note };
    },
    inspect(value) {
      return value;
    },
    onChanged(listener) {
      changedListener = listener;
      return { remove() {} };
    },
    setMode(mode) {
      return mode;
    },
  };
  const adapter = generated.createParsedFixtureModuleSolidAdapter(native, {
    methods: {
      getPayload(invoke, arguments_) {
        assert.ok(Object.isFrozen(arguments_));
        return invoke(...arguments_);
      },
    },
    events: {
      onChanged: {
        name: "platform.fixture.changed",
        decode(value) {
          return value.id;
        },
      },
    },
  });
  assert.deepEqual(await adapter.getPayload("account", null), {
    id: "account",
  });
  changedListener({ id: "event" });
  assert.equal(adapter.onChanged(), "event");
  assert.equal("optionalMethod" in adapter, false);
  assert.equal("onUnknown" in adapter, false);
  assert.throws(
    () =>
      generateSolidNativeTurboModuleAdapterScaffold(schema, {
        moduleName: "MissingModule",
        bindingsImport: "./FixtureBindings.js",
      }),
    /MissingModule is unavailable/u,
  );
  assert.throws(
    () =>
      generateSolidNativeTurboModuleAdapterScaffold(schema, {
        moduleName: "ParsedFixtureModule",
        bindingsImport: "./FixtureBindings.js\nunsafe",
      }),
    /bindingsImport/u,
  );
});

test("emits mixed component and TurboModule schemas as one binding module", () => {
  const schema = combineReactNativeCodegenSchemas(
    [fileURLToPath(new URL("fixtures", import.meta.url))],
    { libraryName: "FixtureSpec" },
  );
  const source = generateSolidNativeBindingsModule(schema);
  assert.match(source, /ParsedFixtureViewNativeComponent/u);
  assert.match(source, /ParsedFixtureModuleNativeModule/u);
  assert.match(source, /SOLID_NATIVE_COMPONENT_DESCRIPTORS/u);
  assert.match(source, /SOLID_NATIVE_MODULE_DESCRIPTORS/u);
  assert.equal(
    source.match(/Generated by @solid-native\/codegen/gu)?.length,
    1,
  );
  assert.deepEqual(
    typeScriptDiagnostics(source).filter(
      (diagnostic) =>
        !diagnostic.startsWith("Cannot find module '@solid-native/"),
    ),
    [],
  );
});

test("validates TurboModule members before returning a generated binding", async () => {
  const schema = {
    modules: {
      Fixture: {
        type: "NativeModule",
        aliasMap: {},
        enumMap: {},
        spec: {
          eventEmitters: [],
          methods: [
            {
              name: "read",
              optional: false,
              typeAnnotation: voidFunction(),
            },
            {
              name: "maybeWrite",
              optional: true,
              typeAnnotation: voidFunction(),
            },
          ],
        },
        moduleName: "FixtureModule",
      },
    },
  };
  const source = generateSolidNativeTurboModuleBindings(schema);
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual(javascript.diagnostics, []);
  const generated = await import(
    `data:text/javascript;base64,${Buffer.from(javascript.outputText).toString("base64")}`
  );
  const valid = { read() {} };
  assert.equal(
    generated.resolveFixtureModuleNativeModule({
      get: () => undefined,
      getEnforcing: () => valid,
    }),
    null,
  );
  assert.equal(
    generated.requireFixtureModuleNativeModule({
      get: () => valid,
      getEnforcing: () => valid,
    }),
    valid,
  );
  assert.throws(
    () =>
      generated.requireFixtureModuleNativeModule({
        get: () => undefined,
        getEnforcing: () => ({}),
      }),
    /FixtureModule\.read must be a function/u,
  );
  assert.throws(
    () =>
      generated.requireFixtureModuleNativeModule({
        get: () => undefined,
        getEnforcing: () => ({ read() {}, maybeWrite: true }),
      }),
    /FixtureModule\.maybeWrite must be a function when present/u,
  );
});

test("honors platform exclusions and the interface-only safety boundary", () => {
  const schema = {
    modules: {
      PlatformViews: {
        type: "Component",
        components: {
          AndroidView: component({ excludedPlatforms: ["iOS"] }),
          IOSView: component({ excludedPlatforms: ["android"] }),
          SharedInterface: component({ interfaceOnly: true }),
        },
      },
      AndroidModule: {
        type: "NativeModule",
        aliasMap: {},
        enumMap: {},
        spec: { eventEmitters: [], methods: [] },
        moduleName: "AndroidModule",
        excludedPlatforms: ["iOS"],
      },
      IOSModule: {
        type: "NativeModule",
        aliasMap: {},
        enumMap: {},
        spec: { eventEmitters: [], methods: [] },
        moduleName: "IOSModule",
        excludedPlatforms: ["android"],
      },
    },
  };

  assert.deepEqual(
    createSolidNativeComponentDescriptors(schema, { platform: "android" }).map(
      (descriptor) => descriptor.name,
    ),
    ["AndroidView"],
  );
  assert.deepEqual(
    createSolidNativeComponentDescriptors(schema, {
      platform: "ios",
      includeInterfaceOnly: true,
    }).map((descriptor) => descriptor.name),
    ["IOSView", "SharedInterface"],
  );
  assert.deepEqual(
    createSolidNativeModuleDescriptors(schema, { platform: "android" }).map(
      (descriptor) => descriptor.name,
    ),
    ["AndroidModule"],
  );
  assert.deepEqual(
    createSolidNativeModuleDescriptors(schema, { platform: "ios" }).map(
      (descriptor) => descriptor.name,
    ),
    ["IOSModule"],
  );
  const audit = createSolidNativeSchemaAudit(schema, { platform: "android" });
  assert.deepEqual(
    audit.components.map((descriptor) => descriptor.name),
    ["AndroidView"],
  );
  assert.deepEqual(audit.interfaceOnlyComponents, ["SharedInterface"]);
  assert.deepEqual(audit.platformExcludedComponents, ["IOSView"]);
  assert.deepEqual(
    audit.modules.map((descriptor) => descriptor.name),
    ["AndroidModule"],
  );
  assert.deepEqual(audit.platformExcludedModules, ["IOSModule"]);
  assert.ok(Object.isFrozen(audit));
  assert.ok(Object.isFrozen(audit.interfaceOnlyComponents));
});

test("rejects malformed schemas and descriptor policy drift", () => {
  assert.throws(
    () => createSolidNativeComponentDescriptors(null),
    /schema must be an object/,
  );
  assert.throws(
    () => createSolidNativeComponentDescriptors({ modules: [] }),
    /schema.modules must be an object/,
  );
  assert.throws(
    () =>
      createSolidNativeComponentDescriptors({
        modules: {
          Invalid: {
            type: "Component",
            components: {
              Invalid: component({
                events: [
                  {
                    name: "ready",
                    optional: true,
                    bubblingType: "direct",
                    typeAnnotation: { type: "EventTypeAnnotation" },
                  },
                ],
              }),
            },
          },
        },
      }),
    /onEventName convention/,
  );
  assert.throws(
    () =>
      createSolidNativeComponentDescriptors(
        {
          modules: {
            Fixture: {
              type: "Component",
              components: { Fixture: component() },
            },
          },
        },
        { rawTextComponents: ["Missing"] },
      ),
    /does not identify an emitted component/,
  );
});
