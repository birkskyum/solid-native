# Risks and open questions

## Risk register

| Risk                                                     | Impact   | Early mitigation                                                                    |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| Fabric internals are too coupled to Fiber                | Critical | Complete a direct-shadow-node spike before designing public APIs                    |
| React Native releases create unsustainable porting work  | High     | Pin one release line, isolate backend, measure one upgrade                          |
| OXC Solid compiler prerelease changes output or maps     | High     | Exact pin, fail-closed transform, composed-map assertions, and device gates         |
| Solid server-component wire changes during preview       | High     | Defer integration, collaborate upstream, and require a public renderer-neutral seam |
| Native modules rely on React Native JS initialization    | High     | Classify and test representative modules; provide shims only at explicit boundaries |
| Solid commits expose intermediate native state           | High     | Transaction queue, coalescing, sequence IDs, conformance tests                      |
| Text/input/accessibility behavior is incomplete          | High     | Treat them as exit criteria, not post-beta polish                                   |
| UI-thread animation model conflicts with Solid ownership | High     | Keep every graph, timing, interruption, and cancellation bound to one Solid owner   |
| OTA updates violate policy or create security exposure   | High     | Signed protocol, runtime fingerprints, staged rollout, legal/security review        |
| Naming implies Meta/Solid endorsement                    | Medium   | Trademark review and neutral compatibility language                                 |
| Scope expands into an Expo clone before core works       | High     | Enforce roadmap gates and explicit non-goals                                        |

## Architectural questions

- Can Fabric's renderer and mounting pieces be driven cleanly without React Fiber?
- Is it cheaper long term to extract Fabric pieces or implement a smaller standalone host?
- Which React Native Codegen schemas can be reused without React-facing JavaScript?
- Should logical shadow nodes live primarily in JavaScript, C++, or both?
- What is the minimum synchronous host API required by text input, focus, and measurement?
- How should Solid priorities and async boundaries map to native event and commit priorities?
- Can Solid 2 flush boundaries provide a reliable default commit point across all application patterns?
- How are portals represented across surfaces, modals, and native screen containers?
- What lifecycle does a hidden but preserved navigation screen have?
- Can a UI-thread reactive graph share semantics with ordinary Solid signals without misleading developers?
- Which server-function/data hooks are already renderer-neutral, and what
  smallest upstream frame abstraction would let a native renderer consume
  server-owned content without HTML or raw Fabric operations?

## Ecosystem questions

- Which twenty native capabilities are required by the first external adopters?
- How many can reuse TurboModules unchanged, with wrappers, or only after native modification?
- What compatibility label should a module receive, and how is it continuously tested?
- Can Expo Modules Core be supported independently enough to expand the ecosystem?
- Which TanStack Router extension points best represent platform-driven navigation?

The storage, local-notification, and camera-session experiments reduce
uncertainty but do not close the native-module risk. AsyncStorage and Notify Kit
now have narrow wrapper-free generated-ABI adapters. Notify Kit local delivery
still needs application-owned React Native environment/event setup; remote push
and background handlers would additionally need explicit headless-task
registration and remain unclaimed. Neither adapter renders a React component.
VisionCamera's imperative Nitro API can be driven without hooks or a React
tree. Live preview now exercises an explicit, bounded opaque-native-resource
lifetime contract that preserves a Nitro HybridObject only for a direct Fabric
prop while ordinary `HostValue` remains transport-safe. The Android test
requires a real native preview to reach `STREAMING` and release with its Solid
owner. A serialized photo capture now disposes its in-memory Nitro object after
writing a temporary JPEG and returns only bounded portable metadata; Android
requires that result to drive a separate Solid/Fabric commit. The signed iPhone
Release run also opens its physical camera, mounts the preview, captures the
JPEG, commits its result, and stops the session. Video, frame processors,
durable media persistence, remote push/background work, independent iOS
operating-system assertions, broader resource types, and a backend upgrade
remain intentionally separate evidence gates.

Answers should become ADRs, experiments, or roadmap acceptance criteria rather than remaining informal conclusions.
