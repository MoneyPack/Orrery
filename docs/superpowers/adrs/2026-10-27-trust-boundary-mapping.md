# Architecture Decision Record: Trust-Boundary Mapping

**Date**: 2026-10-27
**Status**: Accepted
**Context**: Production readiness plan, Task 11. The filesystem should make the trust boundary obvious, but moving packages rewrites workspace paths, tsconfig references, and imports for zero runtime benefit.

## Context

The authenticated loopback daemon is the sole authority for repository trust, execution, snapshots, events, inspection, and promotion. Electron, OpenTUI, the browser renderer, and the Theia extension are untrusted clients of the same `MissionControlClient` contract. Seven packages in `packages/` sit on different sides of that line, but nothing in the tree says which.

## Decision

Record the classification here and mirror it in `packages/README.md`. Do NOT move directories.

| Package | Side | Reasoning |
|---------|------|-----------|
| `mission-control-daemon` | Trusted | Holds the capability token, approved-repo registry, durable stores, startup-lock promotion challenge. Runs with Git/filesystem/process reach. |
| `mission-kernel` | Trusted | Runs real commands in isolated Git worktrees, writes evidence, promotes reviewed changes. Called only by the daemon. |
| `mission-control-domain` | Shared contract, trusted content | Framework-free pure logic (capabilities, `Permission<T>`, transitions). Importable anywhere; its outputs are the rules both sides enforce. Must never gain I/O imports — pinned by `index.test.ts`. |
| `mission-control-protocol` | Untrusted shape, trusted validation | Type + validation layer for the wire. Validators run on the daemon side; the client side only constructs messages. |
| `mission-control-client` | Untrusted | Speaks the authenticated protocol, holds no Git/filesystem/process primitives. Same contract as Electron and TUI. |
| `mission-control-tui` | Untrusted | OpenTUI view-model and keymap only; dynamically loaded, talks to the daemon through the client contract. |
| `electron-security-policy` | Trusted policy, untrusted host | Declares the main-process security policy (navigation blocks, IPC contract). Its assertions constrain the untrusted renderer. |

`electron/` (root shell: main, preload, IPC, policy) is trusted code hosting untrusted web content; `scripts/` daemon launchers run trusted-side; `theia-extensions/` and `theia-app/` are untrusted clients like the root renderer.

## Consequences

### Positive

- The boundary is readable from two files (`packages/README.md` table, this ADR) without churning every import in the repo.
- The domain I/O pin (`index.test.ts` forbidding `node:` imports) keeps the shared contract honest.

### Negative

- A flat `packages/` still invites a future contributor to import daemon code from a client. The mapping is advisory, not enforced by the filesystem.

### Mitigations

- Revisit a physical `packages/trusted/` vs `packages/untrusted/` split when a second consumer (e.g. container adapters) makes the boundary load-bearing. The classification in this ADR becomes the move plan.
- A lint rule forbidding `mission-control-daemon` and `mission-kernel` imports from client/TUI sources would enforce the mapping cheaply.

## Alternatives Considered

- Physical split now: rejected — rewrites tsconfig project references, workspace globs, and Electron/Theia import paths across a dozen files for a readability gain a README table delivers.
- No record at all: rejected — the boundary already exists in the daemon design doc but is invisible from the package tree.
