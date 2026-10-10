import { useEffect, useState } from "react";
import { STORAGE_KEY, useMissions } from "../state/mission-context";
import { OrreryMark } from "./orrery-mark";

/*
 * Boot is an instrument calibration, not a splash screen. Every line in the
 * telemetry readout is a real fact about this launch — where state lives, how
 * many missions were restored, whether the desktop bridge is attached — so the
 * sequence reads as the shell powering on rather than a logo being shown.
 *
 * Timings (ms from mount):
 *    150–1900  rings draw, ticks fade, wordmark resolves
 *   1200–1800  bodies arrive on their orbits
 *   1900       core ignites; telemetry begins
 *   3400       exit fade begins
 *   3900       overlay unmounts, shell choreography starts
 *
 * Any key or click skips straight to the exit. Reduced motion collapses the
 * whole thing to a single frame and hands off immediately.
 */
const EXIT_AT = 3400;
const EXIT_DURATION = 520;
const SESSION_FLAG = "orrery.booted";

export const BOOT_LINE_DELAYS = [1900, 2150, 2400, 2650, 2900] as const;

export function hasBootedThisSession(storage: Pick<Storage, "getItem"> | undefined = safeSession()): boolean {
  return storage?.getItem(SESSION_FLAG) === "1";
}

function safeSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Line { k: string; v: string; s: string; state?: "ok" | "warn" | "pending" }

export function BootSequence({ theme, onDone }: { theme: string; onDone: () => void }) {
  const { missions, storageError } = useMissions();
  const [phase, setPhase] = useState<"run" | "exit">("run");
  const [runtime, setRuntime] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const api = window.orreryDesktop;
    if (!api) {
      setRuntime("browser / fixture runtime");
      return;
    }
    api.getRuntime().then((info) => {
      if (!cancelled) setRuntime(`electron ${info.versions.electron} / ${info.platform}`);
    }).catch(() => {
      if (!cancelled) setRuntime("desktop bridge unavailable");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const exitAt = reduced ? 0 : EXIT_AT;
    const exitTimer = window.setTimeout(() => setPhase("exit"), exitAt);
    return () => window.clearTimeout(exitTimer);
  }, []);

  useEffect(() => {
    if (phase !== "exit") return;
    const reduced = prefersReducedMotion();
    const timer = window.setTimeout(() => {
      safeSession()?.setItem(SESSION_FLAG, "1");
      onDone();
    }, reduced ? 0 : EXIT_DURATION);
    return () => window.clearTimeout(timer);
  }, [phase, onDone]);

  useEffect(() => {
    const skip = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") setPhase("exit");
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);

  const reduced = prefersReducedMotion();
  const lines: Line[] = [
    { k: "STORE", v: STORAGE_KEY, s: storageError ? "CORRUPT" : "OK", state: storageError ? "warn" : "ok" },
    { k: "MISSIONS", v: `${missions.length.toString().padStart(2, "0")} restored from local persistence`, s: "OK" },
    { k: "RUNTIME", v: runtime ?? "probing desktop bridge", s: runtime ? (runtime.startsWith("electron") ? "LINKED" : "LOCAL") : "", state: runtime ? "ok" : "pending" },
    { k: "THEME", v: `${theme} / motion ${reduced ? "reduced" : "full"}`, s: "OK" },
    { k: "SHELL", v: "mission control / m0", s: "READY" },
  ];

  return (
    <div className="boot" data-phase={phase} role="status" aria-label="Starting Orrery Mission Control" onClick={() => setPhase("exit")}>
      <div className="boot-grid" />
      <button type="button" className="boot-skip" onClick={() => setPhase("exit")}>
        Skip<kbd>ESC</kbd>
      </button>
      <div className="boot-stage">
        <OrreryMark className="boot-orrery" id="boot" />
        <div className="boot-wordmark">
          <strong>ORRERY</strong>
          <span>Mission Control</span>
        </div>
      </div>
      <div className="boot-telemetry" aria-hidden="true">
        {lines.map((line, index) => (
          <div
            key={line.k}
            className="boot-line"
            data-state={line.state ?? "ok"}
            style={{ animationDelay: reduced ? "0ms" : `${BOOT_LINE_DELAYS[index]}ms` }}
          >
            <span className="k">{line.k}</span>
            <span className="v">{line.v}</span>
            <span className="s">{line.s}</span>
          </div>
        ))}
        <div className="boot-progress" />
      </div>
    </div>
  );
}
