/**
 * Signing policy: signed builds are the DEFAULT. Unsigned output is a
 * local-validation-only escape hatch that requires an explicit opt-in:
 *
 *   ORRERY_UNSIGNED_LOCAL=1  -> forceCodeSigning off, Windows
 *   signAndEditExecutable off, mac identity null (unsigned local build).
 *
 * Without that flag the config demands real identities:
 *   - Windows: EV/OV code-signing certificate (see CSC_LINK /
 *     CSC_KEY_PASSWORD or a cert in the Windows certificate store).
 *   - macOS: "Developer ID Application" identity in the login keychain
 *     (override name via APPLE_IDENTITY) plus notarization credentials
 *     (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID).
 *
 * FAILURE MODE (by design): running electron-builder without the flag
 * and without those identities installed does NOT produce an unsigned
 * installer — it fails with a signing error. That error is the signal
 * to procure/install the identities above, never a reason to flip the
 * default back. Local dev/packaging without certs must set
 * ORRERY_UNSIGNED_LOCAL=1 explicitly.
 *
 * @type {import('electron-builder').Configuration}
 */
const unsignedLocalBuild = process.env.ORRERY_UNSIGNED_LOCAL === "1";

if (unsignedLocalBuild) {
  console.warn(
    "[orrery] ORRERY_UNSIGNED_LOCAL=1: building UNSIGNED local-only artifacts. " +
      "Do not distribute these binaries.",
  );
}

module.exports = {
  appId: "com.orrery.mission-control",
  productName: "Orrery Mission Control",
  asar: true,
  forceCodeSigning: !unsignedLocalBuild,
  directories: {
    output: "release",
  },
  files: [
    "dist/**/*",
    "dist-electron/**/*",
    "package.json",
  ],
  win: {
    executableName: "orrery-mission-control",
    ...(unsignedLocalBuild ? { signAndEditExecutable: false } : {}),
    target: ["nsis", "portable", "zip"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    identity: unsignedLocalBuild ? null : process.env.APPLE_IDENTITY,
    target: ["dmg", "zip"],
  },
  linux: {
    executableName: "orrery-mission-control",
    category: "Development",
    target: ["AppImage", "deb"],
  },
};
