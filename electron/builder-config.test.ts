import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../electron-builder.config.cjs");

function loadConfig(env: { unsigned?: string; identity?: string }) {
  if (env.unsigned === undefined) delete process.env.ORRERY_UNSIGNED_LOCAL;
  else process.env.ORRERY_UNSIGNED_LOCAL = env.unsigned;
  if (env.identity === undefined) delete process.env.APPLE_IDENTITY;
  else process.env.APPLE_IDENTITY = env.identity;
  delete require.cache[configPath];
  return require(configPath) as Record<string, unknown>;
}

afterEach(() => {
  delete process.env.ORRERY_UNSIGNED_LOCAL;
  delete process.env.APPLE_IDENTITY;
  delete require.cache[configPath];
  vi.restoreAllMocks();
});

describe("electron-builder configuration", () => {
  it("packages the desktop outputs with the Orrery identity", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      appId: "com.orrery.mission-control",
      productName: "Orrery Mission Control",
      asar: true,
      directories: { output: "release" },
      files: ["dist/**/*", "dist-electron/**/*", "package.json"],
      win: { target: ["nsis", "portable", "zip"] },
      mac: { target: ["dmg", "zip"] },
      linux: { target: ["AppImage", "deb"] },
    });
  });

  it("signs by default and picks up the mac identity from APPLE_IDENTITY", () => {
    const config = loadConfig({ identity: "Developer ID Application: Orrery" });
    expect(config).toMatchObject({ forceCodeSigning: true });
    expect(config.win).not.toMatchObject({ signAndEditExecutable: false });
    expect(config.mac).toMatchObject({
      identity: "Developer ID Application: Orrery",
    });
  });

  it("allows unsigned local-only builds behind ORRERY_UNSIGNED_LOCAL=1", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadConfig({ unsigned: "1" });
    expect(config).toMatchObject({
      forceCodeSigning: false,
      win: { target: ["nsis", "portable", "zip"], signAndEditExecutable: false },
      mac: { target: ["dmg", "zip"], identity: null },
    });
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not configure publishing or updates", () => {
    const config = loadConfig({});
    expect(config).not.toHaveProperty("publish");
    expect(config).not.toHaveProperty("afterSign");
    expect(config).not.toHaveProperty("afterAllArtifactBuild");
    expect(config).not.toHaveProperty("electronUpdaterCompatibility");
  });
});
