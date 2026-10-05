import { describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createSmokeResult,
  isSmokeMode,
  isValidSmokeReadiness,
  parseSmokeLaunchArgs,
  registerDesktopSmokeIpc,
  SMOKE_MODE_FLAG,
  SMOKE_RESULT_PREFIX,
} from "./smoke";

describe("packaged desktop smoke contract", () => {
  it("enables smoke mode only for the exact opt-in value", () => {
    expect(isSmokeMode("1")).toBe(true);
    expect(isSmokeMode(undefined)).toBe(false);
    expect(isSmokeMode("")).toBe(false);
    expect(isSmokeMode("true")).toBe(false);
  });

  it("activates only from the launcher argv flags, never from env vars", () => {
    expect(parseSmokeLaunchArgs(["orrery.exe", "--user-data-dir=C:\\tmp\\profile"])).toBeNull();
    expect(parseSmokeLaunchArgs([
      "orrery.exe",
      "--user-data-dir=C:\\tmp\\profile",
      SMOKE_MODE_FLAG,
      `${SMOKE_RESULT_PREFIX}C:\\tmp\\result.json`,
    ])).toEqual({ resultPath: "C:\\tmp\\result.json" });
  });

  it("rejects the smoke flag without a result path and vice versa", () => {
    expect(() => parseSmokeLaunchArgs(["orrery.exe", SMOKE_MODE_FLAG]))
      .toThrow(`${SMOKE_RESULT_PREFIX}<path>`);
    expect(() => parseSmokeLaunchArgs(["orrery.exe", `${SMOKE_RESULT_PREFIX}C:\\tmp\\result.json`]))
      .toThrow(SMOKE_MODE_FLAG);
  });

  it("accepts only the exact readiness payload", () => {
    expect(isValidSmokeReadiness({
      desktopRuntimeExists: true,
      processType: "undefined",
      requireType: "undefined",
    })).toBe(true);
    expect(isValidSmokeReadiness({
      desktopRuntimeExists: true,
      processType: "object",
      requireType: "undefined",
    })).toBe(false);
    expect(isValidSmokeReadiness({
      desktopRuntimeExists: true,
      processType: "undefined",
      requireType: "undefined",
      unexpected: true,
    })).toBe(false);
    expect(isValidSmokeReadiness(null)).toBe(false);
  });

  it("passes only when the runtime exists and Node globals are absent", () => {
    expect(createSmokeResult({
      desktopRuntimeExists: true,
      processType: "undefined",
      requireType: "undefined",
    })).toEqual({
      passed: true,
      checks: {
        desktopRuntimeExists: true,
        rendererProcessUndefined: true,
        rendererRequireUndefined: true,
      },
    });

    expect(createSmokeResult({
      desktopRuntimeExists: false,
      processType: "undefined",
      requireType: "undefined",
    }).passed).toBe(false);
  });

  it("accepts the first readiness payload and rejects repeat invocations", async () => {
    type Handler = (event: unknown, payload: unknown) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => { handlers.set(channel, handler); }),
      removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
    };
    const rendererUrl = "file:///opt/Orrery/renderer/index.html";
    const senderFrame = { url: rendererUrl };
    const event = { senderFrame, sender: { mainFrame: senderFrame } };
    const readiness = {
      desktopRuntimeExists: true,
      processType: "undefined",
      requireType: "undefined",
    };
    const finish = vi.fn();
    const resultPath = join(process.cwd(), ".tmp", "smoke-test", `result-${process.pid}.json`);

    try {
      registerDesktopSmokeIpc(ipcMain as never, () => rendererUrl, resultPath, finish);
      const handler = handlers.get("desktop:smoke:v1:ready");
      expect(handler).toBeDefined();

      // Invalid payloads do not consume the single accepted readiness report.
      await expect(handler?.(event, { unexpected: true })).rejects.toThrow("invalid desktop smoke readiness");
      expect(finish).not.toHaveBeenCalled();

      await handler?.(event, readiness);
      expect(finish).toHaveBeenCalledWith(0);
      expect(ipcMain.removeHandler).toHaveBeenCalledWith("desktop:smoke:v1:ready");
      expect(handlers.has("desktop:smoke:v1:ready")).toBe(false);
      await expect(readFile(resultPath, "utf8")).resolves.toContain("\"passed\":true");
    } finally {
      await rm(join(process.cwd(), ".tmp", "smoke-test"), { recursive: true, force: true });
    }
  });
});
