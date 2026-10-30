import type { Mission, MissionStatus } from "../domain/mission";
import { useReveal } from "../hooks/use-reveal";

type Tone = "neutral" | "danger" | "success";
interface Stage { id: string; label: string; short: string }

const STAGES: Stage[] = [
  { id: "define", label: "Define", short: "01" },
  { id: "plan", label: "Plan", short: "02" },
  { id: "approve", label: "Approve", short: "03" },
  { id: "run", label: "Run", short: "04" },
  { id: "review", label: "Review", short: "05" },
  { id: "decide", label: "Decide", short: "06" },
];

/** Index of the stage a status sits in, plus the tone the current node should carry. */
export function lifecyclePosition(status: MissionStatus): { index: number; tone: Tone; terminalLabel?: string } {
  switch (status) {
    case "draft": return { index: 0, tone: "neutral" };
    case "planning":
    case "revision_requested": return { index: 1, tone: "neutral" };
    case "awaiting_approval": return { index: 2, tone: "neutral" };
    case "queued":
    case "running":
    case "paused":
    case "blocked": return { index: 3, tone: status === "blocked" ? "danger" : "neutral" };
    case "ready_for_review": return { index: 4, tone: "neutral" };
    case "accepted": return { index: 5, tone: "success", terminalLabel: "Accepted" };
    case "rejected": return { index: 5, tone: "danger", terminalLabel: "Rejected" };
    case "failed": return { index: 5, tone: "danger", terminalLabel: "Failed" };
    case "cancelled": return { index: 5, tone: "danger", terminalLabel: "Cancelled" };
  }
}

export function LifecycleRail({ mission }: { mission: Mission }) {
  const { index, tone, terminalLabel } = lifecyclePosition(mission.status);
  const railReveal = useReveal<HTMLOListElement>();
  return (
    <ol className="lifecycle" aria-label="Mission lifecycle" ref={railReveal} data-stagger>
      {STAGES.map((stage, i) => {
        const state = i < index ? "done" : i === index ? "current" : "upcoming";
        const label = i === 5 && terminalLabel ? terminalLabel : stage.label;
        const liveTone = i === index ? tone : "neutral";
        return (
          <li key={stage.id} data-state={state} data-tone={liveTone} aria-current={state === "current" ? "step" : undefined}>
            {state === "current" && (mission.status === "running" || mission.status === "blocked") ? (
              <span className="beacon" data-tone={mission.status === "blocked" ? "blocked" : "live"} aria-hidden="true" />
            ) : null}
            {stage.short}<span> {label}</span>
          </li>
        );
      })}
    </ol>
  );
}
