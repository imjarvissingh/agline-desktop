import { spawnSync } from 'node:child_process';

const env = { ...process.env };
if (!env.CSC_LINK && !env.CSC_NAME) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const result = spawnSync('electron-builder', process.argv.slice(2), {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error('Could not start electron-builder.');
  process.exit(1);
}
process.exit(result.status ?? 1);
