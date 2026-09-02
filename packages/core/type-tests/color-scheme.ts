import type { ColorScheme, ColorSchemeSource } from "../src/index.js";
import { createColorScheme } from "../src/index.js";

declare const source: ColorSchemeSource;
const scheme: ColorScheme = createColorScheme(source)();

void scheme;
