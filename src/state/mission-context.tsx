import { createContext, use, useEffect, useReducer, useRef, type ReactNode } from "react";
import { createFixtureRun, resolveFixtureCapability, type FixtureRun } from "../domain/fixture-runtime";
import {
  createMission,
  transitionMission,
  type CreateMissionInput,
  type Mission,
  type MissionAction,
  type MissionEvent,
  type PlanContent,
} from "../domain/mission";

export const STORAGE_KEY = "orrery.missions.v1";

interface AppState {
  missions: Mission[];
  storageError?: string;
  runtimeError?: string;
}

type AppAction =
  | { type: "create"; input: CreateMissionInput }
  | { type: "mission"; missionId: string; action: MissionAction }
  | { type: "runtime_error"; message?: string }
  | { type: "storage_error"; message?: string }
  | { type: "recover_interrupted" }
  | { type: "reset" };

interface MissionContextValue extends AppState {
  create: (input: CreateMissionInput) => void;
  updatePlan: (missionId: string, plan: PlanContent) => void;
  approvePlan: (missionId: string) => void;
  start: (missionId: string) => Promise<void>;
  cancel: (missionId: string) => void;
  resolveCapability: (missionId: string, runId: string, requestId: string, decision: "allowed" | "denied") => void;
  review: (missionId: string, decision: "accept" | "reject" | "request_revision") => void;
  resetDemo: () => void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

function reducer(state: AppState, action: AppAction): AppState {
  if (action.type === "reset") return { missions: [] };
  if (action.type === "runtime_error") return { ...state, runtimeError: action.message };
  if (action.type === "storage_error") return { ...state, storageError: action.message };
  if (action.type === "recover_interrupted") {
    const missions = state.missions.map(interruptActiveMission);
    if (missions.every((mission, index) => mission === state.missions[index])) return state;
    return { ...state, missions };
  }
  try {
    if (action.type === "create") {
      return { ...state, runtimeError: undefined, missions: [createMission(action.input), ...state.missions] };
    }
    const matches = state.missions.filter((mission) => mission.id === action.missionId).length;
    if (matches !== 1) throw new Error(matches === 0 ? "Mission no longer exists." : "Mission identifier is not unique.");
    const missions = state.missions.map((mission) => {
      if (mission.id !== action.missionId) return mission;
      return transitionMission(mission, action.action);
    });
    return { ...state, runtimeError: undefined, missions };
  } catch (error) {
    return { ...state, runtimeError: error instanceof Error ? error.message : "Mission action failed." };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const MAX_STORAGE_BYTES = 1_000_000;
const MAX_MISSIONS = 100;
const MAX_EVENTS = 5_000;
const MAX_ITEMS = 200;
const MAX_TEXT = 20_000;
const modes = ["explore", "plan", "build", "delegate"] as const;
const statuses = ["draft", "planning", "awaiting_approval", "queued", "running", "paused", "blocked", "ready_for_review", "revision_requested", "accepted", "rejected", "failed", "cancelled"] as const;
const eventKinds = ["workspace", "context", "execution", "capability_request", "capability_resolution", "change", "verification", "completion", "cancellation", "interruption", "fallback", "error"] as const;
const evidenceKinds = ["command", "test", "diagnostic", "screenshot", "log", "manual"] as const;
const evidenceStatuses = ["passed", "failed", "warning", "informational"] as const;
const capabilities = ["network", "dependency", "secret", "destructive", "deployment"] as const;
const resolutions = ["allowed", "denied", "interrupted"] as const;
const reviewDecisions = ["accepted", "rejected", "revision_requested"] as const;
const activeStatuses = new Set(["running", "paused", "blocked"]);
const terminalStatuses = new Set(["accepted", "rejected", "failed", "cancelled"]);
const isEnum = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && allowed.includes(value as T);
const isString = (value: unknown, max = MAX_TEXT): value is string => typeof value === "string" && value.length <= max;
const isTimestamp = (value: unknown): value is string => isString(value, 40) && !Number.isNaN(Date.parse(value));
const isInteger = (value: unknown, max = 1_000_000) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max;
const hasOnly = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const keys = Object.keys(value);
  return required.every((key) => key in value) && keys.every((key) => required.includes(key) || optional.includes(key));
};
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_ITEMS && value.every((item) => isString(item));

function isValidMission(value: unknown): value is Mission {
  if (!isRecord(value) || !isRecord(value.plan)) return false;
  const plan = value.plan;
  if (
    !hasOnly(value, ["id", "title", "goal", "mode", "status", "createdAt", "updatedAt", "targetBranch", "plan", "events", "changes", "evidence"], ["missionBranch", "workspaceId", "completionSummary", "reviewDecision", "activeRunId"]) ||
    !hasOnly(plan, ["id", "revision", "approved", "createdAt", "scope", "actions", "acceptanceCriteria"]) ||
    !isEnum(value.mode, modes) || !isEnum(value.status, statuses) ||
    !isString(value.id, 100) || !isString(value.title, 300) || !isString(value.goal) ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
    !isString(value.targetBranch) || !isString(plan.id) || !isString(plan.scope) ||
    !isInteger(plan.revision, 100_000) || Number(plan.revision) < 1 || typeof plan.approved !== "boolean" ||
    !isTimestamp(plan.createdAt) || !isStringArray(plan.actions) || !isStringArray(plan.acceptanceCriteria) ||
    !Array.isArray(value.events) || value.events.length > MAX_EVENTS ||
    !Array.isArray(value.changes) || value.changes.length > MAX_ITEMS ||
    !Array.isArray(value.evidence) || value.evidence.length > MAX_ITEMS ||
    (value.missionBranch !== undefined && !isString(value.missionBranch)) ||
    (value.workspaceId !== undefined && !isString(value.workspaceId)) ||
    (value.completionSummary !== undefined && !isString(value.completionSummary)) ||
    (value.reviewDecision !== undefined && !isEnum(value.reviewDecision, reviewDecisions)) ||
    (value.activeRunId !== undefined && !isString(value.activeRunId, 100))
  ) return false;

  const ids = new Set<string>();
  for (let index = 0; index < value.events.length; index += 1) {
    const event = value.events[index];
    if (!isRecord(event) || !hasOnly(event, ["id", "missionId", "runId", "sequence", "timestamp", "kind", "title", "detail"], ["capability"]) ||
      !isString(event.id, 100) || ids.has(event.id) ||
      event.missionId !== value.id || !isString(event.runId) || event.sequence !== index + 1 ||
      !isTimestamp(event.timestamp) || !isEnum(event.kind, eventKinds) || !isString(event.title, 500) || !isString(event.detail)) {
      return false;
    }
    ids.add(event.id);
    if (event.capability !== undefined) {
      if (!isRecord(event.capability) || !hasOnly(event.capability, ["requestId", "runId", "capability", "scope", "reason"], ["resolved"]) ||
        !isString(event.capability.requestId, 100) || event.capability.runId !== event.runId ||
        !isEnum(event.capability.capability, capabilities) || !isString(event.capability.scope) ||
        !isString(event.capability.reason) ||
        (event.capability.resolved !== undefined && !isEnum(event.capability.resolved, resolutions))) return false;
    } else if (event.kind === "capability_request") {
      return false;
    }
  }
  const evidenceIds = new Set<string>();
  const validEvidence = value.evidence.every((item) => {
    if (!isRecord(item) || !hasOnly(item, ["id", "kind", "status", "summary", "planRevisionId", "timestamp"], ["criterion"]) ||
      !isString(item.id, 100) || evidenceIds.has(item.id) || !isEnum(item.kind, evidenceKinds) ||
      !isEnum(item.status, evidenceStatuses) || !isString(item.summary) || !isString(item.planRevisionId, 100) ||
      !isTimestamp(item.timestamp) || (item.criterion !== undefined && !isString(item.criterion))) return false;
    evidenceIds.add(item.id);
    return true;
  });
  const validChanges = value.changes.every((item) => isRecord(item) &&
    hasOnly(item, ["path", "additions", "deletions", "diff"]) && isString(item.path, 1_000) &&
    isInteger(item.additions) && isInteger(item.deletions) && isString(item.diff));
  if (!validEvidence || !validChanges) return false;

  if (["running", "paused"].includes(value.status) !== Boolean(value.activeRunId) && value.status !== "blocked") return false;
  if (value.status === "blocked" && !value.activeRunId && !value.completionSummary?.trim()) return false;
  if (terminalStatuses.has(value.status) && value.activeRunId) return false;
  if (["queued", "running", "paused", "blocked"].includes(value.status) && !plan.approved) return false;
  if (value.status === "ready_for_review" && (!plan.approved || !value.completionSummary?.trim() || !value.evidence.some((item) => item.planRevisionId === plan.id && ["passed", "warning"].includes(item.status)))) return false;
  if (value.status === "accepted" && value.reviewDecision !== "accepted") return false;
  if (value.status === "rejected" && value.reviewDecision !== "rejected") return false;
  return true;
}

function interruptActiveMission(mission: Mission): Mission {
  if (!activeStatuses.has(mission.status) || !mission.activeRunId) return mission;
  const timestamp = new Date().toISOString();
  const runId = mission.activeRunId!;
  return {
    ...mission,
    status: "blocked",
    activeRunId: undefined,
    completionSummary: "Execution was interrupted by an application reload. Cancel safely or revise the plan and requeue.",
    updatedAt: timestamp,
    events: [
      ...mission.events.map((event) => event.runId === runId && event.kind === "capability_request" && !event.capability?.resolved
        ? { ...event, capability: { ...event.capability!, resolved: "interrupted" as const } }
        : event),
      { id: crypto.randomUUID(), missionId: mission.id, runId, sequence: mission.events.length + 1, timestamp, kind: "interruption", title: "Run interrupted", detail: "The application reloaded while this run was active." },
    ],
  };
}

const CURRENT_VERSION = 1;
// Persisted payloads carry a `version` field. Future schema changes bump the field, never
// STORAGE_KEY, so older builds fail gracefully with a clear error instead of misreading data.
const MIGRATIONS: Record<number, (data: { missions: unknown[] }) => { missions: unknown[] }> = {
  1: (data) => data,
};

function migratePersisted(parsed: { version: number; missions: unknown[] }): { missions: unknown[] } {
  if (parsed.version > CURRENT_VERSION) {
    throw new Error(`Persisted mission state version ${parsed.version} is newer than this build understands (${CURRENT_VERSION}).`);
  }
  let data: { missions: unknown[] } = { missions: parsed.missions };
  for (let version = parsed.version; version <= CURRENT_VERSION; version += 1) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`Persisted mission state version ${parsed.version} requires a migration this build does not provide (stopped at version ${version}).`);
    }
    data = migrate(data);
  }
  return data;
}

function quarantineCorruptState(storage: Storage) {
  try {
    const corrupt = storage.getItem(STORAGE_KEY);
    if (corrupt === null) return;
    storage.setItem(`${STORAGE_KEY}.corrupt.${new Date().toISOString()}`, corrupt);
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Quarantine is best-effort; the surfaced storage error is the primary signal.
  }
}

function loadState(storage: Storage): AppState {
  const serialized = storage.getItem(STORAGE_KEY);
  if (!serialized) return { missions: [] };
  try {
    if (serialized.length > MAX_STORAGE_BYTES) throw new Error("Persisted state exceeds the size limit.");
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || !hasOnly(parsed, ["version", "missions"]) || !isInteger(parsed.version) ||
      Number(parsed.version) < 1 || !Array.isArray(parsed.missions)) {
      throw new Error("Invalid persisted mission schema or event log integrity.");
    }
    const migrated = migratePersisted(parsed as { version: number; missions: unknown[] });
    if (migrated.missions.length > MAX_MISSIONS || !migrated.missions.every(isValidMission) ||
      new Set(migrated.missions.map((mission) => mission.id)).size !== migrated.missions.length) {
      throw new Error("Invalid persisted mission schema or event log integrity.");
    }
    return { missions: migrated.missions as Mission[] };
  } catch (error) {
    quarantineCorruptState(storage);
    return {
      missions: [],
      storageError: `Stored mission data is corrupt or invalid. Reset local data to recover. ${error instanceof Error ? error.message : ""}`.trim(),
    };
  }
}

interface ActiveRun {
  run: FixtureRun;
  nextSignalSequence: number;
  nextEventSequence: number;
}

export function MissionProvider({
  children,
  runtimeDelay,
  storage = window.localStorage,
}: {
  children: ReactNode;
  runtimeDelay?: number;
  storage?: Storage;
}) {
  const [state, dispatch] = useReducer(reducer, storage, loadState);
  const activeRuns = useRef(new Map<string, ActiveRun>());
  // Mirror for async loops (start/cancel/resolveCapability) that need current state outside
  // render. Assigning during render is the accepted pattern here; the reducer is only ever
  // advanced through dispatch, never invoked manually.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Snapshot of what storage holds: the initializer reads storage synchronously, so the first
  // persistence pass would only echo the load and is skipped. When the payload was corrupt,
  // loadState quarantines it and storage no longer matches state, so no write happens either.
  const persistedRef = useRef(state.missions);
  // Set by resetDemo so the reset transition clears storage instead of writing an empty payload.
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    if (persistedRef.current === state.missions) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      persistedRef.current = state.missions;
      return;
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: CURRENT_VERSION, missions: state.missions }));
      persistedRef.current = state.missions;
    } catch (error) {
      dispatch({
        type: "storage_error",
        message: `Mission state could not be saved to local storage. ${
          error instanceof Error ? error.message : "Storage is unavailable."
        }`,
      });
    }
  }, [state.missions, storage]);

  // Recover runs that were active when the app last reloaded. loadState stays side-effect
  // free; the interruption is a pure reducer transition, persisted by the effect above.
  useEffect(() => {
    dispatch({ type: "recover_interrupted" });
  }, []);

  useEffect(() => () => {
    for (const active of activeRuns.current.values()) active.run.cancel();
    activeRuns.current.clear();
  }, []);

  const reportRuntimeError = (message?: string) => dispatch({ type: "runtime_error", message });
  const actOnMission = (missionId: string, action: MissionAction) =>
    dispatch({ type: "mission", missionId, action });

  const start = async (missionId: string) => {
    if (activeRuns.current.has(missionId)) return;
    const mission = stateRef.current.missions.find((item) => item.id === missionId);
    if (!mission || mission.status !== "queued") {
      reportRuntimeError(mission ? `Cannot start while mission is ${mission.status}.` : "Mission no longer exists.");
      return;
    }
    if (!mission.plan.approved) {
      reportRuntimeError("Cannot start without an approved plan.");
      return;
    }
    if (mission.mode !== "build") {
      reportRuntimeError("Only Build mode can run the Milestone 0 local fixture. Delegate is not supported yet.");
      return;
    }

    const workspaceId = `fixture-workspace-${crypto.randomUUID()}`;
    const run = createFixtureRun(missionId, {
      delay: runtimeDelay,
      workspaceId,
      plan: mission.plan,
      planRevisionId: mission.plan.id,
    });
    activeRuns.current.set(missionId, {
      run,
      nextSignalSequence: 1,
      nextEventSequence: mission.events.length + 1,
    });

    try {
      for await (const signal of run.signals) {
        const active = activeRuns.current.get(missionId);
        if (
          !active ||
          active.run.runId !== signal.runId ||
          signal.sequence !== active.nextSignalSequence
        ) continue;
        active.nextSignalSequence += 1;
        const event = { ...signal.event, sequence: active.nextEventSequence };
        active.nextEventSequence += 1;
        actOnMission(missionId, { type: "append_event", runId: signal.runId, event });
        if (signal.type === "change") {
          actOnMission(missionId, { type: "observe_change", runId: signal.runId, change: signal.change });
        } else if (signal.type === "evidence") {
          actOnMission(missionId, {
            type: "record_evidence",
            runId: signal.runId,
            evidence: signal.evidence,
          });
        } else if (signal.type === "complete") {
          actOnMission(missionId, { type: "complete", runId: signal.runId, summary: signal.summary });
          activeRuns.current.delete(missionId);
        }
      }
    } catch (error) {
      const isOwned = activeRuns.current.get(missionId)?.run.runId === run.runId;
      activeRuns.current.delete(missionId);
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isOwned) {
        const reason = error instanceof Error ? error.message : "Fixture runtime failed.";
        actOnMission(missionId, { type: "fail", runId: run.runId, reason });
        reportRuntimeError(reason);
      }
    }
  };

  const cancel = (missionId: string) => {
    const active = activeRuns.current.get(missionId);
    if (!active) {
      const interrupted = stateRef.current.missions.find((mission) => mission.id === missionId);
      if (interrupted?.status === "blocked" && !interrupted.activeRunId) {
        const runId = [...interrupted.events].reverse().find((event) => event.kind === "interruption")?.runId;
        if (runId) {
          const event: MissionEvent = {
            id: crypto.randomUUID(), missionId, runId, sequence: interrupted.events.length + 1,
            timestamp: new Date().toISOString(), kind: "cancellation", title: "Run cancelled", detail: "Cancelled by the user after recovery.",
          };
          actOnMission(missionId, { type: "cancel", runId, event });
          return;
        }
        reportRuntimeError("The interrupted run identity is missing.");
        return;
      }
      reportRuntimeError("This mission has no active run.");
      return;
    }
    activeRuns.current.delete(missionId);
    active.run.cancel();
    const event: MissionEvent = {
      id: crypto.randomUUID(),
      missionId,
      runId: active.run.runId,
      sequence: active.nextEventSequence,
      timestamp: new Date().toISOString(),
      kind: "cancellation",
      title: "Run cancelled",
      detail: "Cancelled by the user.",
    };
    actOnMission(missionId, { type: "cancel", runId: active.run.runId, event });
  };

  const value: MissionContextValue = {
    ...state,
    create: (input) => dispatch({ type: "create", input }),
    updatePlan: (missionId, plan) => actOnMission(missionId, { type: "update_plan", plan }),
    approvePlan: (missionId) => actOnMission(missionId, { type: "approve_plan" }),
    start,
    cancel,
    resolveCapability: (missionId, runId, requestId, decision) => {
      const active = activeRuns.current.get(missionId);
      if (!active || active.run.runId !== runId) {
        reportRuntimeError("This capability decision is stale or belongs to another run.");
        return;
      }
      try {
        actOnMission(missionId, { type: "resolve_capability", runId, requestId, decision });
        resolveFixtureCapability(runId, requestId, decision);
      } catch (error) {
        reportRuntimeError(error instanceof Error ? error.message : "Capability resolution failed.");
      }
    },
    review: (missionId, decision) => actOnMission(missionId, { type: decision }),
    resetDemo: () => {
      for (const active of activeRuns.current.values()) active.run.cancel();
      activeRuns.current.clear();
      // Drop the live payload plus any stale corrupt backups quarantined by loadState.
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key && (key === STORAGE_KEY || key.startsWith(`${STORAGE_KEY}.corrupt.`))) storage.removeItem(key);
      }
      persistedRef.current = [];
      skipNextPersistRef.current = true;
      dispatch({ type: "reset" });
    },
  };

  return <MissionContext value={value}>{children}</MissionContext>;
}

export function useMissions() {
  const context = use(MissionContext);
  if (!context) throw new Error("useMissions must be used inside MissionProvider.");
  return context;
}
