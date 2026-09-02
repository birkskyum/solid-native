/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  ScrollView,
  Text,
  View,
} from "@solid-native/core";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

const READY_TEXT = "Solid Native Pressable ready";
const RETENTION_LABEL = "Diagonal retained-region Pressable";
const CANCEL_LABEL = "Cancellation recovery Pressable";
const RIPPLE_LABEL = "Native foreground ripple Pressable";
const SCROLL_LABEL = "Scroll takeover Pressable";
const DISPOSE_LABEL = "Dispose Solid Native Pressable proof";

interface PressCounts {
  readonly ins: number;
  readonly moves: number;
  readonly outs: number;
  readonly presses: number;
}

const EMPTY_COUNTS: PressCounts = Object.freeze({
  ins: 0,
  moves: 0,
  outs: 0,
  presses: 0,
});

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_PRESSABLE_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function status(prefix: string, counts: PressCounts): string {
  return `${prefix} in=${counts.ins} out=${counts.outs} move=${counts.moves} press=${counts.presses}`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function scrollOffsetY(payload: unknown): number | undefined {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const contentOffset = Reflect.get(payload, "contentOffset");
  if (
    contentOffset === null ||
    typeof contentOffset !== "object" ||
    Array.isArray(contentOffset)
  ) {
    return undefined;
  }
  return finiteNumber(Reflect.get(contentOffset, "y"));
}

function updateCount(
  setCounts: (
    value: PressCounts | ((previous: PressCounts) => PressCounts),
  ) => PressCounts,
  name: keyof PressCounts,
): void {
  setCounts((previous) => ({
    ...previous,
    [name]: previous[name] + 1,
  }));
}

function StaticProofButton(props: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessible
      accessibilityLabel={props.label}
      accessibilityRole="button"
      onPress={props.onPress}
      style={{
        alignItems: "center",
        backgroundColor: "#334155",
        borderRadius: 8,
        justifyContent: "center",
        marginTop: 10,
        minHeight: 44,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 14 }}>{props.label}</Text>
    </Pressable>
  );
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    let application: NativeApplication;
    application = startApplication(
      () => {
        const [retention, setRetention] = createSignal(EMPTY_COUNTS);
        const [cancellation, setCancellation] = createSignal(EMPTY_COUNTS);
        const [ripple, setRipple] = createSignal(EMPTY_COUNTS);
        const [scroll, setScroll] = createSignal(EMPTY_COUNTS);
        const [scrollY, setScrollY] = createSignal(0);

        const assertCompleted = (): void => {
          const retained = retention();
          const cancelled = cancellation();
          const nativeRipple = ripple();
          const takeover = scroll();
          if (
            retained.ins !== 2 ||
            retained.outs !== 2 ||
            retained.moves < 3 ||
            retained.presses !== 1
          ) {
            throw new Error(
              `Diagonal retained-region proof is incomplete: ${status("Retention", retained)}.`,
            );
          }
          if (
            cancelled.ins !== 2 ||
            cancelled.outs !== 2 ||
            cancelled.presses !== 1
          ) {
            throw new Error(
              `Cancellation recovery proof is incomplete: ${status("Cancellation", cancelled)}.`,
            );
          }
          if (
            nativeRipple.ins !== 1 ||
            nativeRipple.outs !== 1 ||
            nativeRipple.presses !== 1
          ) {
            throw new Error(
              `Native ripple proof is incomplete: ${status("Ripple", nativeRipple)}.`,
            );
          }
          if (
            takeover.ins !== 1 ||
            takeover.outs !== 1 ||
            takeover.presses !== 0 ||
            scrollY() <= 0
          ) {
            throw new Error(
              `Scroll takeover proof is incomplete: ${status("Scroll", takeover)} y=${scrollY()}.`,
            );
          }
        };

        return (
          <View
            style={{
              alignItems: "stretch",
              backgroundColor: "#f8fafc",
              flex: 1,
              padding: 18,
            }}
          >
            <Text accessibilityRole="header" style={{ fontSize: 22 }}>
              {READY_TEXT}
            </Text>
            <Text style={{ color: "#334155", fontSize: 13, marginTop: 4 }}>
              {status("Retention", retention())}
            </Text>
            <Pressable
              accessible
              accessibilityLabel={RETENTION_LABEL}
              accessibilityRole="button"
              android_ripple={{
                color: "#ffffff",
                foreground: true,
                radius: 30,
              }}
              onPress={() => updateCount(setRetention, "presses")}
              onPressIn={() => updateCount(setRetention, "ins")}
              onPressMove={() => updateCount(setRetention, "moves")}
              onPressOut={() => updateCount(setRetention, "outs")}
              pressRetentionOffset={32}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "center",
                backgroundColor: pressed ? "#0d9488" : "#0f766e",
                borderRadius: 10,
                height: 64,
                justifyContent: "center",
                marginTop: 6,
                width: 200,
              })}
            >
              {({ pressed }) => (
                <Text style={{ color: "#ffffff", fontSize: 15 }}>
                  {pressed ? "Retained press active" : "Retained press idle"}
                </Text>
              )}
            </Pressable>

            <Text style={{ color: "#334155", fontSize: 13, marginTop: 6 }}>
              {status("Cancellation", cancellation())}
            </Text>
            <Pressable
              accessible
              accessibilityLabel={CANCEL_LABEL}
              accessibilityRole="button"
              onPress={() => updateCount(setCancellation, "presses")}
              onPressIn={() => updateCount(setCancellation, "ins")}
              onPressMove={() => updateCount(setCancellation, "moves")}
              onPressOut={() => updateCount(setCancellation, "outs")}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: pressed ? "#7c3aed" : "#6d28d9",
                borderRadius: 8,
                height: 48,
                justifyContent: "center",
                marginTop: 4,
              })}
            >
              <Text style={{ color: "#ffffff", fontSize: 14 }}>
                Cancel then recover
              </Text>
            </Pressable>

            <Text style={{ color: "#334155", fontSize: 13, marginTop: 6 }}>
              {status("Ripple", ripple())}
            </Text>
            <Pressable
              accessible
              accessibilityLabel={RIPPLE_LABEL}
              accessibilityRole="button"
              android_ripple={{
                alpha: 0.85,
                color: "#ffffff",
                foreground: true,
                radius: 36,
              }}
              onPress={() => updateCount(setRipple, "presses")}
              onPressIn={() => updateCount(setRipple, "ins")}
              onPressOut={() => updateCount(setRipple, "outs")}
              style={{
                alignItems: "center",
                alignSelf: "center",
                backgroundColor: "#111827",
                borderRadius: 40,
                height: 72,
                justifyContent: "center",
                marginTop: 4,
                width: 72,
              }}
            >
              <Text style={{ color: "#ffffff", fontSize: 12 }}>Ripple</Text>
            </Pressable>

            <Text style={{ color: "#334155", fontSize: 13, marginTop: 6 }}>
              {`${status("Scroll", scroll())} y=${Math.round(scrollY())}`}
            </Text>
            <ScrollView
              contentContainerStyle={{ minHeight: 420, padding: 8 }}
              onScroll={(event) => {
                const nextY = scrollOffsetY(event.payload);
                if (nextY !== undefined) setScrollY(nextY);
              }}
              scrollEventThrottle={16}
              style={{
                backgroundColor: "#e2e8f0",
                borderRadius: 8,
                flexGrow: 0,
                flexShrink: 0,
                height: 160,
                marginTop: 4,
              }}
            >
              <Pressable
                accessible
                accessibilityLabel={SCROLL_LABEL}
                accessibilityRole="button"
                onPress={() => updateCount(setScroll, "presses")}
                onPressIn={() => updateCount(setScroll, "ins")}
                onPressMove={() => updateCount(setScroll, "moves")}
                onPressOut={() => updateCount(setScroll, "outs")}
                pressRetentionOffset={96}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: pressed ? "#f97316" : "#ea580c",
                  borderRadius: 8,
                  height: 64,
                  justifyContent: "center",
                })}
              >
                <Text style={{ color: "#ffffff", fontSize: 14 }}>
                  Drag to hand off to ScrollView
                </Text>
              </Pressable>
              {Array.from({ length: 6 }, (_, index) => (
                <View
                  style={{
                    backgroundColor: index % 2 === 0 ? "#cbd5e1" : "#dbeafe",
                    borderRadius: 6,
                    height: 48,
                    justifyContent: "center",
                    marginTop: 8,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 13 }}>
                    Scroll takeover row {index + 1}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <StaticProofButton
              label={DISPOSE_LABEL}
              onPress={() => {
                try {
                  assertCompleted();
                } catch (error) {
                  reportFatal(error);
                  return;
                }
                console.log("SOLID_NATIVE_PRESSABLE_SCENARIOS_SUCCEEDED");
                void application.dispose().then(() => {
                  if (binding.getSurfaceInfo().ready) {
                    throw new Error(
                      "The Pressable proof resolved disposal before its native surface stopped.",
                    );
                  }
                  console.log("SOLID_NATIVE_PRESSABLE_TEARDOWN_SUCCEEDED");
                }, reportFatal);
              }}
            />
          </View>
        );
      },
      host,
      {
        surface: {
          name: "pressable-e2e",
          initialProps: {
            style: { backgroundColor: "#f8fafc", flex: 1 },
          },
        },
        requirements: {
          components: ["Pressable", "ScrollView", "Text", "View"],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The Pressable proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_PRESSABLE_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
