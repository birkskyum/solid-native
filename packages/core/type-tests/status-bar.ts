import {
  StatusBar,
  type StatusBarSource,
  type StatusBarStackEntry,
} from "../src/index.js";

declare const source: StatusBarSource;

const result = StatusBar({
  source,
  animated: true,
  barStyle: "auto",
  hidden: false,
  showHideTransition: "fade",
});

const entry: StatusBarStackEntry = source.pushStatusBarEntry({
  barStyle: "light-content",
});
entry.replace({ hidden: true, showHideTransition: "slide" });
entry.remove();

void result;
