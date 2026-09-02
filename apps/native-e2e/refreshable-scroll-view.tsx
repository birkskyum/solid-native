/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  RefreshableScrollView,
  Text,
  View,
  type ScrollViewHandle,
} from "@solid-native/core";
import {
  createSignal,
  type NativeApplication,
  type NativeNode,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { onCleanup } from "solid-js";

const READY_TEXT = "Solid Native pull to refresh ready";
const REJECTED_TEXT = "Rejected native refresh 1";
const ACCEPTED_TEXT = "Accepted native refresh 2";
const COMPLETED_TEXT = "Completed native refresh 2";
const DISPOSE_LABEL = "Dispose Solid Native pull to refresh proof";
const ACCEPTED_REFRESH_HOLD_MS = 2_500;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_REFRESHABLE_SCROLL_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    invariant(
      binding.platform === "android" || binding.platform === "ios",
      "The physical pull-to-refresh proof requires an Android or iOS host.",
    );
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    let application: NativeApplication;
    let backingScrollView: ScrollViewHandle | undefined;
    let retainedBackingScrollView: ScrollViewHandle | undefined;
    let refreshAttempts = 0;

    application = startApplication(
      () => {
        const [refreshing, setRefreshing] = createSignal(false);
        const [status, setStatus] = createSignal(READY_TEXT);
        let completionActive = false;
        onCleanup(() => {
          completionActive = false;
        });

        const publishCommit = async (marker: string): Promise<void> => {
          invariant(
            backingScrollView === retainedBackingScrollView,
            `${marker} replaced the backing ScrollView handle.`,
          );
          const commit = await application.root.flushMounted();
          invariant(commit !== undefined, `${marker} did not commit.`);
          invariant(
            backingScrollView === retainedBackingScrollView,
            `${marker} replaced the backing ScrollView handle during commit.`,
          );
          console.log(marker, commit.sequence);
        };

        const handleRefresh = (): void => {
          refreshAttempts++;
          if (refreshAttempts === 1) {
            setStatus(REJECTED_TEXT);
            void publishCommit(
              "SOLID_NATIVE_REFRESHABLE_SCROLL_REJECTED_SUCCEEDED",
            ).catch(reportFatal);
            return;
          }
          if (refreshAttempts !== 2 || completionActive) {
            reportFatal(
              new Error(
                `The pull-to-refresh proof received invalid attempt ${String(refreshAttempts)}.`,
              ),
            );
            return;
          }

          completionActive = true;
          setRefreshing(true);
          setStatus(ACCEPTED_TEXT);
          void (async () => {
            await publishCommit(
              "SOLID_NATIVE_REFRESHABLE_SCROLL_ACCEPTED_SUCCEEDED",
            );
            await delay(ACCEPTED_REFRESH_HOLD_MS);
            if (!completionActive) return;
            setRefreshing(false);
            setStatus(COMPLETED_TEXT);
            completionActive = false;
            await publishCommit(
              "SOLID_NATIVE_REFRESHABLE_SCROLL_COMPLETED_SUCCEEDED",
            );
            console.log("SOLID_NATIVE_REFRESHABLE_SCROLL_IDENTITY_SUCCEEDED");
          })().catch(reportFatal);
        };

        return (
          <View style={{ backgroundColor: "#eff6ff", flex: 1 }}>
            <RefreshableScrollView
              ref={(node) => {
                backingScrollView = node;
              }}
              colors={["#2563eb", "#16a34a"]}
              contentContainerStyle={{ minHeight: 1_200, padding: 20 }}
              enabled
              progressBackgroundColor="#ffffff"
              progressViewOffset={16}
              refreshing={refreshing()}
              size="large"
              testID="solid-native-refreshable-scroll-view"
              tintColor="#2563eb"
              onRefresh={handleRefresh}
              style={{
                backgroundColor: "#eff6ff",
                borderRadius: 12,
                flex: 1,
                marginHorizontal: 12,
                marginVertical: 16,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <Text
                testID="solid-native-refresh-status"
                style={{ color: "#1e3a8a", fontSize: 17, marginTop: 8 }}
              >
                {status()}
              </Text>
              <Pressable
                accessible
                accessibilityLabel={DISPOSE_LABEL}
                accessibilityRole="button"
                onPress={() => {
                  if (
                    refreshAttempts !== 2 ||
                    refreshing() ||
                    status() !== COMPLETED_TEXT ||
                    backingScrollView !== retainedBackingScrollView
                  ) {
                    reportFatal(
                      new Error(
                        "The pull-to-refresh proof was disposed before both controlled paths settled.",
                      ),
                    );
                    return;
                  }
                  void application.dispose().then(() => {
                    if (binding.getSurfaceInfo().ready) {
                      throw new Error(
                        "The pull-to-refresh proof resolved disposal before its native surface stopped.",
                      );
                    }
                    console.log(
                      "SOLID_NATIVE_REFRESHABLE_SCROLL_TEARDOWN_SUCCEEDED",
                    );
                  }, reportFatal);
                }}
                style={{
                  backgroundColor: "#1d4ed8",
                  borderRadius: 8,
                  marginTop: 12,
                  padding: 12,
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 16 }}>
                  {DISPOSE_LABEL}
                </Text>
              </Pressable>
              {Array.from({ length: 24 }, (_, index) => (
                <View
                  style={{
                    backgroundColor: index % 2 === 0 ? "#dbeafe" : "#dcfce7",
                    borderRadius: 8,
                    marginTop: 12,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 16 }}>
                    Refreshable row {index + 1}
                  </Text>
                </View>
              ))}
            </RefreshableScrollView>
          </View>
        );
      },
      host,
      {
        surface: {
          name: "refreshable-scroll-view-e2e",
          initialProps: {
            style: { backgroundColor: "#eff6ff", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: {
          components: [
            "Pressable",
            "RefreshControl",
            "ScrollContentView",
            "ScrollView",
            "Text",
            "View",
          ],
        },
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    invariant(
      initial?.sequence === 1,
      "The pull-to-refresh proof did not mount exactly once.",
    );
    invariant(
      backingScrollView?.nativeNode.componentName === "ScrollView",
      "RefreshableScrollView did not expose its backing ScrollView ref.",
    );
    retainedBackingScrollView = backingScrollView;
    console.log("SOLID_NATIVE_REFRESHABLE_SCROLL_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
