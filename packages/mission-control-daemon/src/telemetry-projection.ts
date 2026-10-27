import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathsFor, readEvents, readSnapshotFile } from "./durable-store-files";

/**
 * Telemetry query layer: a rebuildable, pure-JS projection over the JSONL event
 * store. Shape decision (see task report): option (c), a structured JSON index.
 *
 * Why not SQLite here:
 * - `better-sqlite3` is a native module and is not a declared dependency of this
 *   repo (it only resolves from an unrelated hoisted install). Adding it — even
 *   lazily — would introduce a required native build and break
 *   `--ignore-scripts` installs, which the brief forbids.
 * - `node:sqlite` ships with newer Node but is not guaranteed under the Electron
 *   runtime the daemon bundles with, and it would add a second durable format.
 * - A JSON projection keeps JSONL as the single write authority, needs zero new
 *   dependencies, and answers both required questions.
 *
 * Durability contract: this module only ever reads `missions/` and `events/`
 * directories. It never writes to them; the only file it writes is an
 * optional, explicitly-requested projection cache under `<root>/telemetry/`
 * (or at a caller-chosen path).
 */

export const TELEMETRY_PROJECTION_VERSION = 1;
export const DEFAULT_BLOCKED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_SLOW_APPROVAL_THRESHOLD_MS = 10_000;

interface TelemetrySourceEvent {
  readonly missionId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: string;
  readonly title: string;
  readonly detail: string;
  readonly capability?: {
    readonly requestId: string;
    readonly runId: string;
    readonly capability: string;
    readonly resolved?: string;
  };
}

export interface TelemetryApproval {
  readonly missionId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly capability: string;
  readonly requestedAt: string;
  /** Set when a later event in the same mission marks the end of the wait. */
  readonly resolvedAt?: string;
  readonly latencyMs?: number;
  /**
   * True when the request row already carries `capability.resolved` but no
   * later event exists to timestamp the resolution. Resolution happened, but
   * the durable log records no resolution time, so latency is unknown.
   */
  readonly resolvedInPlace: boolean;
}

export interface TelemetryBlockedSignal {
  readonly at: string;
  readonly reason: string;
}

export interface TelemetryMission {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly lastEventSequence: number;
  readonly blockedSignals: readonly TelemetryBlockedSignal[];
  readonly approvals: readonly TelemetryApproval[];
}

export interface TelemetryProjection {
  readonly version: typeof TELEMETRY_PROJECTION_VERSION;
  readonly builtAt: string;
  readonly stateDirectory: string;
  /** `<missionId>:<status>:<updatedAt>:<lastEventSequence>` per mission. */
  readonly fingerprint: string;
  readonly missions: readonly TelemetryMission[];
}

export interface BlockedMission {
  readonly missionId: string;
  readonly title: string;
  readonly status: string;
  readonly blockedAt: string;
  readonly reason: string;
  readonly recovered: boolean;
}

export interface SlowApproval extends TelemetryApproval {
  readonly thresholdMs: number;
  readonly pending: boolean;
  readonly waitingMs?: number;
}

function timestampMs(value: string): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSourceEvent(value: unknown): value is TelemetrySourceEvent {
  if (!isRecord(value)) return false;
  return typeof value.missionId === "string" && typeof value.runId === "string" &&
    Number.isSafeInteger(value.sequence) && typeof value.timestamp === "string" &&
    typeof value.kind === "string" && typeof value.title === "string" && typeof value.detail === "string";
}

function capabilityOf(event: TelemetrySourceEvent): TelemetrySourceEvent["capability"] {
  const capability = event.capability;
  if (!isRecord(capability)) return undefined;
  if (typeof capability.requestId !== "string" || typeof capability.runId !== "string" || typeof capability.capability !== "string") return undefined;
  return {
    requestId: capability.requestId,
    runId: capability.runId,
    capability: capability.capability,
    ...(typeof capability.resolved === "string" ? { resolved: capability.resolved } : {}),
  };
}

async function listMissionIds(stateDirectory: string): Promise<string[]> {
  const missions = pathsFor(stateDirectory).missions;
  let entries;
  try {
    entries = await readdir(missions, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const ids: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) throw new Error(`Corrupt mission snapshot directory: unexpected entry ${entry.name}.`);
    const missionId = entry.name.slice(0, -".json".length);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(missionId)) throw new Error(`Corrupt mission snapshot directory: invalid mission id ${missionId}.`);
    ids.push(missionId);
  }
  return ids;
}

function projectMission(
  missionId: string,
  title: string,
  status: string,
  updatedAt: string,
  lastEventSequence: number,
  events: readonly TelemetrySourceEvent[],
): TelemetryMission {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const blockedSignals: TelemetryBlockedSignal[] = [];
  const approvals: TelemetryApproval[] = [];
  for (const event of ordered) {
    const at = timestampMs(event.timestamp);
    if (at === undefined) continue;
    if (event.kind === "capability_request") {
      const capability = capabilityOf(event);
      if (capability) {
        const resolution = ordered.find((candidate) => candidate.sequence > event.sequence && timestampMs(candidate.timestamp) !== undefined && (Date.parse(candidate.timestamp) >= at));
        approvals.push({
          missionId,
          runId: event.runId,
          requestId: capability.requestId,
          capability: capability.capability,
          requestedAt: event.timestamp,
          ...(resolution ? { resolvedAt: resolution.timestamp, latencyMs: Date.parse(resolution.timestamp) - at } : {}),
          resolvedInPlace: capability.resolved !== undefined && !resolution,
        });
      }
      blockedSignals.push({ at: event.timestamp, reason: `${event.title}: ${event.detail}` });
    } else if (event.kind === "interruption") {
      blockedSignals.push({ at: event.timestamp, reason: `${event.title}: ${event.detail}` });
    }
  }
  if (status === "blocked" && timestampMs(updatedAt) !== undefined) {
    blockedSignals.push({ at: updatedAt, reason: "Mission status is blocked." });
  }
  return { id: missionId, title, status, updatedAt, lastEventSequence, blockedSignals, approvals };
}

/**
 * Rebuilds the projection from the JSONL event logs (falling back to snapshot
 * events when a mission has no log file yet). Always safe to re-run: it is a
 * pure function of durable state.
 */
export async function buildTelemetryProjection(stateDirectory: string, now: () => string = () => new Date().toISOString()): Promise<TelemetryProjection> {
  const root = resolve(stateDirectory);
  const missions: TelemetryMission[] = [];
  for (const missionId of await listMissionIds(root)) {
    let snapshot;
    try {
      snapshot = await readSnapshotFile(join(pathsFor(root).missions, `${missionId}.json`));
    } catch (error) {
      throw new Error(`Cannot project mission ${missionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (snapshot.id !== missionId) throw new Error(`Corrupt mission snapshot filename for ${missionId}.`);
    let events: TelemetrySourceEvent[];
    try {
      const logged = await readEvents(root, missionId);
      const source = logged.length > 0 ? logged : snapshot.events;
      if (!source.every(isSourceEvent)) throw new Error(`Corrupt mission event history for ${missionId}.`);
      events = source;
    } catch (error) {
      throw new Error(`Cannot project mission ${missionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    missions.push(projectMission(snapshot.id, snapshot.title, snapshot.status, snapshot.updatedAt, snapshot.lastEventSequence, events));
  }
  const fingerprint = missions.map((mission) => `${mission.id}:${mission.status}:${mission.updatedAt}:${mission.lastEventSequence}`).join("|");
  return { version: TELEMETRY_PROJECTION_VERSION, builtAt: now(), stateDirectory: root, fingerprint, missions };
}

/** Missions blocked now or blocked at any point inside the window. */
export function queryBlockedMissions(
  projection: TelemetryProjection,
  options: { windowMs?: number; now?: string } = {},
): BlockedMission[] {
  const windowMs = options.windowMs ?? DEFAULT_BLOCKED_WINDOW_MS;
  if (!Number.isFinite(windowMs) || windowMs < 0) throw new Error("Blocked-mission window must be a non-negative finite duration.");
  const nowMs = timestampMs(options.now ?? new Date().toISOString());
  if (nowMs === undefined) throw new Error("Reference time is not a valid timestamp.");
  const cutoff = nowMs - windowMs;
  const blocked: BlockedMission[] = [];
  for (const mission of projection.missions) {
    const qualifying = mission.blockedSignals.filter((signal) => {
      const at = timestampMs(signal.at);
      return at !== undefined && at >= cutoff && at <= nowMs;
    });
    const updatedAtMs = mission.status === "blocked" ? timestampMs(mission.updatedAt) : undefined;
    const currentlyBlockedInWindow = updatedAtMs !== undefined && updatedAtMs >= cutoff && updatedAtMs <= nowMs;
    if (qualifying.length === 0 && !currentlyBlockedInWindow) continue;
    const latest = [...qualifying].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
    const blockedAt = latest?.at ?? mission.updatedAt;
    blocked.push({
      missionId: mission.id,
      title: mission.title,
      status: mission.status,
      blockedAt,
      reason: latest?.reason ?? "Mission status is blocked.",
      recovered: mission.status !== "blocked",
    });
  }
  return blocked.sort((left, right) => left.blockedAt.localeCompare(right.blockedAt)).reverse();
}

/**
 * Capability (operator) approvals whose wait exceeded the threshold. The wait
 * ends at the first later event in the same mission: while a capability
 * request is unresolved the mission is blocked, so the next durable event is
 * the earliest durable evidence that the wait ended. Requests already marked
 * resolved in place with no follow-up event carry no measurable latency and
 * are reported as unknown, never as slow. Still-waiting requests count once
 * their wait so far passes the threshold.
 */
export function querySlowApprovals(
  projection: TelemetryProjection,
  options: { thresholdMs?: number; now?: string } = {},
): SlowApproval[] {
  const thresholdMs = options.thresholdMs ?? DEFAULT_SLOW_APPROVAL_THRESHOLD_MS;
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) throw new Error("Slow-approval threshold must be a non-negative finite duration.");
  const nowMs = timestampMs(options.now ?? new Date().toISOString());
  if (nowMs === undefined) throw new Error("Reference time is not a valid timestamp.");
  const slow: SlowApproval[] = [];
  for (const mission of projection.missions) {
    for (const approval of mission.approvals) {
      const requestedMs = timestampMs(approval.requestedAt);
      if (requestedMs === undefined) continue;
      if (approval.latencyMs !== undefined) {
        if (approval.latencyMs > thresholdMs) slow.push({ ...approval, thresholdMs, pending: false });
      } else if (!approval.resolvedInPlace) {
        const waitingMs = nowMs - requestedMs;
        if (waitingMs > thresholdMs) slow.push({ ...approval, thresholdMs, pending: true, waitingMs });
      }
    }
  }
  return slow.sort((left, right) => (right.latencyMs ?? right.waitingMs ?? 0) - (left.latencyMs ?? left.waitingMs ?? 0));
}

function assertProjection(value: unknown): asserts value is TelemetryProjection {
  if (!isRecord(value) || value.version !== TELEMETRY_PROJECTION_VERSION || typeof value.builtAt !== "string" ||
      typeof value.stateDirectory !== "string" || typeof value.fingerprint !== "string" || !Array.isArray(value.missions) ||
      timestampMs(value.builtAt) === undefined) throw new Error("Corrupt telemetry projection cache.");
  for (const mission of value.missions) {
    if (!isRecord(mission) || typeof mission.id !== "string" || typeof mission.title !== "string" ||
        typeof mission.status !== "string" || typeof mission.updatedAt !== "string" ||
        !Number.isSafeInteger(mission.lastEventSequence) ||
        !Array.isArray(mission.blockedSignals) || !Array.isArray(mission.approvals)) {
      throw new Error("Corrupt telemetry projection cache.");
    }
  }
}

export async function readProjectionFile(path: string): Promise<TelemetryProjection> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read telemetry projection cache: ${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Corrupt telemetry projection cache: invalid JSON.");
  }
  assertProjection(value);
  return value;
}

export async function writeProjectionFile(path: string, projection: TelemetryProjection): Promise<void> {
  assertProjection(projection);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(projection)}\n`, "utf8");
}

/**
 * Loads a cached projection when it exists, validates, and still covers the
 * current durable state; otherwise rebuilds from JSONL and refreshes the
 * cache. The cache is best-effort: any cache failure falls back to a rebuild.
 */
export async function loadTelemetryProjection(
  stateDirectory: string,
  options: { projectionPath?: string; rebuild?: boolean; now?: () => string } = {},
): Promise<{ projection: TelemetryProjection; fromCache: boolean }> {
  const root = resolve(stateDirectory);
  const cachePath = options.projectionPath ?? join(pathsFor(root).root, "telemetry", "projection.json");
  if (!options.rebuild) {
    try {
      const cached = await readProjectionFile(cachePath);
      const fresh = await buildTelemetryProjection(root, options.now);
      if (cached.stateDirectory === root && cached.fingerprint === fresh.fingerprint) {
        return { projection: cached, fromCache: true };
      }
      try {
        await writeProjectionFile(cachePath, fresh);
      } catch {
        // Cache refresh is advisory; the rebuilt projection is still authoritative.
      }
      return { projection: fresh, fromCache: false };
    } catch {
      // Stale, corrupt, or missing cache: rebuild below.
    }
  }
  const projection = await buildTelemetryProjection(root, options.now);
  try {
    await writeProjectionFile(cachePath, projection);
  } catch {
    // Cache refresh is advisory; the rebuilt projection is still authoritative.
  }
  return { projection, fromCache: false };
}
