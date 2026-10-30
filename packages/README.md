# packages/

Trust-boundary classification. The authenticated loopback daemon is the sole authority; everything else is an untrusted client of the `MissionControlClient` contract. Full reasoning: [`docs/superpowers/adrs/2026-10-27-trust-boundary-mapping.md`](../docs/superpowers/adrs/2026-10-27-trust-boundary-mapping.md).

| Package | Side |
|---------|------|
| `mission-control-daemon` | Trusted — token, registry, stores, promotion challenge |
| `mission-kernel` | Trusted — worktree execution, evidence, promotion (daemon-called only) |
| `mission-control-domain` | Shared contract — pure logic, no I/O (pinned by test) |
| `mission-control-protocol` | Wire shape + daemon-side validation |
| `mission-control-client` | Untrusted — protocol speaker, no OS primitives |
| `mission-control-tui` | Untrusted — view-model only, via client contract |
| `electron-security-policy` | Trusted policy constraining the untrusted renderer |

Rule of thumb: `mission-control-daemon` and `mission-kernel` must never be imported from client, TUI, or renderer code.
