/**
 * Packaging for the Orrery Theia workbench.
 *
 * Signing policy is inherited verbatim from the root config: signed builds are the default and
 * unsigned output needs the explicit ORRERY_UNSIGNED_LOCAL=1 opt-in. Everything below only
 * describes *what* ships, following Theia IDE's layout:
 *
 *   - the backend, extension host, and frontend are esbuild bundles under `lib/`, so
 *     `node_modules` is excluded entirely;
 *   - native addons and the terminal shell-integration scripts are unpacked from the asar
 *     because they are loaded by path;
 *   - the daemon is unpacked so the main process can fork it;
 *   - the VS Code builtins are shipped as extraResources at `resources/app/plugins`, where
 *     `scripts/electron-main.cjs` points the plugin deployer when running from an asar.
 *
 * @type {import('electron-builder').Configuration}
 */
const path = require("path");
const root = require("../electron-builder.config.cjs");

module.exports = {
  ...root,
  appId: "com.orrery.mission-control.workbench",
  productName: "Orrery Mission Control",
  electronDist: path.join(__dirname, "node_modules", "electron", "dist"),
  electronVersion: require("./node_modules/electron/package.json").version,
  npmRebuild: false,
  nodeGypRebuild: false,
  asar: true,
  asarUnpack: [
    "**/lib/backend/native/**",
    "**/lib/backend/shell-integrations/**",
    "**/lib/backend/worker/**",
    "**/lib/backend/*.exe",
    "**/host/lib/resources/**"
  ],
  directories: {
    output: "release"
  },
  files: [
    "scripts/electron-main.cjs",
    "src-gen/**/*",
    "lib/**/*",
    "host/lib/resources/**/*",
    "host/package.json",
    "package.json",
    "!**/node_modules/**"
  ],
  extraResources: [
    { from: "plugins", to: "app/plugins" }
  ],
  win: {
    ...root.win,
    target: ["nsis", "zip"]
  }
};
