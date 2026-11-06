/**
 * Electron entry for the Orrery workbench, in both the development layout and the packaged app.
 *
 * Hands over to Theia's bundled electron-main after deciding where the bundled VS Code plugins
 * live. Inside an asar archive they cannot be read by the plugin deployer, so electron-builder
 * places them in `resources/app/plugins` (see electron-builder.config.cjs `extraResources`) and
 * this entry points `THEIA_DEFAULT_PLUGINS` there; in the checkout they sit beside this script
 * under `plugins/`. An explicit `THEIA_DEFAULT_PLUGINS` from the environment is left alone so
 * smokes and packaging can redirect it.
 */
const path = require("path");

const insideAsar = __dirname.includes(".asar");
const bundledPluginsDir = insideAsar
  ? path.join(process.resourcesPath, "app", "plugins")
  : path.resolve(__dirname, "..", "plugins");

if (!process.env.THEIA_DEFAULT_PLUGINS) {
  process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${bundledPluginsDir}`;
}

require("../lib/backend/electron-main.js");
