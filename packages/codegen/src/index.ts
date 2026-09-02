import type {
  CommandParamTypeAnnotation,
  ComponentArrayTypeAnnotation,
  ComponentShape,
  EventEmitterTypeAnnotation,
  EventTypeAnnotation,
  NamedShape,
  NativeModuleAliasMap,
  NativeModuleFunctionTypeAnnotation,
  NativeModuleSchema,
  NativeModuleTypeAnnotation,
  Nullable,
  PropTypeAnnotation,
  SchemaType,
  UnsafeAnyTypeAnnotation,
} from "@react-native/codegen/lib/CodegenSchema.js";
import { validate } from "@react-native/codegen/lib/SchemaValidator.js";
import type { NativeComponentDescriptor } from "@solid-native/host-contract";
import { createRequire } from "node:module";

export type SolidNativeCodegenPlatform = "android" | "ios";

export interface SolidNativeDescriptorOptions {
  /** Excludes components unavailable on this platform. */
  readonly platform?: SolidNativeCodegenPlatform;
  /**
   * Includes Codegen interfaces that do not generate their own Fabric
   * descriptor. Disabled by default so the result cannot overclaim a mountable
   * New Architecture component.
   */
  readonly includeInterfaceOnly?: boolean;
  /** Component names whose native implementation accepts unwrapped text. */
  readonly rawTextComponents?: readonly string[];
}

export interface ReactNativeSchemaSourceOptions {
  /** Applies React Native's platform filename filtering while parsing. */
  readonly platform?: SolidNativeCodegenPlatform;
  /** Optional library identity retained by the upstream combined schema. */
  readonly libraryName?: string;
}

export interface SolidNativeModuleOptions {
  /** Excludes TurboModules unavailable on this platform. */
  readonly platform?: SolidNativeCodegenPlatform;
}

export interface SolidNativeAdapterScaffoldOptions extends SolidNativeModuleOptions {
  /** Exact TurboModule name selected from the validated schema. */
  readonly moduleName: string;
  /** Module specifier for the generated raw binding module. */
  readonly bindingsImport: string;
}

export interface SolidNativeBindingOptions
  extends SolidNativeDescriptorOptions, SolidNativeModuleOptions {}

/** Runtime-checkable surface metadata for a raw Codegen TurboModule ABI. */
export interface SolidNativeModuleDescriptor {
  readonly name: string;
  readonly requiredMethods: readonly string[];
  readonly optionalMethods: readonly string[];
  readonly requiredEventEmitters: readonly string[];
  readonly optionalEventEmitters: readonly string[];
  /** Members whose Codegen schema contains `mixed`, `any`, or untyped Object. */
  readonly unknownValueMembers: readonly string[];
}

/** Portable compatibility inventory for one validated Codegen schema. */
export interface SolidNativeSchemaAudit {
  readonly schemaVersion: 0;
  readonly components: readonly NativeComponentDescriptor[];
  readonly interfaceOnlyComponents: readonly string[];
  readonly platformExcludedComponents: readonly string[];
  readonly modules: readonly SolidNativeModuleDescriptor[];
  readonly platformExcludedModules: readonly string[];
}

interface ReactNativeSchemaCombiner {
  combineSchemasInFileList(
    sourcePaths: readonly string[],
    platform?: SolidNativeCodegenPlatform,
    exclude?: string,
    libraryName?: string,
  ): SchemaType;
}

interface ProjectedComponent {
  readonly component: ComponentShape;
  readonly descriptor: NativeComponentDescriptor;
  readonly name: string;
}

interface ProjectedNativeModule {
  readonly descriptor: SolidNativeModuleDescriptor;
  readonly module: NativeModuleSchema;
  readonly name: string;
}

type ComponentValueTypeAnnotation =
  | PropTypeAnnotation
  | EventTypeAnnotation
  | CommandParamTypeAnnotation
  | ComponentArrayTypeAnnotation["elementType"];

const NATIVE_COMPONENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EVENT_PROPERTY_NAME = /^on[A-Z][A-Za-z0-9_]*$/;
const COMMAND_ARGUMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_COMPONENT_NAME_LENGTH = 128;
const MAX_SCHEMA_SOURCE_PATHS = 256;
const require = createRequire(import.meta.url);
const schemaCombiner =
  require("@react-native/codegen/lib/cli/combine/combine-js-to-schema.js") as ReactNativeSchemaCombiner;

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertComponentName(name: string, path: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_COMPONENT_NAME_LENGTH ||
    !NATIVE_COMPONENT_NAME.test(name)
  ) {
    throw new TypeError(`${path} must be a 1-128 character identifier.`);
  }
}

function semanticEventName(name: string, path: string): string {
  if (!EVENT_PROPERTY_NAME.test(name)) {
    throw new TypeError(
      `${path} must use the React Native onEventName convention.`,
    );
  }
  return `${name[2]?.toLowerCase() ?? ""}${name.slice(3)}`;
}

function nativePlatform(
  platform: SolidNativeCodegenPlatform,
): "android" | "iOS" {
  return platform === "ios" ? "iOS" : "android";
}

function componentIsIncluded(
  component: ComponentShape,
  options: SolidNativeDescriptorOptions,
): boolean {
  if (
    component.interfaceOnly === true &&
    options.includeInterfaceOnly !== true
  ) {
    return false;
  }
  if (options.platform === undefined) return true;
  return !component.excludedPlatforms?.includes(
    nativePlatform(options.platform),
  );
}

function componentDescriptor(
  name: string,
  component: ComponentShape,
  acceptsRawText: boolean,
): NativeComponentDescriptor {
  assertComponentName(name, `Codegen component ${JSON.stringify(name)}`);
  const bubblingEvents: string[] = [];
  const directEvents: string[] = [];
  const observedEvents = new Set<string>();
  for (const event of component.events) {
    const semanticName = semanticEventName(
      event.name,
      `Codegen event ${JSON.stringify(event.name)} on ${name}`,
    );
    if (observedEvents.has(semanticName)) {
      throw new TypeError(
        `Codegen component ${name} declares duplicate event ${semanticName}.`,
      );
    }
    observedEvents.add(semanticName);
    (event.bubblingType === "bubble" ? bubblingEvents : directEvents).push(
      semanticName,
    );
  }

  const commands: Array<readonly [string, readonly string[]]> = [];
  const observedCommands = new Set<string>();
  for (const command of component.commands) {
    assertComponentName(
      command.name,
      `Codegen command ${JSON.stringify(command.name)} on ${name}`,
    );
    if (observedCommands.has(command.name)) {
      throw new TypeError(
        `Codegen component ${name} declares duplicate command ${command.name}.`,
      );
    }
    observedCommands.add(command.name);
    const arguments_ = command.typeAnnotation.params.map((parameter) => {
      if (!COMMAND_ARGUMENT_NAME.test(parameter.name)) {
        throw new TypeError(
          `Codegen command argument ${JSON.stringify(parameter.name)} on ${name}.${command.name} must be an identifier.`,
        );
      }
      return parameter.name;
    });
    if (new Set(arguments_).size !== arguments_.length) {
      throw new TypeError(
        `Codegen command ${name}.${command.name} declares duplicate argument names.`,
      );
    }
    commands.push([command.name, Object.freeze(arguments_)]);
  }

  bubblingEvents.sort();
  directEvents.sort();
  commands.sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze({
    name,
    acceptsRawText,
    bubblingEvents: Object.freeze(bubblingEvents),
    directEvents: Object.freeze(directEvents),
    commands: Object.freeze(Object.fromEntries(commands)),
  });
}

function validatedSchema(value: unknown): SchemaType {
  const root = plainRecord(value, "React Native Codegen schema");
  plainRecord(root.modules, "React Native Codegen schema.modules");
  const schema = value as SchemaType;
  validate(schema);
  return schema;
}

function projectedComponents(
  value: unknown,
  options: SolidNativeDescriptorOptions,
): readonly ProjectedComponent[] {
  const schema = validatedSchema(value);
  const rawTextComponents = new Set(options.rawTextComponents ?? []);
  for (const name of rawTextComponents) {
    assertComponentName(name, "rawTextComponents entry");
  }

  const projected: ProjectedComponent[] = [];
  const emittedNames = new Set<string>();
  for (const moduleName of Object.keys(schema.modules).sort()) {
    const module = schema.modules[moduleName];
    if (module?.type !== "Component") continue;
    for (const name of Object.keys(module.components).sort()) {
      const component = module.components[name];
      if (component === undefined || !componentIsIncluded(component, options)) {
        continue;
      }
      if (emittedNames.has(name)) {
        throw new TypeError(
          `React Native Codegen schema declares component ${name} more than once.`,
        );
      }
      emittedNames.add(name);
      projected.push(
        Object.freeze({
          component,
          descriptor: componentDescriptor(
            name,
            component,
            rawTextComponents.has(name),
          ),
          name,
        }),
      );
    }
  }

  for (const name of rawTextComponents) {
    if (!emittedNames.has(name)) {
      throw new TypeError(
        `rawTextComponents entry ${name} does not identify an emitted component.`,
      );
    }
  }
  return projected;
}

/**
 * Projects the component portion of a pinned React Native Codegen schema into
 * the metadata consumed by the Solid Native renderer and native host.
 * React Native Codegen remains responsible for native ABI generation.
 */
export function createSolidNativeComponentDescriptors(
  value: unknown,
  options: SolidNativeDescriptorOptions = {},
): readonly NativeComponentDescriptor[] {
  return Object.freeze(
    projectedComponents(value, options).map(({ descriptor }) => descriptor),
  );
}

/**
 * Uses the application-local, pinned React Native parser to combine component
 * specs without evaluating their React-facing wrapper exports.
 */
export function combineReactNativeCodegenSchemas(
  sourcePaths: readonly string[],
  options: ReactNativeSchemaSourceOptions = {},
): SchemaType {
  if (
    sourcePaths.length === 0 ||
    sourcePaths.length > MAX_SCHEMA_SOURCE_PATHS
  ) {
    throw new TypeError(
      `Codegen requires 1-${MAX_SCHEMA_SOURCE_PATHS} source paths.`,
    );
  }
  const normalizedPaths = sourcePaths.map((sourcePath, index) => {
    if (
      typeof sourcePath !== "string" ||
      sourcePath.length === 0 ||
      sourcePath.includes("\0")
    ) {
      throw new TypeError(
        `Codegen source path ${index} must be a path string.`,
      );
    }
    return sourcePath;
  });
  if (
    options.libraryName !== undefined &&
    (options.libraryName.length === 0 ||
      options.libraryName.length > MAX_COMPONENT_NAME_LENGTH ||
      !NATIVE_COMPONENT_NAME.test(options.libraryName))
  ) {
    throw new TypeError(
      "Codegen libraryName must be a 1-128 character identifier.",
    );
  }
  return validatedSchema(
    schemaCombiner.combineSchemasInFileList(
      normalizedPaths,
      options.platform,
      undefined,
      options.libraryName,
    ),
  );
}

type NativeModuleValueAnnotation =
  | Nullable<NativeModuleTypeAnnotation>
  | UnsafeAnyTypeAnnotation
  | EventEmitterTypeAnnotation;

function unwrapNullableNativeFunction(
  annotation: Nullable<NativeModuleFunctionTypeAnnotation>,
): {
  readonly annotation: NativeModuleFunctionTypeAnnotation;
  readonly nullable: boolean;
} {
  return annotation.type === "NullableTypeAnnotation"
    ? { annotation: annotation.typeAnnotation, nullable: true }
    : { annotation, nullable: false };
}

function annotationContainsUnknownValue(
  annotation: NativeModuleValueAnnotation,
  aliases: NativeModuleAliasMap,
  aliasesInProgress: ReadonlySet<string> = new Set(),
): boolean {
  switch (annotation.type) {
    case "NullableTypeAnnotation":
      return annotationContainsUnknownValue(
        annotation.typeAnnotation,
        aliases,
        aliasesInProgress,
      );
    case "AnyTypeAnnotation":
    case "MixedTypeAnnotation":
      return true;
    case "GenericObjectTypeAnnotation":
      return annotation.dictionaryValueType === undefined
        ? true
        : annotationContainsUnknownValue(
            annotation.dictionaryValueType,
            aliases,
            aliasesInProgress,
          );
    case "ArrayTypeAnnotation":
      return annotationContainsUnknownValue(
        annotation.elementType,
        aliases,
        aliasesInProgress,
      );
    case "ObjectTypeAnnotation":
      return annotation.properties.some((property) =>
        annotationContainsUnknownValue(
          property.typeAnnotation,
          aliases,
          aliasesInProgress,
        ),
      );
    case "FunctionTypeAnnotation":
      return (
        annotation.params.some((parameter) =>
          annotationContainsUnknownValue(
            parameter.typeAnnotation,
            aliases,
            aliasesInProgress,
          ),
        ) ||
        annotationContainsUnknownValue(
          annotation.returnTypeAnnotation,
          aliases,
          aliasesInProgress,
        )
      );
    case "PromiseTypeAnnotation":
      return annotationContainsUnknownValue(
        annotation.elementType,
        aliases,
        aliasesInProgress,
      );
    case "EventEmitterTypeAnnotation":
      return annotationContainsUnknownValue(
        annotation.typeAnnotation,
        aliases,
        aliasesInProgress,
      );
    case "UnionTypeAnnotation":
      return annotation.types.some((member) =>
        annotationContainsUnknownValue(member, aliases, aliasesInProgress),
      );
    case "TypeAliasTypeAnnotation": {
      if (aliasesInProgress.has(annotation.name)) return true;
      const target = aliases[annotation.name];
      if (target === undefined) return true;
      const nextAliases = new Set(aliasesInProgress);
      nextAliases.add(annotation.name);
      return annotationContainsUnknownValue(target, aliases, nextAliases);
    }
    default:
      return false;
  }
}

function frozenSortedNames(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...values].sort((left, right) => left.localeCompare(right)),
  );
}

function nativeModuleDescriptor(
  module: NativeModuleSchema,
): SolidNativeModuleDescriptor {
  assertComponentName(
    module.moduleName,
    `Codegen TurboModule ${JSON.stringify(module.moduleName)}`,
  );
  const requiredMethods: string[] = [];
  const optionalMethods: string[] = [];
  const requiredEventEmitters: string[] = [];
  const optionalEventEmitters: string[] = [];
  const unknownValueMembers: string[] = [];
  const members = new Set<string>();

  for (const method of module.spec.methods) {
    assertComponentName(
      method.name,
      `Codegen method ${JSON.stringify(method.name)} on ${module.moduleName}`,
    );
    if (members.has(method.name)) {
      throw new TypeError(
        `Codegen TurboModule ${module.moduleName} declares duplicate member ${method.name}.`,
      );
    }
    members.add(method.name);
    const projected = unwrapNullableNativeFunction(method.typeAnnotation);
    (method.optional || projected.nullable
      ? optionalMethods
      : requiredMethods
    ).push(method.name);
    if (
      annotationContainsUnknownValue(method.typeAnnotation, module.aliasMap)
    ) {
      unknownValueMembers.push(method.name);
    }
  }

  for (const emitter of module.spec.eventEmitters) {
    assertComponentName(
      emitter.name,
      `Codegen event emitter ${JSON.stringify(emitter.name)} on ${module.moduleName}`,
    );
    if (members.has(emitter.name)) {
      throw new TypeError(
        `Codegen TurboModule ${module.moduleName} declares duplicate member ${emitter.name}.`,
      );
    }
    members.add(emitter.name);
    (emitter.optional ? optionalEventEmitters : requiredEventEmitters).push(
      emitter.name,
    );
    if (
      annotationContainsUnknownValue(emitter.typeAnnotation, module.aliasMap)
    ) {
      unknownValueMembers.push(emitter.name);
    }
  }

  return Object.freeze({
    name: module.moduleName,
    requiredMethods: frozenSortedNames(requiredMethods),
    optionalMethods: frozenSortedNames(optionalMethods),
    requiredEventEmitters: frozenSortedNames(requiredEventEmitters),
    optionalEventEmitters: frozenSortedNames(optionalEventEmitters),
    unknownValueMembers: frozenSortedNames(unknownValueMembers),
  });
}

function projectedNativeModules(
  value: unknown,
  options: SolidNativeModuleOptions,
): readonly ProjectedNativeModule[] {
  const schema = validatedSchema(value);
  const projected: ProjectedNativeModule[] = [];
  const emittedNames = new Set<string>();
  for (const schemaName of Object.keys(schema.modules).sort()) {
    const module = schema.modules[schemaName];
    if (module?.type !== "NativeModule") continue;
    if (
      options.platform !== undefined &&
      module.excludedPlatforms?.includes(nativePlatform(options.platform))
    ) {
      continue;
    }
    if (emittedNames.has(module.moduleName)) {
      throw new TypeError(
        `React Native Codegen schema declares TurboModule ${module.moduleName} more than once.`,
      );
    }
    emittedNames.add(module.moduleName);
    projected.push(
      Object.freeze({
        descriptor: nativeModuleDescriptor(module),
        module,
        name: module.moduleName,
      }),
    );
  }
  return projected;
}

/**
 * Projects the TurboModule portion of a Codegen schema into deeply frozen
 * runtime surface metadata. Data validation remains the adapter's job.
 */
export function createSolidNativeModuleDescriptors(
  value: unknown,
  options: SolidNativeModuleOptions = {},
): readonly SolidNativeModuleDescriptor[] {
  return Object.freeze(
    projectedNativeModules(value, options).map(({ descriptor }) => descriptor),
  );
}

/**
 * Inventories reusable surfaces and explicit exclusion reasons without
 * evaluating a dependency's React-facing JavaScript entry point.
 */
export function createSolidNativeSchemaAudit(
  value: unknown,
  options: SolidNativeBindingOptions = {},
): SolidNativeSchemaAudit {
  const schema = validatedSchema(value);
  const interfaceOnlyComponents: string[] = [];
  const platformExcludedComponents: string[] = [];
  const platformExcludedModules: string[] = [];
  const excludedPlatform =
    options.platform === undefined
      ? undefined
      : nativePlatform(options.platform);

  for (const schemaName of Object.keys(schema.modules).sort()) {
    const module = schema.modules[schemaName];
    if (module?.type === "Component") {
      for (const name of Object.keys(module.components).sort()) {
        const component = module.components[name];
        if (component === undefined) continue;
        if (component.interfaceOnly === true) {
          interfaceOnlyComponents.push(name);
        }
        if (
          excludedPlatform !== undefined &&
          component.excludedPlatforms?.includes(excludedPlatform)
        ) {
          platformExcludedComponents.push(name);
        }
      }
      continue;
    }
    if (
      module?.type === "NativeModule" &&
      excludedPlatform !== undefined &&
      module.excludedPlatforms?.includes(excludedPlatform)
    ) {
      platformExcludedModules.push(module.moduleName);
    }
  }

  return Object.freeze({
    schemaVersion: 0,
    components: Object.freeze(
      projectedComponents(schema, options).map(({ descriptor }) => descriptor),
    ),
    interfaceOnlyComponents: Object.freeze(interfaceOnlyComponents),
    platformExcludedComponents: Object.freeze(platformExcludedComponents),
    modules: Object.freeze(
      projectedNativeModules(schema, options).map(
        ({ descriptor }) => descriptor,
      ),
    ),
    platformExcludedModules: Object.freeze(platformExcludedModules),
  });
}

function nativeModuleTypeName(moduleName: string, localName: string): string {
  assertComponentName(
    localName,
    `Codegen type ${JSON.stringify(localName)} on ${moduleName}`,
  );
  return `${moduleName}ABI${localName}`;
}

function nativeObjectType(
  moduleName: string,
  properties: readonly NamedShape<NativeModuleValueAnnotation>[],
  aliases: NativeModuleAliasMap,
): string {
  if (properties.length === 0) return "Readonly<Record<string, never>>";
  const observed = new Set<string>();
  const fields = properties.map((property) => {
    if (observed.has(property.name)) {
      throw new TypeError(
        `Codegen object on ${moduleName} declares duplicate property ${property.name}.`,
      );
    }
    observed.add(property.name);
    return `readonly ${JSON.stringify(property.name)}${property.optional ? "?" : ""}: ${nativeModuleValueType(moduleName, property.typeAnnotation, aliases)};`;
  });
  return `Readonly<{ ${fields.join(" ")} }>`;
}

function nativeFunctionType(
  moduleName: string,
  annotation: NativeModuleFunctionTypeAnnotation,
  aliases: NativeModuleAliasMap,
): string {
  const parameters = annotation.params.map(
    (parameter, index) =>
      `argument${index}${parameter.optional ? "?" : ""}: ${nativeModuleValueType(moduleName, parameter.typeAnnotation, aliases)}`,
  );
  return `(${parameters.join(", ")}) => ${nativeModuleValueType(moduleName, annotation.returnTypeAnnotation, aliases)}`;
}

function nativeModuleValueType(
  moduleName: string,
  annotation: NativeModuleValueAnnotation,
  aliases: NativeModuleAliasMap,
): string {
  switch (annotation.type) {
    case "NullableTypeAnnotation":
      return `(${nativeModuleValueType(moduleName, annotation.typeAnnotation, aliases)}) | null`;
    case "AnyTypeAnnotation":
    case "MixedTypeAnnotation":
      return "unknown";
    case "ArrayBufferTypeAnnotation":
      return "ArrayBuffer";
    case "BooleanTypeAnnotation":
      return "boolean";
    case "BooleanLiteralTypeAnnotation":
      return String(annotation.value);
    case "StringTypeAnnotation":
      return "string";
    case "StringLiteralTypeAnnotation":
      return JSON.stringify(annotation.value);
    case "NumberTypeAnnotation":
    case "Int32TypeAnnotation":
    case "DoubleTypeAnnotation":
    case "FloatTypeAnnotation":
      return "number";
    case "NumberLiteralTypeAnnotation":
      return String(annotation.value);
    case "VoidTypeAnnotation":
      return "void";
    case "ReservedTypeAnnotation":
      return "number";
    case "ArrayTypeAnnotation":
      return `ReadonlyArray<${nativeModuleValueType(moduleName, annotation.elementType, aliases)}>`;
    case "ObjectTypeAnnotation":
      return nativeObjectType(moduleName, annotation.properties, aliases);
    case "GenericObjectTypeAnnotation":
      return annotation.dictionaryValueType === undefined
        ? "Readonly<Record<string, unknown>>"
        : `Readonly<Record<string, ${nativeModuleValueType(moduleName, annotation.dictionaryValueType, aliases)}>>`;
    case "TypeAliasTypeAnnotation":
      return nativeModuleTypeName(moduleName, annotation.name);
    case "EnumDeclaration":
      return nativeModuleTypeName(moduleName, annotation.name);
    case "UnionTypeAnnotation":
      return annotation.types
        .map((member) => nativeModuleValueType(moduleName, member, aliases))
        .join(" | ");
    case "FunctionTypeAnnotation":
      return nativeFunctionType(moduleName, annotation, aliases);
    case "PromiseTypeAnnotation":
      return `Promise<${nativeModuleValueType(moduleName, annotation.elementType, aliases)}>`;
    case "EventEmitterTypeAnnotation":
      return `SolidNativeEventEmitter<${nativeModuleValueType(moduleName, annotation.typeAnnotation, aliases)}>`;
    default:
      throw new TypeError(
        `Unsupported TurboModule type annotation ${JSON.stringify((annotation as { readonly type?: unknown }).type)}.`,
      );
  }
}

function nativeModuleAliasesSource(
  moduleName: string,
  module: NativeModuleSchema,
): readonly string[] {
  for (const name of Object.keys(module.aliasMap)) {
    if (module.enumMap[name] !== undefined) {
      throw new TypeError(
        `Codegen TurboModule ${moduleName} declares both an alias and enum named ${name}.`,
      );
    }
  }
  const aliases = Object.keys(module.aliasMap)
    .sort()
    .map((name) => {
      const annotation = module.aliasMap[name];
      if (annotation === undefined) {
        throw new TypeError(
          `Codegen alias ${name} on ${moduleName} is missing.`,
        );
      }
      return `export type ${nativeModuleTypeName(moduleName, name)} = ${nativeModuleValueType(moduleName, annotation, module.aliasMap)};`;
    });
  const enums = Object.keys(module.enumMap)
    .sort()
    .map((name) => {
      const declaration = module.enumMap[name];
      if (declaration === undefined) {
        throw new TypeError(
          `Codegen enum ${name} on ${moduleName} is missing.`,
        );
      }
      const values = declaration.members.map(({ value }) => value.value);
      return `export type ${nativeModuleTypeName(moduleName, name)} = ${quotedUnion(values)};`;
    });
  return [...aliases, ...enums];
}

function nativeModuleSource(projected: ProjectedNativeModule): string {
  const { descriptor, module, name } = projected;
  const members: string[] = [];
  for (const method of module.spec.methods) {
    const unwrapped = unwrapNullableNativeFunction(method.typeAnnotation);
    const functionType = nativeFunctionType(
      name,
      unwrapped.annotation,
      module.aliasMap,
    );
    members.push(
      `  readonly ${JSON.stringify(method.name)}${method.optional ? "?" : ""}: ${unwrapped.nullable ? `(${functionType}) | null` : functionType};`,
    );
  }
  for (const emitter of module.spec.eventEmitters) {
    members.push(
      `  readonly ${JSON.stringify(emitter.name)}${emitter.optional ? "?" : ""}: SolidNativeEventEmitter<${nativeModuleValueType(name, emitter.typeAnnotation.typeAnnotation, module.aliasMap)}>;`,
    );
  }
  return [
    ...nativeModuleAliasesSource(name, module),
    ...(Object.keys(module.aliasMap).length +
      Object.keys(module.enumMap).length ===
    0
      ? []
      : [""]),
    `export interface ${name}NativeModule {`,
    ...members,
    "}",
    "",
    `export const ${name}NativeModuleDescriptor = freezeNativeModuleDescriptor({`,
    `  name: ${JSON.stringify(name)},`,
    `  requiredMethods: ${JSON.stringify(descriptor.requiredMethods)},`,
    `  optionalMethods: ${JSON.stringify(descriptor.optionalMethods)},`,
    `  requiredEventEmitters: ${JSON.stringify(descriptor.requiredEventEmitters)},`,
    `  optionalEventEmitters: ${JSON.stringify(descriptor.optionalEventEmitters)},`,
    `  unknownValueMembers: ${JSON.stringify(descriptor.unknownValueMembers)},`,
    "});",
    "",
    `export function resolve${name}NativeModule(`,
    "  registry: SolidNativeModuleRegistry,",
    `): ${name}NativeModule | null {`,
    `  const value = registry.get(${JSON.stringify(name)});`,
    "  return value === null || value === undefined",
    "    ? null",
    `    : (validateNativeModule(value, ${name}NativeModuleDescriptor) as unknown as ${name}NativeModule);`,
    "}",
    "",
    `export function require${name}NativeModule(`,
    "  registry: SolidNativeModuleRegistry,",
    `): ${name}NativeModule {`,
    "  return validateNativeModule(",
    `    registry.getEnforcing(${JSON.stringify(name)}),`,
    `    ${name}NativeModuleDescriptor,`,
    `  ) as unknown as ${name}NativeModule;`,
    "}",
  ].join("\n");
}

function nativeModuleRuntimeSource(): string {
  return [
    "export interface SolidNativeEventSubscription {",
    "  remove(): void;",
    "}",
    "",
    "export type SolidNativeEventEmitter<T> = (",
    "  listener: (event: T) => void,",
    ") => SolidNativeEventSubscription;",
    "",
    "export interface SolidNativeModuleRegistry {",
    "  get(name: string): unknown;",
    "  getEnforcing(name: string): unknown;",
    "}",
    "",
    "export interface SolidNativeModuleDescriptor {",
    "  readonly name: string;",
    "  readonly requiredMethods: readonly string[];",
    "  readonly optionalMethods: readonly string[];",
    "  readonly requiredEventEmitters: readonly string[];",
    "  readonly optionalEventEmitters: readonly string[];",
    "  readonly unknownValueMembers: readonly string[];",
    "}",
    "",
    "function freezeNativeModuleDescriptor(",
    "  descriptor: SolidNativeModuleDescriptor,",
    "): SolidNativeModuleDescriptor {",
    "  Object.freeze(descriptor.requiredMethods);",
    "  Object.freeze(descriptor.optionalMethods);",
    "  Object.freeze(descriptor.requiredEventEmitters);",
    "  Object.freeze(descriptor.optionalEventEmitters);",
    "  Object.freeze(descriptor.unknownValueMembers);",
    "  return Object.freeze(descriptor);",
    "}",
    "",
    "function validateNativeModule(",
    "  value: unknown,",
    "  descriptor: SolidNativeModuleDescriptor,",
    "): Readonly<Record<string, unknown>> {",
    '  if ((typeof value !== "object" && typeof value !== "function") || value === null) {',
    "    throw new TypeError(`TurboModule ${descriptor.name} must be an object.`);",
    "  }",
    "  const module = value as Readonly<Record<string, unknown>>;",
    "  const requiredMembers = [",
    "    ...descriptor.requiredMethods,",
    "    ...descriptor.requiredEventEmitters,",
    "  ];",
    "  for (const name of requiredMembers) {",
    '    if (typeof module[name] !== "function") {',
    "      throw new TypeError(`TurboModule ${descriptor.name}.${name} must be a function.`);",
    "    }",
    "  }",
    "  const optionalMembers = [",
    "    ...descriptor.optionalMethods,",
    "    ...descriptor.optionalEventEmitters,",
    "  ];",
    "  for (const name of optionalMembers) {",
    "    const member = module[name];",
    '    if (member !== undefined && member !== null && typeof member !== "function") {',
    "      throw new TypeError(`TurboModule ${descriptor.name}.${name} must be a function when present.`);",
    "    }",
    "  }",
    "  return module;",
    "}",
  ].join("\n");
}

function nativeModuleDescriptorListSource(
  descriptors: readonly SolidNativeModuleDescriptor[],
): string {
  return [
    "// prettier-ignore",
    "export const SOLID_NATIVE_MODULE_DESCRIPTORS: readonly SolidNativeModuleDescriptor[] = Object.freeze([",
    ...descriptors.map(({ name }) => `  ${name}NativeModuleDescriptor,`),
    "]);",
  ].join("\n");
}

/**
 * Emits raw, React-free TurboModule ABI types plus injected-registry resolvers.
 * Callers should adapt and validate returned data before exposing portable APIs.
 */
export function generateSolidNativeTurboModuleBindings(
  value: unknown,
  options: SolidNativeModuleOptions = {},
): string {
  const projected = projectedNativeModules(value, options);
  return `${[
    "// Generated by @solid-native/codegen. Do not edit.",
    "// Raw native ABI: validate values in an explicit application adapter.",
    "",
    nativeModuleRuntimeSource(),
    "",
    ...projected.flatMap((module) => [nativeModuleSource(module), ""]),
    nativeModuleDescriptorListSource(
      projected.map(({ descriptor }) => descriptor),
    ),
  ].join("\n")}\n`;
}

function adapterBindingsImport(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new TypeError(
      "Adapter scaffold bindingsImport must be a 1-512 character module specifier without surrounding whitespace or control lines.",
    );
  }
  return value;
}

function adapterMemberType(moduleName: string, memberName: string): string {
  return `${moduleName}NativeModule[${JSON.stringify(memberName)}]`;
}

function adapterPolicyMembersSource(
  moduleName: string,
  members: readonly Readonly<{ name: string }>[],
): readonly string[] {
  if (members.length === 0) return ["    readonly [name: string]: never;"];
  return members.flatMap(({ name }) => [
    `    readonly ${JSON.stringify(name)}: (`,
    `      invoke: NativeCallable<${adapterMemberType(moduleName, name)}>,`,
    `      arguments_: Readonly<NativeArguments<${adapterMemberType(moduleName, name)}>>,`,
    "    ) => unknown;",
  ]);
}

function adapterEventPolicySource(
  moduleName: string,
  emitters: readonly Readonly<{ name: string }>[],
): readonly string[] {
  if (emitters.length === 0) return ["    readonly [name: string]: never;"];
  return emitters.map(
    ({ name }) =>
      `    readonly ${JSON.stringify(name)}: NativeEventAccessorOptions<NativeEventValue<${adapterMemberType(moduleName, name)}>, unknown>;`,
  );
}

function adapterInterfaceMembersSource(
  moduleName: string,
  methods: readonly Readonly<{ name: string; optional: boolean }>[],
  emitters: readonly Readonly<{ name: string; optional: boolean }>[],
): readonly string[] {
  return [
    ...methods.map(
      ({ name, optional }) =>
        `  readonly ${JSON.stringify(name)}${optional ? "?" : ""}: (...arguments_: NativeArguments<${adapterMemberType(moduleName, name)}>) => unknown;`,
    ),
    ...emitters.map(
      ({ name, optional }) =>
        `  readonly ${JSON.stringify(name)}${optional ? "?" : ""}: () => unknown | undefined;`,
    ),
  ];
}

function boundAdapterMemberSource(
  moduleName: string,
  memberName: string,
  optional: boolean,
): readonly string[] {
  const boundName = `nativeMember_${memberName}`;
  if (!optional) {
    return [
      `  const ${boundName} = native[${JSON.stringify(memberName)}].bind(native) as NativeCallable<${adapterMemberType(moduleName, memberName)}>;`,
    ];
  }
  const rawName = `rawNativeMember_${memberName}`;
  return [
    `  const ${rawName} = native[${JSON.stringify(memberName)}];`,
    `  const ${boundName} = typeof ${rawName} === "function"`,
    `    ? (${rawName}.bind(native) as NativeCallable<${adapterMemberType(moduleName, memberName)}>)`,
    "    : undefined;",
  ];
}

function adapterMethodImplementationSource(
  moduleName: string,
  name: string,
  optional: boolean,
): readonly string[] {
  const boundName = `nativeMember_${name}`;
  const implementation = [
    `${JSON.stringify(name)}(...arguments_: NativeArguments<${adapterMemberType(moduleName, name)}>) {`,
    `  return policy.methods[${JSON.stringify(name)}](${boundName}, frozenArguments(arguments_));`,
    "},",
  ];
  return optional
    ? [
        `    ...(${boundName} === undefined`,
        "      ? {}",
        "      : {",
        ...implementation.map((line) => `        ${line}`),
        "      }),",
      ]
    : implementation.map((line) => `    ${line}`);
}

function adapterEventImplementationSource(
  name: string,
  optional: boolean,
): readonly string[] {
  const boundName = `nativeMember_${name}`;
  const expression = `createNativeEventAccessor(${boundName}, policy.events[${JSON.stringify(name)}])`;
  return optional
    ? [
        `    ...(${boundName} === undefined`,
        "      ? {}",
        `      : { ${JSON.stringify(name)}: ${expression} }),`,
      ]
    : [`    ${JSON.stringify(name)}: ${expression},`];
}

/**
 * Emits an editable, fail-safe TurboModule adapter starting point. Native
 * methods remain behind policy hooks with `unknown` outputs, while events use
 * Solid-owned decoded accessors. The scaffold never asserts domain semantics.
 */
export function generateSolidNativeTurboModuleAdapterScaffold(
  value: unknown,
  options: SolidNativeAdapterScaffoldOptions,
): string {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Adapter scaffold options must be an object.");
  }
  assertComponentName(
    options.moduleName,
    `Adapter scaffold moduleName ${JSON.stringify(options.moduleName)}`,
  );
  const bindingsImport = adapterBindingsImport(options.bindingsImport);
  const projected = projectedNativeModules(value, options).find(
    (entry) => entry.name === options.moduleName,
  );
  if (projected === undefined) {
    throw new TypeError(
      `Codegen TurboModule ${options.moduleName} is unavailable for the selected adapter platform.`,
    );
  }
  const { module, name } = projected;
  const methods = module.spec.methods
    .map((method) => ({
      name: method.name,
      optional:
        method.optional ||
        unwrapNullableNativeFunction(method.typeAnnotation).nullable,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const emitters = module.spec.eventEmitters
    .map((emitter) => ({ name: emitter.name, optional: emitter.optional }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const members = [...methods, ...emitters].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  if (members.some((member) => member.name === "__proto__")) {
    throw new TypeError(
      `Codegen TurboModule ${name} cannot scaffold reserved member __proto__.`,
    );
  }
  return `${[
    "// Scaffolded by @solid-native/codegen. This file is application-owned and safe to edit.",
    "// Native method outputs intentionally remain unknown until policy code validates them.",
    "",
    ...(emitters.length === 0
      ? []
      : [
          "import {",
          "  createNativeEventAccessor,",
          "  type NativeEventAccessorOptions,",
          '} from "@solid-native/core";',
        ]),
    `import type { ${name}NativeModule } from ${JSON.stringify(bindingsImport)};`,
    "",
    "type NativeCallable<T> = T extends (...arguments_: infer TArguments) => infer TResult",
    "  ? (...arguments_: TArguments) => TResult",
    "  : never;",
    "type NativeArguments<T> = T extends (...arguments_: infer TArguments) => unknown",
    "  ? TArguments",
    "  : never;",
    ...(emitters.length === 0
      ? []
      : [
          "type NativeEventValue<T> = NativeCallable<T> extends (",
          "  listener: (event: infer TEvent) => void,",
          ") => unknown",
          "  ? TEvent",
          "  : never;",
        ]),
    "",
    `export interface ${name}AdapterPolicy {`,
    "  readonly methods: Readonly<{",
    ...adapterPolicyMembersSource(name, methods),
    "  }>;",
    "  readonly events: Readonly<{",
    ...adapterEventPolicySource(name, emitters),
    "  }>;",
    "}",
    "",
    `export interface ${name}SolidAdapter {`,
    ...adapterInterfaceMembersSource(name, methods, emitters),
    "}",
    "",
    "function frozenArguments<TArguments extends readonly unknown[]>(",
    "  arguments_: TArguments,",
    "): Readonly<TArguments> {",
    "  return Object.freeze(arguments_);",
    "}",
    "",
    `export function create${name}SolidAdapter(`,
    `  native: ${name}NativeModule,`,
    `  policy: ${name}AdapterPolicy,`,
    `): ${name}SolidAdapter {`,
    ...members.flatMap((member) =>
      boundAdapterMemberSource(name, member.name, member.optional),
    ),
    "  return Object.freeze({",
    ...methods.flatMap((method) =>
      adapterMethodImplementationSource(name, method.name, method.optional),
    ),
    ...emitters.flatMap((emitter) =>
      adapterEventImplementationSource(emitter.name, emitter.optional),
    ),
    "  });",
    "}",
  ].join("\n")}\n`;
}

function quotedUnion(values: readonly (string | number)[]): string {
  if (values.length === 0) return "never";
  return values.map((value) => JSON.stringify(value)).join(" | ");
}

function objectType(
  properties: readonly NamedShape<ComponentValueTypeAnnotation>[],
): string {
  if (properties.length === 0) return "Readonly<Record<string, never>>";
  const observed = new Set<string>();
  const fields = properties.map((property) => {
    if (observed.has(property.name)) {
      throw new TypeError(
        `Codegen object declares duplicate property ${property.name}.`,
      );
    }
    observed.add(property.name);
    return `readonly ${JSON.stringify(property.name)}${property.optional ? "?" : ""}: ${componentValueType(property.typeAnnotation)};`;
  });
  return `Readonly<{ ${fields.join(" ")} }>`;
}

function componentValueType(annotation: ComponentValueTypeAnnotation): string {
  switch (annotation.type) {
    case "BooleanTypeAnnotation":
      return "boolean";
    case "StringTypeAnnotation":
      return "string";
    case "DoubleTypeAnnotation":
    case "FloatTypeAnnotation":
    case "Int32TypeAnnotation":
      return "number";
    case "MixedTypeAnnotation":
      return "HostValue";
    case "StringEnumTypeAnnotation":
    case "Int32EnumTypeAnnotation":
      return quotedUnion(annotation.options);
    case "UnionTypeAnnotation":
      return quotedUnion(annotation.types.map(({ value }) => value));
    case "ReservedPropTypeAnnotation":
      switch (annotation.name) {
        case "ColorPrimitive":
          return "string";
        case "ImageSourcePrimitive":
        case "ImageRequestPrimitive":
          return "ImageSource";
        case "PointPrimitive":
          return "Readonly<{ readonly x: number; readonly y: number }>";
        case "EdgeInsetsPrimitive":
          return "Readonly<{ readonly top: number; readonly left: number; readonly bottom: number; readonly right: number }>";
        case "DimensionPrimitive":
          return "number | string";
      }
    case "ReservedTypeAnnotation":
      return "number";
    case "ObjectTypeAnnotation":
      return objectType(
        annotation.properties as readonly NamedShape<ComponentValueTypeAnnotation>[],
      );
    case "ArrayTypeAnnotation":
      return `ReadonlyArray<${componentValueType(annotation.elementType)}>`;
    default:
      throw new TypeError(
        `Unsupported component type annotation ${JSON.stringify((annotation as { readonly type?: unknown }).type)}.`,
      );
  }
}

function componentPropsSource(name: string, component: ComponentShape): string {
  const fields: string[] = [];
  const observed = new Set<string>();
  for (const property of component.props) {
    if (observed.has(property.name)) {
      throw new TypeError(
        `Codegen component ${name} declares duplicate prop ${property.name}.`,
      );
    }
    observed.add(property.name);
    fields.push(
      `  readonly ${JSON.stringify(property.name)}${property.optional ? "?" : ""}: ${componentValueType(property.typeAnnotation)};`,
    );
  }
  for (const event of component.events) {
    if (observed.has(event.name)) {
      throw new TypeError(
        `Codegen component ${name} declares both a prop and event named ${event.name}.`,
      );
    }
    observed.add(event.name);
    fields.push(
      `  readonly ${JSON.stringify(event.name)}${event.optional ? "?" : ""}: (event: NativeSyntheticEvent) => unknown;`,
    );
  }
  return [
    `export interface ${name}NativeProps extends NativeElementProps {`,
    ...fields,
    "}",
    "",
    `export const ${name}NativeComponent =`,
    `  createNativeComponent<${name}NativeProps>(${JSON.stringify(name)});`,
  ].join("\n");
}

function componentCommandsSource(
  name: string,
  component: ComponentShape,
): string | undefined {
  if (component.commands.length === 0) return undefined;
  const methods = component.commands.map((command) => {
    const parameters = command.typeAnnotation.params.map(
      (parameter, index) =>
        `    argument${index}: ${componentValueType(parameter.typeAnnotation)},`,
    );
    const arguments_ = command.typeAnnotation.params.map(
      (_parameter, index) => `argument${index}`,
    );
    return [
      `  ${JSON.stringify(command.name)}(`,
      "    node: NativeNode,",
      ...parameters,
      "  ): Promise<void> {",
      `    return node.dispatchCommand(${[
        JSON.stringify(command.name),
        ...arguments_,
      ].join(", ")});`,
      "  },",
    ].join("\n");
  });
  return [
    `export const ${name}NativeCommands = Object.freeze({`,
    ...methods,
    "});",
  ].join("\n");
}

function descriptorDataSource(
  descriptors: readonly NativeComponentDescriptor[],
): string {
  const declarations = descriptors.map((descriptor) =>
    [
      "// prettier-ignore",
      `export const ${descriptor.name}NativeDescriptor: NativeComponentDescriptor = freezeDescriptor({`,
      `  name: ${JSON.stringify(descriptor.name)},`,
      `  acceptsRawText: ${String(descriptor.acceptsRawText)},`,
      `  bubblingEvents: ${JSON.stringify(descriptor.bubblingEvents)},`,
      `  directEvents: ${JSON.stringify(descriptor.directEvents)},`,
      `  commands: ${JSON.stringify(descriptor.commands)},`,
      "});",
    ].join("\n"),
  );
  return [
    "function freezeDescriptor(",
    "  descriptor: NativeComponentDescriptor,",
    "): NativeComponentDescriptor {",
    "  Object.freeze(descriptor.bubblingEvents);",
    "  Object.freeze(descriptor.directEvents);",
    "  for (const parameters of Object.values(descriptor.commands)) {",
    "    Object.freeze(parameters);",
    "  }",
    "  Object.freeze(descriptor.commands);",
    "  return Object.freeze(descriptor);",
    "}",
    "",
    ...declarations.flatMap((declaration) => [declaration, ""]),
    "// prettier-ignore",
    "export const SOLID_NATIVE_COMPONENT_DESCRIPTORS: readonly NativeComponentDescriptor[] = Object.freeze([",
    ...descriptors.map(({ name }) => `  ${name}NativeDescriptor,`),
    "]);",
  ].join("\n");
}

/** Emits a React-free TypeScript module for direct application consumption. */
export function generateSolidNativeComponentModule(
  value: unknown,
  options: SolidNativeDescriptorOptions = {},
): string {
  const projected = projectedComponents(value, options);
  const sections = projected.flatMap(({ component, name }) => {
    const commands = componentCommandsSource(name, component);
    return [
      componentPropsSource(name, component),
      ...(commands === undefined ? [] : [commands]),
    ];
  });
  return `${[
    "// Generated by @solid-native/codegen. Do not edit.",
    "import {",
    "  createNativeComponent,",
    "  type ImageSource,",
    "  type NativeElementProps,",
    "  type NativeNode,",
    "  type NativeSyntheticEvent,",
    '} from "@solid-native/core";',
    'import type { HostValue, NativeComponentDescriptor } from "@solid-native/host-contract";',
    "",
    ...sections.flatMap((section) => [section, ""]),
    descriptorDataSource(projected.map(({ descriptor }) => descriptor)),
  ].join("\n")}\n`;
}

/** Emits every Solid-facing binding present in a mixed Codegen schema. */
export function generateSolidNativeBindingsModule(
  value: unknown,
  options: SolidNativeBindingOptions = {},
): string {
  const hasComponents =
    createSolidNativeComponentDescriptors(value, options).length > 0;
  const hasModules =
    createSolidNativeModuleDescriptors(value, options).length > 0;
  if (!hasComponents && !hasModules) {
    return "// Generated by @solid-native/codegen. Do not edit.\nexport {};\n";
  }
  if (!hasComponents) {
    return generateSolidNativeTurboModuleBindings(value, options);
  }
  const componentSource = generateSolidNativeComponentModule(value, options);
  if (!hasModules) return componentSource;
  const moduleLines = generateSolidNativeTurboModuleBindings(value, options)
    .trimEnd()
    .split("\n");
  moduleLines.shift();
  return `${componentSource.trimEnd()}\n\n${moduleLines.join("\n")}\n`;
}
