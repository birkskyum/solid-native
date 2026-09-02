# `@solid-native/networking`

Bounded incremental HTTP(S) text transport for Solid Native. The React Native
adapter resolves the pinned 0.87 `Networking` TurboModule directly and listens
to its native event channel without importing or routing requests through
`fetch`, `XMLHttpRequest`, either `RCTNetworking` platform wrapper, or the
generated JavaScript specs.

```ts
import { createReactNativeNetworkService } from "@solid-native/networking/react-native";
import { createNetworkController } from "@solid-native/networking/solid";

const network = createNetworkController(createReactNativeNetworkService());
const request = network.requestText(
  {
    url: "https://api.example/assistant",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Show the account summary" }),
  },
  {
    onResponse(response) {
      console.log(response.status);
    },
    onChunk(chunk) {
      appendIncrementalPayload(chunk.text);
    },
  },
);

const result = await request.result;
```

For a finite JSON response, the optional document layer owns buffering and
validation instead of leaving each application to rebuild it:

```ts
import { requestJSON } from "@solid-native/networking/json";

const document = requestJSON(
  network,
  {
    url: "https://api.example/assistant/profile",
    headers: { Accept: "application/json" },
  },
  {
    onResult(result) {
      setProfile(result.value);
    },
  },
);

const { response, value } = await document.result;
```

For screen state, `createJSONResource` removes the imperative request-handle
bookkeeping while retaining the bounded native transport:

```ts
import { createJSONResource } from "@solid-native/networking/solid-json";
import { createSignal } from "solid-js";

const [accountId, setAccountId] = createSignal("42");
const account = createJSONResource(
  network,
  () => ({
    url: `https://api.example/accounts/${accountId()}`,
    headers: { Accept: "application/json" },
  }),
  {
    decode(value) {
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof value.name !== "string"
      ) {
        throw new TypeError("Account name is required.");
      }
      return { name: value.name };
    },
  },
);

// Reactive reads: account(), account.state, account.loading, account.error.
```

Changing `accountId()` cancels obsolete native work before starting its
replacement. The last good value remains readable during refresh and after a
failure; `account.latest`, `account.response`, and `account.result` expose the
same state explicitly. `account.refetch()` retries the current request,
`account.cancel()` restores the last stable state, a `false`/`null`/`undefined`
source disables loading, and owner disposal cancels the final request. The
optional decoder must be synchronous so validation and publication remain in
the exact native completion cause.

The JSON layer independently caps native chunk count, document characters,
nesting depth, and value count, accepts `application/json` and registered
`application/*+json` forms, and deeply freezes the parsed value without
interpreting HTTP status. Content-type checks can be disabled only through an
explicit option. `onResult` must be synchronous and runs inside the Solid
controller's native completion event, so its reactive writes retain the exact
completion-to-computation-to-commit relationship. The promise is still
available for ordinary asynchronous control flow, but a later promise
continuation is not implicitly treated as native input.

For Server-Sent Events, the optional protocol layer preserves those same native
chunk and completion causes through event parsing:

```ts
import { requestServerEvents } from "@solid-native/networking/server-events";

const stream = requestServerEvents(
  network,
  {
    url: "https://api.example/assistant/events",
    headers: { Accept: "text/event-stream" },
  },
  {
    onEvent(event) {
      applyServerEvent(event.type, event.data);
    },
  },
);

const { eventCount, lastEventId, retryMilliseconds } = await stream.result;
```

Long-lived screens can project the same connection into reactive state:

```ts
import { createServerEventStream } from "@solid-native/networking/solid-server-events";

const assistant = createServerEventStream(
  network,
  () => ({
    url: `https://api.example/assistant/${conversationId()}`,
    headers: { Accept: "text/event-stream" },
  }),
  {
    onEvent(event) {
      applyAssistantEvent(event.type, event.data);
    },
  },
);

// Reactive reads: assistant(), assistant.state, assistant.active,
// assistant.eventCount, assistant.lastEventId, assistant.error.
```

Changing the request cancels the obsolete native stream and resets its
connection-specific state. `assistant.restart()` explicitly repeats the current
request, `assistant.restart(request)` starts a supplied request,
`assistant.cancel()` closes it, and owner disposal cancels it. Event publication
and the optional synchronous `onResponse` and `onEvent` callbacks retain each
native input's causal relationship to Solid computations and Fabric commits.

The decoder accepts arbitrary CR, LF, and CRLF chunk boundaries, comments,
multiline data, event names, IDs, and bounded retry hints. It independently
bounds line length, data size, data-line count, and total event count. A stream
must return HTTP 200 and `text/event-stream` unless the caller explicitly opts
out of the media-type check. Completion flushes a final event whose data was not
followed by a blank line, which is useful when a server cleanly closes a finite
AI response.

`requestServerEvents` and `createServerEventStream` deliberately do not
reconnect, sleep, or send `Last-Event-ID`; applications can implement an
owner-aware policy using the returned ID and retry hint without hidden
background work. `restart()` repeats the request exactly as supplied. This
layer only defines SSE framing. It does not pre-empt Solid's server-function or
server-component wire protocol.

The adapter normalizes two incompatible native ABIs. Android requires a
caller-generated signed 32-bit request identifier, tuple headers, and positional
arguments. iOS accepts an object request and returns its native identifier via a
callback, including after the application has already cancelled. React Native's
iOS request counter starts at zero, so the adapter accepts non-negative safe
integers rather than imposing Android's positive signed 32-bit range. Invalid
callback IDs settle as a canonical non-timeout transport failure instead of
creating a malformed completion. Both platforms use native incremental text
delivery and native abort rather than buffering the entire response through the
React Native fetch polyfill. React Native 0.87's
completion event can omit its timeout element for success and ordinary transport
failure. The bridgeless iOS event path can expose the false NSNumber slot as
`null` or `undefined`, while other native paths can surface booleans as `0` or
`1`. The pinned adapter canonicalizes only those bounded two- or three-element
representations to `false` or `true`; it reports malformed lengths and value
kinds without including native error values, and the service contract remains
strictly boolean.

Request URLs, methods, credentials, headers, body size, timeout, per-chunk size,
aggregate response size, response metadata, byte progress, native errors, and
event ordering are validated. The service never accumulates response text; the
application decides what to retain. Immediate cancellation avoids native work,
active cancellation aborts the platform request, and Solid owner disposal
cancels every pending request. Response and chunk observers are synchronous by
design so the native input, reactive write, and resulting commit retain one
exact causal relationship; start separate owned work explicitly when a chunk
needs asynchronous processing.

The Solid controller gives response metadata, every chunk, completion, and
failure a separate causal platform event. This is the transport-level path for
tracing a server or AI stream into the Solid computations, Fabric commits, and
frames it causes. Causal telemetry records none of the URL, headers, request
body, response headers, streamed text, or parsed JSON. JSON documents and SSE
are separate, stable framing layers; server functions and Solid server
components remain future protocol layers and are deliberately not inferred
here.

React Native's application bootstrap still installs its standard fetch/XHR
globals before the entrypoint. The Release source policy fingerprints that
unavoidable, platform-specific `setup-env` baseline while requiring the Solid
Native transport itself to contain only its direct registry, adapter, service,
and ownership seam. Removing the broader React Native environment bootstrap is
a separate backend concern, not something this package disguises.

The dedicated Release proofs can be run on attached, securely unlocked physical
devices with:

```sh
pnpm --filter @solid-native/native-e2e android:networking:test

SOLID_NATIVE_IOS_DESTINATION=<xcode-device-id> \
SOLID_NATIVE_IOS_TEAM=<development-team-id> \
pnpm --filter @solid-native/native-e2e ios:networking:test
```

It serves split SSE and JSON responses from a bounded local host server through
an explicit `adb reverse`, forces a native transport failure, physically taps
explicit and Solid-owner cancellation paths, and requires response/chunk/
completion-to-computation-to-Fabric-commit/mount/frame causality without the
URL, headers, bodies, or streamed values entering telemetry. The runner rejects
emulators and ambiguous devices, bounds the one transparent OkHttp retry seen
for the idempotent forced-failure request, waits for JavaScript cancellation and
surface-teardown acknowledgement, and verifies that the app process, disposable
packages, and reverse tunnel are gone before success. Cleartext permission is
limited to this checked-in local proof application; the package does not weaken
an application's network-security policy.

The iOS runner uses the same bounded server and proof definition over a
run-scoped 144-bit `*.local` launch capability. Its app rejects any non-local or
malformed origin, keeps arbitrary ATS loads disabled, and declares local-network
access only in the disposable proof bundle. The generic Release app, XCTest
bundle, Hermes bytecode, and composed source map compile and pass the same seam
policy without signing. The signed physical URLSession run remains the iOS
promotion gate.
