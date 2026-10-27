/**
 * Container enforcement violation tests + hostile-config fuzzer.
 *
 * Scope note — what this file proves: the framework-free enforcement contract in
 * `./container-enforcement` rejects malformed `docker inspect`-like JSON and every
 * isolation violation in the design-doc matrix (section 8) before dispatch.
 *
 * What remains (not built here): real Docker/Podman CLI adapters that obtain genuine
 * inspect output, `SessionAuthority` dispatch wiring, and any image-resolution or
 * approval flow. A passing suite here is pre-dispatch evidence only; no session may be
 * labeled `ENFORCED` until an adapter feeds real engine output through the contract.
 *
 * The fuzzer below is deterministic (seeded PRNG, fixed iteration budget) so it stays
 * stable under `vitest run`, including repeated runs.
 */
import { describe, expect, it } from "vitest";
import {
  createContainerEnforcement,
  type ContainerEnforcementPolicy,
} from "./container-enforcement";

const IMAGE_DIGEST = "sha256:9f2c4b6d8a0e1f3a5c7e9b0d2f4a6c8e0b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7";
const WORKSPACE_SOURCE = "C:/repos/example/.orrery/worktrees/mission-1";
const INERT_SOURCE = "C:/repos/example/.orrery/inert/mission-1-git";

const policy: ContainerEnforcementPolicy = {
  workspaceDestination: "/workspace",
  allowedBindSources: [WORKSPACE_SOURCE, INERT_SOURCE],
  allowedImageDigest: IMAGE_DIGEST,
};

interface MutableHostConfig {
  Privileged: boolean;
  NetworkMode: string;
  ReadonlyRootfs: boolean;
  CapAdd: string[];
  CapDrop: string[];
  Devices: unknown[];
  DeviceRequests: unknown[];
  SecurityOpt: string[];
  Tmpfs: Record<string, string>;
  Binds: string[];
  PidMode: string;
  IpcMode: string;
  UTSMode: string;
  UsernsMode: string;
  CgroupnsMode: string;
}

interface MutableContainer {
  HostConfig: MutableHostConfig;
  Config: { User: string; Image: string };
  Mounts: Array<{ Source: string; Destination: string; RW: boolean }>;
}

function honoredContainer(): MutableContainer {
  return {
    HostConfig: {
      Privileged: false,
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapAdd: [],
      CapDrop: ["ALL"],
      Devices: [],
      DeviceRequests: [],
      SecurityOpt: ["no-new-privileges", "seccomp=default"],
      Tmpfs: { "/tmp": "rw,size=64m" },
      Binds: [`${WORKSPACE_SOURCE}:/workspace:ro`, `${INERT_SOURCE}:/workspace/.git:ro`],
      PidMode: "",
      IpcMode: "private",
      UTSMode: "private",
      UsernsMode: "",
      CgroupnsMode: "private",
    },
    Config: { User: "1000:1000", Image: `registry.example/app@${IMAGE_DIGEST}` },
    Mounts: [
      { Source: WORKSPACE_SOURCE, Destination: "/workspace", RW: false },
      { Source: INERT_SOURCE, Destination: "/workspace/.git", RW: false },
    ],
  };
}

const enforcement = createContainerEnforcement();

function reasonsFor(container: unknown): string[] {
  const verdict = enforcement.verify({ inspect: container, policy });
  expect(verdict.allowed).toBe(false);
  if (verdict.allowed) return [];
  return [...verdict.reasons];
}

describe("container enforcement violations", () => {
  it("allows a fully honored enforcement matrix", () => {
    const verdict = enforcement.verify({ inspect: [honoredContainer()], policy });
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies a privileged container", () => {
    const container = honoredContainer();
    container.HostConfig.Privileged = true;
    expect(reasonsFor(container).join(" ")).toMatch(/Privileged/i);
  });

  it("denies host, bridged, and default network modes", () => {
    for (const mode of ["host", "bridge", "default", ""]) {
      const container = honoredContainer();
      container.HostConfig.NetworkMode = mode;
      expect(reasonsFor(container).join(" "), `network ${mode}`).toMatch(/NetworkMode/i);
    }
  });

  it("denies extra host mounts and socket exposure", () => {
    const extraBinds = [
      `${WORKSPACE_SOURCE}:/data:ro`,
      "C:/repos/example:/etc/hosts:ro",
      "/var/run/docker.sock:/var/run/docker.sock:ro",
    ];
    for (const bind of extraBinds) {
      const container = honoredContainer();
      container.HostConfig.Binds.push(bind);
      expect(reasonsFor(container).length, bind).toBeGreaterThan(0);
    }
    const socket = honoredContainer();
    socket.Mounts.push({ Source: "/var/run/docker.sock", Destination: "/workspace", RW: false });
    expect(reasonsFor(socket).join(" ")).toMatch(/socket/i);
  });

  it("denies a writable .git overlay and a missing worktree mount", () => {
    const writable = honoredContainer();
    writable.HostConfig.Binds = [`${WORKSPACE_SOURCE}:/workspace:ro`, `${INERT_SOURCE}:/workspace/.git:rw`];
    writable.Mounts = [
      { Source: WORKSPACE_SOURCE, Destination: "/workspace", RW: false },
      { Source: INERT_SOURCE, Destination: "/workspace/.git", RW: true },
    ];
    expect(reasonsFor(writable).join(" ")).toMatch(/read-only/i);

    const missing = honoredContainer();
    missing.HostConfig.Binds = [`${INERT_SOURCE}:/workspace/.git:ro`];
    missing.Mounts = [{ Source: INERT_SOURCE, Destination: "/workspace/.git", RW: false }];
    expect(reasonsFor(missing).join(" ")).toMatch(/worktree/i);
  });

  it("denies weak or missing seccomp and missing no-new-privileges", () => {
    const unconfined = honoredContainer();
    unconfined.HostConfig.SecurityOpt = ["no-new-privileges", "seccomp=unconfined"];
    expect(reasonsFor(unconfined).join(" ")).toMatch(/seccomp/i);

    const missing = honoredContainer();
    missing.HostConfig.SecurityOpt = ["no-new-privileges"];
    expect(reasonsFor(missing).join(" ")).toMatch(/seccomp/i);

    const noNnp = honoredContainer();
    noNnp.HostConfig.SecurityOpt = ["seccomp=default"];
    expect(reasonsFor(noNnp).join(" ")).toMatch(/no-new-privileges/i);
  });

  it("denies added capabilities, missing capability drop, devices, and host namespaces", () => {
    const added = honoredContainer();
    added.HostConfig.CapAdd = ["SYS_ADMIN"];
    expect(reasonsFor(added).join(" ")).toMatch(/capabilit/i);

    const noDrop = honoredContainer();
    noDrop.HostConfig.CapDrop = ["NET_RAW"];
    expect(reasonsFor(noDrop).join(" ")).toMatch(/CapDrop/i);

    const devices = honoredContainer();
    devices.HostConfig.Devices = [{ PathOnHost: "/dev/kvm" }];
    expect(reasonsFor(devices).join(" ")).toMatch(/device/i);

    for (const field of ["PidMode", "IpcMode", "UTSMode", "UsernsMode"] as const) {
      const container = honoredContainer();
      container.HostConfig[field] = "host";
      expect(reasonsFor(container).join(" "), field).toMatch(/host namespace/i);
    }
  });

  it("denies root users, writable roots, missing tmpfs, and image digest mismatch", () => {
    for (const user of ["", "0", "root", "0:0", "root:root"]) {
      const container = honoredContainer();
      container.Config.User = user;
      expect(reasonsFor(container).join(" "), `user ${user}`).toMatch(/non-root/i);
    }
    const writable = honoredContainer();
    writable.HostConfig.ReadonlyRootfs = false;
    expect(reasonsFor(writable).join(" ")).toMatch(/ReadonlyRootfs/i);

    const noTmp = honoredContainer();
    noTmp.HostConfig.Tmpfs = {};
    expect(reasonsFor(noTmp).join(" ")).toMatch(/\/tmp/i);

    const digest = honoredContainer();
    digest.Config.Image = "registry.example/app:latest";
    expect(reasonsFor(digest).join(" ")).toMatch(/digest/i);
  });

  it("denies malformed inspect output before dispatch", () => {
    expect(enforcement.verify({ inspect: null, policy })).toEqual({
      allowed: false,
      reasons: ["inspected container must be an object"],
    });
    expect(enforcement.verify({ inspect: {}, policy }).allowed).toBe(false);
    expect(enforcement.verify({ inspect: [honoredContainer(), honoredContainer()], policy }).allowed).toBe(false);
    expect(enforcement.verifyJsonText("not json {", policy).allowed).toBe(false);
    expect(enforcement.verifyJsonText(42, policy).allowed).toBe(false);
    expect(enforcement.verifyJsonText(JSON.stringify({ Config: null }), policy).allowed).toBe(false);
    expect(enforcement.verifyJsonText(JSON.stringify(honoredContainer()), policy)).toEqual({ allowed: true });
    expect(
      enforcement.verify({ inspect: honoredContainer(), policy: { ...policy, allowedBindSources: [] } }).allowed,
    ).toBe(false);
  });
});

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("container enforcement violation fuzzer", () => {
  it("never allows a hostile or malformed inspect value", () => {
    const random = mulberry32(0x8e47a1);
    const networks = ["host", "bridge", "default", "container:other", ""];
    const users = ["", "0", "root", "0:0", "root:wheel"];
    const mutations: Array<(container: MutableContainer) => void> = [
      (c) => {
        c.HostConfig.Privileged = true;
      },
      (c) => {
        c.HostConfig.NetworkMode = networks[Math.floor(random() * networks.length)] ?? "host";
      },
      (c) => {
        c.HostConfig.CapAdd = ["SYS_ADMIN", "NET_ADMIN"];
      },
      (c) => {
        c.HostConfig.CapDrop = [];
      },
      (c) => {
        c.HostConfig.Devices = [{ PathOnHost: "/dev/fuse" }];
      },
      (c) => {
        c.HostConfig.DeviceRequests = [{ Driver: "nvidia" }];
      },
      (c) => {
        c.HostConfig.SecurityOpt = ["no-new-privileges", "seccomp=unconfined"];
      },
      (c) => {
        c.HostConfig.SecurityOpt = ["seccomp=default"];
      },
      (c) => {
        c.HostConfig.SecurityOpt = [];
      },
      (c) => {
        c.HostConfig.ReadonlyRootfs = false;
      },
      (c) => {
        c.HostConfig.Tmpfs = {};
      },
      (c) => {
        c.Config.User = users[Math.floor(random() * users.length)] ?? "root";
      },
      (c) => {
        c.Config.Image = "registry.example/app:latest";
      },
      (c) => {
        c.HostConfig.PidMode = "host";
      },
      (c) => {
        c.HostConfig.Binds.push("C:/repos/example:/stolen:ro");
      },
      (c) => {
        c.HostConfig.Binds.push("/var/run/docker.sock:/var/run/docker.sock:ro");
      },
      (c) => {
        c.HostConfig.Binds = [`${WORKSPACE_SOURCE}:/workspace:ro`];
        c.Mounts = [{ Source: WORKSPACE_SOURCE, Destination: "/workspace", RW: false }];
      },
      (c) => {
        c.Mounts.push({ Source: "/etc", Destination: "/workspace", RW: false });
      },
    ];

    const iterations = 240;
    let denied = 0;
    for (let index = 0; index < iterations; index += 1) {
      const container = honoredContainer();
      const picks = 1 + Math.floor(random() * 3);
      for (let pick = 0; pick < picks; pick += 1) {
        const mutate = mutations[Math.floor(random() * mutations.length)];
        mutate?.(container);
      }
      const verdict = enforcement.verify({ inspect: container, policy });
      expect(verdict.allowed, `fuzz iteration ${index} allowed a hostile config`).toBe(false);
      if (!verdict.allowed && verdict.reasons.length > 0) denied += 1;
    }
    expect(denied).toBe(iterations);

    const malformed: unknown[] = [
      null,
      42,
      "docker inspect output",
      [],
      [honoredContainer(), honoredContainer()],
      { HostConfig: null },
      { HostConfig: { ...honoredContainer().HostConfig, Binds: "C:/x:/workspace:ro" }, Config: { User: "1:1" } },
      { HostConfig: { ...honoredContainer().HostConfig, SecurityOpt: [7] }, Config: { User: "1:1" } },
      { HostConfig: { ...honoredContainer().HostConfig, CapAdd: "SYS_ADMIN" }, Config: { User: "1:1" } },
    ];
    for (const [index, value] of malformed.entries()) {
      expect(enforcement.verify({ inspect: value, policy }).allowed, `malformed case ${index}`).toBe(false);
    }

    expect(enforcement.verify({ inspect: [honoredContainer()], policy })).toEqual({ allowed: true });
  });
});
