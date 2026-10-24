type LoginItemApp = {
  getLoginItemSettings(options: { args: string[] }): { openAtLogin: boolean };
  setLoginItemSettings(options: { openAtLogin: boolean; args: string[] }): void;
};

export function startAtLoginMenuItem(app: LoginItemApp, refreshMenu: () => void) {
  return {
    label: 'Start at login',
    type: 'checkbox' as const,
    checked: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
    click: (item: { checked: boolean }) => {
      app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
      refreshMenu();
    },
  };
}
