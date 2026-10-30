import { describe, expect, it } from "vitest";
import { enforce } from "@orrery/mission-control-domain";
import {
  ipcSenderTrustDecision,
  ipcSenderTrustPermission,
  trustedSender,
} from "./ipc-permission";

const rendererUrl = "file:///C:/Orrery/dist/index.html";

describe("ipc-sender-trust permission", () => {
  it("allows the main frame at the exact renderer URL and denies anything else", () => {
    expect(ipcSenderTrustPermission.system).toBe("ipc-sender-trust");
    expect(ipcSenderTrustPermission.check(trustedSender(rendererUrl)).allowed).toBe(true);
    expect(ipcSenderTrustPermission.approve).toBeUndefined();
    expect(ipcSenderTrustPermission.revoke).toBeUndefined();
    const mainFrame = { url: rendererUrl };
    expect(ipcSenderTrustDecision({ senderFrame: { url: rendererUrl }, mainFrame, rendererUrl }).allowed).toBe(false);
    expect(ipcSenderTrustDecision({ senderFrame: mainFrame, mainFrame: { url: "https://attacker.invalid/" }, rendererUrl }).allowed).toBe(false);
    expect(ipcSenderTrustDecision({ senderFrame: null, mainFrame, rendererUrl })).toEqual({
      allowed: false,
      reason: "Untrusted IPC sender",
    });
  });

  it("enforce maps the denial to the caller's fixed rejection error", () => {
    const trusted = trustedSender(rendererUrl);
    expect(enforce(ipcSenderTrustPermission.check(trusted), () => new Error("Rejected untrusted mission IPC request"))).toBe(true);
    expect(() => enforce(
      ipcSenderTrustPermission.check({ ...trusted, rendererUrl: "file:///other/index.html" }),
      () => new Error("Rejected untrusted mission IPC request"),
    )).toThrow("Rejected untrusted mission IPC request");
  });
});
