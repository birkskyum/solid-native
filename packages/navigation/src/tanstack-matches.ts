import {
  type AnyRoute,
  type AnyRouteMatch,
  type AnyRouter,
  type MakeRouteMatch,
  type MakeRouteMatchUnion,
  type RegisteredRouter,
  type ResolveUseLoaderData,
  type RouteIds,
  type RouterState,
} from "@tanstack/router-core";
import type { NativeNode } from "@solid-native/renderer";
import {
  Errored,
  Show,
  createComponent as solidCreateComponent,
  createContext,
  createMemo,
  useContext,
  type Accessor,
  type Component,
} from "solid-js";

import { useTanStackNativeRouter } from "./tanstack-router.js";

export type TanStackNativeRouteComponent = (() => NativeNode) & {
  readonly preload?: () => Promise<void> | undefined;
};

export interface TanStackNativePendingComponentProps<
  TRouter extends AnyRouter = AnyRouter,
> {
  readonly state: Accessor<RouterState<TRouter["routeTree"]>>;
  readonly match: Accessor<MakeRouteMatchUnion<TRouter>>;
}

export type TanStackNativePendingComponent = (
  props: TanStackNativePendingComponentProps,
) => NativeNode;

export interface TanStackNativeErrorComponentProps<
  TRouter extends AnyRouter = AnyRouter,
> {
  readonly error: Accessor<unknown>;
  readonly retry: () => Promise<void>;
  readonly match: Accessor<MakeRouteMatchUnion<TRouter>>;
}

export type TanStackNativeErrorComponent = (
  props: TanStackNativeErrorComponentProps,
) => NativeNode;

export interface TanStackNativeNotFoundComponentProps<
  TRouter extends AnyRouter = AnyRouter,
> {
  readonly match: Accessor<MakeRouteMatchUnion<TRouter>>;
}

export type TanStackNativeNotFoundComponent = (
  props: TanStackNativeNotFoundComponentProps,
) => NativeNode;

declare module "@tanstack/router-core" {
  interface UpdatableRouteOptionsExtensions {
    component?: TanStackNativeRouteComponent;
    errorComponent?: false | null | TanStackNativeErrorComponent;
    notFoundComponent?: TanStackNativeNotFoundComponent;
    pendingComponent?: TanStackNativePendingComponent;
  }

  interface RouterOptionsExtensions {
    defaultComponent?: TanStackNativeRouteComponent;
    defaultErrorComponent?: TanStackNativeErrorComponent;
    defaultNotFoundComponent?: TanStackNativeNotFoundComponent;
    defaultPendingComponent?: TanStackNativePendingComponent;
  }
}

type NativeMatchContextValue = readonly [
  routeId: Accessor<string | undefined>,
  match: Accessor<AnyRouteMatch | undefined>,
];

const defaultNativeMatchContext: NativeMatchContextValue = [
  () => undefined,
  () => undefined,
];
const TanStackNativeMatchContext = createContext<NativeMatchContextValue>(
  defaultNativeMatchContext,
);
const TanStackNativeMatchContextProvider =
  TanStackNativeMatchContext as Component<{
    readonly value: NativeMatchContextValue;
    readonly children: NativeNode;
  }>;

interface TanStackNativeMatchSource {
  readonly state: Accessor<RouterState>;
  readonly ids: Accessor<readonly string[]>;
  getMatch(routeId: string): AnyRouteMatch | undefined;
}

const TanStackNativeMatchSourceContext =
  createContext<TanStackNativeMatchSource | null>(null);
const TanStackNativeMatchSourceContextProvider =
  TanStackNativeMatchSourceContext as Component<{
    readonly value: TanStackNativeMatchSource;
    readonly children: NativeNode;
  }>;

function liveMatchSource(router: AnyRouter): TanStackNativeMatchSource {
  return {
    state: router.stores.__store.get as Accessor<RouterState>,
    ids: router.stores.ids.get,
    getMatch(routeId) {
      return router.stores.byRoute.get(routeId)?.get();
    },
  };
}

function currentMatchSource(router: AnyRouter): TanStackNativeMatchSource {
  return (
    useContext(TanStackNativeMatchSourceContext) ?? liveMatchSource(router)
  );
}

type NativeMatchResult<
  TRouter extends AnyRouter,
  TFrom extends RouteIds<TRouter["routeTree"]> | undefined,
> = TFrom extends string
  ? MakeRouteMatch<TRouter["routeTree"], TFrom, true>
  : MakeRouteMatchUnion<TRouter>;

export interface UseTanStackNativeMatchOptions<
  TRouter extends AnyRouter,
  TFrom extends RouteIds<TRouter["routeTree"]> | undefined,
  TSelected,
> {
  readonly from?: TFrom | undefined;
  readonly select?: (match: NativeMatchResult<TRouter, TFrom>) => TSelected;
}

export type UseTanStackNativeMatchResult<
  TRouter extends AnyRouter,
  TFrom extends RouteIds<TRouter["routeTree"]> | undefined,
  TSelected,
> = unknown extends TSelected ? NativeMatchResult<TRouter, TFrom> : TSelected;

/** Reads either a route-ID-specific match or the nearest native route match. */
export function useTanStackNativeMatch<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> | undefined = undefined,
  TSelected = unknown,
>(
  options: UseTanStackNativeMatchOptions<TRouter, TFrom, TSelected> = {},
): Accessor<UseTanStackNativeMatchResult<TRouter, TFrom, TSelected>> {
  const router = useTanStackNativeRouter<TRouter>();
  const nearest = useContext(TanStackNativeMatchContext);
  const source = useContext(TanStackNativeMatchSourceContext);
  const read =
    options.from === undefined
      ? nearest[1]
      : source === null
        ? router.stores.getMatchStore(options.from).get
        : () => source.getMatch(options.from as string);
  return createMemo(() => {
    const match = read();
    if (match === undefined) {
      throw new Error(
        options.from === undefined
          ? "No nearest TanStack native route match is active."
          : `No active TanStack native route match exists for ${options.from}.`,
      );
    }
    return options.select === undefined
      ? match
      : options.select(match as NativeMatchResult<TRouter, TFrom>);
  }) as Accessor<UseTanStackNativeMatchResult<TRouter, TFrom, TSelected>>;
}

type NativeLoaderDataResult<
  TRouter extends AnyRouter,
  TFrom extends RouteIds<TRouter["routeTree"]> | undefined,
> = TFrom extends string
  ? ResolveUseLoaderData<TRouter, TFrom, true>
  : NativeMatchResult<TRouter, TFrom>["loaderData"];

export interface UseTanStackNativeLoaderDataOptions<
  TRouter extends AnyRouter,
  TFrom extends RouteIds<TRouter["routeTree"]> | undefined,
  TSelected,
> {
  readonly from?: TFrom | undefined;
  readonly select?: (data: NativeLoaderDataResult<TRouter, TFrom>) => TSelected;
}

export type UseTanStackNativeLoaderDataResult<
  TRouter extends AnyRouter,
  TFrom extends RouteIds<TRouter["routeTree"]> | undefined,
  TSelected,
> = unknown extends TSelected
  ? NativeLoaderDataResult<TRouter, TFrom>
  : TSelected;

/** Selects typed loader data from the nearest or an explicit route match. */
export function useTanStackNativeLoaderData<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends RouteIds<TRouter["routeTree"]> | undefined = undefined,
  TSelected = unknown,
>(
  options: UseTanStackNativeLoaderDataOptions<TRouter, TFrom, TSelected> = {},
): Accessor<UseTanStackNativeLoaderDataResult<TRouter, TFrom, TSelected>> {
  return useTanStackNativeMatch<TRouter, TFrom, TSelected>({
    from: options.from,
    select: (match) => {
      const data = match.loaderData;
      return options.select === undefined
        ? (data as TSelected)
        : options.select(data);
    },
  }) as Accessor<UseTanStackNativeLoaderDataResult<TRouter, TFrom, TSelected>>;
}

interface TanStackNativeMatchProps {
  readonly routeId: string;
}

interface TanStackNativeMatchContentProps {
  readonly routeId: Accessor<string>;
  readonly match: Accessor<AnyRouteMatch | undefined>;
}

const TanStackNativeKeyedShow = Show as unknown as Component<{
  readonly when: string | undefined;
  readonly keyed: true;
  readonly children: (value: string) => NativeNode;
}>;
const TanStackNativeErrored = Errored as unknown as Component<{
  readonly fallback: (
    error: Accessor<unknown>,
    reset: () => void,
  ) => NativeNode;
  readonly children: NativeNode;
}>;

function renderRouteComponent(
  component: TanStackNativeRouteComponent,
): NativeNode {
  return solidCreateComponent(component as Component, {}) as NativeNode;
}

function renderPendingComponent(
  component: TanStackNativePendingComponent,
  props: TanStackNativePendingComponentProps,
): NativeNode {
  return solidCreateComponent(
    component as Component<TanStackNativePendingComponentProps>,
    props,
  ) as NativeNode;
}

function renderErrorComponent(
  component: TanStackNativeErrorComponent,
  props: TanStackNativeErrorComponentProps,
): NativeNode {
  return solidCreateComponent(
    component as Component<TanStackNativeErrorComponentProps>,
    props,
  ) as NativeNode;
}

function renderNotFoundComponent(
  component: TanStackNativeNotFoundComponent,
  props: TanStackNativeNotFoundComponentProps,
): NativeNode {
  return solidCreateComponent(
    component as Component<TanStackNativeNotFoundComponentProps>,
    props,
  ) as NativeNode;
}

function TanStackNativeMatchContent(
  props: TanStackNativeMatchContentProps,
): NativeNode {
  const router = useTanStackNativeRouter<AnyRouter>();
  const source = currentMatchSource(router);
  const routeId = props.routeId;
  const match = props.match;
  const requiredMatch = match as Accessor<MakeRouteMatchUnion<AnyRouter>>;
  const state = source.state;
  const route = (): AnyRoute => {
    const current = router.routesById[routeId()];
    if (current === undefined) {
      throw new Error(`Unknown TanStack native route ${routeId()}.`);
    }
    return current;
  };
  const retry = (): Promise<void> => {
    const id = requiredMatch().id;
    return router.invalidate({
      forcePending: true,
      filter: (candidate) => candidate.id === id,
    });
  };
  const pendingComponent = () =>
    (route().options.pendingComponent ??
      router.options.defaultPendingComponent) as
      TanStackNativePendingComponent | undefined;
  const errorComponent = () =>
    (route().options.errorComponent ?? router.options.defaultErrorComponent) as
      false | null | TanStackNativeErrorComponent | undefined;
  const notFoundComponent = () =>
    (route().options.notFoundComponent ??
      router.options.defaultNotFoundComponent) as
      TanStackNativeNotFoundComponent | undefined;
  const routeComponent = () =>
    (route().options.component ?? router.options.defaultComponent) as
      TanStackNativeRouteComponent | undefined;

  const notFound = solidCreateComponent(Show, {
    get when() {
      const current = match();
      return current?.status === "notFound" || current?._notFound === true
        ? current
        : undefined;
    },
    children: (_current) => {
      const component = notFoundComponent();
      return component === undefined
        ? undefined
        : renderNotFoundComponent(component, { match: requiredMatch });
    },
  });
  const errored = solidCreateComponent(Show, {
    get when() {
      const current = match();
      return current?.status === "error" ? current : undefined;
    },
    fallback: notFound,
    children: (_current) => {
      const component = errorComponent();
      if (
        component === undefined ||
        component === null ||
        component === false
      ) {
        throw requiredMatch().error;
      }
      return renderErrorComponent(component, {
        error: () => requiredMatch().error,
        retry,
        match: requiredMatch,
      });
    },
  });
  const succeeded = solidCreateComponent(Show, {
    get when() {
      const current = match();
      return current?.status === "success" && current._notFound !== true
        ? current
        : undefined;
    },
    fallback: errored,
    children: (_current) => {
      const component = routeComponent();
      const render = (): NativeNode =>
        component === undefined
          ? (solidCreateComponent(TanStackNativeOutlet, {}) as NativeNode)
          : renderRouteComponent(component);
      const boundary = errorComponent();
      if (boundary === undefined || boundary === null || boundary === false) {
        return render();
      }
      return solidCreateComponent(TanStackNativeErrored, {
        fallback: (error, reset) =>
          renderErrorComponent(boundary, {
            error,
            retry: () => {
              reset();
              return Promise.resolve();
            },
            match: requiredMatch,
          }),
        get children() {
          return render();
        },
      }) as NativeNode;
    },
  });
  const content = solidCreateComponent(Show, {
    get when() {
      return match()?.status !== "pending";
    },
    get fallback() {
      const component = pendingComponent();
      return component === undefined
        ? undefined
        : renderPendingComponent(component, {
            state,
            match: requiredMatch,
          });
    },
    children: () => succeeded,
  });
  return content as NativeNode;
}

/** Renders one matched route and provides its match to nested route hooks. */
export function TanStackNativeMatch(
  props: TanStackNativeMatchProps,
): NativeNode {
  const router = useTanStackNativeRouter<AnyRouter>();
  const source = currentMatchSource(router);
  const routeId = () => props.routeId;
  const match = createMemo(() => source.getMatch(routeId()));
  const context: NativeMatchContextValue = [routeId, match];
  return solidCreateComponent(TanStackNativeMatchContextProvider, {
    value: context,
    get children() {
      return solidCreateComponent(TanStackNativeMatchContent, {
        routeId,
        match,
      }) as NativeNode;
    },
  }) as NativeNode;
}

/** Renders the next matched child under the nearest route component. */
export function TanStackNativeOutlet(): NativeNode {
  const router = useTanStackNativeRouter<AnyRouter>();
  const source = currentMatchSource(router);
  const parent = useContext(TanStackNativeMatchContext);
  const childRouteId = createMemo(() => {
    const parentId = parent[0]();
    if (parentId === undefined || parent[1]()?._notFound === true) {
      return undefined;
    }
    const ids = source.ids();
    const index = ids.indexOf(parentId);
    return index < 0 ? undefined : ids[index + 1];
  });
  return solidCreateComponent(TanStackNativeKeyedShow, {
    get when() {
      return childRouteId();
    },
    keyed: true,
    children: (routeId: string) =>
      solidCreateComponent(TanStackNativeMatch, { routeId }) as NativeNode,
  }) as NativeNode;
}

function TanStackNativeMatchesContent(): NativeNode {
  const source = useContext(TanStackNativeMatchSourceContext);
  if (source === null) {
    throw new Error("TanStack native matches require a match source.");
  }
  const rootRouteId = createMemo(() => source.ids()[0]);
  return solidCreateComponent(TanStackNativeKeyedShow, {
    get when() {
      return rootRouteId();
    },
    keyed: true,
    children: (routeId: string) =>
      solidCreateComponent(TanStackNativeMatch, { routeId }) as NativeNode,
  }) as NativeNode;
}

export interface TanStackNativeMatchesProps<
  TRouter extends AnyRouter = AnyRouter,
> {
  /** A frozen screen-local state snapshot; omitted for the live router state. */
  readonly state?: Accessor<RouterState<TRouter["routeTree"]>>;
}

/** Renders a live or screen-local TanStack match hierarchy into native nodes. */
export function TanStackNativeMatches<TRouter extends AnyRouter = AnyRouter>(
  props: TanStackNativeMatchesProps<TRouter> = {},
): NativeNode {
  const router = useTanStackNativeRouter<AnyRouter>();
  const state = props.state as Accessor<RouterState> | undefined;
  const source =
    state === undefined
      ? liveMatchSource(router)
      : ({
          state,
          ids: () => state().matches.map((match) => match.routeId),
          getMatch(routeId: string) {
            return state().matches.find((match) => match.routeId === routeId);
          },
        } satisfies TanStackNativeMatchSource);
  return solidCreateComponent(TanStackNativeMatchSourceContextProvider, {
    value: source,
    get children() {
      return solidCreateComponent(
        TanStackNativeMatchesContent,
        {},
      ) as NativeNode;
    },
  }) as NativeNode;
}
