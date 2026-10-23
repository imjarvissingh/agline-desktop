const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function normalizeOrigin(raw: string): string {
  const url = new URL(raw);
  const localHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ''));
  if (url.protocol !== 'https:' && !localHttp) throw new Error('AGLINE_ORIGIN must use HTTPS (or loopback HTTP for local development)');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('AGLINE_ORIGIN must contain only an origin');
  return url.origin;
}

export function isAllowedDesktopUrl(raw: string, origin: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === origin && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ''))));
  } catch {
    return false;
  }
}

/** Desktop replies are typed only; the trusted web origin may request notifications but never microphone access. */
export function isAllowedDesktopPermission(permission: string, requestingUrl: string, origin: string): boolean {
  return isAllowedDesktopUrl(requestingUrl, origin) && permission === 'notifications';
}

/** Native notifications can appear on a locked screen. Message text stays inside the app. */
export function incomingNotificationBody(): string { return 'Open AGline to view this call.'; }

export function externalHttpsUrl(raw: string, origin: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin === origin) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function safeExternalHttpsUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
