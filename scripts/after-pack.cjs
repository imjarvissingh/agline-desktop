const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Records whether this package is code-signed so the app only self-updates when it is (M-13).
// Windows also needs WIN_PUBLISHER_NAME (exact certificate CN, comma-separated for several) so
// electron-updater checks the signer of each downloaded update; run-builder.mjs passes the same
// value to electron-builder as win.signtoolOptions.publisherName.
exports.default = async function afterPack(context) {
  const isMac = context.electronPlatformName === 'darwin';
  const isWin = context.electronPlatformName === 'win32';
  const resourceDir = isMac
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  mkdirSync(resourceDir, { recursive: true });
  const hasCert = Boolean(process.env.CSC_LINK || process.env.CSC_NAME || (isWin && process.env.WIN_CSC_LINK));
  const winPublisherName = (process.env.WIN_PUBLISHER_NAME || '').split(',').map((s) => s.trim()).filter(Boolean);
  const macSigned = isMac && hasCert;
  const winSigned = isWin && hasCert && winPublisherName.length > 0;
  writeFileSync(join(resourceDir, 'desktop-build.json'), JSON.stringify({ macSigned, winSigned, winPublisherName }), { mode: 0o644 });
};
