import { contextBridge, ipcRenderer } from 'electron';

const agline = Object.freeze({
  openCall: (callId: string, answerNow = false) => ipcRenderer.invoke('open-call', callId, answerNow) as Promise<void>,
  closeIncoming: (callId: string) => ipcRenderer.invoke('close-incoming', callId) as Promise<void>,
  isRingerMuted: () => ipcRenderer.invoke('is-ringer-muted') as Promise<boolean>,
  onRingerMuted: (callback: (muted: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, muted: boolean) => callback(muted);
    ipcRenderer.on('ringer-muted', listener);
    return () => ipcRenderer.removeListener('ringer-muted', listener);
  },
});

contextBridge.exposeInMainWorld('agline', agline);
