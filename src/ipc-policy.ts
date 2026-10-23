import { isAllowedDesktopUrl } from './origin-policy.js';

export const IPC_CHANNELS = [
  'open-call',
  'close-incoming',
  'is-ringer-muted',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];
const CHANNEL_SET: ReadonlySet<string> = new Set(IPC_CHANNELS);
export const CALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return CHANNEL_SET.has(channel);
}

export function isTrustedIpcSender(channel: string, senderUrl: string | undefined, origin: string): boolean {
  return isAllowedIpcChannel(channel) && typeof senderUrl === 'string' && isAllowedDesktopUrl(senderUrl, origin);
}

export function isValidCallId(value: unknown): value is string {
  return typeof value === 'string' && CALL_ID_RE.test(value);
}
