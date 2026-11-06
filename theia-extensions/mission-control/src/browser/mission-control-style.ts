const STYLE_ELEMENT_ID = "orrery-mission-control-style";

/**
 * Mission Control styling.
 * Injected at runtime because the extension ships a `tsc`-only build with no CSS asset pipeline.
 * Uses Theia theme variables so the surface follows the active light or dark theme, and the
 * same rhythm as Orrery Intelligence and Orrery Tools: hairlines, inset panels, uppercase labels.
 */
export const MISSION_CONTROL_STYLE = `
.orrery-mission-control {
  --orrery-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --orrery-radius-inner: 4px;
  --orrery-radius-outer: 7px;
  --orrery-accent: var(--theia-focusBorder, #3794ff);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  padding: 14px 14px 18px;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: var(--theia-ui-font-size1);
  color: var(--theia-foreground);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.orrery-mission-control__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--theia-editorGroup-border);
}
.orrery-mission-control__header h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-wrap: balance;
}
.orrery-mission-control h3,
.orrery-mission-control h4 {
  margin: 0 0 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  opacity: 0.72;
}
.orrery-mission-control__meta {
  margin: 5px 0 0;
  font-size: 11px;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
  text-wrap: pretty;
}
.orrery-mission-control__meta code {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--theia-editorWidget-background);
  overflow-wrap: anywhere;
}
.orrery-mission-control button {
  font: inherit;
  min-height: 26px;
  padding: 5px 11px;
  color: var(--theia-foreground);
  background: transparent;
  border: 1px solid var(--theia-editorGroup-border);
  border-radius: var(--orrery-radius-inner);
  cursor: pointer;
  transition-property: transform, background-color, color, opacity;
  transition-duration: 140ms;
  transition-timing-function: var(--orrery-ease-out);
}
.orrery-mission-control button[type="submit"],
.orrery-mission-control__review button[data-primary="true"] {
  color: var(--theia-button-foreground);
  background: var(--theia-button-background);
  border-color: transparent;
}
@media (hover: hover) and (pointer: fine) {
  .orrery-mission-control button:hover:not(:disabled) {
    background: var(--theia-button-hoverBackground);
    color: var(--theia-button-foreground);
  }
}
.orrery-mission-control button:active:not(:disabled) { transform: scale(0.97); }
.orrery-mission-control button:disabled { opacity: 0.45; cursor: default; }
.orrery-mission-control__error,
.orrery-mission-control__notice {
  margin: 0;
  padding: 9px 11px;
  border-left: 2px solid var(--theia-errorForeground);
  border-radius: 0 var(--orrery-radius-inner) var(--orrery-radius-inner) 0;
  background: var(--theia-editorWidget-background);
  color: var(--theia-errorForeground);
  font-size: 12px;
  text-wrap: pretty;
  animation: orrery-mission-control-enter 200ms var(--orrery-ease-out) both;
}
.orrery-mission-control__notice {
  border-left-color: var(--orrery-accent);
  color: var(--theia-foreground);
}
.orrery-mission-control__form,
.orrery-mission-control__section,
.orrery-mission-control__detail {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--theia-editorGroup-border);
  border-radius: var(--orrery-radius-outer);
  background: var(--theia-editorWidget-background);
}
.orrery-mission-control__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.8;
}
.orrery-mission-control__field input,
.orrery-mission-control__field select,
.orrery-mission-control__field textarea {
  font: inherit;
  min-height: 26px;
  padding: 5px 8px;
  color: var(--theia-input-foreground);
  background: var(--theia-input-background);
  border: 1px solid var(--theia-editorGroup-border);
  border-radius: var(--orrery-radius-inner);
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  transition: border-color 140ms var(--orrery-ease-out);
}
.orrery-mission-control__field textarea { resize: vertical; min-height: 56px; }
.orrery-mission-control__field input:focus-visible,
.orrery-mission-control__field select:focus-visible,
.orrery-mission-control__field textarea:focus-visible,
.orrery-mission-control button:focus-visible {
  outline: 1px solid var(--theia-focusBorder);
  outline-offset: 1px;
  border-color: var(--theia-focusBorder);
}
.orrery-mission-control__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.orrery-mission-control__list button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  padding: 7px 10px;
  border-left-width: 2px;
}
.orrery-mission-control__list button[aria-current="true"] {
  border-left-color: var(--orrery-accent);
  background: var(--theia-list-activeSelectionBackground, var(--theia-editorWidget-background));
}
.orrery-mission-control__list button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.orrery-mission-control__status {
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.7;
}
.orrery-mission-control__status--running,
.orrery-mission-control__status--ready_for_review { color: var(--theia-editorWarning-foreground, var(--theia-foreground)); opacity: 1; }
.orrery-mission-control__status--accepted { color: var(--theia-gitDecoration-addedResourceForeground, var(--theia-foreground)); opacity: 1; }
.orrery-mission-control__status--failed,
.orrery-mission-control__status--rejected,
.orrery-mission-control__status--blocked { color: var(--theia-errorForeground); opacity: 1; }
.orrery-mission-control__detail header { display: flex; flex-direction: column; gap: 4px; }
.orrery-mission-control__detail header h3 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; text-transform: none; opacity: 1; text-wrap: balance; }
.orrery-mission-control__mode { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.6; }
.orrery-mission-control__goal { margin: 0; font-size: 12px; line-height: 1.5; opacity: 0.85; text-wrap: pretty; }
.orrery-mission-control__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 11px;
}
.orrery-mission-control__facts dt { opacity: 0.6; text-transform: uppercase; font-size: 9px; letter-spacing: 0.08em; align-self: center; }
.orrery-mission-control__facts dd { margin: 0; font-family: var(--theia-code-font-family); font-size: 11px; overflow-wrap: anywhere; }
.orrery-mission-control__detail section { padding-top: 10px; border-top: 1px solid var(--theia-editorGroup-border); }
.orrery-mission-control__detail section p { margin: 0; font-size: 11px; opacity: 0.72; }
.orrery-mission-control__changes,
.orrery-mission-control__evidence { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.orrery-mission-control__changes li { display: flex; justify-content: space-between; gap: 8px; }
.orrery-mission-control__changes code { font-size: 11px; overflow-wrap: anywhere; }
.orrery-mission-control__changes span { font-family: var(--theia-code-font-family); font-variant-numeric: tabular-nums; opacity: 0.7; flex: 0 0 auto; }
.orrery-mission-control__evidence strong { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; margin-right: 6px; }
.orrery-mission-control__review { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 10px; border-top: 1px solid var(--theia-editorGroup-border); }
.orrery-mission-control__empty { margin: 0; font-size: 12px; opacity: 0.66; line-height: 1.55; text-wrap: pretty; }
.orrery-mission-control__pending {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.72;
}
.orrery-mission-control__pending::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: orrery-mission-control-pulse 1.4s ease-in-out infinite;
}
@keyframes orrery-mission-control-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes orrery-mission-control-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .orrery-mission-control__error,
  .orrery-mission-control__notice { animation: orrery-mission-control-fade 160ms ease both; }
  .orrery-mission-control__pending::before { animation: none; opacity: 0.7; }
  .orrery-mission-control button:active:not(:disabled) { transform: none; }
}
@keyframes orrery-mission-control-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

/** Adds the stylesheet once per document. Safe to call from every widget instance. */
export function ensureMissionControlStyle(target: Pick<Document, "getElementById" | "createElement" | "head"> | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!target || target.getElementById(STYLE_ELEMENT_ID)) return;
  const style = target.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = MISSION_CONTROL_STYLE;
  target.head.appendChild(style);
}
