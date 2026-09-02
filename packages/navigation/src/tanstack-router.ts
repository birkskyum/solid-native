import {
  RouterCore,
  type AnyRouter,
  type CreateRouterFn,
  type GetStoreConfig,
  type MakeRouteMatchUnion,
  type MatchRouteOptions,
  type NavigateOptions,
  type RegisteredRouter,
  type RouterReadableStore,
  type RouterState,
  type RouterWritableStore,
  type UseNavigateResult,
} from "@tanstack/router-core";
import {
  Pressable,
  type AccessibilityState,
  type PressableProps,
} from "@solid-native/core";
import {
  type NativeCausalScope,
  type NativeCausalScopeFactory,
  type NativeNode,
  useNativeCausalScopeFactory,
} from "@solid-native/renderer";
import type { RouterHistory } from "@tanstack/history";
import {
  Show,
  createComponent as solidCreateComponent,
  createContext,
  createMemo,
  createSignal,
  flush,
  onSettled,
  useContext,
  type Accessor,
  type Component,
} from "solid-js";

import { reportIsolatedError } from "./error-reporting.js";

export {
  BaseRootRoute as TanStackRootRoute,
  BaseRoute as TanStackRoute,
  redirect as tanStackRedirect,
} from "@tanstack/router-core";
export type {
  AnyRoute as AnyTanStackRoute,
  AnyRouter as AnyTanStackRouter,
  RouterState as TanStackRouterState,
} from "@tanstack/router-core";

function createSolidMutableStore<TValue>(
  initialValue: TValue,
): RouterWritableStore<TValue> {
  // TanStack's router stores contain locations, statuses, IDs, and matches,
  // never callable values. The cast selects Solid 2's plain-signal overload
  // rather than its function-as-computation overload for this generic factory.
  const [read, write] = createSignal<TValue>(
    initialValue as Exclude<TValue, Function>,
    { ownedWrite: true },
  );
  return { get: read, set: write };
}

function createSolidReadonlyStore<TValue>(
  read: () => TValue,
): RouterReadableStore<TValue> {
  return { get: createMemo(read) };
}

/**
 * Solid 2 store implementation for TanStack Router's framework extension
 * point. `flush(fn)` is the Solid 2 atomic publication boundary replacing the
 * Solid 1 `batch(fn)` primitive used by the published Solid router binding.
 */
export const getSolidNativeRouterStoreConfig: GetStoreConfig = () => ({
  createMutableStore: createSolidMutableStore,
  createReadonlyStore: createSolidReadonlyStore,
  batch(fn) {
    flush(fn);
  },
});

/**
 * Creates the framework-neutral TanStack routing engine with Solid 2-owned
 * reactive stores. Native runtimes are always clients, even though they do not
 * expose a DOM.
 */
export const createTanStackNativeRouter: CreateRouterFn = (options) => {
  if (options.isServer === true) {
    throw new Error("A Solid Native TanStack router must use isServer: false.");
  }
  const router = new RouterCore(
    { ...options, isServer: false, scrollRestoration: false },
    getSolidNativeRouterStoreConfig,
  );
  // Core installs a browser-oriented onRendered reset even when restoration is
  // disabled. A false predicate keeps that listener inert without enabling its
  // document/sessionStorage setup during construction. Native scroll state is
  // owned by native scroll containers, not globalThis.scrollTo.
  router.options.scrollRestoration = () => false;
  return router;
};

const TanStackNativeRouterContext = createContext<AnyRouter>();
const TanStackNativeRouterContextProvider =
  TanStackNativeRouterContext as Component<{
    readonly value: AnyRouter;
    readonly children: NativeNode;
  }>;
const boundRouters = new WeakSet<object>();
const routerCausalScopeFactories = new WeakMap<
  object,
  NativeCausalScopeFactory
>();
const activeRouterCausalScopes = new WeakMap<object, NativeCausalScope>();

function beginRouterCausalScope(
  router: AnyRouter,
  name: "navigation.link" | "navigation.programmatic",
  fallbackFactory?: NativeCausalScopeFactory,
): NativeCausalScope | undefined {
  const createScope = routerCausalScopeFactories.get(router) ?? fallbackFactory;
  if (createScope === undefined) return undefined;
  // TanStack navigation is latest-wins. Reflect that ownership directly in the
  // causal stream instead of leaving a displaced route task open.
  const previous = activeRouterCausalScopes.get(router);
  if (previous?.state === "active") previous.cancel();
  const scope = createScope(name);
  activeRouterCausalScopes.set(router, scope);
  return scope;
}

function runRouterCausalScope<T>(
  scope: NativeCausalScope | undefined,
  callback: () => T,
): T {
  return scope?.state === "active" ? scope.run(callback) : callback();
}

function settleRouterCausalScope(
  router: AnyRouter,
  scope: NativeCausalScope | undefined,
  status: "finished" | "failed",
  error?: unknown,
): void {
  if (scope === undefined) return;
  if (activeRouterCausalScopes.get(router) === scope) {
    activeRouterCausalScopes.delete(router);
  }
  if (status === "finished") scope.finish();
  else scope.fail(error);
}

export interface TanStackNativeRouterProviderProps<
  TRouter extends AnyRouter = AnyRouter,
> {
  readonly router: TRouter;
  readonly children: NativeNode;
  readonly onReady?: (router: TRouter) => unknown;
  readonly onError?: (error: unknown) => unknown;
}

function reportRouterError(
  error: unknown,
  handler: ((error: unknown) => unknown) | undefined,
): void {
  if (reportIsolatedError(handler, error)) return;
  void Promise.resolve().then(() => {
    throw error;
  });
}

function hasResolvedLatestLocation(router: AnyRouter): boolean {
  const resolved = router.stores.resolvedLocation.get();
  if (resolved === undefined || resolved.href !== router.latestLocation.href) {
    return false;
  }
  return resolved.state.__TSR_key === router.latestLocation.state.__TSR_key;
}

/**
 * Owns the core history subscription and initial load for one native Solid
 * subtree. Solid 2 `onSettled` supplies component setup/teardown, while the
 * router transition hook acknowledges publication after the reactive graph
 * settles.
 */
export function TanStackNativeRouterProvider<
  TRouter extends AnyRouter = AnyRouter,
>(props: TanStackNativeRouterProviderProps<TRouter>): NativeNode {
  const createCausalScope = useNativeCausalScopeFactory();
  const content = solidCreateComponent(TanStackNativeRouterContextProvider, {
    value: props.router,
    get children() {
      return props.children;
    },
  }) as NativeNode;
  onSettled(() => {
    const router = props.router;
    if (boundRouters.has(router)) {
      throw new Error(
        "A TanStack native router cannot be mounted by more than one provider.",
      );
    }
    boundRouters.add(router);
    routerCausalScopeFactories.set(router, createCausalScope);
    let active = true;
    let settleCurrent: ((rendered: boolean) => void) | undefined;
    const previousStartTransition = router.startTransition;
    const startTransition: typeof router.startTransition = (publish) => {
      settleCurrent?.(false);
      return new Promise<boolean>((resolve, reject) => {
        const settle = (rendered: boolean): void => {
          if (settleCurrent !== settle) return;
          settleCurrent = undefined;
          resolve(rendered);
        };
        settleCurrent = settle;
        try {
          const publishTransition = (): void => {
            flush(() => {
              if (active && settleCurrent === settle) publish();
            });
          };
          runRouterCausalScope(
            activeRouterCausalScopes.get(router),
            publishTransition,
          );
          // `flush` has already drained every reactive consumer of the router
          // stores. Unlike Solid 1's async transition primitive, Solid 2 needs
          // no second scheduler turn to acknowledge this synchronous publish.
          settle(true);
        } catch (error) {
          if (settleCurrent === settle) settleCurrent = undefined;
          reject(error);
        }
      });
    };
    router.startTransition = startTransition;

    let unsubscribe: (() => void) | undefined;
    try {
      const history = router.history as RouterHistory;
      unsubscribe = history.subscribe((update) => {
        void router.load(update).catch((error: unknown) => {
          reportRouterError(error, props.onError);
        });
      });
    } catch (error) {
      active = false;
      router.startTransition = previousStartTransition;
      boundRouters.delete(router);
      if (routerCausalScopeFactories.get(router) === createCausalScope) {
        routerCausalScopeFactories.delete(router);
      }
      throw error;
    }

    void Promise.resolve().then(() => {
      if (!active) return;
      const initialLoad = hasResolvedLatestLocation(router)
        ? Promise.resolve()
        : router.load();
      void initialLoad
        .then(() => {
          if (!active) return;
          try {
            props.onReady?.(router);
          } catch (error) {
            reportRouterError(error, props.onError);
          }
        })
        .catch((error: unknown) => {
          reportRouterError(error, props.onError);
        });
    });

    return () => {
      active = false;
      settleCurrent?.(false);
      settleCurrent = undefined;
      unsubscribe?.();
      if (router.startTransition === startTransition) {
        router.startTransition = previousStartTransition;
      }
      const causalScope = activeRouterCausalScopes.get(router);
      if (causalScope !== undefined) {
        activeRouterCausalScopes.delete(router);
        causalScope.cancel();
      }
      if (routerCausalScopeFactories.get(router) === createCausalScope) {
        routerCausalScopeFactories.delete(router);
      }
      boundRouters.delete(router);
    };
  });

  return content;
}

export function useTanStackNativeRouter<
  TRouter extends AnyRouter = RegisteredRouter,
>(): TRouter {
  const router = useContext(TanStackNativeRouterContext);
  if (router === undefined) {
    throw new Error(
      "A TanStack native router hook requires a TanStackNativeRouterProvider ancestor.",
    );
  }
  return router as TRouter;
}

export interface UseTanStackNativeNavigateOptions<
  TDefaultFrom extends string = string,
> {
  readonly from?: TDefaultFrom;
}

/** Returns TanStack's registered-router navigation function without a DOM. */
export function useTanStackNativeNavigate<TDefaultFrom extends string = string>(
  defaultOptions: UseTanStackNativeNavigateOptions<TDefaultFrom> = {},
): UseNavigateResult<TDefaultFrom> {
  const router = useTanStackNativeRouter<RegisteredRouter>();
  const createCausalScope = useNativeCausalScopeFactory();
  const navigate = (
    navigationOptions: Parameters<typeof router.navigate>[0],
  ): Promise<void> => {
    const from = navigationOptions.from ?? defaultOptions.from;
    const resolvedOptions =
      from === undefined ? navigationOptions : { ...navigationOptions, from };
    assertNativeNavigationOptions(resolvedOptions);
    const scope = beginRouterCausalScope(
      router,
      "navigation.programmatic",
      createCausalScope,
    );
    let navigation: Promise<void>;
    try {
      navigation = runRouterCausalScope(scope, () =>
        router.navigate(
          resolvedOptions as Parameters<typeof router.navigate>[0],
        ),
      );
    } catch (error) {
      settleRouterCausalScope(router, scope, "failed", error);
      throw error;
    }
    return navigation.then(
      () => settleRouterCausalScope(router, scope, "finished"),
      (error: unknown) => {
        settleRouterCausalScope(router, scope, "failed", error);
        throw error;
      },
    );
  };
  return navigate as UseNavigateResult<TDefaultFrom>;
}

export interface TanStackNativeLinkState {
  /** Whether the underlying native press gesture is currently active. */
  readonly pressed: boolean;
  /** Whether the destination matches the router's committed location. */
  readonly isActive: boolean;
  /** Whether the destination matches TanStack's pending location. */
  readonly isPending: boolean;
  /** Whether this link owns an unsettled navigation request. */
  readonly isTransitioning: boolean;
  /** Whether this link owns an unsettled route preload. */
  readonly isPreloading: boolean;
}

export type TanStackNativeLinkPreload = false | "intent" | "render";

export type TanStackNativeLinkPressableProps = Omit<
  PressableProps,
  | "accessibilityRole"
  | "accessibilityState"
  | "children"
  | "disabled"
  | "onPress"
  | "role"
> & {
  readonly accessibilityState?: Omit<
    AccessibilityState,
    "busy" | "disabled" | "selected"
  >;
};

export interface TanStackNativeLinkProps<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> {
  /** Defaults to the nearest `TanStackNativeRouterProvider`. */
  readonly router?: TRouter;
  /** TanStack's registered-router navigation contract, including typed params. */
  readonly options: NavigateOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>;
  /** Controls active and pending route matching. */
  readonly activeOptions?: Omit<MatchRouteOptions, "pending">;
  readonly disabled?: boolean;
  /**
   * `intent` preloads at native press-in; `render` preloads after the first
   * Solid settlement. Defaults to the router's compatible preload policy.
   */
  readonly preload?: TanStackNativeLinkPreload;
  /** Native interaction, styling, testing, and accessibility-label props. */
  readonly pressableProps?: TanStackNativeLinkPressableProps;
  readonly children:
    NativeNode | ((state: TanStackNativeLinkState) => NativeNode);
  readonly onPreloadError?: (error: unknown) => unknown;
  readonly onNavigationError?: (error: unknown) => unknown;
  readonly onNavigationSettled?: () => unknown;
}

function assertNativeNavigationOptions(
  options: NavigateOptions<AnyRouter>,
): void {
  if (options.href !== undefined || options.reloadDocument === true) {
    throw new Error(
      "TanStackNativeLink only accepts client-native route navigation. Use a platform linking service for external URLs instead of href or reloadDocument.",
    );
  }
}

/**
 * Presents a typed TanStack destination as a real native Pressable. The link's
 * active and pending states are Solid memos over TanStack's stores; no React
 * component, DOM anchor, or duplicated route matcher participates.
 */
export function TanStackNativeLink<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
>(
  props: TanStackNativeLinkProps<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
): NativeNode {
  const router = props.router ?? useTanStackNativeRouter<TRouter>();
  const createCausalScope = useNativeCausalScopeFactory();
  const options = (): NavigateOptions<
    TRouter,
    TFrom,
    TTo,
    TMaskFrom,
    TMaskTo
  > => {
    const current = props.options;
    assertNativeNavigationOptions(current as NavigateOptions<AnyRouter>);
    return current;
  };
  const isActive = createMemo(() =>
    Boolean(
      router.matchRoute(options() as Parameters<typeof router.matchRoute>[0], {
        ...props.activeOptions,
        pending: false,
      }),
    ),
  );
  const isPending = createMemo(() =>
    Boolean(
      router.matchRoute(options() as Parameters<typeof router.matchRoute>[0], {
        ...props.activeOptions,
        pending: true,
      }),
    ),
  );
  const [isTransitioning, setIsTransitioning] = createSignal(false);
  const [isPreloading, setIsPreloading] = createSignal(false);
  let navigationInFlight = false;
  let preloadInFlight: Promise<unknown> | undefined;
  let active = true;

  const preloadStrategy = (): TanStackNativeLinkPreload => {
    const configured = props.preload ?? router.options.defaultPreload ?? false;
    // A native component has no DOM IntersectionObserver. Applications that
    // share a web router config must opt into render preloading explicitly.
    return configured === "intent" || configured === "render"
      ? configured
      : false;
  };
  const preload = (): void => {
    if (
      !active ||
      props.disabled === true ||
      isActive() ||
      preloadInFlight !== undefined
    ) {
      return;
    }
    const onPreloadError = props.onPreloadError;
    let request: Promise<unknown>;
    try {
      request = router.preloadRoute(
        options() as Parameters<typeof router.preloadRoute>[0],
      );
    } catch (error) {
      reportIsolatedError(onPreloadError, error);
      return;
    }
    preloadInFlight = request;
    setIsPreloading(true);
    void request
      .catch((error: unknown) => {
        reportIsolatedError(onPreloadError, error);
      })
      .finally(() => {
        if (preloadInFlight !== request) return;
        preloadInFlight = undefined;
        if (active) setIsPreloading(false);
      });
  };
  onSettled(() => {
    if (preloadStrategy() === "render") preload();
    return () => {
      active = false;
    };
  });

  const navigate = async (): Promise<void> => {
    if (props.disabled === true || navigationInFlight) return;
    const onNavigationError = props.onNavigationError;
    const causalScope = beginRouterCausalScope(
      router,
      "navigation.link",
      createCausalScope,
    );
    let navigationError: unknown;
    let navigationFailed = false;
    navigationInFlight = true;
    runRouterCausalScope(causalScope, () => setIsTransitioning(true));
    try {
      await runRouterCausalScope(causalScope, () => router.navigate(options()));
    } catch (error) {
      navigationFailed = true;
      navigationError = error;
      reportRouterError(error, onNavigationError);
    } finally {
      navigationInFlight = false;
      if (active) {
        runRouterCausalScope(causalScope, () => {
          setIsTransitioning(false);
          try {
            props.onNavigationSettled?.();
          } catch (error) {
            reportRouterError(error, onNavigationError);
          }
        });
      }
      settleRouterCausalScope(
        router,
        causalScope,
        navigationFailed ? "failed" : "finished",
        navigationError,
      );
    }
  };

  const pressableOverrides: PressableProps = {
    get accessibilityRole() {
      return "link" as const;
    },
    get accessibilityState() {
      return {
        ...props.pressableProps?.accessibilityState,
        disabled: props.disabled === true,
        selected: isActive(),
        busy: isPending() || isTransitioning(),
      };
    },
    get disabled() {
      return props.disabled === true;
    },
    onPress() {
      void navigate();
    },
    onPressIn(event) {
      const result = props.pressableProps?.onPressIn?.(event);
      if (preloadStrategy() === "intent") preload();
      return result;
    },
    children: (pressableState) => {
      const state: TanStackNativeLinkState = Object.freeze({
        get pressed() {
          return pressableState.pressed;
        },
        get isActive() {
          return isActive();
        },
        get isPending() {
          return isPending();
        },
        get isTransitioning() {
          return isTransitioning();
        },
        get isPreloading() {
          return isPreloading();
        },
      });
      const children = props.children;
      return typeof children === "function" ? children(state) : children;
    },
  };
  // Preserve getter-backed nested props without sacrificing Pressable's
  // render-function descriptor, which it uses to expose pressed state once.
  const nativePressableProps = new Proxy(pressableOverrides, {
    get(target, property, receiver) {
      if (Reflect.getOwnPropertyDescriptor(target, property) !== undefined) {
        return Reflect.get(target, property, receiver);
      }
      const forwarded = props.pressableProps;
      return forwarded === undefined
        ? undefined
        : Reflect.get(forwarded, property, forwarded);
    },
    getOwnPropertyDescriptor(target, property) {
      const owned = Reflect.getOwnPropertyDescriptor(target, property);
      if (owned !== undefined) return owned;
      const forwarded = props.pressableProps;
      const descriptor =
        forwarded === undefined
          ? undefined
          : Reflect.getOwnPropertyDescriptor(forwarded, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys(target) {
      return [
        ...new Set([
          ...Reflect.ownKeys(props.pressableProps ?? {}),
          ...Reflect.ownKeys(target),
        ]),
      ];
    },
  });
  return solidCreateComponent(Pressable, nativePressableProps) as NativeNode;
}

export type TanStackNativeRouteMatch<TRouter extends AnyRouter> =
  MakeRouteMatchUnion<TRouter>;

export interface TanStackNativeRouteViewProps<
  TRouter extends AnyRouter = AnyRouter,
> {
  readonly router?: TRouter;
  readonly children: (
    match: Accessor<TanStackNativeRouteMatch<TRouter>>,
  ) => NativeNode;
  readonly renderPending: (
    state: Accessor<RouterState<TRouter["routeTree"]>>,
  ) => NativeNode;
  readonly renderError: (
    error: Accessor<unknown>,
    retry: () => Promise<void>,
    match: Accessor<TanStackNativeRouteMatch<TRouter>>,
  ) => NativeNode;
  readonly renderNotFound: (
    match: Accessor<TanStackNativeRouteMatch<TRouter>>,
  ) => NativeNode;
}

/**
 * Projects the active leaf match into native content without owning matching
 * or loading policy. TanStack supplies the state machine; Solid preserves one
 * branch owner for pending, error, not-found, and successful presentation.
 */
export function TanStackNativeRouteView<TRouter extends AnyRouter = AnyRouter>(
  props: TanStackNativeRouteViewProps<TRouter>,
): NativeNode {
  const router = props.router ?? useTanStackNativeRouter<TRouter>();
  const state = router.stores.__store.get as Accessor<
    RouterState<TRouter["routeTree"]>
  >;
  const match = createMemo(() => {
    const matches = router.stores.matches.get();
    return (matches.find((candidate) => candidate._notFound === true) ??
      matches.at(-1)) as TanStackNativeRouteMatch<TRouter> | undefined;
  });
  const requiredMatch = match as Accessor<TanStackNativeRouteMatch<TRouter>>;
  const retry = (): Promise<void> => {
    const id = requiredMatch().id;
    return router.invalidate({
      forcePending: true,
      filter: (candidate) => candidate.id === id,
    });
  };

  const notFound = solidCreateComponent(Show, {
    get when() {
      const current = match();
      return current?.status === "notFound" || current?._notFound === true
        ? current
        : undefined;
    },
    children: () => props.renderNotFound(requiredMatch),
  });
  const errored = solidCreateComponent(Show, {
    get when() {
      const current = match();
      return current?.status === "error" ? current : undefined;
    },
    fallback: notFound,
    children: () =>
      props.renderError(() => requiredMatch().error, retry, requiredMatch),
  });
  const resolved = solidCreateComponent(Show, {
    get when() {
      const current = match();
      return current?.status === "success" && current._notFound !== true
        ? current
        : undefined;
    },
    fallback: errored,
    children: () => props.children(requiredMatch),
  });
  return solidCreateComponent(Show, {
    get when() {
      return state().status !== "pending";
    },
    get fallback() {
      return props.renderPending(state);
    },
    children: () => resolved,
  }) as NativeNode;
}
