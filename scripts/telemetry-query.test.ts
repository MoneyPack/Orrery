import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMissionStore } from "../packages/mission-control-daemon/src/file-mission-store";
import type { MissionEventRecord, MissionSnapshot } from "../packages/mission-control-daemon/src/authority-types";
import { formatTelemetryQuery, parseTelemetryQueryArgs, runTelemetryQuery } from "./telemetry-query";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function seedSlowApproval() {
  const directory = await mkdtemp(join(tmpdir(), "orrery-telemetry-cli-"));
  directories.push(directory);
  const store = new FileMissionStore(directory);
  const snapshot: MissionSnapshot = {
    id: "mission-cli",
    title: "CLI fixture",
    goal: "Verify telemetry:query",
    mode: "build",
    status: "blocked",
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:45.000Z",
    targetBranch: "main",
    plan: {
      id: "plan-1", revision: 1, approved: true, createdAt: "2026-10-25T00:00:00.000Z",
      scope: "scope", actions: ["act"], acceptanceCriteria: ["done"],
    },
    events: [],
    changes: [],
    evidence: [],
    repositoryId: "repository-1",
    fingerprint: "sha256:fixture",
    lastEventSequence: 0,
    payloadVersion: 1,
  };
  await store.create(snapshot);
  const events: MissionEventRecord[] = [
    {
      id: "mission-cli-event-1", missionId: "mission-cli", runId: "run-1", sequence: 1,
      timestamp: "2026-10-26T00:00:00.000Z", kind: "capability_request",
      title: "Network access requested", detail: "registry.npmjs.org",
      capability: { requestId: "request-1", runId: "run-1", capability: "network", scope: "registry.npmjs.org", reason: "check metadata" },
      payloadVersion: 1, recordedAt: "2026-10-26T00:00:00.000Z",
    },
    {
      id: "mission-cli-event-2", missionId: "mission-cli", runId: "run-1", sequence: 2,
      timestamp: "2026-10-26T00:00:45.000Z", kind: "execution",
      title: "execution 2", detail: "execution detail 2",
      payloadVersion: 1, recordedAt: "2026-10-26T00:00:45.000Z",
    },
  ];
  await store.save({ ...snapshot, status: "blocked", events: [...events], lastEventSequence: 2 }, [...events]);
  return directory;
}

describe("telemetry:query CLI", () => {
  it("rejects unknown commands and options with usage", () => {
    expect(() => parseTelemetryQueryArgs(["nope"])).toThrow(/Usage: telemetry:query/);
    expect(() => parseTelemetryQueryArgs(["blocked-last-week", "--nope"])).toThrow(/Unknown option/);
  });

  it("answers blocked-last-week from a state directory", async () => {
    const directory = await seedSlowApproval();
    const result = await runTelemetryQuery(["blocked-last-week", "--state-dir", directory, "--rebuild", "--now", "2026-10-27T00:00:00.000Z"], {});
    expect(result.blocked.map((entry) => entry.missionId)).toEqual(["mission-cli"]);
    expect(formatTelemetryQuery(result, { json: false })).toContain("mission-cli");
  });

  it("answers slow-approvals with JSON output", async () => {
    const directory = await seedSlowApproval();
    const result = await runTelemetryQuery(["slow-approvals", "--state-dir", directory, "--now", "2026-10-27T00:00:00.000Z"], {});
    expect(result.slowApprovals.map((entry) => entry.requestId)).toEqual(["request-1"]);
    const parsed = JSON.parse(formatTelemetryQuery(result, { json: true })) as { slowApprovals: { requestId: string }[] };
    expect(parsed.slowApprovals.map((entry) => entry.requestId)).toEqual(["request-1"]);
  });
});
