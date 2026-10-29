import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/app-shell";
import { LaunchGate } from "./components/launch-screen";
import { reportDesktopSmokeReadiness } from "./desktop";
import { MissionProvider } from "./state/mission-context";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><MissionProvider><LaunchGate><AppShell /></LaunchGate></MissionProvider></StrictMode>,
);

void reportDesktopSmokeReadiness();
