import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uninstaller = readFileSync(resolve(import.meta.dirname, '../scripts/uninstaller.nsh'), 'utf8');

describe('Windows uninstaller cleanup', () => {
  it('deletes the invoking user updater cache in per-machine mode and restores all-users context', () => {
    expect(uninstaller).toMatch(/\$installMode == "all"[\s\S]*?SetShellVarContext current[\s\S]*?RMDir \/r "\$LOCALAPPDATA\\desktop-updater"[\s\S]*?\$installMode == "all"[\s\S]*?SetShellVarContext all/);
    expect(uninstaller).not.toMatch(/RMDir \/r "\$APPDATA\\AGline"/i);
  });

  it('retries removing the install directory after the uninstaller exits', () => {
    expect(uninstaller).toMatch(/SetOutPath \$TEMP[\s\S]*?RMDir \/REBOOTOK "\$INSTDIR"[\s\S]*?ExecShell "open" "\$SYSDIR\\cmd\.exe" '[\s\S]*?ping -n 3 127\.0\.0\.1 >NUL & rmdir "\$INSTDIR"' SW_HIDE/);
  });
});
