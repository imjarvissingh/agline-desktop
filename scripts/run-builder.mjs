import { spawnSync } from 'node:child_process';

const env = { ...process.env };
// CI passes unset secrets as empty strings; electron-builder would read them as a certificate path.
for (const key of Object.keys(env)) if (key.startsWith('CSC_') && env[key] === '') delete env[key];
if (!env.CSC_LINK && !env.CSC_NAME) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const args = process.argv.slice(2);
// M-13: once Windows builds are signed, set WIN_PUBLISHER_NAME to the exact certificate CN(s)
// (comma-separated). electron-updater then refuses updates not signed by that publisher, and the
// app re-enables self-updating (scripts/after-pack.cjs records winSigned).
const publishers = (env.WIN_PUBLISHER_NAME ?? '').split(',').map((s) => s.trim()).filter(Boolean);
publishers.forEach((name, i) => args.push(`-c.win.signtoolOptions.publisherName[${i}]=${name}`));

const result = spawnSync('electron-builder', args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error('Could not start electron-builder.');
  process.exit(1);
}
process.exit(result.status ?? 1);
