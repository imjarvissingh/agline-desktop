const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const isMac = context.electronPlatformName === 'darwin';
  const resourceDir = isMac
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  mkdirSync(resourceDir, { recursive: true });
  const macSigned = isMac && Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
  writeFileSync(join(resourceDir, 'desktop-build.json'), JSON.stringify({ macSigned }), { mode: 0o644 });
};
