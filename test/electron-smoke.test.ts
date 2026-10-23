import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { _electron as electron } from 'playwright';

const callId = '11111111-1111-4111-8111-111111111111';
let runningServer: Server | undefined;
let runningElectron: Awaited<ReturnType<typeof electron.launch>> | undefined;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('timed out waiting for desktop smoke condition');
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const keys = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'USER', 'LANG', 'LC_ALL', 'SystemRoot', 'COMSPEC', 'WINDIR'];
  return Object.fromEntries(keys.flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
}

describe('Electron smoke flow', () => {
  afterEach(async () => {
    await runningElectron?.close().catch(() => undefined);
    runningElectron = undefined;
    await new Promise<void>((resolve) => runningServer?.close(() => resolve()) ?? resolve());
    runningServer = undefined;
  });

  it('opens, shows a ringing call, declines it, and hides the main window to the tray', async () => {
    let declines = 0;
    const createdAt = new Date().toISOString();
    runningServer = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>AGline</title><body><h1>AGline fake</h1></body>');
        return;
      }
      if (req.method === 'GET' && req.url === '/api/v1/calls') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ calls: [{ id: callId, status: 'ringing', agent_name: 'Stub agent', text: 'Should I continue?', created_at: createdAt }] }));
        return;
      }
      if (req.method === 'POST' && req.url === `/api/v1/calls/${callId}/decline`) {
        declines += 1;
        res.writeHead(204).end();
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/desktop/incoming')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><title>Incoming AGline call</title><body><main><h1>Incoming call</h1><p>Stub agent</p><p>Should I continue?</p><button id="answer">Answer</button><button id="decline">Decline</button></main><script>
          const id = '${callId}';
          document.querySelector('#answer').addEventListener('click', () => window.agline.openCall(id));
          document.querySelector('#decline').addEventListener('click', async () => { await fetch('/api/v1/calls/' + id + '/decline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await window.agline.closeIncoming(id); });
        </script></body>`);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => runningServer!.listen(0, '127.0.0.1', resolve));
    const address = runningServer.address();
    if (!address || typeof address === 'string') throw new Error('fake server did not bind');
    const appDir = fileURLToPath(new URL('..', import.meta.url));
    const mainPath = join(appDir, 'dist', 'src', 'main.js');
    const env = {
      ...minimalEnvironment(),
      AGLINE_ORIGIN: `http://127.0.0.1:${address.port}`,
      AGLINE_SMOKE_TEST: '1',
      AGLINE_DISABLE_UPDATES: '1',
    };
    runningElectron = await electron.launch({ args: [mainPath], env, timeout: 25_000 });
    await runningElectron.firstWindow();
    await waitFor(() => runningElectron!.windows().some((page) => page.url().includes('/desktop/incoming')));
    const incoming = runningElectron.windows().find((page) => page.url().includes('/desktop/incoming'));
    expect(incoming).toBeDefined();
    expect(await incoming!.getByRole('heading', { name: 'Incoming call' }).isVisible()).toBe(true);
    expect(await incoming!.getByText('Should I continue?').isVisible()).toBe(true);
    await incoming!.getByRole('button', { name: 'Decline' }).click();
    await waitFor(() => declines === 1);
    await waitFor(() => runningElectron!.windows().filter((page) => page.url().includes('/desktop/incoming')).length === 0);
    const hasTray = await runningElectron.evaluate(() => (globalThis as unknown as { __aglineSmokeState: { hasTray: boolean } }).__aglineSmokeState.hasTray);
    expect(hasTray).toBe(true);
    await runningElectron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'AGline')?.close();
    });
    const mainHidden = await runningElectron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible()));
    expect(mainHidden).toBe(true);
  }, 45_000);
});
