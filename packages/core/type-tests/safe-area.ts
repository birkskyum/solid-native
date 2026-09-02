import type {
  SafeAreaEdge,
  SafeAreaMetrics,
  SafeAreaProviderProps,
  SafeAreaViewProps,
} from "../src/index.js";
import { useSafeAreaFrame, useSafeAreaInsets } from "../src/index.js";

const metrics: SafeAreaMetrics = {
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
  frame: { x: 0, y: 59, width: 393, height: 759 },
};

const provider: SafeAreaProviderProps = { initialMetrics: metrics };
const edges: readonly SafeAreaEdge[] = ["top", "bottom"];
const view: SafeAreaViewProps = {
  edges,
  mode: "padding",
};
const insetTop: number = useSafeAreaInsets().top();
const frameWidth: number = useSafeAreaFrame().width();

void provider;
void view;
void insetTop;
void frameWidth;
