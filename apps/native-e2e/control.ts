import { createElement, useEffect, useRef, useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

import SolidNativeGeneratedView from "./specs/SolidNativeGeneratedViewNativeComponent";

const MODULE_NAME = "SolidNativeReactControl";

function ReactControlApplication() {
  const [count, setCount] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) {
      console.log("SOLID_NATIVE_REACT_CONTROL_UPDATE_SUCCEEDED");
      return;
    }
    mounted.current = true;
    console.log("SOLID_NATIVE_REACT_CONTROL_READY");
  }, [count]);

  return createElement(
    View,
    { style: styles.screen, testID: "react-control-root" },
    createElement(
      Text,
      { style: styles.title, testID: "react-control-title" },
      "React Native 0.87 control",
    ),
    createElement(
      Text,
      { style: styles.status, testID: "react-control-status" },
      `React control count ${String(count)}`,
    ),
    createElement(SolidNativeGeneratedView, {
      accessibilityLabel: "React control generated Fabric component",
      accessible: true,
      label: "Generated Fabric component",
      style: styles.generated,
      testID: "react-control-generated-view",
    }),
    createElement(
      Pressable,
      {
        accessibilityLabel: "Run React control update",
        accessibilityRole: "button",
        onPress: () => setCount((value) => value + 1),
        style: styles.button,
        testID: "react-control-button",
      },
      createElement(Text, { style: styles.buttonText }, "Run React update"),
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
    borderRadius: 10,
    height: 48,
    marginBottom: 16,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#6d28d9",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
});

AppRegistry.registerComponent(MODULE_NAME, () => ReactControlApplication);
