import {
  NativeHistory,
  NativeModalStack,
  NativeScrollRestoration,
  NativeTabs,
  TanStackRootRoute,
  TanStackRoute,
  TanStackNativeLink,
  TanStackNativeStack,
  createNativeTabsState,
  createTanStackNativeMemoryPolicy,
  createNativeScreenAccessibilityFocus,
  createNativeScreenFocusEffect,
  createNativeScreenFocusTask,
  createTanStackNativeScreenAccessibilityFocus,
  createTanStackNativeScreenFocusEffect,
  createTanStackNativeScreenFocusTask,
  createTanStackNativeHistory,
  createTanStackNativeRouter,
  tanStackRedirect,
  useTanStackNativeLoaderData,
  useTanStackNativeMatch,
  useTanStackNativeNavigate,
  useTanStackNativeScreen,
} from "../src/index.js";
import { ScreenHeader, ScreenHeaderSubview } from "@solid-native/core";
import type { NativeNode } from "@solid-native/renderer";

declare const nativeNode: NativeNode;

const DetailComponent = (): NativeNode => {
  const navigate = useTanStackNativeNavigate({ from: "/detail/$id" });
  const screen = useTanStackNativeScreen();
  const foreground = (): boolean => true;
  let heading: NativeNode | undefined;
  createTanStackNativeScreenFocusEffect(() => () => undefined);
  createTanStackNativeScreenFocusTask(
    async (signal) => {
      const checkedAborted: boolean = signal.aborted;
      void checkedAborted;
    },
    { enabled: foreground, onError: (error) => void error },
  );
  createTanStackNativeScreenAccessibilityFocus(() => heading);
  createNativeScreenFocusEffect(screen.isFocused, () => undefined);
  createNativeScreenFocusTask(screen.isFocused, async (signal) => {
    const checkedReason: unknown = signal.reason;
    void checkedReason;
  });
  createNativeScreenAccessibilityFocus(screen.isFocused, nativeNode);
  const title = useTanStackNativeLoaderData({
    from: "/detail/$id",
    select: (data) => {
      const typedTitle: string = data.title;
      // @ts-expect-error The loader's numeric field cannot be treated as text.
      const invalidCount: string = data.count;
      void invalidCount;
      return typedTitle;
    },
  });
  const id = useTanStackNativeMatch({
    from: "/detail/$id",
    select: (match) => match.params.id,
  });
  const checkedTitle: string = title();
  const checkedId: string = id();
  const checkedFocus: boolean = screen.isFocused();
  void checkedTitle;
  void checkedId;
  void checkedFocus;
  heading = nativeNode;
  void navigate({ to: "/detail/$id", params: { id: "next" } });
  return nativeNode;
};

const rootRoute = new TanStackRootRoute({
  component: () => nativeNode,
});
const detailRoute = new TanStackRoute({
  getParentRoute: () => rootRoute,
  path: "/detail/$id",
  loader: () => ({ title: "Detail", count: 1 }),
  component: DetailComponent,
});
const routeTree = rootRoute.addChildren([detailRoute]);
const nativeHistory = new NativeHistory();
const scrollRestoration = new NativeScrollRestoration(nativeHistory);
const router = createTanStackNativeRouter({
  routeTree,
  history: createTanStackNativeHistory(nativeHistory),
  isServer: false,
});
const memoryPolicy = createTanStackNativeMemoryPolicy(
  {
    subscribeMemoryWarning: (_listener) => ({ remove: () => undefined }),
  },
  {
    normalMountedRouteTrees: 4,
    pressuredMountedRouteTrees: 2,
    onMemoryPressure: (count) => {
      const warningCount: number = count;
      void warningCount;
    },
    onMemoryPressureError: (error, count) => {
      const failure: unknown = error;
      const warningCount: number = count;
      void failure;
      void warningCount;
    },
  },
);
const warningCount: number = memoryPolicy.warningCount();
const underMemoryPressure: boolean = memoryPolicy.isUnderMemoryPressure();
const policyRouteTreeLimit: number = memoryPolicy.maxMountedRouteTrees();
memoryPolicy.acknowledgeRecovery();
void warningCount;
void underMemoryPressure;
void policyRouteTreeLimit;

declare module "@tanstack/router-core" {
  interface Register {
    router: typeof router;
  }
}

function invalidRouteSelection(): void {
  // @ts-expect-error Registered route IDs reject unknown component selectors.
  useTanStackNativeMatch({ from: "/missing" });
}

const detailLink: NativeNode = TanStackNativeLink({
  router,
  options: {
    to: "/detail/$id",
    params: { id: "42" },
  },
  pressableProps: {
    accessibilityLabel: "Open detail",
    testID: "detail-link",
  },
  children: (state) => {
    const checkedPressed: boolean = state.pressed;
    const checkedActive: boolean = state.isActive;
    const checkedPending: boolean = state.isPending;
    const checkedTransitioning: boolean = state.isTransitioning;
    const checkedPreloading: boolean = state.isPreloading;
    void checkedPressed;
    void checkedActive;
    void checkedPending;
    void checkedTransitioning;
    void checkedPreloading;
    return nativeNode;
  },
});
void detailLink;

function invalidNativeLinks(): void {
  TanStackNativeLink({
    router,
    // @ts-expect-error Registered routes reject unknown native-link targets.
    options: { to: "/missing" },
    children: nativeNode,
  });
  TanStackNativeLink({
    router,
    options: {
      to: "/detail/$id",
      // @ts-expect-error Route params preserve the registered string ID type.
      params: { id: 42 },
    },
    children: nativeNode,
  });
  TanStackNativeLink({
    router,
    options: { to: "/detail/$id", params: { id: "42" } },
    // @ts-expect-error Native links do not pretend to own DOM viewport intent.
    preload: "viewport",
    children: nativeNode,
  });
}

function invalidNativeNavigation(): void {
  const navigate = useTanStackNativeNavigate({ from: "/detail/$id" });
  // @ts-expect-error Registered navigation rejects an unknown route.
  void navigate({ to: "/missing" });
  void navigate({
    to: "/detail/$id",
    // @ts-expect-error Registered navigation preserves parameter types.
    params: { id: 42 },
  });
}

const loginRedirect = tanStackRedirect({
  to: "/detail/$id",
  params: { id: "after-login" },
  replace: true,
});
void loginRedirect;

const stack: NativeNode = TanStackNativeStack({
  router,
  history: nativeHistory,
  maxMountedRouteTrees: 3,
  memoryPolicy,
  scrollRestoration,
  preloadRestoredEntries: 2,
  shouldPreloadRestoredEntry: (entry, index, signal) => {
    const checkedHref: string = entry.href;
    const checkedIndex: number = index;
    const checkedSignal: AbortSignal = signal;
    void checkedHref;
    void checkedIndex;
    void checkedSignal;
    return Promise.resolve(true);
  },
  defaultScreenOptions: {
    gestureEnabled: true,
    nativeBackButtonDismissalEnabled: true,
    presentation: "push",
  },
  screenOptions: () => ({
    presentation: "sheet",
    sheetAllowedDetents: [0.45, 0.9],
    sheetInitialDetent: "last",
    sheetLargestUndimmedDetent: 0,
    sheetGrabberVisible: true,
  }),
  onScreenSheetDetentChange: (_entry, event) => {
    const checkedIndex: number = event.payload.index;
    const checkedStable: boolean = event.payload.isStable;
    void checkedIndex;
    void checkedStable;
  },
  onPreloadError: (error, entry) => {
    const checkedError: unknown = error;
    const checkedHref: string = entry.href;
    void checkedError;
    void checkedHref;
  },
  renderHeader: (entry) =>
    ScreenHeader({
      title: entry().href,
      headerLeftBarButtonItems: [
        { type: "button", title: "Edit", onPress: () => undefined },
      ],
      headerRightBarButtonItems: [
        {
          type: "menu",
          icon: { type: "sfSymbol", name: "ellipsis.circle" },
          menu: {
            items: [
              {
                type: "action",
                title: "Archive",
                destructive: true,
                onPress: () => undefined,
              },
            ],
          },
        },
      ],
      children: ScreenHeaderSubview({
        type: "right",
        children: nativeNode,
      }),
    }),
  renderUnresolved: () => nativeNode,
  renderParked: (_entry, index, isFocused) => {
    const checkedIndex: number = index();
    const checkedFocus: boolean = isFocused();
    void checkedIndex;
    void checkedFocus;
    return nativeNode;
  },
});
void stack;

const modalStack: NativeNode = NativeModalStack({
  history: nativeHistory,
  defaultModalOptions: {
    allowSwipeDismissal: true,
    animationType: "slide",
    presentationStyle: "pageSheet",
  },
  modalOptions: (entry, index) => ({
    accessibilityLabel: `Modal ${entry.href}`,
    testID: `modal-${String(index)}`,
  }),
  onModalHidden: (entry) => {
    const checkedHref: string = entry.href;
    void checkedHref;
  },
  onPlatformBack: (transition) => {
    const checkedOrigin: "application" | "platform" | "system" | "restoration" =
      transition.origin;
    void checkedOrigin;
  },
  children: (_entry, _index, isFocused) => {
    const checkedFocused: boolean = isFocused();
    void checkedFocused;
    return nativeNode;
  },
});
void modalStack;

const tabsState = createNativeTabsState({
  tabs: [
    { key: "home", initialHref: "/home" },
    { key: "settings", initialHref: "/settings" },
  ],
});
const selectedTabKey: string = tabsState.selectedKey();
const selectedTabHistory: NativeHistory = tabsState.selectedHistory();
void selectedTabKey;
void selectedTabHistory;

const tabs: NativeNode = NativeTabs({
  tabs: [
    { key: "home", count: 1 },
    { key: "settings", count: 2 },
  ],
  selectedKey: tabsState.selectedKey(),
  defaultScreenOptions: {
    preventNativeSelection: false,
    tabBarItemAccessibilityLabel: "Application tab",
    standardAppearance: {
      android: {
        tabBarItemLabelVisibilityMode: "labeled",
        selected: { tabBarItemIconColor: "#ea580c" },
      },
      ios: {
        stacked: {
          selected: {
            tabBarItemTitleFontWeight: "600",
            tabBarItemIconColor: "#ea580c",
          },
        },
        tabBarBlurEffect: "systemDefault",
      },
    },
    scrollEdgeAppearance: {
      ios: { tabBarBackgroundColor: "transparent" },
    },
  },
  screenOptions: (tab) => {
    const checkedCount: number = tab.count;
    void checkedCount;
    return { title: tab.key };
  },
  onTabSelected: (selection) => tabsState.handleTabSelected(selection),
  children: (tab, _index, isSelected) => {
    const checkedCount: number = tab().count;
    const checkedSelected: boolean = isSelected();
    void checkedCount;
    void checkedSelected;
    return nativeNode;
  },
});
void tabs;

void invalidRouteSelection;
void invalidNativeLinks;
void invalidNativeNavigation;
