import type { WindowDimensions, WindowMetricsSource } from "../src/index.js";
import { createWindowDimensions } from "../src/index.js";

declare const source: WindowMetricsSource;

const dimensions: WindowDimensions = createWindowDimensions(source);
const width: number = dimensions.width();
const fontScale: number = dimensions.fontScale();

void width;
void fontScale;
