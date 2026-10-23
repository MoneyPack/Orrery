import type { Mission } from "@orrery/mission-control-domain";
import type {
  ChangeSnapshot,
  MissionRepository,
  MissionWorkspace,
  RunMissionInput,
  RunMissionResult,
  WorkspaceService,
} from "../../mission-kernel/src";
import { MissionRunner, PromotionService } from "../../mission-kernel/src";
import { describe, expect, it, vi } from "vitest";
import type { MissionEventStore, MissionStore, RepositoryRegistry } from "./authority-ports";
import type { ApprovedRepository, MissionEventRecord, MissionSnapshot } from "./authority-types";
import { MissionAuthority } from "./mission-authority";
import { PinnedApprovalVerifier, TrustedApprovalService } from "./promotion-approval";
import { digestReviewContent } from "./review-content";

const repository: ApprovedRepository = {
  repositoryId: "repository-1",
  canonicalRoot: "C:/approved/repository",
  fingerprint: "sha256:approved",
  gitIdentity: "git-identity",
  approvedAt: "2026-08-28T10:00:00.000Z",
  lastVerifiedAt: "2026-08-28T10:00:00.000Z",
  payloadVersion: 1,
};

const workspace: MissionWorkspace = {
  id: "workspace-1",
  missionId: "mission-1",
  repositoryRoot: repository.canonicalRoot,
  worktreePath: "C:/daemon/worktrees/mission-1",
  targetBranch: "main",
  missionBranch: "orrery/mission-1",
  initialRevision: "target-1",
};

const changes: ChangeSnapshot = {
  revision: "change-1",
  files: [{ path: "change.txt", additions: 1, deletions: 0, binary: false, diff: "+change" }],
  unifiedDiff: "+change",
};
const contentDigestFor = (mission: MissionSnapshot) => digestReviewContent({ changes: changes.files, evidence: mission.evidence.filter((item) => item.planRevisionId === mission.plan.id) });

function setup(now: () => string = () => "2026-08-28T11:00:00.000Z") {
  const snapshots = new Map<string, MissionSnapshot>();
  const records = new Map<string, MissionEventRecord[]>();
  const listeners = new Map<string, Set<(event: MissionEventRecord) => void>>();
  const order: string[] = [];
  const saveMission: MissionStore["save"] = async (snapshot, events) => {
    snapshots.set(snapshot.id, structuredClone(snapshot));
    const history = records.get(snapshot.id) ?? [];
    history.push(...structuredClone(events));
    records.set(snapshot.id, history);
    order.push(`persist:${snapshot.status}`);
    for (const event of events) { order.push(`publish:${event.kind}`); for (const listener of listeners.get(snapshot.id) ?? []) listener(structuredClone(event)); }
  };
  const missionStore: MissionStore = {
    create: async (snapshot) => {
      if (snapshots.has(snapshot.id)) throw new Error("exists");
      snapshots.set(snapshot.id, structuredClone(snapshot));
      order.push("persist:create");
    },
    load: async (id) => structuredClone(snapshots.get(id) ?? null),
    list: async () => structuredClone([...snapshots.values()]),
    save: saveMission,
  };
  const eventStore: MissionEventStore = {
    append: async () => { throw new Error("authority must commit events through MissionStore.save"); },
    readAfter: async (missionId, sequence) => structuredClone((records.get(missionId) ?? []).filter((event) => event.sequence > sequence)),
    subscribe: (missionId, listener) => {
      const group = listeners.get(missionId) ?? new Set();
      group.add(listener);
      listeners.set(missionId, group);
      return { unsubscribe: () => group.delete(listener) };
    },
  };
  const registry: RepositoryRegistry = {
    propose: async () => { throw new Error("not used"); },
    approve: async () => { throw new Error("not used"); },
    resolve: vi.fn(async (repositoryId) => {
      if (repositoryId !== repository.repositoryId) throw new Error("not approved");
      return repository;
    }),
  };
  const workspaceService: WorkspaceService = {
    createMissionWorkspace: async () => workspace,
    removeMissionWorkspace: async () => undefined,
    inspectChanges: vi.fn(async () => changes),
    preparePromotion: async () => { throw new Error("not used"); },
    promote: async () => ({ status: "promoted", revision: "target-2" }),
    promoteRetry: async () => { throw new Error("not used"); },
  };
  const run = vi.fn<(input: RunMissionInput) => Promise<RunMissionResult>>();
  const missionRunner = { run } as unknown as MissionRunner;
  const preparePromotion = vi.fn(async (input: { decision: "accepted" | "rejected" }) => input.decision === "rejected"
    ? ({ status: "rejected" as const })
    : ({ status: "prepared" as const, token: {
        missionRevision: "mission-revision",
        expectedTargetRevision: workspace.initialRevision,
        targetBranch: workspace.targetBranch,
        workspace,
        missionParent: workspace.initialRevision,
        missionTree: "mission-tree",
      } }));
  const commitPromotion = vi.fn(async () => ({ status: "promoted" as const, revision: "target-2" }));
  const reconcilePromotion = vi.fn<() => Promise<import("../../mission-kernel/src").PromotionReconciliation>>(async () => ({ status: "pending" }));
  const promote = vi.fn(async () => ({ status: "promoted" as const, revision: "target-2" }));
  const promotionService = { promote, preparePromotion, commitPromotion, reconcilePromotion } as unknown as PromotionService;
  let nextId = 0;
  const approvals = new TrustedApprovalService({
    now,
    id: () => `approval-${++nextId}`,
  });
  const authority = new MissionAuthority({
    missionStore,
    eventStore,
    repositoryRegistry: registry,
    missionRunner,
    promotionService,
    workspaceService,
    verificationCommandResolver: async () => ({ executable: "npm", args: ["test"] }),
    promotionApprovalVerifier: new PinnedApprovalVerifier(approvals.approvalKey, { now }),
    now,
    id: () => `generated-${++nextId}`,
  });
  const createInput = {
    intentId: "intent-create",
    repositoryId: repository.repositoryId,
    title: "Authoritative mission",
    goal: "Run only through the daemon",
    mode: "build" as const,
    plan: { scope: "authority", actions: ["run"], acceptanceCriteria: ["persisted"] },
  };
  return { approvals, authority, commitPromotion, createInput, eventStore, missionStore, order, preparePromotion, promote, reconcilePromotion, registry, run, snapshots, workspaceService, saveMission };
}

async function createReady(setupResult: ReturnType<typeof setup>) {
  const created = await setupResult.authority.create(setupResult.createInput);
  const ready: MissionSnapshot = {
    ...created,
    status: "ready_for_review",
    workspaceId: workspace.id,
    missionBranch: workspace.missionBranch,
    plan: { ...created.plan, approved: true },
    evidence: [{ id: "evidence-1", kind: "diagnostic", status: "passed", summary: "verified", planRevisionId: created.plan.id, timestamp: created.updatedAt }],
    completionSummary: "ready",
    currentWorkspace: { ...workspace, missionId: created.id },
    currentChangeSnapshot: changes,
  };
  setupResult.snapshots.set(created.id, ready);
  return ready;
}

describe("MissionAuthority crash recovery", () => {
  it("reconciles an in_progress run without durable outcome to a blocked mission and allows a fresh intent to requeue", async () => {
    const context = setup();
    const created = await context.authority.create(context.createInput);
    context.run.mockImplementation(async () => new Promise(() => undefined));
    const intent = { intentId: "run-crashed", missionId: created.id, planRevisionId: created.plan.id };

    const crashed = context.authority.run(intent);
    await vi.waitFor(() => expect(context.run).toHaveBeenCalledTimes(1));
    void crashed.catch(() => undefined);
    const durable = context.snapshots.get(created.id)!;
    const crashedOperation = durable.operations![intent.intentId];
    expect(crashedOperation).toMatchObject({ operation: "run", state: "in_progress" });
    const crashedRunId = (crashedOperation as Extract<typeof crashedOperation, { operation: "run" }>).runId;

    const restarted = setup();
    restarted.snapshots.set(created.id, structuredClone(durable));

    await expect(restarted.authority.run(intent)).rejects.toThrow(/interrupted/i);

    const recovered = restarted.snapshots.get(created.id)!;
    expect(recovered).toMatchObject({ status: "blocked" });
    expect(recovered.activeRunId).toBeUndefined();
    expect(recovered.completionSummary).toMatch(/interrupted/i);
    expect(recovered.operations![intent.intentId]).toMatchObject({ operation: "run", state: "interrupted", runId: crashedRunId });
    expect(recovered.events).toEqual([expect.objectContaining({ kind: "interruption", sequence: 1 })]);
    expect(restarted.run).not.toHaveBeenCalled();

    restarted.run.mockImplementation(async (input) => ({
      missionId: created.id,
      runId: input.runId,
      planRevisionId: created.plan.id,
      status: "ready_for_review",
      mission: { ...input.mission, status: "ready_for_review", activeRunId: undefined } as Mission,
      workspace: { ...workspace, missionId: created.id },
      changeSnapshot: changes,
    }));
    const fresh = await restarted.authority.run({ intentId: "run-after-recovery", missionId: created.id, planRevisionId: created.plan.id });

    expect(fresh.status).toBe("ready_for_review");
    expect(fresh.runId).toBe(crashedRunId);
    expect(restarted.run).toHaveBeenCalledTimes(1);
    expect(restarted.snapshots.get(created.id)!.status).toBe("ready_for_review");
  });

  it("reconciles a prepared run claim before the runner starts", async () => {
    const context = setup();
    const created = await context.authority.create(context.createInput);
    const durable = context.snapshots.get(created.id)!;
    context.snapshots.set(created.id, {
      ...durable,
      status: "queued",
      plan: { ...durable.plan, approved: true },
      operations: {
        "run-prepared-crash": {
          operation: "run",
          requestDigest: "f".repeat(64),
          state: "prepared",
          runId: "run-prepared",
        },
      },
    });

    const restarted = setup();
    restarted.snapshots.set(created.id, structuredClone(context.snapshots.get(created.id)!));

    await expect(restarted.authority.run({ intentId: "run-prepared-crash", missionId: created.id, planRevisionId: created.plan.id }))
      .rejects.toThrow(/different request payload/i);

    const recovered = restarted.snapshots.get(created.id)!;
    expect(recovered).toMatchObject({ status: "blocked" });
    expect(recovered.activeRunId).toBeUndefined();
    expect(recovered.operations!["run-prepared-crash"]).toMatchObject({ operation: "run", state: "interrupted", runId: "run-prepared" });
    expect(recovered.events).toEqual([expect.objectContaining({ kind: "interruption", sequence: 1, runId: "run-prepared" })]);

    restarted.run.mockImplementation(async (input) => ({
      missionId: created.id,
      runId: input.runId,
      planRevisionId: created.plan.id,
      status: "ready_for_review",
      mission: { ...input.mission, status: "ready_for_review", activeRunId: undefined } as Mission,
      workspace: { ...workspace, missionId: created.id },
      changeSnapshot: changes,
    }));
    const fresh = await restarted.authority.run({ intentId: "run-prepared-retry", missionId: created.id, planRevisionId: created.plan.id });

    expect(fresh.status).toBe("ready_for_review");
    expect(fresh.runId).toBe("run-prepared");
    expect(restarted.run).toHaveBeenCalledTimes(1);
  });

  it("keeps reconciliation idempotent across repeated requests", async () => {
    const context = setup();
    const created = await context.authority.create(context.createInput);
    context.run.mockImplementation(async () => new Promise(() => undefined));
    const intent = { intentId: "run-crash-twice", missionId: created.id, planRevisionId: created.plan.id };
    const crashed = context.authority.run(intent);
    await vi.waitFor(() => expect(context.run).toHaveBeenCalledTimes(1));
    void crashed.catch(() => undefined);
    const durable = context.snapshots.get(created.id)!;

    const restarted = setup();
    restarted.snapshots.set(created.id, structuredClone(durable));
    await expect(restarted.authority.run(intent)).rejects.toThrow(/interrupted/i);
    const first = restarted.snapshots.get(created.id)!;

    await expect(restarted.authority.run(intent)).rejects.toThrow(/interrupted/i);
    await expect(restarted.authority.inspect({ missionId: created.id, planRevisionId: created.plan.id })).rejects.toThrow(/workspace/i);
    const second = restarted.snapshots.get(created.id)!;

    expect(second).toEqual(first);
    expect(second.events).toHaveLength(1);
  });

  it("finalizes a run whose durable outcome was staged before the crash", async () => {
    const context = setup();
    const created = await context.authority.create(context.createInput);
    context.run.mockImplementation(async (input) => {
      const completed = { ...input.mission, status: "ready_for_review" as const, activeRunId: undefined };
      const result = { missionId: created.id, runId: input.runId, planRevisionId: created.plan.id, status: "ready_for_review" as const, mission: completed, workspace: { ...workspace, missionId: created.id }, changeSnapshot: changes };
      const durable = context.snapshots.get(created.id)!;
      context.snapshots.set(created.id, { ...durable, ...completed, currentWorkspace: result.workspace, currentChangeSnapshot: changes });
      context.missionStore.save = vi.fn(async () => { throw new Error("simulated crash"); });
      return result;
    });
    const intent = { intentId: "run-staged", missionId: created.id, planRevisionId: created.plan.id };

    await expect(context.authority.run(intent)).rejects.toThrow("simulated crash");
    const restarted = setup();
    restarted.snapshots.set(created.id, structuredClone(context.snapshots.get(created.id)!));

    const result = await restarted.authority.run(intent);

    expect(result.status).toBe("ready_for_review");
    expect(restarted.run).not.toHaveBeenCalled();
    expect(restarted.snapshots.get(created.id)!.operations![intent.intentId].state).toBe("committed");
  });

  it("reconciles an in_progress promotion through the kernel retry path after restart", async () => {
    const context = setup();
    const ready = await createReady(context);
    const contentDigest = contentDigestFor(ready);
    const approval = context.approvals.issue({ missionId: ready.id, planRevisionId: ready.plan.id, changeRevision: changes.revision, decision: "accepted", contentDigest });
    const intent = { intentId: "promote-crashed", missionId: ready.id, planRevisionId: ready.plan.id, changeRevision: changes.revision, approvalCapability: approval, decision: "accepted" as const, contentDigest };
    context.commitPromotion.mockRejectedValueOnce(new Error("simulated crash"));

    await expect(context.authority.promote(intent)).rejects.toThrow("simulated crash");
    expect(context.snapshots.get(ready.id)!.operations![intent.intentId]).toMatchObject({ operation: "promote", state: "in_progress" });

    const restarted = setup();
    restarted.snapshots.set(ready.id, structuredClone(context.snapshots.get(ready.id)!));
    restarted.reconcilePromotion.mockResolvedValueOnce({ status: "pending" });
    const result = await restarted.authority.promote(intent);

    expect(result.result.status).toBe("promoted");
    expect(restarted.preparePromotion).not.toHaveBeenCalled();
    expect(restarted.commitPromotion).toHaveBeenCalledTimes(1);
    expect(restarted.snapshots.get(ready.id)!.operations![intent.intentId]).toMatchObject({ operation: "promote", state: "committed" });
  });

  it("closes an expired in_progress promotion across restart and keeps the mission reviewable", async () => {
    let now = "2026-08-28T11:00:00.000Z";
    const context = setup(() => now);
    const ready = await createReady(context);
    const contentDigest = contentDigestFor(ready);
    const approval = context.approvals.issue({ missionId: ready.id, planRevisionId: ready.plan.id, changeRevision: changes.revision, decision: "accepted", contentDigest });
    const intent = { intentId: "promote-expired-crash", missionId: ready.id, planRevisionId: ready.plan.id, changeRevision: changes.revision, approvalCapability: approval, decision: "accepted" as const, contentDigest };
    context.commitPromotion.mockRejectedValueOnce(new Error("simulated crash"));
    await expect(context.authority.promote(intent)).rejects.toThrow("simulated crash");

    now = "2026-08-28T11:01:00.000Z";
    // The restarted authority verifies against the original issuer key, not a fresh one.
    const restarted = setup(() => now);
    restarted.snapshots.set(ready.id, structuredClone(context.snapshots.get(ready.id)!));
    (restarted.authority as unknown as { options: { promotionApprovalVerifier: PinnedApprovalVerifier } }).options.promotionApprovalVerifier =
      new PinnedApprovalVerifier(context.approvals.approvalKey, { now: () => now });

    // The durable in_progress operation is closed as expired before the kernel is re-entered.
    await expect(restarted.authority.promote(intent)).rejects.toThrow(/approval expired/i);

    const recovered = restarted.snapshots.get(ready.id)!;
    expect(recovered.status).toBe("ready_for_review");
    expect(recovered.operations![intent.intentId]).toMatchObject({ operation: "promote", state: "expired" });
    expect(restarted.reconcilePromotion).not.toHaveBeenCalled();
    expect(restarted.commitPromotion).not.toHaveBeenCalled();

    const freshApproval = new TrustedApprovalService({ now: () => now, id: () => "approval-fresh" });
    (restarted.authority as unknown as { options: { promotionApprovalVerifier: PinnedApprovalVerifier } }).options.promotionApprovalVerifier =
      new PinnedApprovalVerifier(freshApproval.approvalKey, { now: () => now });
    const reissued = freshApproval.issue({ missionId: ready.id, planRevisionId: ready.plan.id, changeRevision: changes.revision, decision: "accepted", contentDigest });
    await expect(restarted.authority.promote({ ...intent, intentId: "promote-after-expiry", approvalCapability: reissued })).resolves.toMatchObject({ result: { status: "promoted" } });
  });
});
