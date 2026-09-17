import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SmokeReadiness, SmokeResult } from "./contract";
import { DESKTOP_SMOKE_READY_CHANNEL } from "./channels";
import { isTrustedIpcSender } from "./policy";

export const SMOKE_MODE_FLAG = "--orrery-smoke";
export const SMOKE_RESULT_PREFIX = "--orrery-smoke-result=";

export function isSmokeMode(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Smoke mode activates only from explicit launcher argv flags, never from
 * inherited environment variables. Returns the result path when --orrery-smoke
 * is present, and rejects a dangling --orrery-smoke-result flag.
 */
export function parseSmokeLaunchArgs(argv: readonly string[]): { resultPath: string } | null {
  const smokeRequested = argv.includes(SMOKE_MODE_FLAG);
  const resultArgument = argv.find((argument) => argument.startsWith(SMOKE_RESULT_PREFIX));
  if (!smokeRequested) {
    if (resultArgument !== undefined) {
      throw new Error(`${SMOKE_RESULT_PREFIX}<path> requires ${SMOKE_MODE_FLAG}`);
    }
    return null;
  }
  const resultPath = resultArgument?.slice(SMOKE_RESULT_PREFIX.length);
  if (!resultPath) {
    throw new Error(`${SMOKE_MODE_FLAG} requires ${SMOKE_RESULT_PREFIX}<path>`);
  }
  return { resultPath };
}

export function isValidSmokeReadiness(value: unknown): value is SmokeReadiness {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 &&
    typeof record.desktopRuntimeExists === "boolean" &&
    record.processType === "undefined" &&
    record.requireType === "undefined";
}

export function createSmokeResult(readiness: SmokeReadiness): SmokeResult {
  const checks = {
    desktopRuntimeExists: readiness.desktopRuntimeExists,
    rendererProcessUndefined: readiness.processType === "undefined",
    rendererRequireUndefined: readiness.requireType === "undefined",
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function registerDesktopSmokeIpc(
  ipcMain: IpcMain,
  getRendererUrl: () => string,
  resultPath: string,
  finish: (exitCode: number) => void,
): void {
  ipcMain.removeHandler(DESKTOP_SMOKE_READY_CHANNEL);
  ipcMain.handle(DESKTOP_SMOKE_READY_CHANNEL, async (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!isTrustedIpcSender(event.senderFrame, event.sender.mainFrame, getRendererUrl())) {
      throw new Error("Rejected untrusted desktop smoke IPC request");
    }
    if (!isValidSmokeReadiness(payload)) {
      throw new Error("Rejected invalid desktop smoke readiness payload");
    }

    // Readiness is single-fire: the first accepted payload removes the handler so
    // any repeat invocation rejects before it can rewrite the result.
    ipcMain.removeHandler(DESKTOP_SMOKE_READY_CHANNEL);
    const result = createSmokeResult(payload);
    await mkdir(dirname(resultPath), { recursive: true });
    const temporaryResultPath = `${resultPath}.tmp`;
    await writeFile(temporaryResultPath, `${JSON.stringify(result)}\n`, "utf8");
    await rename(temporaryResultPath, resultPath);
    finish(result.passed ? 0 : 1);
  });
}
