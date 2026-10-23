const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

// Apple Silicon kills a binary whose signature no longer matches (the fuse step edits the
// Electron binary after Electron's own signature). Without a Developer ID identity, re-sign
// ad hoc so the unsigned build launches. A real identity (CSC_LINK / CSC_NAME) signs in electron-builder.
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
