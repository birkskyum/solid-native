import type { PressableProps } from "../src/index.js";

const callbackProps: PressableProps = {
  android_ripple: {
    color: "#336699",
    borderless: false,
    radius: 24,
    foreground: true,
    alpha: 0.7,
  },
  children: (state) => (state.pressed ? "Release" : "Save"),
  style: (state) => ({ opacity: state.pressed ? 0.5 : 1 }),
  delayHoverIn: 40,
  delayHoverOut: 60,
  unstable_pressDelay: 80,
  pressRetentionOffset: { top: 8, right: 12, bottom: 16, left: 12 },
  hitSlop: { top: 4, bottom: 4 },
  pointerEvents: "auto",
  onLayout: (event) => event.payload.layout.width,
  onPressMove: (event) => event.payload,
  onFocus: (event) => event.name,
  onBlur: (event) => event.name,
  onHoverIn: (event) => event.name,
  onHoverOut: (event) => event.name,
};

const accessorChildren: PressableProps = {
  children: () => "Reactive child",
};

const invalidDelay: PressableProps = {
  // @ts-expect-error delayLongPress is expressed in milliseconds.
  delayLongPress: "slow",
};

const invalidRetentionOffset: PressableProps = {
  // @ts-expect-error press retention insets are expressed in density-independent pixels.
  pressRetentionOffset: "wide",
};

const invalidHitSlop: PressableProps = {
  // @ts-expect-error hit slop accepts only edge inset names.
  hitSlop: { horizontal: 8 },
};

const invalidRipple: PressableProps = {
  android_ripple: {
    // @ts-expect-error Android ripple radii are density-independent numbers.
    radius: "wide",
  },
};

void callbackProps;
void accessorChildren;
void invalidDelay;
void invalidRetentionOffset;
void invalidHitSlop;
void invalidRipple;
