import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Emitted only after every Mission Control view rendered in the real renderer.
 *
 * This replaced a preload-time marker. The preload runs before the Theia frontend starts, so the
 * old signal proved the trusted preload had loaded and nothing about whether any widget appeared.
 */
export const THEIA_READY_MARKER = "ORRERY_THEIA_RENDERED";

export function waitForTheiaReadiness(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = "";
    const streams = new Map([[child.stdout, ""], [child.stderr, ""]]);
    const timeout = setTimeout(() => finish(new Error(`Theia Electron readiness was not observed within ${timeoutMs}ms.\n${output}`)), timeoutMs);
    const onData = function (chunk) {
      output += chunk.toString();
      const streamOutput = `${streams.get(this) ?? ""}${chunk.toString()}`;
      streams.set(this, streamOutput);
      if (streamOutput.split(/\r?\n/).some(line => line.trim() === THEIA_READY_MARKER)) finish();
    };
    const onExit = (code, signal) => finish(new Error(`Theia Electron exited before readiness (code ${code}, signal ${signal ?? "none"}).\n${output}`));
    const finish = error => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error); else resolve(output);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

export function waitForTheiaExit(child, timeoutMs, dependencies = {}) {
  if (child.exitCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error(`Theia Electron exited after readiness with code ${child.exitCode}, signal ${child.signalCode ?? "none"}.`));
  }
  return new Promise((resolve, reject) => {
    // The OS drops the PID before Node delivers "exit", so a disappeared PID alone is not a failure:
    // allow a grace window for the real exit code, and only report an unobserved death if none arrives.
    const graceMs = Math.min(Math.max(Math.floor(timeoutMs / 2), 1), 500);
    let grace;
    const timeout = setTimeout(() => reject(new Error(`Theia Electron did not exit after readiness within ${timeoutMs}ms.`)), timeoutMs);
    const finish = (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(grace);
      clearInterval(poll);
      if (code === 0) resolve();
      else reject(new Error(`Theia Electron exited after readiness with code ${code}, signal ${signal ?? "none"}.`));
    };
    const poll = setInterval(() => {
      if (child.exitCode !== null) finish(child.exitCode, child.signalCode);
      else if (child.pid && !(dependencies.isProcessAlive ?? isProcessAlive)(child.pid) && grace === undefined) {
        clearInterval(poll);
        grace = setTimeout(() => finish(child.exitCode ?? 1, child.exitCode === null ? "unobserved_process_death" : child.signalCode), graceMs);
      }
    }, 25);
    child.once("exit", finish);
    child.once("close", finish);
    if (child.exitCode !== null) finish(child.exitCode, child.signalCode);
  });
}

export function removeSmokeUserData(path) {
  // Chromium can release profile WAL handles just after Electron emits exit.
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
    // Windows may release Chromium profile handles asynchronously after taskkill.
    spawnSync("cmd.exe", ["/c", "rmdir", "/s", "/q", path], { stdio: "ignore" });
  }
}

export function terminateProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group exited after SIGTERM.
    }
  }
}

/**
 * Reads how many bundled plugins the backend accepted from the launch output.
 *
 * Theia's plugin deployer logs one `Deploy batch of N accepted plugins` line per batch (the
 * system batch first). The largest count is the number of plugins that will actually run; a
 * directory of .vsix files that Theia refuses to unpack logs `0` here while every other signal
 * stays green, which is exactly the failure this guards against.
 */
/** Bundled plugins on disk: every directory under the plugins folder, or 0 when it is absent. */
export function countBundledPlugins(pluginsDir, list = directory => readdirSync(directory, { withFileTypes: true })) {
  try {
    return list(pluginsDir).filter(entry => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

export function countDeployedPlugins(output) {
  let deployed = null;
  for (const match of output.matchAll(/Deploy batch of (\d+) accepted plugins/g)) {
    const count = Number(match[1]);
    deployed = deployed === null ? count : Math.max(deployed, count);
  }
  return deployed;
}

/**
 * Launches an Electron executable in Theia smoke mode against a throwaway profile, waits for
 * every Mission Control view to render, then for a clean exit. Shared by the development smoke
 * (electron.exe plus the checkout) and the packaged smoke (the built product executable).
 *
 * `minimumPlugins` turns the bundled builtins into a requirement: readiness alone proves the
 * Orrery views, not that Git or the language features exist.
 */
export async function runTheiaSmokeLaunch({ executable, args, cwd, readinessTimeoutMs = 120_000, exitTimeoutMs = 30_000, minimumPlugins = 0 }) {
  const smokeRoot = resolve(tmpdir(), "orrery-theia-smoke-");
  mkdirSync(smokeRoot, { recursive: true });
  const userData = mkdtempSync(smokeRoot);
  const localAppData = resolve(process.env.LOCALAPPDATA ?? tmpdir(), `OrrerySmoke-${randomUUID()}`);
  mkdirSync(localAppData, { recursive: true });
  const launch = spawn(executable, [...args, `--electronUserData=${userData}`], {
    cwd,
    detached: process.platform !== "win32",
    env: { ...process.env, LOCALAPPDATA: localAppData, ORRERY_THEIA_SMOKE: "1", ORRERY_THEIA_SMOKE_USER_DATA: userData, ORRERY_TEST_TIMEOUT_SCALE: process.env.ORRERY_TEST_TIMEOUT_SCALE ?? "4" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const output = await waitForTheiaReadiness(launch, readinessTimeoutMs);
    await waitForTheiaExit(launch, exitTimeoutMs);
    if (minimumPlugins > 0) {
      const deployed = countDeployedPlugins(output);
      if (deployed === null) throw new Error(`Theia never reported a plugin deployment batch; expected at least ${minimumPlugins} bundled plugins.`);
      if (deployed < minimumPlugins) throw new Error(`Theia deployed ${deployed} bundled plugins, expected at least ${minimumPlugins}. Bundled plugins must be unpacked directories (see scripts/download-plugins.mjs).`);
      console.log(`Theia deployed ${deployed} bundled plugins.`);
    }
  } finally {
    terminateProcessTree(launch.pid);
    removeSmokeUserData(userData);
    removeSmokeUserData(localAppData);
  }
}

function isProcessAlive(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return result.status === 0 && result.stdout.includes(`"${pid}"`);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
