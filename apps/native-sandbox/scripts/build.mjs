import { rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSolidNative } from "./compiler.mjs";

const applicationRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(applicationRoot, "src");
const outputRoot = join(applicationRoot, "dist");
const sourceExtensions = new Set([".ts", ".tsx"]);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files.sort();
}

await rm(outputRoot, { force: true, recursive: true });
const files = await sourceFiles(sourceRoot);
for (const sourcePath of files) {
  const sourceName = relative(sourceRoot, sourcePath);
  const outputName = sourceName.replace(/\.tsx?$/, ".js");
  const outputPath = join(outputRoot, outputName);
  const mapPath = `${outputPath}.map`;
  const source = await readFile(sourcePath, "utf8");
  const result = compileSolidNative(source, sourcePath);
  result.map.file = outputName;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${result.code.trimEnd()}\n//# sourceMappingURL=${outputName.split("/").at(-1)}.map\n`,
  );
  await writeFile(mapPath, `${JSON.stringify(result.map)}\n`);
}

process.stdout.write(`Compiled ${files.length} file(s) with Solid OXC.\n`);
