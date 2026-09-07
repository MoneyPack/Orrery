# Agent Execution Sessions: Structured Container Foundation

## 1. Objective

Add daemon-owned, agent-first execution sessions to Orrery without weakening its existing mission, worktree, approval, or promotion boundaries. An intelligence turn may request a structured command in an isolated mission workspace. The operator controls immutable capability-profile revisions, sees the exact execution context, approves escalations, observes output, and may cancel any queued or running work. The renderer and model never receive raw process authority, unrestricted stdin, host paths, secret values, runtime credentials, or container-engine access.

This document also fixes the architecture for later persistent shells, operator-approved mounts, secrets, and native policy-only execution. Those are approved program goals, but each changes the threat model enough to require a separate design and implementation plan. The first implementation plan covers only the structured-container foundation defined here.

Success for the first slice means:

- One active mission run may own multiple concurrent structured sessions while each session serializes commands.
- Every command is authorized against an immutable operator-managed profile revision and an exact execution context.
- Docker or Podman owns the isolated command processes; Orrery verifies a concrete enforcement matrix before displaying `ENFORCED`.
- The mission worktree is available for file edits, but Git control metadata and the target checkout are not available inside the container.
- Command requests, decisions, bounded output, outcomes, and mission evidence are durable and ordered.
- Mission cancellation or daemon shutdown terminates all sessions and command process trees in the active run.
- Restart never reattaches to or presents a previous process as live.

## 2. Existing Boundaries

- `MissionAuthority` is the daemon-owned authority for mission lifecycle, one `activeRunId`, run cancellation, durable mission events, inspection, and promotion. It serializes mutations per mission.
- `MissionRunner` is the existing fixed local-fixture run implementation. It creates a worktree, writes a fixture change, executes one daemon-selected verification command, records evidence, and completes the mission.
- `AllowlistedCommandRunner` is the kernel's trusted verification primitive. It requires an exact executable-and-arguments match, uses `shell: false`, restricts cwd to a canonical worktree, bounds output and time, and terminates process trees. Agent execution must not broaden this allowlist.
- `GitWorkspaceService` creates a private linked worktree and mission branch, isolates Git configuration and hooks, revalidates workspace identity, and promotes only an exact reviewed change snapshot.
- MCP execution already validates bounded arguments, derives risk at invocation time, shows a native sandboxed confirmation, signs an exact-context capability, spends it once, and audits intent before dispatch.
- The Theia host accepts confirmation-capable requests only from a live trusted main frame with the exact renderer URL. IPC inputs are exact-field validated and bounded.
- The Theia application does not currently depend on `@theia/terminal`. This slice does not add it.

## 3. Program Decisions

The approved long-term direction is:

- Agent-first sessions rather than unrestricted human terminals.
- Structured commands and persistent shells, with structured commands as the default.
- Policy-selected mode; persistent-shell creation requires an agent reason and explicit operator approval.
- Operator-managed custom profiles expressed as platform-neutral container-style manifests.
- Windows, macOS, and Linux host support.
- Docker or Podman enforcement when available, with an explicitly accepted native policy-only fallback later.
- Profile-specified images resolved and approved by immutable digest.
- Operator-selected host mounts represented to agents by opaque aliases.
- Per-command profile authorization and conservative shell parsing.
- OS credential-store secret references with narrow injection.
- One active command per session, multiple sessions per active mission run, and daemon-wide resource caps.
- Durable records but ephemeral processes; no restart reattachment.

These decisions do not imply that all features belong in one implementation. Sections 4 and 18 define the required decomposition.

## 4. Required Decomposition

The program is divided into independently reviewed security increments:

1. **Structured container foundation, this specification.** Mission-run integration, profile revisions, local Docker/Podman adapters, one mission-worktree mount, structured commands, approvals, transcripts, evidence, cancellation, recovery, IPC, and Theia UI.
2. **Additional host mounts.** Native directory selection, stable host-object identity, reparse-point and rename-race handling, runtime path translation, per-mount approval, and read-only enforcement.
3. **Secrets.** Credential-store adapters, injection methods, image/executable/destination scoping, runtime-log policy, streaming redaction semantics, and a per-adapter prohibition matrix.
4. **Persistent shells.** Separate Bash, Zsh, and PowerShell supervisor protocols, PTY/ConPTY ownership, prompt and foreground-process attestation, command framing, cancellation, terminal control sequences, and adversarial tests.
5. **Native policy-only execution.** An explicit account of which isolation and promotion guarantees it forfeits, which mission modes may use it, cleanup limits, and permanent UI/audit labeling.
6. **Broader image trust.** Optional signature, provenance, vulnerability, registry, and organization policy beyond operator approval of immutable bytes.

No later increment may be implemented merely by loosening validators or treating an unsupported first-slice field as advisory.

## 5. Mission Run Ownership

Sessions are not a parallel mission lifecycle. They are children of one existing mission run.

Add an explicit run kind to daemon-owned run state:

```ts
type MissionRunKind = "fixture" | "agent_sessions";

interface ActiveMissionRun {
  missionId: string;
  runId: string;
  kind: MissionRunKind;
  planRevisionId: string;
  workspaceId: string;
  controller: AbortController;
}
```

`fixture` preserves the current `MissionRunner` path. `agent_sessions` is coordinated by `MissionAuthority` and delegates session execution to `SessionAuthority`.

Starting an agent run:

1. Validates and approves the exact submitted plan revision through `MissionAuthority`.
2. Creates the mission worktree through `GitWorkspaceService`.
3. Applies the existing `queued -> running` domain transition with one `runId` and workspace ID.
4. Persists the active agent-run record before accepting session creation.
5. Creates one run-level `AbortController` inherited by every session and command.

One mission still has at most one active run. An agent run may own multiple sessions, but every session carries the same mission ID, run ID, plan revision ID, and workspace ID. Sessions cannot outlive the run.

Commands may start only while the mission is `running`. A command that needs operator capability resolution appends a mission capability request and moves the mission to `blocked`; no session in that run dispatches another command until the request is resolved and the mission returns to `running`. Evidence is recorded only while `running`, preserving current domain invariants.

A failed command becomes durable evidence but does not automatically fail the mission. Intelligence may request another authorized command. Explicit agent-run finalization terminates idle sessions, inspects the workspace through the daemon, records the final change snapshot and evidence assessment, and asks `MissionAuthority` to apply `complete` or `fail`. Only `MissionAuthority` changes mission status.

Mission cancellation aborts the run-level controller, stops every queued and active session command, terminates each container, persists cancellation, and clears `activeRunId`. Mission completion, failure, review transition, or daemon shutdown likewise leaves no live child session.

## 6. Authority Modules

### MissionAuthority

`MissionAuthority` remains the sole owner of mission status, active run identity, worktree lifecycle, mission event ordering, evidence attachment, final inspection, and cancellation hierarchy. It exposes a narrow run context to `SessionAuthority` and receives summarized command outcomes back through a port.

### SessionAuthority

`SessionAuthority` is a deep daemon module responsible for profile resolution, session state, command sequencing, authorization, adapter dispatch, transcript persistence, quotas, and cleanup. It cannot create a worktree, assign mission status, promote changes, or resolve host paths supplied by a client.

Its trusted input is a daemon-created `AgentRunContext`:

```ts
interface AgentRunContext {
  missionId: string;
  runId: string;
  planRevisionId: string;
  workspace: MissionWorkspace;
  signal: AbortSignal;
}
```

Public clients receive opaque session, command, profile, mount, and evidence IDs. They do not receive `MissionWorkspace`, canonical paths, process IDs, container IDs, environment values, engine sockets, or mutable kernel objects.

### Existing Runner

`MissionRunner` and `AllowlistedCommandRunner` remain unchanged for fixture/verification runs. Agent-selected executables, images, mounts, and arguments never enter their allowlists.

## 7. First-Slice Profile Revision

Profiles are stored in an Orrery-owned private state directory and managed only through a trusted operator settings surface. Editing creates a new immutable revision. Existing sessions retain their original revision.

The first-slice schema is deliberately narrower than the eventual container-style manifest:

```ts
interface StructuredContainerProfileRevision {
  payloadVersion: 1;
  profileId: string;
  revisionId: string;
  displayName: string;
  imageReference: string;
  approvedImageDigest?: string;
  commands: StructuredCommandRule[];
  resources: {
    cpuCount: number;       // default 2, range 0.25..8
    memoryMiB: number;      // default 2048, range 128..16384
    processCount: number;   // default 128, range 16..1024
  };
  limits: {
    commandTimeoutMs: number; // default 120000, max 1800000
    outputBytes: number;      // default 1048576, max 10485760
    idleTimeoutMs: number;    // default 600000, max 3600000
    sessionLifetimeMs: number; // default 3600000, max 14400000
    queuedCommands: number;   // default 16, max 64
  };
  createdAt: string;
  supersedes?: string;
}

interface StructuredCommandRule {
  executable: string;
  arguments: Array<{ literal: string } | { value: "any_literal" }>;
  decision: "allow" | "confirm" | "deny";
  capabilities: Array<"read" | "write" | "destructive" | "network" | "spend" | "secret" | "privileged">;
}
```

The first slice always uses:

- Mode `structured` only.
- The mission worktree as the sole read-write host mount.
- Network disabled.
- No secrets.
- No additional host mounts.
- An immutable environment built by the daemon from a small platform-neutral baseline; profiles cannot pass host environment variables.
- A read-only container root filesystem with bounded writable temporary storage.

Unknown fields, regular expressions, shell text, arbitrary environment maps, privileged flags, device requests, host namespaces, runtime sockets, extra mounts, secret references, network enablement, unsupported image platforms, duplicate rules, ambiguous rule ordering, unsafe strings, and out-of-range limits are rejected.

Rule precedence is `deny`, then `confirm`, then `allow`. A command is automatically allowed only if exactly one normalized rule shape matches and all derived capability flags are covered by that rule. Unmatched commands require confirmation. Any `network`, `secret`, or `privileged` capability is denied in this slice because the corresponding feature is unavailable, not merely unapproved.

## 8. Container Enforcement Matrix

The first slice supports local Docker Engine, Docker Desktop, and Podman engines on Windows, macOS, and Linux hosts running Linux containers. Windows containers, remote contexts, SSH contexts, Kubernetes contexts, and engines whose effective configuration cannot be inspected are unsupported.

A session is labeled `ENFORCED` only when the adapter establishes and verifies all of the following:

- The selected platform image manifest matches the approved immutable digest.
- The engine endpoint is local and is not mounted or otherwise exposed to the container.
- The mission worktree is the only host bind mount.
- The linked-worktree `.git` control file is hidden inside the container by a separate read-only inert mount; the repository common Git directory and target checkout are not mounted.
- Container root filesystem is read-only; bounded temporary filesystems provide `/tmp` and required runtime scratch paths.
- Network mode is `none`.
- Effective user is non-root, with explicit UID/GID mapping where supported.
- Linux capabilities are dropped, `no-new-privileges` is set, no devices are added, and host PID, IPC, UTS, user, and network namespaces are not joined.
- CPU, memory, and process-count controls requested by the profile are supported and visible in engine inspection.
- The adapter can identify and terminate the container and reject surviving command descendants before the next command.
- Runtime configuration inspected after creation matches the requested immutable configuration.

Rootful and rootless engines, Docker Desktop VMs, Podman machines, host architectures, user-namespace modes, and security modules have different guarantees. The adapter maintains a versioned platform/runtime capability matrix. If any required item is absent, unverifiable, or downgraded by that engine, the first-slice session is `unsupported`; it does not fall back to policy-only execution.

`ENFORCED` means the listed container boundary was configured and verified against the supported runtime matrix. It does not mean the operator-approved image is benign, the host engine has no vulnerability, or an authorized process cannot modify the mounted mission worktree.

## 9. Mission Worktree And Git Boundary

The mission worktree remains the daemon-owned source of reviewable changes. The container receives it at a fixed path such as `/workspace`, but does not receive usable Git control metadata.

Because a linked worktree's `.git` file points into the original repository's common Git directory, the adapter overlays that file with an inert read-only mount before execution. It then verifies inside the created container that:

- `/workspace` is the expected mount destination.
- `/workspace/.git` is the inert mount rather than the host file.
- The repository common Git directory and target checkout are absent from the mount table.
- The engine has not added an implicit host mount.

Git commands inside the container are intentionally unsupported in this slice. Repository inspection, diffs, status, branch identity, and promotion remain daemon-owned operations. If the command mutates `.git` through an unexpected path, alters workspace identity, or causes the target repository identity/cleanliness checks to fail, the run fails closed and cannot promote.

The daemon revalidates workspace identity and target cleanliness before every command dispatch, final inspection, and promotion. This is defense in depth; the container mount boundary is the primary isolation control.

## 10. Image Integrity And Approval

Digest approval establishes byte identity, not publisher trust or safety.

The image resolver accepts a profile-specified registry reference or local tag, resolves the OCI index and selected Linux platform-manifest digest without starting the image, and records registry origin, index digest, platform digest, architecture, media type, local/remote source, and available signature, provenance, and scan metadata. Optional metadata is displayed but does not silently become a trust guarantee.

The operator approves the exact profile revision, platform digest, registry origin, and intended mission-worktree access. If a tag later resolves differently, if platform selection changes, or if a local image no longer matches the approved digest, session creation stops for new approval. Pull and create use the approved digest, not the mutable tag.

The first slice rejects insecure registry transport, credential-bearing image references, remote engine contexts, implicit pulls during session start, mutable local-only images without a stable content digest, and images whose configured entrypoint cannot be overridden by the structured adapter. Registry authentication setup remains an operator/runtime concern and is not sent to the model or stored in profile records.

## 11. Session And Command State

```ts
type SessionState =
  | "proposed"
  | "awaiting_approval"
  | "starting"
  | "idle"
  | "running"
  | "terminating"
  | "terminated"
  | "failed"
  | "interrupted"
  | "cleanup_required";

type CommandState =
  | "requested"
  | "awaiting_approval"
  | "queued"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "approval_expired"
  | "cancelled"
  | "timed_out"
  | "interrupted";

interface ExecutionSession {
  sessionId: string;
  missionId: string;
  runId: string;
  planRevisionId: string;
  profileRevisionId: string;
  adapter: "docker" | "podman";
  enforcement: "enforced";
  imageDigest: string;
  workspaceBindingDigest: string;
  state: SessionState;
  nextCommandSequence: number;
  leaseExpiresAt: string;
  createdAt: string;
  terminatedAt?: string;
}

interface CommandRecord {
  commandId: string;
  sessionId: string;
  sequence: number;
  executable: string;
  arguments: string[];
  cwdAlias: "workspace";
  contextDigest: string;
  capabilities: Array<"read" | "write" | "destructive" | "network" | "spend" | "secret" | "privileged">;
  policyDecision: "allow" | "confirm" | "deny";
  operatorDecision?: "approved" | "denied" | "expired";
  state: CommandState;
  exitCode?: number;
  signal?: string;
  outputTruncated: boolean;
  startedAt?: string;
  finishedAt?: string;
}
```

Sequence numbers are reserved by durably creating a command record. Denied and expired commands consume their sequence so replay remains contiguous. A client submits the expected next sequence; stale, duplicate-with-different-input, and skipped submissions are rejected. Identical intent retries return the durable original result.

One command may be `starting` or `running` in a session. Multiple sessions may run concurrently under a default daemon cap of four active sessions, two active sessions per mission, and one active command per session. Profiles may lower but not exceed daemon limits.

## 12. Structured Command Authorization

A command request contains only an opaque mission/session ID, expected sequence, executable identifier, literal argument array, cwd alias `workspace`, and a bounded reason. It contains no shell string, host path, image override, mount, network setting, environment map, secret, or runtime flag.

The daemon normalizes the executable and arguments, rejects control characters and platform ambiguity, resolves the matching profile rules, and derives a set of capability flags. Capability flags are additive: one command may be write-capable and destructive. A scalar “maximum risk” is insufficient for policy.

Automatic allowance requires a unique matching `allow` rule and no unavailable capability. `deny` wins. `confirm` and unmatched commands require native operator approval. Oversized or structurally unreviewable commands are rejected before prompting rather than truncated into misleading consent.

The approval capability binds:

- Daemon execution instance and trusted Electron signer identity.
- Mission, run, session, command, and sequence IDs.
- Exact executable and argument array.
- Profile revision and image digest.
- Workspace-binding digest and cwd alias.
- Immutable environment digest.
- Capability flags, policy decision, timeout, output limit, and expiration.

It is signed, short-lived, and atomically single-use. Any changed field requires a new approval.

## 13. Approval Trust Protocol

The daemon token authenticates a local client but does not grant approval authority. Execution approvals require a separate Electron trust channel.

When Electron starts its owned daemon, it creates an ephemeral Ed25519 approval keypair. The private key remains in Electron main memory. The public key and an execution-instance nonce are pinned into the daemon through the existing parent-bootstrap handoff before mutation traffic is accepted. A restarted daemon or Electron process establishes a new identity; outstanding approval challenges expire.

For a confirmation:

1. The daemon durably records an approval challenge containing the exact context digest and nonce.
2. Electron receives the challenge only through a request originating from a live trusted Theia main frame.
3. Electron shows the existing no-preload, sandboxed native modal with the full reviewable context.
4. On approval, Electron signs the daemon challenge, context digest, decision, signer identity, and expiry.
5. The daemon verifies the pinned signer and challenge, atomically records the nonce as spent with the command transition, and only then dispatches execution.

A process possessing only the daemon token cannot mint approval. Approval capabilities are not reusable after daemon restart, signer restart, expiry, context change, denial, or prior spend. OpenTUI may inspect and cancel sessions in this slice but cannot approve profile revisions, images, sessions, or commands because it lacks an equivalent trusted native-window signer.

## 14. Structured Container Execution

One session owns one long-lived container so file changes and temporary container state persist across its serialized commands. Each command uses an engine `exec` operation with explicit executable and argument arrays; no shell is involved.

The adapter:

- Uses the immutable session image and configuration.
- Sets cwd to `/workspace`.
- Supplies only the daemon baseline environment.
- Captures stdout and stderr separately in bounded chunks.
- Applies the profile timeout and output cap.
- Rejects TTY allocation and stdin.
- Cancels the exec and, when clean command-tree termination cannot be proven, terminates the entire session container.
- Verifies no command process remains before returning the session to `idle`.

Background descendants are not a supported command outcome. If the engine cannot prove the command tree is gone, the session becomes `cleanup_required`, accepts no new work, and is terminated with bounded retry.

## 15. Event, Transcript, And Evidence Ordering

Session transcripts and mission events are separate ordered streams:

- Each session has a contiguous session-event sequence containing requests, policy decisions, operator decisions, starts, bounded stdout/stderr chunks, exits, cancellations, truncation, cleanup, and recovery.
- The mission retains one contiguous mission-event sequence across all sessions. It receives summarized lifecycle and command outcome events through `MissionAuthority`, which serializes them with all other mission mutations.

Command completion is one logical transaction coordinated by `MissionAuthority`: finalize command/session state and transcript high-water mark, append the bounded evidence summary to the current plan/run, append the mission summary event, and advance the mission snapshot. Filesystem storage uses the existing transaction-journal pattern or an equivalent recoverable transaction. Output chunks may be committed incrementally, but a final record binds their high-water mark and truncation status.

Command output remains transcript data, not the mission state source of truth. Mission evidence stores the command ID, executable and sanitized argument summary, capability flags, enforcement status, exit result, timing, output high-water mark, and truncation flag. Transcript retention may later delete output chunks while preserving immutable command and evidence facts.

Final agent-run completion first terminates sessions, then performs daemon-owned workspace inspection. `ready_for_review` is reached only after current-plan evidence exists and the final exact change snapshot is durably bound to the mission.

## 16. Restart And Cleanup

Session and command records are durable; containers and processes are ephemeral authority.

Daemon shutdown stops new mutations, aborts every active run, cancels queued commands, terminates known containers, waits for bounded cleanup, and persists terminal states. Cleanup failure records `cleanup_required` and enough private runtime identity for retry; public DTOs expose only the safe status.

On startup, `starting`, `running`, and `terminating` commands become `interrupted`. Their sessions become `cleanup_required` until the adapter proves the old container absent or removes it, then `terminated`. The daemon never reattaches, resumes, or reports an old session as idle. The mission receives one durable interruption event through `MissionAuthority` and follows existing safe run-recovery rules.

## 17. Protocol, IPC, And Theia Scope

Execution uses a separate `agent-execution.v1` protocol namespace on the authenticated daemon transport. It does not weaken the documented `mission-control.v1` rule that ordinary mission requests contain no executable arrays or command primitives.

The first-slice operations cover:

- List profiles and immutable revisions.
- Create a profile revision through the trusted settings surface.
- Inspect local runtime capabilities and image resolution.
- Propose and approve an image digest.
- Start, list, inspect, and terminate sessions.
- Submit, inspect, and cancel commands.
- Read bounded transcript pages and subscribe to ordered session events.
- Finalize an agent run.

Every mutation has an intent ID and expected revision or sequence. Inputs use exact fields, bounded strings/arrays/graphs, opaque IDs, and stable safe error codes. No request accepts host paths, shell text, environment maps, secret values, extra mounts, raw stdin, TTY controls, process IDs, container IDs, or runtime flags.

This slice ships in the Theia application and its Orrery extension/host. The root React/Electron reference shell remains a regression fixture and does not gain the session UI. Shared execution DTOs and validators live in a dedicated transport-neutral package consumed by the daemon client and mirrored into the Theia extension through the existing package/build boundary with contract-drift tests; they are not copied ad hoc into four surfaces.

Confirmation-capable handlers use the window-bound request context. Channel constants, main handlers, host-service methods, preload methods, and public DTOs are pinned by tests. Sender frame, live window, exact URL, graph size, unknown fields, extra arguments, and value bounds are checked before dispatch.

The Theia Agent Sessions view is grouped by mission and shows profile revision, runtime, `ENFORCED`, shortened image digest, session state, active command, lease, and resource limits. The transcript distinguishes agent request, policy decision, operator approval/denial, stdout, stderr, exit, cancellation, truncation, cleanup, and recovery. Operator controls inspect exact context, approve, deny, cancel command, terminate session, finalize run, and open mission evidence.

The trusted profile settings surface creates revisions and previews the supported runtime matrix. There is no directory picker, secret editor, shell terminal, or arbitrary mount control in this slice.

Accessibility includes complete keyboard operation, stable focus through updates, semantic status announcements, non-color status labels, virtualized transcript ordering compatible with assistive technology, and reduced-motion support.

## 18. Deferred Follow-On Contracts

### Additional Mounts

The approved program supports operator-selected read-only and read-write mounts. The follow-on design must use an Electron-main-owned native picker and transfer the selected object directly into daemon-private state without returning its host path to renderer or model. It must bind stable filesystem identity, revalidate after container creation, handle Unix rename/mount races and Windows reparse points/junctions, define descendant-symlink policy, and verify Docker Desktop/Podman-machine path translation.

### Secrets

Secrets are unsupported in the first slice. The follow-on design must define Windows Credential Manager, macOS Keychain, and Linux Secret Service adapters; supported injection methods; maximum secret sizes; runtime-log behavior; streaming redaction across chunk boundaries; image/executable/network scoping; and explicit unsupported combinations. Native policy-only sessions and persistent shells must not receive secrets unless their later design proves a sufficiently narrow boundary.

### Persistent Shells

Persistent shells are unsupported in the first slice. Their design must specify separate Bash, Zsh, and PowerShell/ConPTY supervisors. A random prompt string in PTY output is not attestation. The supervisor must prove foreground-process ownership and completion through a control channel unavailable to command children, define descriptor/handle inheritance, handle builtins, `exec`, traps, shell replacement, background jobs, terminal modes, and cancellation, and fail closed when state is ambiguous. The agent still submits complete command units and never receives raw PTY bytes.

### Native Policy-Only Execution

Native fallback is unsupported in the first slice. Its later design must state plainly that a same-user native process can traverse outside cwd, mutate repositories and refs, read unrelated user files, launch other executables, and open network connections. Operator consent does not preserve container isolation. At minimum, use must permanently mark the run non-promotable, prohibit secrets and extra host mounts, and trigger repository/target integrity checks; the design may instead restrict it to non-build exploration missions.

### Image Policy

The first slice proves immutable byte identity plus explicit operator approval. Signature verification, trusted publishers, provenance requirements, vulnerability thresholds, scan freshness, registry allowlists, local-build trust, and organization policy require a separate design. Approval of a digest does not mean the image is benign and does not automatically authorize future secrets or additional mounts.

## 19. Error Handling And Resource Limits

- Missing/local-runtime mismatch, remote context, changed image digest, unsupported platform, unverified enforcement, stale profile/run/session, expired lease, stale sequence, quota exhaustion, capability failure, workspace identity change, and target-integrity failure block dispatch.
- Runtime disappearance or adapter failure interrupts the command and terminates the session. Orrery does not silently change engine, image, or enforcement.
- Output uses bounded chunks, total command/session limits, backpressure, pagination, and explicit truncation. A slow or disconnected renderer cannot create unbounded daemon memory.
- Failure to persist command intent prevents dispatch. Failure to persist completion forces session termination and recovery; execution does not continue unrecorded.
- Safe errors never expose canonical host paths, environment values, registry credentials, engine endpoints, internal container IDs, or stack traces to renderer/model.
- Client disconnect does not approve, transfer, or broaden authority. Sessions continue only within their run, lease, limits, and already durable decisions.

## 20. Security Invariants

1. `MissionAuthority` owns one active run and cancellation hierarchy per mission; `SessionAuthority` owns only children of that run.
2. The daemon owns containers, command dispatch, authorization, sequencing, transcripts, and cleanup.
3. The agent cannot create profiles, approve images or commands, submit host paths, enable network, provide secrets, alter runtime flags, or access stdin/TTY/process handles.
4. A session is permanently bound to one mission, run, plan revision, workspace, profile revision, runtime kind, image digest, and enforcement matrix.
5. A command starts only after durable intent and any exact-context approval are atomically verified and spent.
6. The daemon token alone cannot grant approval; approval requires the pinned live Electron signer and trusted native window flow.
7. The container cannot access the repository common Git directory, target checkout, engine socket, network, host namespaces, devices, or unlisted host mounts under the supported runtime matrix.
8. Git operations, final inspection, evidence attachment, mission transitions, and promotion remain daemon-owned.
9. Session/command events and mission summary events are separately contiguous and transactionally linked at command completion.
10. Cancellation and shutdown terminate the container boundary; restart never presents old execution as live.

## 21. Testing Strategy

- Domain/authority tests cover agent-run start/finalize/cancel, one active run, multiple child sessions, blocked capability behavior, evidence legality, mission transitions, and cleanup hierarchy.
- Profile tests cover exact schema, unknown fields, immutable revisions, defaults and limits, command-rule precedence, ambiguity, unsupported fields, image references, and capability sets.
- Approval tests cover signer bootstrap, trusted-window origin, challenge persistence, exact-context binding, expiry, signer/daemon restart, signature failure, atomic spending, replay, and token-only attackers.
- Adapter contract tests cover capability discovery, local-context rejection, image digest selection, creation, inspect verification, exec, stdout/stderr ordering, truncation, timeout, descendant cleanup, cancellation, lease expiry, termination, and recovery.
- Container integration tests run on provisioned Windows, macOS, and Linux hosts for Docker and Podman where supported. They prove `.git` masking, no common-Git/target/socket mounts, network denial, read-only root, temporary-storage bounds, non-root user, dropped capabilities, no-new-privileges, namespace/device restrictions, resource controls, and process cleanup.
- Adversarial workspace tests attempt path traversal, symlink escape, Git common-dir access, target mutation, `.git` replacement, engine-socket discovery, environment leakage, background descendants, and runtime-config drift.
- Persistence tests cover intent-before-dispatch, output high-water marks, atomic completion/evidence linkage, contiguous sequences, idempotency, crash points, interrupted recovery, cleanup retry, transcript paging, and retention.
- Protocol/IPC tests pin every operation and preload entry and reject wrong namespaces, untrusted windows, subframes, URL mismatches, extra arguments, unknown fields, oversized graphs, malformed IDs, and path/shell/environment/runtime-bearing payloads.
- Intelligence tests prove model requests use the same daemon authority and native approval gate, model output cannot forge approval, provider/tool/session limits compose, and command output re-enters context only as bounded untrusted data.
- Theia end-to-end tests cover profile creation, image resolution and approval, session creation, command allow/confirm/deny, output, cancellation, concurrent sessions, run finalization, mission evidence, accessibility, restart recovery, and packaged smoke.
- Runtime integration tests report explicit unsupported reasons when infrastructure is unavailable. A skipped runtime test never causes a profile or session to be labeled enforced.

## 22. First-Slice Delivery Order

1. Add agent-run domain/authority behavior and tests while preserving the fixture runner.
2. Add execution protocol types, exact validators, daemon request routing, and trusted Electron approval-signer bootstrap.
3. Add profile/image/session/transcript persistence, immutable revisions, transactional sequencing, and crash recovery.
4. Implement the Docker/Podman adapter contract and strict enforcement matrix for local Linux-container engines.
5. Implement structured command policy, capabilities, approvals, execution, cancellation, evidence linkage, and run finalization.
6. Add Theia host/preload contracts, profile settings, Agent Sessions view, transcript, controls, and accessibility.
7. Complete cross-platform container integration, adversarial security, restart, package, and full-product smoke coverage.

Each step is a vertical, tested change. No step enables persistent shells, secrets, arbitrary mounts, network, policy-only execution, or unrestricted Theia terminal access.

## 23. Acceptance Criteria

1. An operator can create a strictly validated structured-container profile revision; editing creates a new immutable revision, and intelligence cannot create or modify one.
2. An approved build plan can start one `agent_sessions` run through `MissionAuthority`; it creates one worktree and run controller, owns multiple sessions, and remains the only active run for that mission.
3. A session starts only on a supported local Docker/Podman engine after image digest approval and verification of every enforcement-matrix item.
4. The container sees the mission worktree but not usable `.git` control metadata, the common Git directory, target checkout, runtime socket, network, devices, host namespaces, or other host mounts.
5. Structured commands use exact executable and argument arrays with no shell, stdin, or TTY. Profile rules return deterministic allow/confirm/deny decisions over additive capability flags.
6. A confirmed command cannot run without a live trusted Electron signer. Changing any bound execution field or reusing/expiring the capability rejects dispatch.
7. One session never runs two commands concurrently. Multiple sessions run only within daemon and mission caps.
8. Request, decision, output, completion, cancellation, and truncation records are bounded, durable, ordered, and linked to mission evidence before final publication.
9. Failed commands remain evidence and do not directly mutate mission status. Only `MissionAuthority` can block, resume, complete, fail, or cancel the run.
10. Finalization terminates sessions, performs daemon-owned inspection, binds the exact change snapshot and current-plan evidence, and only then permits `ready_for_review`.
11. Cancellation, shutdown, runtime failure, or restart cannot leave a session presented as live; cleanup is retried and incomplete work is durably interrupted.
12. The renderer/model receives opaque handles and sanitized events only and cannot submit host paths, shell text, secrets, environment maps, runtime flags, raw stdin, process IDs, or container IDs.
13. `mission-control.v1` keeps its existing no-command-input contract; new exact, bounded operations live under `agent-execution.v1` and are pinned across daemon, host, IPC, preload, and package tests.
14. Existing fixture verification, mission isolation, review, promotion, MCP approval, intelligence, Electron security, Theia packaging, and smoke suites remain passing.

## 24. Implementation Constraints

- Do not add agent commands to `AllowlistedCommandRunner` or use its trusted verification allowlist as a general command policy.
- Do not let Theia, xterm.js, `@theia/terminal`, `node-pty`, Docker/Podman CLI output, or the renderer become execution authority.
- Do not mount the repository common Git directory, target checkout, engine socket, credential files, or arbitrary host directories in this slice.
- Do not add shell execution, stdin, TTY, network, secrets, extra mounts, privileged containers, host namespaces, devices, remote engines, or native fallback through permissive optional fields.
- Do not describe digest approval as publisher trust or `ENFORCED` as protection from malicious approved images or engine vulnerabilities.
- Do not silently downgrade enforcement, change runtime, re-resolve tags during a session, or resume processes after restart.
- Do not make transcripts the source of mission or command state. Durable structured records remain authoritative.
- Keep mission authority, session authority, policy, adapter, persistence, protocol, approval, and UI modules independently testable.

## 25. Resolved Decisions

- Agent sessions are children of the existing single active mission run, not a second lifecycle.
- An agent-session run replaces the fixed `MissionRunner` implementation for that run kind but preserves `MissionAuthority`, domain transitions, worktree creation, inspection, evidence, and promotion.
- The first implementation is structured container execution only; the approved broader program is decomposed into separate security designs.
- The mission worktree is mounted, while linked-worktree Git control metadata is masked and all Git operations remain daemon-owned.
- Local Docker/Podman Linux-container engines are supported across Windows, macOS, and Linux hosts through a strict capability matrix; unverifiable guarantees are unsupported.
- Approval authority is separate from the daemon token and requires a pinned ephemeral Electron signer bound to a live trusted window.
- Execution uses `agent-execution.v1`, preserving the existing `mission-control.v1` no-command contract.
- Profiles use additive capability sets rather than a scalar risk.
- Session transcripts and mission events are separate ordered streams linked transactionally at command completion.
- The Theia product receives the feature; the root React/Electron shell remains a reference fixture.
- Secrets, persistent shells, arbitrary mounts, native policy-only execution, and broader supply-chain policy remain approved goals but are blocked on their dedicated designs.
