type GradleToken = Readonly<{
  kind: "identifier" | "string" | "symbol";
  value: string;
}>;

export type AndroidReleaseSigningInspection =
  | Readonly<{ kind: "debug" }>
  | Readonly<{ kind: "non-debug"; names: readonly string[] }>
  | Readonly<{ kind: "ambiguous" }>
  | Readonly<{ kind: "missing" }>;

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tokenizeGradle(source: string): readonly GradleToken[] {
  const tokens: GradleToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const triple = source.slice(index, index + 3) === character.repeat(3);
      const delimiterLength = triple ? 3 : 1;
      index += delimiterLength;
      let value = "";
      while (index < source.length) {
        if (
          source.slice(index, index + delimiterLength) ===
          character.repeat(delimiterLength)
        ) {
          index += delimiterLength;
          break;
        }
        if (!triple && source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (
        index < source.length &&
        /[A-Za-z0-9_$-]/u.test(source[index] ?? "")
      ) {
        index += 1;
      }
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "symbol", value: character });
    index += 1;
  }
  return tokens;
}

function matchingGradleBrace(
  tokens: readonly GradleToken[],
  openIndex: number,
): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index]?.value === "{") depth += 1;
    if (tokens[index]?.value !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return undefined;
}

function findGradleBlock(
  tokens: readonly GradleToken[],
  name: string,
  start = 0,
  end = tokens.length,
  directOnly = false,
): Readonly<{ open: number; close: number }> | undefined {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token?.value === "}") {
      depth -= 1;
      continue;
    }
    if (token?.value === "{") {
      depth += 1;
      continue;
    }
    if (directOnly && depth !== 0) continue;
    let open: number | undefined;
    if (
      token?.kind === "identifier" &&
      token.value === name &&
      tokens[index + 1]?.value === "{"
    ) {
      open = index + 1;
    } else if (
      token?.kind === "identifier" &&
      (token.value === "getByName" || token.value === "named") &&
      tokens[index + 1]?.value === "(" &&
      tokens[index + 2]?.kind === "string" &&
      tokens[index + 2]?.value === name &&
      tokens[index + 3]?.value === ")" &&
      tokens[index + 4]?.value === "{"
    ) {
      open = index + 4;
    }
    if (open === undefined) continue;
    const close = matchingGradleBrace(tokens, open);
    if (close !== undefined && close <= end) return { open, close };
  }
  return undefined;
}

function signingConfigNameAfter(
  tokens: readonly GradleToken[],
  signingConfigsIndex: number,
  end: number,
): string | undefined {
  const first = tokens[signingConfigsIndex + 1];
  const second = tokens[signingConfigsIndex + 2];
  if (first?.value === "." && second?.kind === "identifier") {
    if (
      (second.value === "getByName" || second.value === "named") &&
      tokens[signingConfigsIndex + 3]?.value === "(" &&
      tokens[signingConfigsIndex + 4]?.kind === "string" &&
      signingConfigsIndex + 4 < end
    ) {
      return tokens[signingConfigsIndex + 4]?.value;
    }
    return second.value;
  }
  if (
    first?.value === "[" &&
    second?.kind === "string" &&
    tokens[signingConfigsIndex + 3]?.value === "]" &&
    signingConfigsIndex + 3 < end
  ) {
    return second.value;
  }
  return undefined;
}

export function inspectAndroidReleaseSigning(
  source: string,
): AndroidReleaseSigningInspection {
  const tokens = tokenizeGradle(source);
  const buildTypes = findGradleBlock(tokens, "buildTypes");
  if (buildTypes === undefined) return { kind: "missing" };
  const release = findGradleBlock(
    tokens,
    "release",
    buildTypes.open + 1,
    buildTypes.close,
    true,
  );
  if (release === undefined) return { kind: "missing" };

  const names = new Set<string>();
  for (let index = release.open + 1; index < release.close; index += 1) {
    if (tokens[index]?.value !== "signingConfig") continue;
    let valueIndex = index + 1;
    if (tokens[valueIndex]?.value === "=") valueIndex += 1;
    if (tokens[valueIndex]?.value !== "signingConfigs") continue;
    const name = signingConfigNameAfter(tokens, valueIndex, release.close);
    if (name !== undefined) names.add(name);
  }
  if (names.size === 0) return { kind: "missing" };
  const hasDebug = names.has("debug");
  const nonDebugNames = [...names]
    .filter((name) => name !== "debug")
    .sort(compareNames);
  if (hasDebug && nonDebugNames.length > 0) return { kind: "ambiguous" };
  if (hasDebug) return { kind: "debug" };
  return { kind: "non-debug", names: nonDebugNames };
}
