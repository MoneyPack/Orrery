import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMissionStore } from "./file-mission-store";
import {
  buildTelemetryProjection,
  loadTelemetryProjection,
  queryBlockedMissions,
  querySlowApprovals,
  readProjectionFile,
  type TelemetryProjection,
} from "./telemetry-projection";
import type { MissionEventRecord, MissionSnapshot } from "./authority-types";
import type { Mission } from "@orrery/mission-control-domain";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function stateDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "orrery-telemetry-"));
  directories.push(directory);
  return directory;
}

function baseMission(id: string, status: Mission["status"]): MissionSnapshot {
  return {
    id,
    title: `Mission ${id}`,
    goal: "Telemetry fixture",
    mode: "build",
    status,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
    targetBranch: "main",
    plan: {
      id: "plan-1",
      revision: 1,
      approved: true,
      createdAt: "2026-10-20T00:00:00.000Z",
      scope: "scope",
      actions: ["act"],
      acceptanceCriteria: ["done"],
    },
    events: [],
    changes: [],
    evidence: [],
    repositoryId: "repository-1",
    fingerprint: "sha256:fixture",
    lastEventSequence: 0,
    payloadVersion: 1,
  };
}

function record(missionId: string, sequence: number, timestamp: string, kind: MissionEventRecord["kind"], extra: Partial<MissionEventRecord> = {}): MissionEventRecord {
  return {
    id: `${missionId}-event-${sequence}`,
    missionId,
    runId: "run-1",
    sequence,
    timestamp,
    kind,
    title: `${kind} ${sequence}`,
    detail: `${kind} detail ${sequence}`,
    payloadVersion: 1,
    recordedAt: timestamp,
    ...extra,
  };
}

function capabilityEvent(missionId: string, sequence: number, timestamp: string, requestId = "request-1"): MissionEventRecord {
  return record(missionId, sequence, timestamp, "capability_request", {
    title: "Network access requested",
    detail: "registry.npmjs.org",
    capability: { requestId, runId: "run-1", capability: "network", scope: "registry.npmjs.org", reason: "check metadata" },
  });
}

async function seed(directory: string, snapshot: MissionSnapshot, events: readonly MissionEventRecord[]) {
  const store = new FileMissionStore(directory);
  await store.create(snapshot);
  if (events.length > 0) {
    await store.save({ ...snapshot, status: snapshot.status, events: [...events], lastEventSequence: events.length }, [...events]);
  }
}

const NOW = "2026-10-28T00:00:00.000Z";

describe("telemetry projection", () => {
  it("answers missions blocked last week from capability and interruption signals", async () => {
    const directory = await stateDirectory();
    await seed(directory, { ...baseMission("mission-blocked", "blocked"), updatedAt: "2026-10-25T12:00:00.000Z" }, [
      capabilityEvent("mission-blocked", 1, "2026-10-21T10:00:00.000Z"),
      record("mission-blocked", 2, "2026-10-21T10:00:30.000Z", "verification"),
    ]);
    await seed(directory, { ...baseMission("mission-stale", "ready_for_review"), updatedAt: "2026-10-26T00:00:00.000Z" }, [
      capabilityEvent("mission-stale", 1, "2026-10-10T10:00:00.000Z"),
      record("mission-stale", 2, "2026-10-10T10:00:05.000Z", "completion"),
    ]);
    await seed(directory, baseMission("mission-quiet", "running"), []);

    const projection = await buildTelemetryProjection(directory, () => NOW);
    const blocked = queryBlockedMissions(projection, { windowMs: 7 * 24 * 60 * 60 * 1000, now: NOW });

    expect(blocked.map((entry) => entry.missionId)).toEqual(["mission-blocked"]);
    expect(blocked[0]).toMatchObject({ status: "blocked", recovered: false });
  });

  it("marks recovered missions and excludes out-of-window signals", async () => {
    const directory = await stateDirectory();
    await seed(directory, { ...baseMission("mission-recovered", "ready_for_review"), updatedAt: "2026-10-26T00:00:00.000Z" }, [
      capabilityEvent("mission-recovered", 1, "2026-10-25T09:00:00.000Z"),
      record("mission-recovered", 2, "2026-10-25T09:00:04.000Z", "completion"),
    ]);
    const projection = await buildTelemetryProjection(directory, () => NOW);
    const blocked = queryBlockedMissions(projection, { now: NOW });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ missionId: "mission-recovered", recovered: true });
  });

  it("answers approvals slower than 10s and ignores in-place-only resolutions", async () => {
    const directory = await stateDirectory();
    await seed(directory, { ...baseMission("mission-slow", "running"), updatedAt: "2026-10-26T00:00:00.000Z" }, [
      capabilityEvent("mission-slow", 1, "2026-10-26T00:00:00.000Z", "slow"),
      record("mission-slow", 2, "2026-10-26T00:00:45.000Z", "execution"),
    ]);
    await seed(directory, { ...baseMission("mission-fast", "running"), updatedAt: "2026-10-26T00:00:00.000Z" }, [
      capabilityEvent("mission-fast", 1, "2026-10-26T00:00:00.000Z", "fast"),
      record("mission-fast", 2, "2026-10-26T00:00:04.000Z", "execution"),
    ]);
    await seed(directory, { ...baseMission("mission-inplace", "running"), updatedAt: "2026-10-26T00:00:00.000Z" }, [
      { ...capabilityEvent("mission-inplace", 1, "2026-10-25T00:00:00.000Z", "inplace"),
        capability: { requestId: "inplace", runId: "run-1", capability: "network", scope: "s", reason: "r", resolved: "allowed" } },
    ]);

    const projection = await buildTelemetryProjection(directory, () => NOW);
    const slow = querySlowApprovals(projection, { thresholdMs: 10_000, now: "2026-10-26T00:01:00.000Z" });

    expect(slow.map((entry) => entry.requestId)).toEqual(["slow"]);
    expect(slow[0]).toMatchObject({ missionId: "mission-slow", latencyMs: 45_000, pending: false });
  });

  it("flags still-pending approvals whose wait already exceeds the threshold", async () => {
    const directory = await stateDirectory();
    await seed(directory, { ...baseMission("mission-pending", "blocked"), updatedAt: "2026-10-26T00:00:00.000Z" }, [
      capabilityEvent("mission-pending", 1, "2026-10-26T00:00:00.000Z", "pending"),
    ]);
    const projection = await buildTelemetryProjection(directory, () => NOW);
    const slow = querySlowApprovals(projection, { thresholdMs: 10_000, now: "2026-10-26T00:01:00.000Z" });
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatchObject({ requestId: "pending", pending: true, waitingMs: 60_000 });
  });

  it("rebuilds the projection and reuses a fresh cache", async () => {
    const directory = await stateDirectory();
    await seed(directory, baseMission("mission-cache", "running"), []);
    const cachePath = join(directory, "custom-cache", "projection.json");

    const first = await loadTelemetryProjection(directory, { projectionPath: cachePath, now: () => NOW });
    expect(first.fromCache).toBe(false);
    const cached: TelemetryProjection = await readProjectionFile(cachePath);
    expect(cached.missions.map((mission) => mission.id)).toEqual(["mission-cache"]);

    const second = await loadTelemetryProjection(directory, { projectionPath: cachePath });
    expect(second.fromCache).toBe(true);
    expect(second.projection.builtAt).toBe(NOW);
  });

  it("rebuilds when the cache is stale or corrupt", async () => {
    const directory = await stateDirectory();
    await seed(directory, baseMission("mission-a", "running"), []);
    const cachePath = join(directory, "custom-cache", "projection.json");
    await loadTelemetryProjection(directory, { projectionPath: cachePath, now: () => NOW });

    await seed(directory, baseMission("mission-b", "blocked"), []);
    const stale = await loadTelemetryProjection(directory, { projectionPath: cachePath });
    expect(stale.fromCache).toBe(false);
    expect(stale.projection.missions.map((mission) => mission.id).sort()).toEqual(["mission-a", "mission-b"]);
  });
});
