import { describe, expect, it, vi } from 'vitest';
import { startAtLoginMenuItem } from '../src/login-settings.js';

describe('start at login tray setting', () => {
  it('reflects, persists, and can turn off the hidden startup setting', () => {
    let enabled = false;
    const app = {
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: enabled })),
      setLoginItemSettings: vi.fn(({ openAtLogin }: { openAtLogin: boolean }) => { enabled = openAtLogin; }),
    };
    const refreshMenu = vi.fn();

    const off = startAtLoginMenuItem(app, refreshMenu);
    expect(off).toMatchObject({ label: 'Start at login', type: 'checkbox', checked: false });
    off.click({ checked: true });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, args: ['--hidden'] });
    expect(refreshMenu).toHaveBeenCalledTimes(1);
    expect(startAtLoginMenuItem(app, refreshMenu).checked).toBe(true);

    startAtLoginMenuItem(app, refreshMenu).click({ checked: false });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, args: ['--hidden'] });
    expect(startAtLoginMenuItem(app, refreshMenu).checked).toBe(false);
  });
});
