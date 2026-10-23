import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import electronUpdater from 'electron-updater';
import { CredentialStore } from './credential-store.js';
import { isTrustedIpcSender, isValidCallId } from './ipc-policy.js';
import { externalHttpsUrl, incomingNotificationBody, isAllowedDesktopPermission, isAllowedDesktopUrl, normalizeOrigin, safeExternalHttpsUrl } from './origin-policy.js';
import { CallPoller, type FetchCallsResult, type PollerStatus, type RingCall } from './poller.js';

type TrayStatus = PollerStatus;
type BuildMetadata = { macSigned?: boolean };
type AuthCookieSnapshot = {
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
};

const APP_PROTOCOL = 'agline';
const DEFAULT_ORIGIN = 'https://agline.in';
const UPDATE_FEED = 'https://agline.in/downloads/desktop/';
const PARTITION = 'persist:agline';
const CALL_PATH = (id: string) => `/call/${id}`;
const INCOMING_PATH = (id: string) => `/desktop/incoming?id=${encodeURIComponent(id)}`;
const AUTH_COOKIE_NAMES = new Set(['cm_session', 'cm_device', 'cm_pair']);
const ownDir = fileURLToPath(new URL('.', import.meta.url));
const isSmoke = process.env.AGLINE_SMOKE_TEST === '1';

const origin = normalizeOrigin(process.env.AGLINE_ORIGIN ?? DEFAULT_ORIGIN);
const updateUrl = UPDATE_FEED;
const desktopPlatform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
// Sessions can only be created once the app is ready; assigned at the start of whenReady.
let partition: Session;

let mainWindow: BrowserWindow | undefined;
let incomingWindow: BrowserWindow | undefined;
let incomingCallId: string | undefined;
let tray: Tray | undefined;
let trayStatus: TrayStatus = 'signed-out';
let muted = false;
let isQuitting = false;
let poller: CallPoller | undefined;
let cookieVault: CredentialStore | undefined;
let cookieSnapshotSync: Promise<void> = Promise.resolve();
let pendingDeepLink: string | undefined;

function logInfo(message: string): void {
  console.info(`[desktop] ${message}`);
}

function makeOriginUrl(path: string): string {
  return new URL(path, `${origin}/`).href;
}

function asStatusName(status: TrayStatus): string {
  if (status === 'connected') return 'Connected';
  if (status === 'offline') return 'Offline';
  return 'Signed out';
}

// Packaged, assets sit beside the code inside the app bundle. Unpackaged (`electron dist/src/main.js`) the app path is dist/src, so go up to the package.
const assetPath = (name: string) => join(app.isPackaged ? app.getAppPath() : join(ownDir, '..', '..'), 'assets', name);
const appIcon = () => nativeImage.createFromPath(assetPath('app-icon.png'));

function trayIcon(status: TrayStatus) {
  const file = process.platform === 'win32' ? `tray-win-${status}.png` : `tray-${status}.png`;
  return nativeImage.createFromPath(assetPath(file));
}

function setTrayStatus(status: TrayStatus): void {
  trayStatus = status;
  if (!tray) return;
  tray.setImage(trayIcon(status));
  tray.setToolTip(`AGline — ${asStatusName(status)}`);
  if (process.platform === 'darwin') tray.setTitle(status === 'connected' ? '●' : '○');
  rebuildTrayMenu();
}

function setRingerMuted(value: boolean): void {
  muted = value;
  if (incomingWindow && !incomingWindow.isDestroyed() && isAllowedDesktopUrl(incomingWindow.webContents.getURL(), origin)) {
    incomingWindow.webContents.send('ringer-muted', muted);
  }
  rebuildTrayMenu();
}

function showDownloadPage(): void {
  const url = safeExternalHttpsUrl(`${origin}/download`);
  if (url) void shell.openExternal(url);
}

function metadata(): BuildMetadata {
  const candidates = [join(process.resourcesPath, 'desktop-build.json'), join(ownDir, '../desktop-build.json')];
  for (const file of candidates) {
    try { return JSON.parse(readFileSync(file, 'utf8')) as BuildMetadata; }
    catch { /* development build or older package */ }
  }
  return {};
}

let manualUpdateCheck = false;

function setupUpdater(): void {
  if (process.env.AGLINE_DISABLE_UPDATES === '1') {
    logInfo('updates disabled by AGLINE_DISABLE_UPDATES');
    return;
  }
  if (!app.isPackaged || (process.platform === 'darwin' && !metadata().macSigned)) {
    logInfo(process.platform === 'darwin'
      ? 'updates disabled on macOS: this build is unsigned; Check for updates opens the download page'
      : 'updates disabled in an unpackaged development run');
    return;
  }
  // electron-updater's getter needs the app to be ready, so read it lazily.
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
  autoUpdater.on('checking-for-update', () => logInfo('checking for updates'));
  // A check started from the tray menu reports its result; the automatic check stays quiet unless an update is ready.
  autoUpdater.on('update-available', (info) => { logInfo('update available; downloading'); if (manualUpdateCheck) void dialog.showMessageBox({ type: 'info', title: 'AGline', message: `Version ${info.version} is available.`, detail: 'It is downloading now and you will be asked to restart when it is ready.' }); });
  autoUpdater.on('update-not-available', () => { logInfo('no update available'); if (manualUpdateCheck) { manualUpdateCheck = false; void dialog.showMessageBox({ type: 'info', title: 'AGline', message: 'AGline is up to date.', detail: `Version ${app.getVersion()}` }); } });
  autoUpdater.on('update-downloaded', () => {
    logInfo('update downloaded; it will install when AGline quits');
    manualUpdateCheck = false;
    void dialog.showMessageBox({ type: 'info', title: 'AGline update ready', message: 'A new version of AGline is ready.', detail: 'Restart now to install it, or it installs when you quit.', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
      .then((r) => { if (r.response === 0) { isQuitting = true; autoUpdater.quitAndInstall(false, true); } });
  });
  autoUpdater.on('error', () => { logInfo('update check failed'); if (manualUpdateCheck) { manualUpdateCheck = false; void dialog.showMessageBox({ type: 'warning', title: 'AGline', message: 'Could not check for updates.', detail: 'Check your internet connection and try again.' }); } });
}

function checkForUpdates(manual = true): void {
  if (process.env.AGLINE_DISABLE_UPDATES === '1') return;
  if (!app.isPackaged || (process.platform === 'darwin' && !metadata().macSigned)) {
    showDownloadPage();
    return;
  }
  manualUpdateCheck = manual;
  void electronUpdater.autoUpdater.checkForUpdates().catch(() => { logInfo('update check failed'); manualUpdateCheck = false; });
}

function setLaunchAtLogin(openAtLogin: boolean): void {
  app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] });
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const loginEnabled = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: `● ${asStatusName(trayStatus)}`, enabled: false },
    { type: 'separator' },
    { label: 'Open AGline', click: () => openMainWindow() },
    { label: 'Mute ringer', type: 'checkbox', checked: muted, click: (item) => setRingerMuted(item.checked) },
    { label: 'Launch at login', type: 'checkbox', checked: loginEnabled, click: (item) => setLaunchAtLogin(item.checked) },
    { label: 'Check for updates', click: () => checkForUpdates() },
    { label: 'Send feedback', click: () => openPage('/feedback') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; poller?.stop(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function ensureMainWindow(hidden = false): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const win = new BrowserWindow({
    icon: appIcon(),
    autoHideMenuBar: process.platform !== 'darwin',
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    show: !hidden,
    title: 'AGline',
    backgroundColor: '#f8f9fc',
    webPreferences: {
      partition: PARTITION,
      preload: join(ownDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow = win;
  guardWebContents(win.webContents);
  win.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { if (mainWindow === win) mainWindow = undefined; });
  win.webContents.on('did-finish-load', () => {
    poller?.resume();
    if (pendingDeepLink) {
      const url = pendingDeepLink;
      pendingDeepLink = undefined;
      handleDeepLink(url);
    }
  });
  win.webContents.on('did-navigate-in-page', () => poller?.resume());
  void win.loadURL(makeOriginUrl('/number'));
  return win;
}

function guardWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalHttpsUrl(url, origin);
    if (external) void shell.openExternal(external);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAllowedDesktopUrl(url, origin)) return;
    event.preventDefault();
    const external = externalHttpsUrl(url, origin);
    if (external) void shell.openExternal(external);
  });
  contents.on('will-redirect', (event, url) => {
    if (isAllowedDesktopUrl(url, origin)) return;
    event.preventDefault();
    const external = externalHttpsUrl(url, origin);
    if (external) void shell.openExternal(external);
  });
}

function openMainWindow(): void {
  const win = ensureMainWindow();
  win.show();
  win.focus();
}

function openPage(path: string): void {
  const win = ensureMainWindow();
  win.show();
  win.focus();
  void win.loadURL(makeOriginUrl(path));
}

function openCall(callId: string, answerNow = false): void {
  if (!isValidCallId(callId)) return;
  closeIncomingWindow(callId);
  const win = ensureMainWindow();
  win.show();
  win.focus();
  const target = answerNow ? `${CALL_PATH(callId)}?answer=1` : CALL_PATH(callId);
  void win.loadURL(makeOriginUrl(target));
}

function createIncomingWindow(call: RingCall): void {
  if (incomingWindow && !incomingWindow.isDestroyed()) {
    if (incomingCallId === call.id) { incomingWindow.show(); incomingWindow.focus(); return; }
    closeIncomingWindow(incomingCallId);
  }
  const win = new BrowserWindow({
    icon: appIcon(),
    width: 430,
    height: 300,
    minWidth: 390,
    minHeight: 270,
    maxWidth: 520,
    maxHeight: 360,
    title: 'Incoming AGline call',
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#f8f9fc',
    webPreferences: {
      partition: PARTITION,
      preload: join(ownDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  incomingWindow = win;
  incomingCallId = call.id;
  guardWebContents(win.webContents);
  win.on('closed', () => {
    if (incomingWindow === win) { incomingWindow = undefined; incomingCallId = undefined; }
  });
  win.webContents.on('did-finish-load', () => { if (!win.isDestroyed()) win.show(); });
  void win.loadURL(makeOriginUrl(INCOMING_PATH(call.id)));
  if (!mainWindow?.isFocused()) showCallNotification(call);
}

function closeIncomingWindow(callId?: string): void {
  if (!incomingWindow || incomingWindow.isDestroyed() || (callId && incomingCallId !== callId)) return;
  const win = incomingWindow;
  incomingWindow = undefined;
  incomingCallId = undefined;
  win.close();
}

function showCallNotification(call: RingCall): void {
  // On Windows the always-on-top popup already carries the call; the toast only duplicated it, lingered for a minute and covered the tray.
  if (!Notification.isSupported() || process.platform === 'win32') return;
  const notification = new Notification({
    title: `${call.agent_name || 'An agent'} is calling`,
    body: incomingNotificationBody(),
    // Toast buttons are delivered to the app on macOS only; on Windows they appeared but did nothing, so there it is a plain toast
    // and the always-on-top popup carries Answer and Decline.
    ...(process.platform === 'darwin' ? { actions: [{ type: 'button' as const, text: 'Answer' }, { type: 'button' as const, text: 'Decline' }] } : {}),
  });
  notification.on('click', () => openMainCallFromNotification(call.id));
  notification.on('action', (event) => {
    if (event.actionIndex === 0) openMainCallFromNotification(call.id, true);
    else if (event.actionIndex === 1) void declineCallFromMain(call.id);
  });
  notification.on('failed', () => logInfo('native notification was unavailable'));
  notification.show();
}

function openMainCallFromNotification(callId: string, answerNow = false): void {
  openCall(callId, answerNow);
}

async function declineCallFromMain(callId: string): Promise<void> {
  if (!isValidCallId(callId)) return;
  closeIncomingWindow(callId);
  const win = ensureMainWindow(true);
  try {
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    }
    await win.webContents.executeJavaScript(`fetch('/api/v1/calls/${callId}/decline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => true)`);
  } catch {
    logInfo('native notification decline could not reach the web app');
  }
}

function setupPermissions(): void {
  partition.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(!!webContents && isAllowedDesktopUrl(webContents.getURL(), origin) && isAllowedDesktopPermission(permission, details.requestingUrl, origin));
  });
  partition.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return !!webContents && isAllowedDesktopUrl(webContents.getURL(), origin) && isAllowedDesktopPermission(permission, requestingOrigin, origin);
  });
}

async function setupCredentialVault(): Promise<void> {
  cookieVault = new CredentialStore(join(app.getPath('userData'), 'auth-cookies.enc'), safeStorage);
  const syncSnapshot = async () => {
    const cookies = await partition.cookies.get({ url: `${origin}/` });
    const authCookies: AuthCookieSnapshot[] = cookies.filter((cookie) => AUTH_COOKIE_NAMES.has(cookie.name)).map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      path: cookie.path ?? '/',
      secure: cookie.secure ?? origin.startsWith('https:'),
      httpOnly: cookie.httpOnly ?? true,
      sameSite: cookie.sameSite,
      ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
    }));
    if (authCookies.length) await cookieVault?.write(JSON.stringify(authCookies));
    else await cookieVault?.clear();
  };
  partition.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (!removed && AUTH_COOKIE_NAMES.has(cookie.name)) poller?.resume();
    cookieSnapshotSync = cookieSnapshotSync.then(syncSnapshot).catch(() => logInfo('OS credential store unavailable; Chromium cookie encryption remains enabled'));
  });
  try {
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      const existing = await partition.cookies.get({ url: `${origin}/` });
      if (!existing.some((cookie) => AUTH_COOKIE_NAMES.has(cookie.name))) {
        const saved = await cookieVault.read();
        const rows = saved ? JSON.parse(saved) as AuthCookieSnapshot[] : [];
        for (const cookie of rows) {
          if (!AUTH_COOKIE_NAMES.has(cookie.name) || !cookie.value || !cookie.path.startsWith('/')) continue;
          await partition.cookies.set({ url: `${origin}/`, ...cookie });
        }
      }
    }
    await syncSnapshot();
    await cookieSnapshotSync;
  } catch {
    logInfo('OS credential store unavailable; Chromium cookie encryption remains enabled');
  }
}

function fetchCallsFromWebSession(): Promise<FetchCallsResult> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return Promise.reject(new Error('window not ready'));
  const script = `((async () => { const r = await fetch('/api/v1/calls', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15_000) }); if (r.status === 401) return { kind: 'signed-out' }; if (!r.ok) throw new Error('request failed'); const body = await r.json(); return { kind: 'ok', calls: body.calls }; })())`;
  return win.webContents.executeJavaScript(script) as Promise<FetchCallsResult>;
}

function installPoller(): void {
  poller = new CallPoller({
    fetchCalls: fetchCallsFromWebSession,
    onIncoming: createIncomingWindow,
    onEnded: (callId) => closeIncomingWindow(callId),
    onStatus: setTrayStatus,
  });
  poller.start();
}

function registerIpcHandlers(): void {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
  const handlers = {
    'open-call': (_event: IpcMainInvokeEvent, callId: unknown, answerNow: unknown) => { if (isValidCallId(callId)) openCall(callId, answerNow === true); },
    'close-incoming': (_event: IpcMainInvokeEvent, callId: unknown) => { if (isValidCallId(callId)) closeIncomingWindow(callId); },
    'is-ringer-muted': () => muted,
  } satisfies Record<string, Handler>;
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedIpcSender(channel, event.senderFrame?.url, origin)) throw new Error('forbidden');
      return (handler as Handler)(event, ...args);
    });
  }
}

function parseDeepLink(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${APP_PROTOCOL}:` || url.username || url.password) return undefined;
    const route = `${url.hostname ? `/${url.hostname}` : ''}${url.pathname}`;
    const match = /^\/call\/([0-9a-f-]{36})$/i.exec(route);
    return match && isValidCallId(match[1]) ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

function handleDeepLink(raw: string): void {
  const callId = parseDeepLink(raw);
  if (!callId) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingDeepLink = raw;
    ensureMainWindow();
    return;
  }
  openCall(callId);
}

function installProtocolHandling(): void {
  if (!app.isDefaultProtocolClient(APP_PROTOCOL)) app.setAsDefaultProtocolClient(APP_PROTOCOL);
  app.on('open-url', (event, url) => { event.preventDefault(); handleDeepLink(url); });
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find((argument) => argument.startsWith(`${APP_PROTOCOL}://`));
    if (url) handleDeepLink(url);
    else openMainWindow();
  });
}

function setupSmokeState(): void {
  if (!isSmoke) return;
  Object.defineProperty(globalThis, '__aglineSmokeState', {
    configurable: false,
    enumerable: false,
    value: { get hasTray() { return !!tray; }, get status() { return trayStatus; }, get incomingCallId() { return incomingCallId; } },
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  installProtocolHandling();
  registerIpcHandlers();
  app.on('before-quit', () => { isQuitting = true; poller?.stop(); });
  app.on('window-all-closed', () => { /* keep the tray app alive */ });
  app.on('activate', () => openMainWindow());

  void app.whenReady().then(async () => {
    app.setName('AGline');
    if (process.platform === 'darwin') {
      // Automated runs must not flash an app in the Dock; an unpackaged development run would otherwise show Electron's own icon.
      if (isSmoke || process.env.AGLINE_E2E === '1') app.dock?.hide();
      else if (!app.isPackaged) app.dock?.setIcon(nativeImage.createFromPath(assetPath('dock-icon.png')));
    }
    partition = session.fromPartition(PARTITION, { cache: true });
    partition.setUserAgent(`${partition.getUserAgent()} AGlineDesktop/${desktopPlatform}`);
    if (process.platform === 'win32') app.setAppUserModelId('in.agline.desktop');
    setupPermissions();
    // A Keychain/DPAPI prompt can sit unanswered; do not keep the window and tray waiting for it.
    await Promise.race([setupCredentialVault(), new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
    tray = new Tray(trayIcon(trayStatus));
    tray.on('click', () => openMainWindow());
    tray.on('double-click', () => openMainWindow());
    rebuildTrayMenu();
    setupUpdater();
    ensureMainWindow(app.getLoginItemSettings().wasOpenedAtLogin || process.argv.includes('--hidden'));
    installPoller();
    setupSmokeState();
    if (app.isPackaged && (process.platform !== 'darwin' || metadata().macSigned)) setTimeout(() => checkForUpdates(false), 7_000).unref();
    if (pendingDeepLink) handleDeepLink(pendingDeepLink);
    logInfo('desktop shell ready');
  }).catch(() => {
    logInfo('startup failed');
    app.quit();
  });
}

export { parseDeepLink };
