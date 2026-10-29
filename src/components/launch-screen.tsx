import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Play, ShieldCheck, Vault } from "@phosphor-icons/react";
import { useMissions } from "../state/mission-context";
import { useCountUp, useReveal } from "../hooks/use-reveal";
import { OrreryMark } from "./orrery-mark";

/*
 * Pre-boot welcome launcher. Mounted once per session by the gate below,
 * before the boot sequence: an inspirational hero over the orrery emblem —
 * isolate / approve / verify pillars, a live mission count, one enter
 * action — then hands off to BootSequence. Smoke preloads skip it so the
 * packaged readiness gate never waits on a human click. Reduced motion
 * collapses every entrance to a single frame.
 */

const SESSION_FLAG = "orrery.launched";

export function hasLaunchedThisSession(storage: Pick<Storage, "getItem"> | undefined = safeSession()): boolean {
  return storage?.getItem(SESSION_FLAG) === "1";
}

function safeSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isSmokeMode(api: { reportSmokeReadiness?: unknown } | undefined = window.orreryDesktop): boolean {
  return typeof api?.reportSmokeReadiness === "function";
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const PILLARS = [
  { icon: Vault, title: "Isolate", body: "Every run executes in its own workspace, away from your working tree." },
  { icon: ShieldCheck, title: "Approve", body: "Plans and capability requests wait for your explicit decision." },
  { icon: Play, title: "Verify", body: "Evidence and ordered events back every review before you accept." },
] as const;

export function LaunchScreen({ onEnter }: { onEnter: () => void }) {
  const { missions, runtimeError } = useMissions();
  const reveal = useReveal<HTMLElement>();
  const [exiting, setExiting] = useState(false);
  const count = useCountUp(missions.length);

  const enter = useCallback(() => {
    setExiting((was) => {
      if (!was) {
        try {
          safeSession()?.setItem(SESSION_FLAG, "1");
        } catch {
          // Session flag is best-effort; a missing session store just replays the launcher.
        }
        window.setTimeout(onEnter, prefersReducedMotion() ? 0 : 420);
      }
      return true;
    });
  }, [onEnter]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter]);

  return (
    <div className="launch" data-exiting={exiting} role="dialog" aria-modal="true" aria-label="Welcome to Orrery Mission Control">
      <div className="launch-aurora" aria-hidden="true" />
      <div className="launch-grid" aria-hidden="true" />
      <OrreryMark className="launch-orrery" id="launch" />
      <main className="launch-copy" ref={reveal}>
        <p className="eyebrow" data-reveal>Orrery Mission Control</p>
        <h1 data-reveal>Delegate the work.<br /><em>Keep the judgment.</em></h1>
        <p data-reveal>
          Plan missions, approve every boundary crossing, and review gathered
          evidence — the daemon runs the errands, you keep the decisions.
        </p>
        <ol className="launch-pillars" data-stagger>
          {PILLARS.map((pillar) => (
            <li key={pillar.title}>
              <pillar.icon size={18} weight="duotone" aria-hidden="true" />
              <b>{pillar.title}</b>
              <span>{pillar.body}</span>
            </li>
          ))}
        </ol>
        <div className="launch-status" data-reveal>
          <span className="beacon" data-tone={missions.some((mission) => ["running", "blocked"].includes(mission.status)) ? "live" : "done"} aria-hidden="true" />
          <span data-tick={count.bump ? "bump" : undefined}>{count.display}</span>
          <span>{missions.length === 1 ? "mission" : "missions"} restored{runtimeError ? " — runtime warming up" : ""}</span>
        </div>
        <div className="launch-actions" data-reveal>
          <button type="button" className="button primary launch-enter" onClick={enter} autoFocus>
            Enter Mission Control <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </button>
          <span className="launch-hint"><kbd>Enter</kbd> to begin — boot calibrates on entry</span>
        </div>
      </main>
    </div>
  );
}

export function LaunchGate({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState(() => hasLaunchedThisSession() || isSmokeMode());
  if (entered) return <>{children}</>;
  return <LaunchScreen onEnter={() => setEntered(true)} />;
}
