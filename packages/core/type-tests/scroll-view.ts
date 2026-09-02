import type {
  RefreshableScrollViewProps,
  ScrollViewHandle,
  ScrollViewMaintainVisibleContentPosition,
  ScrollViewProps,
  VirtualizedListProps,
} from "../src/index.js";

const anchor: ScrollViewMaintainVisibleContentPosition = {
  minIndexForVisible: 1,
  autoscrollToTopThreshold: 24,
};

const scrollView: ScrollViewProps = {
  maintainVisibleContentPosition: anchor,
  ref(handle) {
    void handle.scrollTo({ y: 120, animated: false });
    void handle.scrollToEnd();
    void handle.nativeNode.measure();
  },
};

declare const scrollViewHandle: ScrollViewHandle;
void scrollViewHandle.scrollTo({ x: 12, y: 48 });
void scrollViewHandle.scrollToEnd({ animated: false });
// @ts-expect-error scrollTo uses a named options object, not positional values.
void scrollViewHandle.scrollTo(0, 48, true);
// @ts-expect-error scrollTo does not accept unknown options.
void scrollViewHandle.scrollTo({ offset: 48 });
// @ts-expect-error scrollToEnd only controls animation.
void scrollViewHandle.scrollToEnd({ y: 48 });
// @ts-expect-error animated is boolean.
void scrollViewHandle.scrollToEnd({ animated: "yes" });

const refreshableScrollView: RefreshableScrollViewProps = {
  refreshing: false,
  colors: ["#146ef5"],
  onRefresh: () => undefined,
};

const horizontalRefreshableScrollView: RefreshableScrollViewProps = {
  refreshing: false,
  // @ts-expect-error pull-to-refresh is vertical-only.
  horizontal: true,
};

const rows = [{ id: "first" }];
const virtualizedList: VirtualizedListProps<(typeof rows)[number]> = {
  data: rows,
  itemSize: 48,
  viewportSize: 480,
  keyExtractor: (item) => item.id,
  renderItem: ({ item }) => item().id,
  maintainVisibleContentPosition: anchor,
};

void scrollView;
void refreshableScrollView;
void horizontalRefreshableScrollView;
void virtualizedList;
