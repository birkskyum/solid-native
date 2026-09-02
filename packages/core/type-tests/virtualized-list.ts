import type {
  VirtualizedListHandle,
  VirtualizedListProps,
} from "../src/index.js";

interface Row {
  readonly id: string;
  readonly height: number;
}

const rows: readonly Row[] = [{ id: "first", height: 48 }];

const fixed: VirtualizedListProps<Row> = {
  data: rows,
  initialScrollKey: "first",
  itemSize: 48,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
  maintainVisibleContentPosition: {
    minIndexForVisible: 0,
    autoscrollToTopThreshold: 48,
  },
  onStartReached: ({ distanceFromStart }) => distanceFromStart,
  onStartReachedThreshold: 0.25,
};

const heterogeneous: VirtualizedListProps<Row> = {
  data: rows,
  getItemLayout: (data, index) => ({
    index,
    length: data[index]!.height,
    offset: data
      .slice(0, index)
      .reduce((total, item) => total + item.height, 0),
  }),
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
};

const measured: VirtualizedListProps<Row> = {
  data: rows,
  estimatedItemSize: 48,
  recycleRowViews: true,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
};

const refreshable: VirtualizedListProps<Row> = {
  data: rows,
  itemSize: 48,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
  refreshing: false,
  onRefresh: () => undefined,
  tintColor: "#146ef5",
};

declare const handle: VirtualizedListHandle;
void handle.scrollToKey({
  key: "first",
  viewOffset: 12,
  viewPosition: 0.5,
  animated: false,
});
// @ts-expect-error keyed scrolling requires a string key.
void handle.scrollToKey({ key: 1 });

// @ts-expect-error pull-to-refresh requires controlled refreshing state.
const refreshWithoutState: VirtualizedListProps<Row> = {
  data: rows,
  itemSize: 48,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
  onRefresh: () => undefined,
};

// @ts-expect-error pull-to-refresh is only supported on vertical lists.
const horizontalRefresh: VirtualizedListProps<Row> = {
  data: rows,
  horizontal: true,
  itemSize: 48,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
  refreshing: false,
  onRefresh: () => undefined,
};

// @ts-expect-error fixed, exact heterogeneous, or measured geometry is required.
const missingGeometry: VirtualizedListProps<Row> = {
  data: rows,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
};

// @ts-expect-error fixed and heterogeneous geometry are mutually exclusive.
const ambiguousGeometry: VirtualizedListProps<Row> = {
  data: rows,
  itemSize: 48,
  getItemLayout: (_data: readonly Row[], index: number) => ({
    index,
    length: 48,
    offset: index * 48,
  }),
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
};

// @ts-expect-error estimated and fixed geometry are mutually exclusive.
const ambiguousEstimatedGeometry: VirtualizedListProps<Row> = {
  data: rows,
  itemSize: 48,
  estimatedItemSize: 48,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
};

// @ts-expect-error initial index and key positions are mutually exclusive.
const ambiguousInitialPosition: VirtualizedListProps<Row> = {
  data: rows,
  itemSize: 48,
  initialScrollIndex: 0,
  initialScrollKey: "first",
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
};

void fixed;
void heterogeneous;
void measured;
void refreshable;
void refreshWithoutState;
void horizontalRefresh;
void missingGeometry;
void ambiguousGeometry;
void ambiguousEstimatedGeometry;
void ambiguousInitialPosition;
