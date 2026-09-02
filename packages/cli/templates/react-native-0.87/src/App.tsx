/** @jsxImportSource @solid-native/core */
import { createUIWorkletGraph } from "@solid-native/animation";
import { createNativeViewAnimation } from "@solid-native/animation/native";
import { Button, StyleSheet, Text, View } from "@solid-native/core";
import type {
  NetworkService,
  NetworkTextRequestHandle,
} from "@solid-native/networking";
import { createNetworkController } from "@solid-native/networking/solid";
import { createSignal } from "solid-js";

const STARTER_NETWORK_URL = "https://example.com/";

export interface AppProps {
  readonly network: NetworkService;
}

const cardGraph = createUIWorkletGraph(
  { progress: 0 },
  ({ progress }, { interpolate }) => ({
    translateY: interpolate(progress, [0, 1], [0, -16]),
    scaleX: interpolate(progress, [0, 1], [1, 1.04]),
    scaleY: interpolate(progress, [0, 1], [1, 1.04]),
    rotation: interpolate(progress, [0, 1], [0, -2]),
  }),
);

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: "#f7f8fa",
    flex: 1,
    gap: 20,
    justifyContent: "center",
    padding: 24,
  },
  heading: { color: "#111827", fontSize: 30 },
  description: { color: "#4b5563", fontSize: 17, textAlign: "center" },
  card: {
    backgroundColor: "#dbeafe",
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  cardText: { color: "#1e3a8a", fontSize: 17 },
  button: {
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  buttonText: { color: "#ffffff", fontSize: 17, margin: 0 },
  count: { color: "#374151", fontSize: 16 },
  status: { color: "#4b5563", fontSize: 15, textAlign: "center" },
});

export function App(props: AppProps) {
  const [count, setCount] = createSignal(0, { name: "starter.press-count" });
  const [networkStatus, setNetworkStatus] = createSignal(
    "Native network check not started.",
    { name: "starter.network-status" },
  );
  const [raised, setRaised] = createSignal(false, {
    name: "starter.card-raised",
  });
  const cardAnimation = createNativeViewAnimation(cardGraph);
  const network = createNetworkController(props.network);
  let activeRequest: NetworkTextRequestHandle | undefined;

  const toggleCard = async (): Promise<void> => {
    if (!(await cardAnimation.ready)) return;
    const next = !raised();
    cardAnimation.animate(
      { progress: next ? 1 : 0 },
      { durationMilliseconds: 240, easing: "ease-in-out" },
    );
    setRaised(next);
  };

  const checkNativeNetwork = (): void => {
    activeRequest?.cancel();
    setNetworkStatus("Starting bounded native request…");
    const request = network.requestText(
      {
        url: STARTER_NETWORK_URL,
        headers: { Accept: "text/html" },
        timeoutMilliseconds: 10_000,
        maxResponseCharacters: 131_072,
      },
      {
        onResponse(response) {
          setNetworkStatus(
            `Native response status: ${String(response.status)}`,
          );
        },
        onChunk(chunk) {
          setNetworkStatus(
            `Native chunk ${String(chunk.sequence)}: ${String(chunk.text.length)} characters`,
          );
        },
      },
    );
    activeRequest = request;
    void request.result.then(
      () => {
        if (activeRequest === request) activeRequest = undefined;
      },
      () => {
        if (activeRequest !== request) return;
        activeRequest = undefined;
        setNetworkStatus("Native request failed or was cancelled.");
      },
    );
  };

  return (
    <View style={styles.root}>
      <Text accessibilityRole="header" style={styles.heading}>
        {__APP_TITLE_LITERAL__}
      </Text>
      <Text style={styles.description}>
        Solid owns this native Fabric tree directly.
      </Text>
      <View ref={cardAnimation.ref} style={styles.card}>
        <Text style={styles.cardText}>
          Typed graph, native UI-thread frames
        </Text>
      </View>
      <Button
        accessibilityLabel="Toggle native animation"
        onPress={toggleCard}
        title={raised() ? "Lower native card" : "Lift native card"}
        style={[styles.button, { backgroundColor: "#0f766e" }]}
        textStyle={styles.buttonText}
      />
      <Button
        accessibilityLabel="Increment counter"
        onPress={() => setCount((value) => value + 1)}
        title="Increment count"
        style={[styles.button, { backgroundColor: "#2563eb" }]}
        textStyle={styles.buttonText}
      />
      <Text
        accessibilityLabel={`Press count: ${count()}`}
        accessibilityLiveRegion="polite"
        style={styles.count}
      >
        {"Press count: " + String(count())}
      </Text>
      <Button
        accessibilityLabel="Check native network"
        onPress={checkNativeNetwork}
        title="Check native network"
        style={[styles.button, { backgroundColor: "#7c3aed" }]}
        textStyle={styles.buttonText}
      />
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {networkStatus()}
      </Text>
    </View>
  );
}
