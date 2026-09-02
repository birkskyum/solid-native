import { createElement, useEffect, useRef, useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

import SolidNativeGeneratedView from "./specs/SolidNativeGeneratedViewNativeComponent";

const MODULE_NAME = "SolidNativeReactControl";

function ReactMemoryApplication() {
  const [count, setCount] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) {
      console.log("SOLID_NATIVE_REACT_MEMORY_READY");
      return;
    }
    mounted.current = true;
    setCount(1);
  }, [count]);

  return createElement(
    View,
    { style: styles.screen, testID: "memory-root" },
    createElement(
      Text,
      {
        accessibilityRole: "header",
        style: styles.title,
        testID: "memory-title",
      },
      "Native renderer memory scenario",
    ),
    createElement(
      Text,
      { style: styles.status, testID: "memory-status" },
      `Memory control count ${String(count)}`,
    ),
    createElement(SolidNativeGeneratedView, {
      accessibilityLabel: "Memory generated Fabric component",
      accessible: true,
      label: "Memory generated Fabric component",
      style: styles.generated,
      testID: "memory-generated-view",
    }),
    createElement(
      Pressable,
      {
        accessibilityLabel: "Run memory update",
        accessibilityRole: "button",
        onPress: () => setCount((value) => value + 1),
        style: styles.button,
        testID: "memory-button",
      },
      createElement(Text, { style: styles.buttonText }, "Run memory update"),
    ),
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#f4f0ff",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#35156d",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  status: {
    color: "#281942",
    fontSize: 18,
    marginBottom: 16,
  },
  generated: {
    backgroundColor: "#5b21b6",
    height: 48,
    marginBottom: 16,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#6d28d9",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
});

AppRegistry.registerComponent(MODULE_NAME, () => ReactMemoryApplication);
