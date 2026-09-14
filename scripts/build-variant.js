#!/usr/bin/env node
'use strict';
/**
 * Builds one installer variant. lib/variant.js is swapped in-place right
 * before the pack step (so the baked-in VARIANT the main process reads at
 * runtime matches what's being built) and restored afterward no matter what
 * happens, so the working tree always ends up back on its default state.
 *
 * Usage: node scripts/build-variant.js <public|dev>
 */
const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');

const variant = process.argv[2];
if (!['public', 'dev'].includes(variant)) {
  console.error('Usage: node scripts/build-variant.js <public|dev>');
  process.exit(1);
}

const indexHtmlFile = path.join(__dirname, '..', 'src', 'index.html');
const originalIndexHtml = fs.readFileSync(indexHtmlFile, 'utf8');

/**
 * For the public build, admin markup isn't just left hidden by CSS - it's
 * physically absent from the shipped HTML, so there's nothing to find even
 * via view-source or devtools. Every block is wrapped in
 * <!-- ADMIN:START/END --> markers in the source; this strips them out.
 * renderer.js is unchanged either way (same file in both builds) - all its
 * admin lookups are optional-chained so it runs fine with these elements
 * simply absent, and main.js's requireDevVariant() is the real backend
 * enforcement regardless of what the UI does or doesn't show.
 */
function stripAdminMarkup(html) {
  return html.replace(/[ \t]*<!-- ADMIN:START -->[\s\S]*?<!-- ADMIN:END -->\n?/g, '');
}

const variantFile = path.join(__dirname, '..', 'lib', 'variant.js');
const original = fs.readFileSync(variantFile, 'utf8');

const productName = variant === 'dev' ? 'Nyx Client Dev' : 'Nyx Client';
const appId = variant === 'dev'
  ? 'com.nyxclientproject.launcher.dev'
  : 'com.nyxclientproject.launcher';
// Separate update feed per variant (latest.yml vs latest-dev.yml on the same
// GitHub repo/releases) so Dev and Public only ever offer to update
// themselves, never each other.
const publishChannel = variant === 'dev' ? 'dev' : 'latest';
// No spaces here on purpose: GitHub strips/rewrites spaces in uploaded
// release-asset filenames, but latest.yml's checksum entry is written
// against the filename electron-builder produced locally. If those two
// don't match byte-for-byte, electron-updater silently fails to find the
// asset. Keeping the artifact name space-free avoids the mismatch entirely
// instead of relying on renaming files after the fact.
const artifactName = variant === 'dev' ? 'Nyx_Client_Dev_Setup_${version}.${ext}' : 'Nyx_Client_Setup_${version}.${ext}';

function variantFileContents(v) {
  const lines = [
    "'use strict';",
    '/**',
    ' * Which build this is. Edited before each electron-builder run to produce',
    ' * the two artifacts:',
    " *   'dev'    - Admin tab reachable (code unlock in Settings), can generate/",
    ' *              manage remote Premium grants.',
    " *   'public' - no way to reach Admin at all, anywhere, even via the raw",
    ' *              settings file - main.js itself refuses to set adminUnlocked',
    " *              when this is 'public', not just the UI hiding the button.",
    ' *              Premium tab still works normally.',
    ' */',
    'module.exports = {',
    `  VARIANT: '${v}',`,
    '};',
    '',
  ];
  return lines.join('\n');
}

(async () => {
  fs.writeFileSync(variantFile, variantFileContents(variant));
  console.log(`[${variant}] lib/variant.js set to VARIANT='${variant}'`);

  if (variant === 'public') {
    const stripped = stripAdminMarkup(originalIndexHtml);
    const removedCount = (originalIndexHtml.match(/<!-- ADMIN:START -->/g) || []).length;
    if (removedCount === 0) throw new Error('Expected ADMIN:START/END markers in src/index.html but found none - refusing to build public without confirming admin markup was actually stripped.');
    fs.writeFileSync(indexHtmlFile, stripped);
    console.log(`[public] stripped ${removedCount} admin block(s) from src/index.html for this build`);
  }

  try {
    await build({
      targets: Platform.WINDOWS.createTarget(),
      config: { productName, appId, nsis: { artifactName }, publish: { provider: 'github', channel: publishChannel } },
      // Locally (and in this sandbox) this only produces the installer + the
      // update-feed yml file - no GitHub token available or wanted here.
      // The GitHub Actions workflow (.github/workflows/release.yml) sets
      // PUBLISH=always and provides GH_TOKEN automatically, so real
      // releases are published from CI, not from anyone's own machine.
      publish: process.env.PUBLISH === 'always' ? 'always' : 'never',
    });
    console.log(`[${variant}] build complete: ${productName} (channel: ${publishChannel})`);
  } finally {
    fs.writeFileSync(variantFile, original);
    console.log(`[${variant}] lib/variant.js restored`);
    if (variant === 'public') {
      fs.writeFileSync(indexHtmlFile, originalIndexHtml);
      console.log('[public] src/index.html restored');
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
