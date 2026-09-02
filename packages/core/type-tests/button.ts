import type { ButtonProps } from "../src/index.js";

const button: ButtonProps = {
  title: "Save",
  onPress: (event) => event.payload,
  color: "#2563eb",
  style: (state) => ({ opacity: state.pressed ? 0.7 : 1 }),
  textStyle: [{ fontWeight: "600" }, false],
  accessibilityLabel: "Save changes",
};

const missingPress: ButtonProps = {
  title: "Save",
  // @ts-expect-error Button requires an activation callback.
  onPress: undefined,
};

const invalidChildren: ButtonProps = {
  title: "Save",
  onPress: () => undefined,
  // @ts-expect-error Button owns its Text child.
  children: "Custom child",
};

const invalidRole: ButtonProps = {
  title: "Save",
  onPress: () => undefined,
  // @ts-expect-error Button always exposes the button accessibility role.
  accessibilityRole: "link",
};

void button;
void missingPress;
void invalidChildren;
void invalidRole;
