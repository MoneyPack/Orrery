import { Check, Clock, ShieldWarning, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { Mission } from "../domain/mission";
import { useCountUp, useReveal } from "../hooks/use-reveal";

/** Live-run progress: determinate when events accrue against a known plan length, live sweep otherwise. */
function RunMeter({ done, total, live }: { done: number; total: number; live: boolean }) {
  const bar = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    if (total > 0) node.style.transform = `scaleX(${Math.min(1, done / total).toFixed(3)})`;
  }, [done, total]);
  if (!live && total <= 0) return null;
  return (
    <div className="meter" data-state={live && total <= 0 ? "live" : undefined} role="progressbar"
      aria-valuemin={0} aria-valuemax={total || undefined} aria-valuenow={total > 0 ? done : undefined}
      aria-label="Run progress">
      <i ref={bar as React.RefObject<HTMLElement>} />
    </div>
  );
}

export function RuntimeTimeline({
  mission,
  onResolve,
}: {
  mission: Mission;
  onResolve: (runId: string, requestId: string, decision: "allowed" | "denied") => void;
}) {
  const pending = ["running", "blocked"].includes(mission.status) && mission.activeRunId
    ? [...mission.events]
        .reverse()
        .find(
          (event) =>
            event.kind === "capability_request" &&
            event.runId === mission.activeRunId &&
            !event.capability?.resolved,
        )
    : undefined;

  const live = mission.status === "running";
  const blocked = mission.status === "blocked";
  const tone = blocked ? "blocked" : live ? "live" : mission.status === "accepted" ? "done" : undefined;
  const panelReveal = useReveal<HTMLElement>();
  const { display: countDisplay, bump } = useCountUp(mission.events.length);

  return (
    <section className="timeline-panel" aria-labelledby="timeline-title" ref={panelReveal}>
      <header className="panel-header compact">
        <div>
          <span className="eyebrow">Durable event log</span>
          <h2 id="timeline-title"><span className="beacon" data-tone={tone} aria-hidden="true" /> Runtime timeline</h2>
        </div>
        <span className="event-count" data-tick={bump ? "bump" : undefined}>{countDisplay}</span>
      </header>
      <RunMeter done={mission.events.length} total={mission.plan.actions.length} live={live} />
      {pending?.capability && (
        <section className="permission-prompt" aria-label="Permission required">
          <div className="permission-title">
            <ShieldWarning size={20} weight="duotone" />
            <div><span className="eyebrow">Guarded capability</span><h3>Permission required</h3></div>
          </div>
          <dl>
            <div><dt>Capability</dt><dd>{pending.capability.capability}</dd></div>
            <div><dt>Scope</dt><dd>{pending.capability.scope}</dd></div>
            <div><dt>Reason</dt><dd>{pending.capability.reason}</dd></div>
          </dl>
          <div className="permission-actions">
            <button className="button secondary" onClick={() => onResolve(pending.capability!.runId, pending.capability!.requestId, "denied")}><X size={14} /> Deny</button>
            <button className="button primary" onClick={() => onResolve(pending.capability!.runId, pending.capability!.requestId, "allowed")}><Check size={14} /> Allow once</button>
          </div>
        </section>
      )}
      {mission.events.length === 0 ? (
        <div className="inline-empty"><Clock size={19} /><p>Activity will appear here after the fixture run starts.</p></div>
      ) : (
        <ol className="event-list" data-stagger>
          {mission.events.map((event) => (
            <li key={event.id} data-kind={event.kind} data-reveal>
              <span className="event-sequence">{event.sequence.toString().padStart(2, "0")}</span>
              <div><strong>{event.title}</strong><p>{event.detail}</p></div>
              <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
