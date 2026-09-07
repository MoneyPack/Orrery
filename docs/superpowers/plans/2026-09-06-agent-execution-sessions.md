# Agent Execution Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the secure structured-container foundation for daemon-owned, mission-bound agent execution sessions in the Theia desktop application.

**Architecture:** `MissionAuthority` owns one active run and its worktree; a new `SessionAuthority` owns child sessions, serialized structured commands, policy, transcripts, and container cleanup. A separate `agent-execution.v1` protocol carries exact bounded DTOs, while an ephemeral Electron signer and trusted native window provide approval authority distinct from the daemon token. Local Docker/Podman adapters run Linux containers with no network, no usable Git metadata, and a verified enforcement matrix.

**Tech Stack:** TypeScript 5.9, Node.js 24.19.0, Vitest, Electron 38, Eclipse Theia 1.75.0, React 19, Docker/Podman CLI, Ed25519 signatures, daemon-private JSON/JSONL persistence.

**Spec:** `docs/superpowers/specs/2026-09-06-agent-execution-sessions-design.md`

## Global Constraints

- Implement structured commands only: no shell text, stdin, TTY, network, secrets, extra mounts, remote engines, or native fallback.
- Preserve `mission-control.v1`; all new execution messages use `agent-execution.v1`.
- Keep `MissionAuthority` as the sole mission-state, worktree, evidence, inspection, completion, failure, and cancellation authority.
- Keep `AllowlistedCommandRunner` unchanged and unavailable to agent-selected commands.
- Support local Docker Engine, Docker Desktop, and Podman running Linux containers on Windows, macOS, and Linux only when every enforcement-matrix requirement is verified.
- Mount only the mission worktree; mask its linked-worktree `.git` file and never mount the repository common Git directory, target checkout, engine socket, credentials, devices, or host namespaces.
- Require a pinned live Electron signer for image and command approvals; the daemon token alone grants no approval authority.
- Keep renderer/model payloads path-free and free of process/container IDs, environment maps, runtime flags, secret values, raw stdin, and mutable authority objects.
- Use TDD for every behavior change. Run each focused test red, then green, before the task commit.
- Do not edit generated `lib/`, `theia-app/src-gen/`, or vendored package output by hand.

---

### Task 1: Add Agent-Run Domain Semantics

**Files:**
- Create: `packages/mission-control-domain/src/execution.ts`
- Create: `packages/mission-control-domain/src/execution.test.ts`
- Modify: `packages/mission-control-domain/src/mission.ts`
- Modify: `packages/mission-control-domain/src/index.ts`
- Modify: `packages/mission-control-domain/src/index.test.ts`

**Interfaces:**
- Produces: `MissionRunKind`, `ExecutionCapability`, `SessionState`, `CommandState`.
- Produces: `Mission.activeRunKind?: MissionRunKind` and `MissionAction.start.kind`.
- Preserves: existing statuses, one `activeRunId`, contiguous mission events, and current evidence legality.

- [ ] **Step 1: Write failing transition and export tests**

Add tests proving `start` records `"fixture"` or `"agent_sessions"`, non-build execution remains rejected, completion/failure/cancellation/revision reset clear both active-run fields, and package exports remain runtime-independent.

```ts
it("binds the active run kind and clears it with the run", () => {
  const running = transitionMission(queuedBuildMission(), {
    type: "start", workspaceId: "workspace-1", runId: "run-1", kind: "agent_sessions",
  });
  expect(running).toMatchObject({ status: "running", activeRunId: "run-1", activeRunKind: "agent_sessions" });
  const failed = transitionMission(running, { type: "fail", runId: "run-1", reason: "stopped" });
  expect(failed.activeRunId).toBeUndefined();
  expect(failed.activeRunKind).toBeUndefined();
});
```

- [ ] **Step 2: Run the domain tests and verify the new contract is absent**

Run: `npx vitest run packages/mission-control-domain/src/execution.test.ts packages/mission-control-domain/src/index.test.ts`

Expected: FAIL because `MissionRunKind`, `activeRunKind`, and `start.kind` do not exist.

- [ ] **Step 3: Implement the minimal domain contract**

```ts
export type MissionRunKind = "fixture" | "agent_sessions";
export type ExecutionCapability = "read" | "write" | "destructive" | "network" | "spend" | "secret" | "privileged";
export type SessionState = "proposed" | "awaiting_approval" | "starting" | "idle" | "running" | "terminating" | "terminated" | "failed" | "interrupted" | "cleanup_required";
export type CommandState = "requested" | "awaiting_approval" | "queued" | "starting" | "running" | "completed" | "failed" | "denied" | "approval_expired" | "cancelled" | "timed_out" | "interrupted";
```

Extend `Mission`, `MissionAction.start`, and every terminal/reset transition. Keep controllers, promises, workspaces, profiles, and adapters out of the domain package.

- [ ] **Step 4: Run focused and root domain tests**

Run: `npx vitest run packages/mission-control-domain/src/execution.test.ts packages/mission-control-domain/src/index.test.ts src/domain/mission.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/mission-control-domain/src
git commit -m "feat(domain): model agent-owned mission runs"
```

---

### Task 2: Define `agent-execution.v1` And Its Client

**Files:**
- Create: `packages/mission-control-protocol/src/agent-execution-types.ts`
- Create: `packages/mission-control-protocol/src/agent-execution-validation.ts`
- Create: `packages/mission-control-protocol/src/agent-execution-validation.test.ts`
- Modify: `packages/mission-control-protocol/src/types.ts`
- Modify: `packages/mission-control-protocol/src/validation.ts`
- Modify: `packages/mission-control-protocol/src/index.ts`
- Create: `packages/mission-control-client/src/agent-execution-client.ts`
- Create: `packages/mission-control-client/src/agent-execution-client.test.ts`
- Modify: `packages/mission-control-client/src/transport.ts`
- Modify: `packages/mission-control-client/src/index.ts`

**Interfaces:**
- Produces: `AGENT_EXECUTION_PROTOCOL_VERSION = "agent-execution.v1"`.
- Produces: exact request/response/event DTO unions and `decodeAgentExecutionMessage`.
- Produces: `AgentExecutionClient` methods for profiles, runtime/image inspection and approval challenges, sessions, commands, transcript pages, subscriptions, and finalization.
- Consumes: Task 1 state/capability unions as type-only imports.

- [ ] **Step 1: Write failing protocol hardening tests**

Cover every request shape, version routing, string/array/page limits, prototype keys, unknown fields, extra fields, and forbidden path/shell/environment/runtime inputs.

```ts
expect(() => decodeMessage(JSON.stringify({
  version: "agent-execution.v1", type: "submit_command", requestId: "r1",
  intentId: "i1", sessionId: "s1", expectedSequence: 1,
  executable: "npm", arguments: ["test"], cwdAlias: "workspace", reason: "verify",
  cwd: "C:\\secret",
}))).toThrow(/field|invalid/i);
```

- [ ] **Step 2: Run protocol tests red**

Run: `npx vitest run packages/mission-control-protocol/src/agent-execution-validation.test.ts packages/mission-control-protocol/src/validation.test.ts`

Expected: FAIL because the namespace and decoder do not exist.

- [ ] **Step 3: Implement namespace-specific DTOs and decoder routing**

Define separate execution unions. Modify the top-level decoder to inspect `version` first and delegate without adding command variants to `mission-control.v1`. Keep all public records sanitized.

```ts
export interface SubmitStructuredCommandRequest {
  version: typeof AGENT_EXECUTION_PROTOCOL_VERSION;
  type: "submit_command";
  requestId: string;
  intentId: string;
  sessionId: string;
  expectedSequence: number;
  executable: string;
  arguments: string[];
  cwdAlias: "workspace";
  reason: string;
}
```

- [ ] **Step 4: Write failing client correlation and subscription tests**

Test exact request construction, request/result type correlation, execution errors, event cursor gaps, transcript pagination, duplicate request rejection, and continued mission-client behavior.

- [ ] **Step 5: Implement `AgentExecutionClient` over the shared line transport**

Keep execution event subscriptions separate from `MissionControlClient.subscribe`. Widen transport message types to the combined namespace union while preserving authentication and request correlation.

- [ ] **Step 6: Run protocol and client suites**

Run: `npx vitest run packages/mission-control-protocol/src packages/mission-control-client/src`

Expected: PASS, including the existing raw-path prohibition for `mission-control.v1`.

- [ ] **Step 7: Commit**

```powershell
git add packages/mission-control-protocol packages/mission-control-client
git commit -m "feat(protocol): add agent execution contracts"
```

---

### Task 3: Validate Profiles And Authorize Structured Commands

**Files:**
- Create: `packages/mission-control-daemon/src/execution-profile.ts`
- Create: `packages/mission-control-daemon/src/execution-profile.test.ts`
- Create: `packages/mission-control-daemon/src/structured-command-policy.ts`
- Create: `packages/mission-control-daemon/src/structured-command-policy.test.ts`
- Modify: `packages/mission-control-daemon/src/index.ts`

**Interfaces:**
- Produces: `parseStructuredContainerProfile(input): StructuredContainerProfileRevision`.
- Produces: `authorizeStructuredCommand(profile, request, derivedCapabilities): PolicyDecision`.
- Produces: canonical `profileRevisionDigest` and `commandContextDigest` helpers.
- Consumes: Task 1 capability union and Task 2 safe command DTO.

- [ ] **Step 1: Write failing exact-schema and policy tests**

Pin defaults/ranges, immutable revision fields, duplicate and ambiguous rules, unsupported fields, literal argument matching, additive capabilities, and `deny > confirm > allow`.

```ts
expect(authorizeStructuredCommand(profile([
  rule("npm", [literal("test")], "allow", ["read"]),
  rule("npm", [literal("test")], "deny", ["read"]),
]), command("npm", ["test"]), ["read"])).toEqual({ decision: "deny", matchedRuleIds: expect.any(Array) });
```

- [ ] **Step 2: Run tests red**

Run: `npx vitest run packages/mission-control-daemon/src/execution-profile.test.ts packages/mission-control-daemon/src/structured-command-policy.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement strict parsing, normalization, and deterministic policy**

Reject shell text, environment maps, network, secrets, mounts, privileged settings, devices, remote engines, control characters, unbounded values, and ambiguous matching. Return capability sets without collapsing them to one scalar risk.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run packages/mission-control-daemon/src/execution-profile.test.ts packages/mission-control-daemon/src/structured-command-policy.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/mission-control-daemon/src/execution-profile* packages/mission-control-daemon/src/structured-command-policy* packages/mission-control-daemon/src/index.ts
git commit -m "feat(daemon): validate execution profiles and command policy"
```

---

### Task 4: Add Durable Execution Records And Transactions

**Files:**
- Create: `packages/mission-control-daemon/src/session-types.ts`
- Create: `packages/mission-control-daemon/src/session-ports.ts`
- Create: `packages/mission-control-daemon/src/file-profile-store.ts`
- Create: `packages/mission-control-daemon/src/file-session-store.ts`
- Create: `packages/mission-control-daemon/src/file-transcript-store.ts`
- Create: `packages/mission-control-daemon/src/execution-transaction-store.ts`
- Create: `packages/mission-control-daemon/src/execution-persistence.test.ts`
- Modify: `packages/mission-control-daemon/src/index.ts`

**Interfaces:**
- Produces: private `ExecutionSessionRecord`, `CommandRecord`, `TranscriptEvent`, `ExecutionApprovalChallenge`.
- Produces: `AgentRunContext`, `ExecutionCapabilityRequest`, `CommittedCommandOutcome`, and `PrivateContainerHandle` as daemon-private contracts.
- Produces: `ProfileRevisionStore`, `SessionStore`, `TranscriptStore`, and recoverable `ExecutionTransactionStore` ports.
- Produces: atomic command reservation and completion APIs with contiguous sequence/high-water checks.

- [ ] **Step 1: Write failing persistence and corruption tests**

Cover private directory modes, immutable profile revisions, duplicate sequence rejection, denied/expired sequence consumption, bounded JSON/JSONL, unknown nested fields, atomic completion, journal recovery at each write boundary, transcript paging, high-water mismatch, and cleanup records hidden from public DTOs.

- [ ] **Step 2: Run persistence tests red**

Run: `npx vitest run packages/mission-control-daemon/src/execution-persistence.test.ts`

Expected: FAIL with missing stores.

- [ ] **Step 3: Implement focused stores and versioned execution journal**

Use separate private roots: `profiles`, `sessions`, `transcripts`, `execution-transactions`, `execution-approvals`, and `runtime-cleanup`. Do not put private runtime handles in mission snapshots or transcripts.

```ts
export interface ExecutionTransactionStore {
  reserveCommand(input: ReserveCommandInput): Promise<CommandRecord>;
  commitCommandOutcome(input: CommitCommandOutcomeInput): Promise<CommittedCommandOutcome>;
  recover(): Promise<ExecutionRecoveryRecord[]>;
}
```

- [ ] **Step 4: Run persistence plus existing durable-store tests**

Run: `npx vitest run packages/mission-control-daemon/src/execution-persistence.test.ts packages/mission-control-daemon/src/durable-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/mission-control-daemon/src
git commit -m "feat(daemon): persist execution sessions and transcripts"
```

---

### Task 5: Establish Durable Electron Approval Authority

**Files:**
- Create: `packages/mission-control-daemon/src/execution-approval.ts`
- Create: `packages/mission-control-daemon/src/execution-approval.test.ts`
- Modify: `scripts/daemon-bootstrap.ts`
- Modify: `scripts/daemon-bootstrap.test.ts`
- Modify: `scripts/daemon-bootstrap.integration.test.ts`
- Modify: `scripts/orrery-daemon.ts`

**Interfaces:**
- Produces: versioned approval bootstrap with `instanceId`, public key, fingerprint, and signer purposes.
- Produces: `ExecutionApprovalVerifier.issueChallenge` and `verifyAndSpend` backed by Task 4 persistence.
- Consumes: Task 3 context digest and Task 4 challenge store.

- [ ] **Step 1: Write failing bootstrap and verifier tests**

Test exact bootstrap fields, process binding, signer purpose, token-only attacker rejection, context mismatch, expiry, signature failure, daemon/Electron restart, duplicate spend, concurrent spend, and crash recovery after challenge creation.

```ts
await expect(verifier.verifyAndSpend({
  challengeId, signature: sign(otherContextDigest), instanceId,
})).rejects.toThrow(/context|signature/i);
```

- [ ] **Step 2: Run approval tests red**

Run: `npx vitest run packages/mission-control-daemon/src/execution-approval.test.ts scripts/daemon-bootstrap.test.ts scripts/daemon-bootstrap.integration.test.ts`

Expected: FAIL because execution signer purpose and durable challenge spending are absent.

- [ ] **Step 3: Generalize the parent bootstrap and implement daemon verification**

Retain the existing promotion signer behavior. Pin one ephemeral Electron key to the daemon instance with explicit purposes `promotion` and `agent_execution`. Persist challenge before presentation and atomically spend it with the command transition.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run packages/mission-control-daemon/src/execution-approval.test.ts scripts/daemon-bootstrap.test.ts scripts/daemon-bootstrap.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/mission-control-daemon/src scripts/daemon-bootstrap* scripts/orrery-daemon.ts
git commit -m "feat(security): bind execution approval to Electron"
```

---

### Task 6: Implement The Container Adapter Contract

**Files:**
- Create: `packages/mission-control-daemon/src/container-adapter.ts`
- Create: `packages/mission-control-daemon/src/container-adapter.contract.test.ts`
- Create: `packages/mission-control-daemon/src/container-runtime-capabilities.ts`
- Create: `packages/mission-control-daemon/src/container-runtime-capabilities.test.ts`
- Create: `packages/mission-control-daemon/src/container-cli-driver.ts`
- Create: `packages/mission-control-daemon/src/docker-adapter.ts`
- Create: `packages/mission-control-daemon/src/podman-adapter.ts`
- Modify: `packages/mission-control-daemon/src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ContainerRuntimeAdapter.discover`, `resolveImage`, `createSession`, `exec`, `cancel`, `inspect`, and `terminate`.
- Produces: normalized `EnforcementReport`; raw CLI output and container IDs remain private.
- Consumes: Task 4 private session types.

- [ ] **Step 1: Write failing contract tests against a fake exact CLI driver**

Assert local Linux-container context, approved platform digest, worktree-only bind, inert `.git` overlay, read-only root, `network=none`, non-root user, dropped capabilities, no-new-privileges, no devices/host namespaces/socket, resource limits, post-create inspect verification, no TTY/stdin/shell, bounded output, cancellation, descendant cleanup, and cleanup-required fallback.

- [ ] **Step 2: Run adapter tests red**

Run: `npx vitest run packages/mission-control-daemon/src/container-runtime-capabilities.test.ts packages/mission-control-daemon/src/container-adapter.contract.test.ts`

Expected: FAIL with missing adapter contract.

- [ ] **Step 3: Implement exact `execFile`-based Docker and Podman adapters**

Do not add a Docker SDK dependency. Invoke fixed CLI subcommands with argument arrays and `shell: false`; parse bounded JSON from inspect commands; reject remote contexts and unknown fields. Build create arguments only from daemon-owned profile/workspace values.

```ts
export interface ContainerRuntimeAdapter {
  discover(): Promise<RuntimeCapabilityReport>;
  resolveImage(reference: string, platform: "linux/amd64" | "linux/arm64"): Promise<ResolvedImage>;
  createSession(input: CreateContainerSessionInput): Promise<PrivateContainerHandle>;
  exec(handle: PrivateContainerHandle, input: StructuredExecInput): Promise<StructuredExecResult>;
  cancel(handle: PrivateContainerHandle): Promise<void>;
  inspect(handle: PrivateContainerHandle): Promise<VerifiedContainerState>;
  terminate(handle: PrivateContainerHandle): Promise<void>;
}
```

- [ ] **Step 4: Add opt-in real-runtime integration scripts**

Add `test:container:docker` and `test:container:podman`. Each script must fail with an explicit unsupported report when invoked without the requested runtime; ordinary unit tests use the fake driver.

- [ ] **Step 5: Run contract tests and one available runtime integration**

Run: `npx vitest run packages/mission-control-daemon/src/container-runtime-capabilities.test.ts packages/mission-control-daemon/src/container-adapter.contract.test.ts`

Run one that is provisioned: `npm run test:container:docker` or `npm run test:container:podman`.

Expected: contract PASS; the selected provisioned runtime PASS. Record unsupported runtime output without treating it as enforcement evidence.

- [ ] **Step 6: Commit**

```powershell
git add packages/mission-control-daemon/src package.json package-lock.json
git commit -m "feat(daemon): add enforced container adapters"
```

---

### Task 7: Build `SessionAuthority`

**Files:**
- Create: `packages/mission-control-daemon/src/session-authority.ts`
- Create: `packages/mission-control-daemon/src/session-authority.test.ts`
- Modify: `packages/mission-control-daemon/src/session-ports.ts`
- Modify: `packages/mission-control-daemon/src/index.ts`

**Interfaces:**
- Produces: `SessionAuthority.startSession`, `submitCommand`, `approveCommand`, `cancelCommand`, `terminateSession`, `finalizeRun`, `shutdown`, and `recover`.
- Consumes: daemon-created `AgentRunContext`, Tasks 3-6 policy/store/approval/adapter ports.
- Produces: `MissionExecutionSink` calls for mission events, evidence, inspection, completion, failure, and cancellation.

- [ ] **Step 1: Write failing authority state-machine tests**

Cover run-context binding, image approval gating, maximum two sessions per mission/four globally, one command per session, durable sequence reservation, allow/confirm/deny, unavailable capability denial, intent replay, timeout, output bounds, cancellation, command failure as evidence rather than mission failure, finalization, lease expiry, shutdown, and cleanup-required behavior.

- [ ] **Step 2: Run authority tests red**

Run: `npx vitest run packages/mission-control-daemon/src/session-authority.test.ts`

Expected: FAIL with missing authority.

- [ ] **Step 3: Implement orchestration without mission mutation**

`SessionAuthority` must reject direct public construction of run contexts, persist before dispatch, serialize command mutations per session, and call only the sink for mission effects.

```ts
export interface MissionExecutionSink {
  assertRunning(context: AgentRunContext): Promise<void>;
  requestCapability(context: AgentRunContext, request: ExecutionCapabilityRequest): Promise<void>;
  recordCommandOutcome(context: AgentRunContext, outcome: CommittedCommandOutcome): Promise<void>;
  finalizeAgentRun(context: AgentRunContext, summary: string): Promise<void>;
  failAgentRun(context: AgentRunContext, reason: string): Promise<void>;
}
```

- [ ] **Step 4: Run authority, persistence, policy, approval, and adapter contract tests**

Run: `npx vitest run packages/mission-control-daemon/src/session-authority.test.ts packages/mission-control-daemon/src/execution-persistence.test.ts packages/mission-control-daemon/src/structured-command-policy.test.ts packages/mission-control-daemon/src/execution-approval.test.ts packages/mission-control-daemon/src/container-adapter.contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/mission-control-daemon/src/session-*
git commit -m "feat(daemon): orchestrate agent execution sessions"
```

---

### Task 8: Integrate Agent Runs Into `MissionAuthority`

**Files:**
- Modify: `packages/mission-control-daemon/src/authority-types.ts`
- Modify: `packages/mission-control-daemon/src/mission-authority.ts`
- Modify: `packages/mission-control-daemon/src/mission-authority.test.ts`
- Modify: `packages/mission-kernel/src/mission-runner.ts` only if required to pass `kind: "fixture"` to the existing start action.

**Interfaces:**
- Produces: daemon-only `startAgentRun`, `agentRunContext`, `recordAgentCommandOutcome`, and `finalizeAgentRun` behavior.
- Consumes: Task 1 run kind and Task 7 `MissionExecutionSink`.
- Preserves: current `run()` fixture behavior and public mission redaction.

- [ ] **Step 1: Write failing mission-authority tests**

Prove exact plan approval, one worktree and controller per agent run, no second run, multiple child sessions sharing run/workspace, blocked dispatch until capability resolution, evidence only while running, final inspection before completion, cancellation hierarchy, restart interruption, and unchanged fixture-run semantics.

- [ ] **Step 2: Run mission-authority tests red**

Run: `npx vitest run packages/mission-control-daemon/src/mission-authority.test.ts packages/mission-control-domain/src/execution.test.ts`

Expected: FAIL because agent-run APIs and durable run kind are absent.

- [ ] **Step 3: Implement the run-kind branch and sink adapter**

Keep private `MissionWorkspace` in daemon snapshots. Agent-run start returns the running public mission after durable workspace/run claim rather than waiting for a fixed runner promise. Finalization terminates sessions first, inspects through `WorkspaceService`, records current-plan evidence/change snapshot, then transitions to review-ready.

- [ ] **Step 4: Run mission authority and kernel regressions**

Run: `npx vitest run packages/mission-control-daemon/src/mission-authority.test.ts packages/mission-kernel/src/mission-runner.test.ts packages/mission-control-domain/src`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/mission-control-daemon/src packages/mission-kernel/src packages/mission-control-domain/src
git commit -m "feat(daemon): bind sessions to authoritative mission runs"
```

---

### Task 9: Route Execution Through The Daemon And Bootstrap Recovery

**Files:**
- Create: `packages/mission-control-daemon/src/agent-execution-dispatch.ts`
- Create: `packages/mission-control-daemon/src/agent-execution-dispatch.test.ts`
- Modify: `packages/mission-control-daemon/src/server.ts`
- Modify: `packages/mission-control-daemon/src/server.test.ts`
- Modify: `scripts/daemon-authority-bootstrap.ts`
- Modify: `scripts/daemon-authority-bootstrap.test.ts`
- Create: `scripts/daemon-agent-execution-bootstrap.test.ts`
- Modify: `scripts/orrery-daemon.ts`

**Interfaces:**
- Produces: authenticated namespace routing to a narrow `DaemonSessionAuthority` dispatcher.
- Produces: bootstrap assembly of profile, execution, transcript, approval, runtime, and session services.
- Consumes: Tasks 2, 4-8.

- [ ] **Step 1: Write failing dispatcher/security tests**

Test every request route, common authentication, namespace mismatch, duplicate request IDs, safe errors, request bounds, token-only approval rejection, event subscription ordering, disconnect cleanup, and no private path/runtime leakage.

- [ ] **Step 2: Write failing bootstrap/recovery tests**

Pin new private directories, journal recovery before traffic, old-container cleanup before sessions become terminal, one mission interruption event, daemon shutdown ordering, corrupt execution records, and safe unsupported-runtime behavior.

- [ ] **Step 3: Run daemon routing/bootstrap tests red**

Run: `npx vitest run packages/mission-control-daemon/src/agent-execution-dispatch.test.ts packages/mission-control-daemon/src/server.test.ts scripts/daemon-agent-execution-bootstrap.test.ts`

Expected: FAIL because execution routing and services are not wired.

- [ ] **Step 4: Implement namespace routing and dependency assembly**

Keep one loopback transport and token authentication. Route by version after authentication; send execution requests only to `agent-execution-dispatch.ts`. Recover execution state and cleanup before publishing the endpoint.

- [ ] **Step 5: Run daemon and bootstrap suites**

Run: `npx vitest run packages/mission-control-daemon/src scripts/daemon-bootstrap.test.ts scripts/daemon-bootstrap.integration.test.ts scripts/daemon-authority-bootstrap.test.ts scripts/daemon-agent-execution-bootstrap.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/mission-control-daemon scripts
git commit -m "feat(daemon): expose authenticated execution sessions"
```

---

### Task 10: Add Electron Execution Confirmations And Client Wiring

**Files:**
- Create: `electron/agent-execution-approval.ts`
- Create: `electron/agent-execution-approval.test.ts`
- Create: `electron/trusted-agent-execution.ts`
- Create: `electron/trusted-agent-execution.test.ts`
- Modify: `electron/mission-control-daemon-client.ts`
- Modify: `electron/mission-control-daemon-client.test.ts`

**Interfaces:**
- Produces: Electron signer for daemon-issued image/command challenges.
- Produces: sandboxed no-preload modal for image and command review.
- Produces: daemon-client methods accepting a captured parent `BrowserWindow` for confirmation-capable operations.
- Consumes: Task 2 execution client and Task 5 bootstrap signer.

- [ ] **Step 1: Write failing signer/modal tests**

Pin exact signed fields, challenge origin, no self-authored payload, no preload/node integration/webview, CSP `default-src 'none'`, window binding, full reviewable context, close-as-deny, no secret/path leakage, and no signing without affirmative native decision.

- [ ] **Step 2: Run Electron tests red**

Run: `npx vitest run electron/agent-execution-approval.test.ts electron/trusted-agent-execution.test.ts electron/mission-control-daemon-client.test.ts`

Expected: FAIL with missing modules/methods.

- [ ] **Step 3: Implement challenge signing and trusted modals**

Reuse native-window hardening patterns, not `ToolApprovalService`'s in-memory issue/spend flow. Electron signs only daemon-issued challenges and returns signatures to the daemon for durable verification/spending.

- [ ] **Step 4: Run Electron security regression suite**

Run: `npx vitest run electron`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add electron
git commit -m "feat(electron): confirm agent execution requests"
```

---

### Task 11: Add Theia Host IPC And Narrow Preload APIs

**Files:**
- Create: `theia-extensions/mission-control/src/common/agent-execution-contracts.ts`
- Create: `theia-extensions/mission-control/src/common/agent-execution-contract-parity.test.ts`
- Modify: `theia-extensions/mission-control/src/common/mission-control-contracts.ts`
- Create: `theia-extensions/mission-control/src/electron-main/agent-execution-ipc.ts`
- Create: `theia-extensions/mission-control/src/electron-main/agent-execution-ipc.test.ts`
- Modify: `theia-extensions/mission-control/src/electron-main/mission-control-electron-main-contribution.ts`
- Modify: `theia-extensions/mission-control/src/electron-main/mission-control-electron-main-contribution.test.ts`
- Modify: `theia-extensions/mission-control/src/electron-browser/mission-control-preload-api.ts`
- Modify: `theia-extensions/mission-control/src/electron-browser/mission-control-preload-api.test.ts`
- Modify: `theia-extensions/mission-control/src/electron-browser/mission-control-preload.test.ts`
- Modify: `theia-extensions/mission-control/src/packaging.test.ts`
- Modify: `theia-extensions/mission-control/src/structure.test.ts`
- Modify: `theia-app/host/src/electron-main/mission-control-host-module.ts`
- Modify: `theia-app/test/host.test.ts`

**Interfaces:**
- Produces: one expanded `window.orreryMissionControl` object with narrow execution methods; no generic `invoke`.
- Produces: one self-contained renderer DTO mirror with bidirectional compile-time parity against Task 2's canonical protocol types.
- Produces: exact execution IPC parsers and handlers.
- Consumes: Task 10 window-bound daemon client.

- [ ] **Step 1: Write failing IPC/preload/packaging tests**

Pin every execution channel and method. Add a parity test that imports canonical Task 2 DTOs only from the test file via `../../../../packages/mission-control-protocol/src`; use bidirectional assignability assertions for every public execution DTO and direct equality for channel/type constants. Production extension source remains self-contained, so emitted declarations contain no `@orrery/` or checkout-relative imports. Reject wrong window, subframe, URL mismatch, extra arguments, unknown fields, oversized graphs, paths, shell text, environment maps, runtime flags, and confirmation calls without a captured parent window.

- [ ] **Step 2: Run Theia boundary tests red**

Run: `npm --prefix theia-extensions/mission-control test -- src/common/agent-execution-contract-parity.test.ts src/electron-main/agent-execution-ipc.test.ts src/electron-main/mission-control-electron-main-contribution.test.ts src/electron-browser/mission-control-preload-api.test.ts src/electron-browser/mission-control-preload.test.ts src/packaging.test.ts src/structure.test.ts`

Expected: FAIL because execution channels and methods are absent.

- [ ] **Step 3: Implement shared DTO packaging, exact handlers, and host methods**

Define the renderer-safe DTO mirror once in `agent-execution-contracts.ts`; import it from the preload, IPC, adapter, store, and views. Do not repeat DTO shapes in those files. Use window-bound request context for profile creation, image approval, session start, and command approval. Reads, cancel, terminate, and transcript operations still require a trusted main-frame sender but do not mint approval.

- [ ] **Step 4: Run extension and host boundary suites**

Run: `npm run theia:test && npm run theia-app:install && npm run theia-app:typecheck && npm run theia-app:test`

Expected: PASS with pinned API lists updated intentionally.

- [ ] **Step 5: Commit**

```powershell
git add theia-extensions/mission-control theia-app/host theia-app/test package-lock.json
git commit -m "feat(theia): expose narrow execution session IPC"
```

---

### Task 12: Build The Agent Sessions And Profile UI

**Files:**
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-adapter.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-adapter.test.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-store.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-store.test.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-view.tsx`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-view.test.tsx`
- Create: `theia-extensions/mission-control/src/browser/agent-profile-settings-view.tsx`
- Create: `theia-extensions/mission-control/src/browser/agent-profile-settings-view.test.tsx`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-widget.tsx`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-widget.test.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-contribution.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-style.ts`
- Create: `theia-extensions/mission-control/src/browser/agent-sessions-style.test.ts`
- Modify: `theia-extensions/mission-control/src/common/mission-control-types.ts`
- Modify: `theia-extensions/mission-control/src/common/mission-control-commands.ts`
- Modify: `theia-extensions/mission-control/src/browser/mission-control-frontend-module.ts`
- Modify: `theia-extensions/mission-control/src/browser/mission-control-frontend-module.test.ts`

**Interfaces:**
- Produces: renderer-safe `AgentSessionsService`, adapter, store, widget, view contribution, and `orrery.agentSessions.open` command.
- Consumes: Task 11 preload API only.

- [ ] **Step 1: Write failing adapter/store tests**

Cover intent IDs, unavailable preload, profile/session refresh, stable selection, stale response suppression, transcript cursor paging, event gaps forcing refresh, cancel/terminate/finalize actions, and bounded polling cleanup.

- [ ] **Step 2: Write failing accessible view tests**

Test mission grouping, profile revision, runtime, `ENFORCED`, image digest, command states, stdout/stderr semantics, approval/deny/cancel/terminate/finalize controls, loading/empty/error/interrupted/cleanup-required states, keyboard operation, live announcements, and non-color labels.

- [ ] **Step 3: Run browser tests red**

Run: `npm --prefix theia-extensions/mission-control test -- src/browser/agent-sessions-adapter.test.ts src/browser/agent-sessions-store.test.ts src/browser/agent-sessions-view.test.tsx src/browser/agent-profile-settings-view.test.tsx src/browser/agent-sessions-widget.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 4: Implement the renderer-safe view stack**

Keep state coordination in `agent-sessions-store.ts`; components receive state/actions. Profile settings expose only the first-slice schema. Do not add xterm.js, raw terminal controls, path pickers, secrets, network, mounts, or policy-only copy.

- [ ] **Step 5: Implement and test styles**

Use Theia theme variables, visible focus, semantic stdout/stderr/status treatment, reduced motion, and no `transition: all`. Keep the established dense industrial-editorial language.

- [ ] **Step 6: Bind widget, commands, menus, and keybinding**

Add the contribution to the existing synchronous frontend bindings and smoke opener. Use an explicit keybinding entry rather than deriving a command ID from the widget ID.

- [ ] **Step 7: Run full extension tests and typecheck**

Run: `npm run theia:typecheck && npm run theia:test`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add theia-extensions/mission-control
git commit -m "feat(ui): add agent execution sessions workspace"
```

---

### Task 13: Prove The Packaged Cross-Platform Execution Path

**Files:**
- Modify: `theia-extensions/mission-control/src/electron-main/mission-control-smoke-probe.ts`
- Modify: `theia-extensions/mission-control/src/electron-main/mission-control-smoke-probe.test.ts`
- Modify: `theia-app/scripts/smoke.mjs`
- Modify: `theia-app/scripts/smoke-runtime.mjs`
- Modify: `theia-app/scripts/smoke-policy.mjs`
- Modify: `theia-app/scripts/smoke-freshness.mjs`
- Modify: `theia-app/test/smoke-runtime.test.ts`
- Modify: `theia-app/test/smoke-policy.test.ts`
- Modify: `theia-app/test/smoke-freshness.test.ts`
- Create: `scripts/agent-execution-smoke.ts`
- Create: `scripts/agent-execution-smoke.test.ts`
- Create: `.github/workflows/agent-execution-containers.yml`
- Modify: `README.md` only to document runtime prerequisites, first-slice limits, and unsupported features.

**Interfaces:**
- Proves: disposable approved repo -> agent run -> enforced session -> allow/confirm/deny commands -> bounded transcript/evidence -> cancellation/finalization -> restart recovery.
- Proves: real Theia renderer landmark/menu/keybinding and packaged host/daemon wiring.

- [ ] **Step 1: Write the failing disposable integration smoke**

Use a temporary Git repository, a test profile/image fixture, an injected trusted signer, and a provisioned local runtime. Assert target unchanged before review, `.git` inaccessible in container, network denied, exact approved command execution, denied unavailable capability, cancellation, evidence, final inspection, and restart interruption.

- [ ] **Step 2: Extend Theia smoke tests red**

Require the Agent Sessions landmark, View menu entry, `orrery.agentSessions.open` keybinding, and renderer-safe fixture state without requiring Docker for the ordinary UI smoke.

- [ ] **Step 3: Run focused smoke tests red**

Run: `npx vitest run scripts/agent-execution-smoke.test.ts && npm run theia:test && npm run theia-app:test`

Expected: FAIL until smoke wiring and probes include the new path.

- [ ] **Step 4: Implement smoke wiring and CI matrix**

Keep ordinary root/Theia CI runtime-independent. Add explicit provisioned Docker and Podman jobs on supported Windows, macOS, and Linux runners; those jobs run the real enforcement smoke and publish unsupported reasons as failures, not silent passes.

- [ ] **Step 5: Run the full verification matrix**

Run sequentially:

```powershell
npm run typecheck
npx vitest run
npm run theia:typecheck
npm run theia:test
npm run theia-app:install
npm run theia-app:typecheck
npm run theia-app:test
npm run theia-app:smoke
npm run build
npm run desktop:build
npm run daemon:smoke
npm audit --omit=dev --audit-level=high
```

Run each provisioned runtime matrix command:

```powershell
npm run test:container:docker
npm run test:container:podman
```

Expected: all ordinary suites pass; each actually provisioned runtime passes its enforcement integration. Record absent runtimes explicitly in the final verification report.

- [ ] **Step 6: Run the root suite a second time under normal parallel load**

Run: `npx vitest run`

Expected: PASS twice consecutively; real-process tests use their explicit scale-aware budgets.

- [ ] **Step 7: Commit**

```powershell
git add scripts theia-extensions/mission-control theia-app .github README.md package.json package-lock.json
git commit -m "test(execution): prove packaged agent sessions end to end"
```

---

## Final Review Gate

- [ ] Confirm every spec acceptance criterion maps to Tasks 1-13.
- [ ] Confirm no code path enables persistent shells, secrets, network, arbitrary mounts, native fallback, remote engines, stdin, TTY, or runtime flags.
- [ ] Confirm `mission-control.v1` still rejects executable and argument arrays.
- [ ] Confirm only `MissionAuthority` mutates mission state and only daemon-owned services inspect/promote Git state.
- [ ] Confirm image/command approvals require the pinned Electron signer and durable single-use spending.
- [ ] Confirm every `ENFORCED` claim is backed by adapter inspection plus a provisioned-runtime integration test.
- [ ] Confirm generated files were produced only by repository scripts and the final diff contains no credentials, host paths, runtime IDs, or build artifacts outside existing tracked outputs.
