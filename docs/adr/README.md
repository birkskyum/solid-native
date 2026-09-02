# Architecture decision records

ADRs record consequential choices and their tradeoffs.

| ADR                                        | Status   | Decision                                                    |
| ------------------------------------------ | -------- | ----------------------------------------------------------- |
| [0001](0001-first-host-backend.md)         | Proposed | Use React Native's lower half as the first host backend     |
| [0002](0002-tanstack-router.md)            | Accepted | Use TanStack Router and build native presentation around it |
| [0003](0003-transactional-commits.md)      | Proposed | Batch fine-grained updates into atomic host commits         |
| [0004](0004-solid-server-native-client.md) | Proposed | Adapt Solid's server/continuation model to native clients   |

New ADRs should contain context, decision, consequences, validation, and status. Supersede old records instead of deleting them.
