import { spawnSync } from 'node:child_process';

const env = { ...process.env };
// CI passes unset secrets as empty strings; electron-builder would read them as a certificate path.
for (const key of Object.keys(env)) if (key.startsWith('CSC_') && env[key] === '') delete env[key];
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
