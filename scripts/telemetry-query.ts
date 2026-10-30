import { resolve } from "node:path";
import { createRuntimeDirectory } from "./daemon-lifecycle";
import {
  DEFAULT_BLOCKED_WINDOW_MS,
  DEFAULT_SLOW_APPROVAL_THRESHOLD_MS,
  loadTelemetryProjection,
  queryBlockedMissions,
  querySlowApprovals,
  type BlockedMission,
  type SlowApproval,
} from "../packages/mission-control-daemon/src/telemetry-projection";

export interface TelemetryQueryResult {
  readonly command: string;
  readonly stateDirectory: string;
  readonly fromCache: boolean;
  readonly blocked: readonly BlockedMission[];
  readonly slowApprovals: readonly SlowApproval[];
}

interface ParsedQuery {
  command: string;
  stateDirectory?: string;
  rebuild: boolean;
  json: boolean;
  windowMs: number;
  thresholdMs: number;
  now?: string;
}

const QUERY_USAGE = [
  "Usage: telemetry:query <blocked-last-week | slow-approvals> [options]",
  "",
  "Options:",
  "  --state-dir <path>     Query a state directory instead of the daemon runtime.",
  "  --rebuild              Ignore the projection cache and rebuild from JSONL.",
  "  --json                 Emit machine-readable JSON.",
  "  --window-days <n>      Blocked query window in days (default 7).",
  "  --threshold-ms <n>     Slow-approval threshold in ms (default 10000).",
  "  --now <iso-timestamp>  Reference time (default: current time).",
].join("\n");

function fail(message: string): never {
  throw new Error(`${message}\n\n${QUERY_USAGE}`);
}

function positiveNumber(raw: string | undefined, label: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be a non-negative number.`);
  return value;
}

export function parseTelemetryQueryArgs(args: readonly string[], env: NodeJS.ProcessEnv = process.env): ParsedQuery {
  const [command, ...rest] = args;
  if (command !== "blocked-last-week" && command !== "slow-approvals") fail(`Unknown telemetry query: ${command ?? "(none)"}.`);
  const parsed: { stateDirectory?: string; rebuild: boolean; json: boolean; windowDays?: string; thresholdMs?: string; now?: string } = {
    rebuild: false,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--rebuild") parsed.rebuild = true;
    else if (flag === "--json") parsed.json = true;
    else if (flag === "--state-dir") parsed.stateDirectory = rest[(index += 1)] ?? fail("--state-dir requires a path.");
    else if (flag === "--window-days") parsed.windowDays = rest[(index += 1)] ?? fail("--window-days requires a value.");
    else if (flag === "--threshold-ms") parsed.thresholdMs = rest[(index += 1)] ?? fail("--threshold-ms requires a value.");
    else if (flag === "--now") parsed.now = rest[(index += 1)] ?? fail("--now requires a timestamp.");
    else fail(`Unknown option: ${flag}.`);
  }
  const now = parsed.now ?? env.ORRERY_TELEMETRY_NOW;
  if (now !== undefined && !Number.isFinite(Date.parse(now))) fail("--now must be a valid ISO timestamp.");
  return {
    command,
    ...(parsed.stateDirectory ? { stateDirectory: parsed.stateDirectory } : {}),
    rebuild: parsed.rebuild,
    json: parsed.json,
    windowMs: positiveNumber(parsed.windowDays, "--window-days", DEFAULT_BLOCKED_WINDOW_MS / 86_400_000) * 86_400_000,
    thresholdMs: positiveNumber(parsed.thresholdMs, "--threshold-ms", DEFAULT_SLOW_APPROVAL_THRESHOLD_MS),
    ...(now ? { now } : {}),
  };
}

export async function runTelemetryQuery(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<TelemetryQueryResult> {
  const parsed = parseTelemetryQueryArgs(args, env);
  const stateDirectory = parsed.stateDirectory ?? await createRuntimeDirectory();
  const { projection, fromCache } = await loadTelemetryProjection(resolve(stateDirectory), {
    ...(parsed.rebuild ? { rebuild: true as const } : {}),
  });
  const reference = parsed.now ?? new Date().toISOString();
  const blocked = parsed.command === "blocked-last-week"
    ? queryBlockedMissions(projection, { windowMs: parsed.windowMs, now: reference })
    : [];
  const slowApprovals = parsed.command === "slow-approvals"
    ? querySlowApprovals(projection, { thresholdMs: parsed.thresholdMs, now: reference })
    : [];
  return { command: parsed.command, stateDirectory: projection.stateDirectory, fromCache, blocked, slowApprovals };
}

function formatLatency(entry: Pick<SlowApproval, "latencyMs" | "waitingMs" | "pending">): string {
  if (entry.latencyMs !== undefined) return `${(entry.latencyMs / 1000).toFixed(1)}s resolved`;
  if (entry.pending) return `${((entry.waitingMs ?? 0) / 1000).toFixed(1)}s waiting`;
  return "unknown latency";
}

export function formatTelemetryQuery(result: TelemetryQueryResult, options: { json: boolean }): string {
  if (options.json) return `${JSON.stringify(result, null, 2)}\n`;
  const lines: string[] = [
    `# telemetry:query ${result.command}`,
    `state: ${result.stateDirectory}${result.fromCache ? " (projection cache)" : " (rebuilt from JSONL)"}`,
    "",
  ];
  if (result.command === "blocked-last-week") {
    if (result.blocked.length === 0) lines.push("No missions blocked in the window.");
    for (const entry of result.blocked) {
      lines.push(`- ${entry.missionId} [${entry.status}] blocked at ${entry.blockedAt}${entry.recovered ? " (recovered)" : ""}`);
      lines.push(`  ${entry.title}`);
      lines.push(`  reason: ${entry.reason}`);
    }
  } else {
    if (result.slowApprovals.length === 0) lines.push("No approvals slower than the threshold.");
    for (const entry of result.slowApprovals) {
      lines.push(`- ${entry.missionId}/${entry.requestId} (${entry.capability}) ${formatLatency(entry)}`);
      lines.push(`  requested at ${entry.requestedAt}${entry.resolvedAt ? `, resolved at ${entry.resolvedAt}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function main(args: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const parsed = parseTelemetryQueryArgs(args, env);
  const result = await runTelemetryQuery(args, env);
  process.stdout.write(formatTelemetryQuery(result, { json: parsed.json }));
}

if (process.env.npm_lifecycle_event === "telemetry:query") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
