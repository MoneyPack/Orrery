import { contextBridge, ipcRenderer } from "electron";
import { createDesktopApi } from "./preload-api";
import { SMOKE_MODE_FLAG } from "./smoke";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld(
  "orreryDesktop",
  // Mirror the main process: smoke mode activates only from the launcher argv
  // flag, never from inherited environment variables.
  createDesktopApi(invoke, process.argv.includes(SMOKE_MODE_FLAG)),
);
