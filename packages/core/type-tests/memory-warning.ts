import type { MemoryWarningSource } from "../src/index.js";
import { createMemoryWarningCount } from "../src/index.js";

declare const source: MemoryWarningSource;
const warnings: number = createMemoryWarningCount(source)();

void warnings;
