import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  AppRegistry,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";

const MODULE_NAME = "SolidNativeReactControl";
const ITEM_COUNT = 1_000;
const ITEM_SIZE = 56;
const VIEWPORT_SIZE = 392;
const PREPEND_COUNT = 50;
const PREPEND_OFFSET_DELTA = PREPEND_COUNT * ITEM_SIZE;
const IMPERATIVE_ITEM_INDEX = 900;
const IMPERATIVE_LOGICAL_INDEX = IMPERATIVE_ITEM_INDEX + PREPEND_COUNT;
const IMPERATIVE_VIEW_POSITION = 0.5;
const IMPERATIVE_EXPECTED_OFFSET =
  IMPERATIVE_LOGICAL_INDEX * ITEM_SIZE -
  IMPERATIVE_VIEW_POSITION * (VIEWPORT_SIZE - ITEM_SIZE);
const READY_TEXT = "React Native FlatList ready";
const SUCCEEDED_TEXT = "React Native FlatList physical scroll mounted";
const PREPEND_SUCCEEDED_TEXT = "React Native FlatList prepend anchor retained";
const PREPEND_STARTED_TEXT = "React Native FlatList prepend started";
const IMPERATIVE_SUCCEEDED_TEXT =
  "React Native FlatList imperative index mounted";
const IMPERATIVE_STARTED_TEXT = "React Native FlatList imperative jump started";
const PREPEND_LABEL = `Prepend ${String(PREPEND_COUNT)} React virtualized rows`;
const IMPERATIVE_LABEL = `Jump to React virtualized row ${String(IMPERATIVE_ITEM_INDEX)}`;
const ROW_PREFIX = "React control virtualized row ";
const PREPENDED_ROW_PREFIX = "React control prepended row ";

interface ListItem {
  readonly id: string;
  readonly label: string;
  readonly accessibilityLabel: string;
}

const originalItems: readonly ListItem[] = Array.from(
  { length: ITEM_COUNT },
  (_, index) => ({
    id: `item-${String(index)}`,
    label: `React control row ${String(index)}`,
    accessibilityLabel: `${ROW_PREFIX}${String(index)}`,
  }),
);
const prependedItems: readonly ListItem[] = Array.from(
  { length: PREPEND_COUNT },
  (_, index) => ({
    id: `prepended-${String(index)}`,
    label: `React control prepended row ${String(index)}`,
    accessibilityLabel: `${PREPENDED_ROW_PREFIX}${String(index)}`,
  }),
);

const mountedKeys = new Set<string>();

function ControlRow({ item }: Readonly<{ item: ListItem }>) {
  useEffect(() => {
    mountedKeys.add(item.id);
    return () => {
      mountedKeys.delete(item.id);
    };
  }, [item.id]);

  return createElement(
    View,
    {
      accessible: true,
      accessibilityLabel: item.accessibilityLabel,
      style: styles.row,
    },
    createElement(
      Text,
      { accessible: false, style: styles.rowText },
      item.label,
    ),
  );
}

function ReactListControlApplication() {
  const [status, setStatus] = useState(READY_TEXT);
  const [items, setItems] = useState(originalItems);
  const list = useRef<FlatList<ListItem>>(null);
  const latestOffset = useRef(0);
  const visibleKeys = useRef(new Set<string>());
  const scrollReported = useRef(false);
  const prependStarted = useRef(false);
  const prependAnchorKey = useRef<string | undefined>(undefined);
  const prependBeforeOffset = useRef(0);
  const imperativeStarted = useRef(false);
  const imperativeReported = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    console.log("SOLID_NATIVE_REACT_LIST_READY");
    return () => {
      if (settleTimer.current !== undefined) {
        clearTimeout(settleTimer.current);
      }
    };
  }, []);

  const reportImperativeIfReady = useCallback(() => {
    if (
      !imperativeStarted.current ||
      imperativeReported.current ||
      !visibleKeys.current.has(`item-${String(IMPERATIVE_ITEM_INDEX)}`)
    ) {
      return;
    }
    imperativeReported.current = true;
    setStatus(IMPERATIVE_SUCCEEDED_TEXT);
    requestAnimationFrame(() => {
      console.log(
        `SOLID_NATIVE_REACT_LIST_IMPERATIVE_SUCCEEDED ${JSON.stringify({
          schemaVersion: 0,
          variant: "react-native-flat-list",
          index: IMPERATIVE_LOGICAL_INDEX,
          itemIndex: IMPERATIVE_ITEM_INDEX,
          viewPosition: IMPERATIVE_VIEW_POSITION,
          expectedOffset: IMPERATIVE_EXPECTED_OFFSET,
          scrollOffset: latestOffset.current,
          visibleRowCount: visibleKeys.current.size,
          mountedRowCount: mountedKeys.size,
        })}`,
      );
    });
  }, []);

  useEffect(() => {
    if (status !== PREPEND_STARTED_TEXT) return;
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      const anchorKey = prependAnchorKey.current;
      const beforeOffset = prependBeforeOffset.current;
      const expectedOffset = beforeOffset + PREPEND_OFFSET_DELTA;
      if (
        anchorKey !== undefined &&
        items.length === ITEM_COUNT + PREPEND_COUNT &&
        visibleKeys.current.has(anchorKey) &&
        Math.abs(latestOffset.current - expectedOffset) <= 1
      ) {
        clearInterval(timer);
        setStatus(PREPEND_SUCCEEDED_TEXT);
        requestAnimationFrame(() => {
          console.log(
            `SOLID_NATIVE_REACT_LIST_PREPEND_SUCCEEDED ${JSON.stringify({
              schemaVersion: 0,
              variant: "react-native-flat-list",
              prependCount: PREPEND_COUNT,
              anchorKey,
              beforeOffset,
              expectedOffset,
              scrollOffset: latestOffset.current,
              visibleRowCount: visibleKeys.current.size,
              mountedRowCount: mountedKeys.size,
            })}`,
          );
        });
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        console.error(
          `SOLID_NATIVE_REACT_LIST_FAILED ${JSON.stringify({
            reason: "prepend-anchor-timeout",
            anchorKey,
            beforeOffset,
            expectedOffset,
            scrollOffset: latestOffset.current,
            anchorVisible:
              anchorKey !== undefined && visibleKeys.current.has(anchorKey),
          })}`,
        );
      }
    }, 20);
    return () => clearInterval(timer);
  }, [items.length, status]);

  const reportPhysicalScrollIfSettled = useCallback(() => {
    if (scrollReported.current) return;
    if (!Number.isFinite(latestOffset.current) || latestOffset.current <= 168) {
      console.error("SOLID_NATIVE_REACT_LIST_FAILED invalid settled offset");
      return;
    }
    scrollReported.current = true;
    setStatus(SUCCEEDED_TEXT);
    requestAnimationFrame(() => {
      console.log(
        `SOLID_NATIVE_REACT_LIST_SUCCEEDED ${JSON.stringify({
          schemaVersion: 0,
          variant: "react-native-flat-list",
          itemCount: ITEM_COUNT,
          scrollOffset: latestOffset.current,
          visibleRowCount: visibleKeys.current.size,
          mountedRowCount: mountedKeys.size,
          containsFirstRow: visibleKeys.current.has("item-0"),
          runtime: "react-native-fabric",
          runtimeVersion: "0.87.0",
          platform: "android",
        })}`,
      );
    });
  }, []);

  const schedulePhysicalScrollReport = useCallback(() => {
    if (scrollReported.current || imperativeStarted.current) return;
    if (settleTimer.current !== undefined) {
      clearTimeout(settleTimer.current);
    }
    settleTimer.current = setTimeout(reportPhysicalScrollIfSettled, 150);
  }, [reportPhysicalScrollIfSettled]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      latestOffset.current = event.nativeEvent.contentOffset.y;
      reportImperativeIfReady();
      if (latestOffset.current > 168) schedulePhysicalScrollReport();
    },
    [reportImperativeIfReady, schedulePhysicalScrollReport],
  );

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { readonly viewableItems: readonly ViewToken[] }) => {
      visibleKeys.current = new Set(
        viewableItems.flatMap((token) =>
          token.isViewable && typeof token.key === "string" ? [token.key] : [],
        ),
      );
      reportImperativeIfReady();
    },
  ).current;

  const handlePrepend = useCallback(() => {
    if (status !== SUCCEEDED_TEXT || prependStarted.current) return;
    const anchorKey = [...visibleKeys.current].find((key) =>
      key.startsWith("item-"),
    );
    if (anchorKey === undefined) {
      console.error("SOLID_NATIVE_REACT_LIST_FAILED missing prepend anchor");
      return;
    }
    prependStarted.current = true;
    prependAnchorKey.current = anchorKey;
    prependBeforeOffset.current = latestOffset.current;
    setStatus(PREPEND_STARTED_TEXT);
    setItems([...prependedItems, ...originalItems]);
  }, [status]);

  const handleJump = useCallback(() => {
    if (status !== PREPEND_SUCCEEDED_TEXT || imperativeStarted.current) return;
    imperativeStarted.current = true;
    setStatus(IMPERATIVE_STARTED_TEXT);
    const target = list.current;
    if (target === null) {
      console.error("SOLID_NATIVE_REACT_LIST_FAILED missing FlatList ref");
      return;
    }
    console.log("SOLID_NATIVE_REACT_LIST_IMPERATIVE_STARTED");
    target.scrollToIndex({
      index: IMPERATIVE_LOGICAL_INDEX,
      viewPosition: IMPERATIVE_VIEW_POSITION,
      animated: false,
    });
  }, [status]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) =>
      createElement(ControlRow, { item }),
    [],
  );

  return createElement(
    View,
    { style: styles.screen, testID: "react-list-control-root" },
    createElement(
      Text,
      { accessibilityRole: "header", style: styles.title },
      "React Native FlatList control",
    ),
    createElement(Text, { style: styles.status }, status),
    createElement(
      Pressable,
      {
        accessibilityLabel:
          status === SUCCEEDED_TEXT ? PREPEND_LABEL : IMPERATIVE_LABEL,
        accessibilityRole: "button",
        disabled:
          status !== SUCCEEDED_TEXT && status !== PREPEND_SUCCEEDED_TEXT,
        onPress:
          status === SUCCEEDED_TEXT
            ? handlePrepend
            : status === PREPEND_SUCCEEDED_TEXT
              ? handleJump
              : undefined,
        style: [
          styles.button,
          status === SUCCEEDED_TEXT || status === PREPEND_SUCCEEDED_TEXT
            ? undefined
            : styles.buttonDisabled,
        ],
      },
      createElement(
        Text,
        { style: styles.buttonText },
        status === SUCCEEDED_TEXT
          ? `Prepend ${String(PREPEND_COUNT)} rows`
          : `Jump to row ${String(IMPERATIVE_ITEM_INDEX)}`,
      ),
    ),
    createElement(FlatList<ListItem>, {
      data: items,
      getItemLayout: (_data, index) => ({
        index,
        length: ITEM_SIZE,
        offset: index * ITEM_SIZE,
      }),
      initialNumToRender: 8,
      keyExtractor: (item) => item.id,
      maintainVisibleContentPosition: { minIndexForVisible: 0 },
      maxToRenderPerBatch: 8,
      onScroll: handleScroll,
      onScrollEndDrag: schedulePhysicalScrollReport,
      onMomentumScrollEnd: schedulePhysicalScrollReport,
      onScrollToIndexFailed: (info) => {
        console.error(
          `SOLID_NATIVE_REACT_LIST_FAILED ${JSON.stringify({
            reason: "scroll-to-index-failed",
            index: info.index,
            highestMeasuredFrameIndex: info.highestMeasuredFrameIndex,
          })}`,
        );
      },
      onViewableItemsChanged: handleViewableItemsChanged,
      removeClippedSubviews: true,
      ref: list,
      renderItem,
      scrollEventThrottle: 16,
      style: styles.list,
      testID: "react-native-list-control",
      viewabilityConfig: { itemVisiblePercentThreshold: 1 },
      windowSize: 3,
    }),
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#f4f0ff",
    flex: 1,
    padding: 16,
  },
  title: {
    color: "#35156d",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  status: {
    color: "#281942",
    fontSize: 16,
    marginBottom: 8,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#6d28d9",
    borderRadius: 8,
    marginBottom: 12,
    padding: 12,
  },
  buttonDisabled: {
    backgroundColor: "#94a3b8",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
  },
  list: {
    flexGrow: 0,
    height: VIEWPORT_SIZE,
  },
  row: {
    backgroundColor: "#ede9fe",
    borderBottomColor: "#c4b5fd",
    borderBottomWidth: 1,
    height: ITEM_SIZE,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  rowText: {
    color: "#35156d",
    fontSize: 16,
  },
});

AppRegistry.registerComponent(MODULE_NAME, () => ReactListControlApplication);
