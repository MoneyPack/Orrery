import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packages the Orrery workbench with electron-builder.
 *
 * Runs Theia's production bundle first so the asar always holds the current code, then invokes
 * the root checkout's electron-builder against this project. Reusing the root install keeps one
 * pinned electron-builder for both desktop targets and one signing policy
 * (`../electron-builder.config.cjs`), which this project's config extends rather than redefines.
 *
 * Pass through electron-builder flags after the script, e.g. `-- --dir` for an unpacked
 * local build. Without flags it builds the installer targets from the config.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required to package the Theia workbench.");

const bundle = spawnSync(process.execPath, [npmCli, "run", "build:full"], { cwd: root, stdio: "inherit" });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

const pluginsDir = resolve(root, "plugins");
if (!existsSync(pluginsDir)) {
  process.stderr.write("theia-app/plugins is missing; run `npm run download:plugins` (theia-app:install does this) before packaging.\n");
  process.exit(1);
}

const builderCli = resolve(root, "..", "node_modules", "electron-builder", "cli.js");
if (!existsSync(builderCli)) {
  process.stderr.write("electron-builder is not installed in the root checkout; run `npm ci` at the repository root.\n");
  process.exit(1);
}
const flags = process.argv.slice(2);
const packaged = spawnSync(process.execPath, [builderCli, "--config", "electron-builder.config.cjs", ...flags], { cwd: root, stdio: "inherit" });
process.exit(packaged.status ?? 1);
