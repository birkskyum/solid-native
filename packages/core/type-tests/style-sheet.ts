import { StyleSheet, type NativeStyle, type StyleProp } from "../src/index.js";

const styles = StyleSheet.create({
  root: { backgroundColor: "#ffffff", flex: 1 },
  title: { color: "#111827", fontSize: 24 },
});

const root: NativeStyle = styles.root;
const composed: StyleProp = StyleSheet.compose(styles.root, false);
const flattened: NativeStyle | undefined = StyleSheet.flatten([
  composed,
  styles.title,
]);
const absolute: NativeStyle = StyleSheet.absoluteFill;

StyleSheet.create({
  invalid: {
    // @ts-expect-error Native styles cannot contain functions.
    opacity: () => 1,
  },
});

void root;
void flattened;
void absolute;
