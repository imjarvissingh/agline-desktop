import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender, isValidCallId } from '../src/ipc-policy.js';
import { externalHttpsUrl, isAllowedDesktopUrl, normalizeOrigin, safeExternalHttpsUrl } from '../src/origin-policy.js';

describe('desktop URL and IPC policy', () => {
  const origin = 'https://agline.in';

  it('allows only the configured origin and permits external HTTPS links', () => {
    expect(isAllowedDesktopUrl('https://agline.in/call/123', origin)).toBe(true);
    expect(isAllowedDesktopUrl('https://www.agline.in/', origin)).toBe(false);
    expect(isAllowedDesktopUrl('http://agline.in/', origin)).toBe(false);
    expect(isAllowedDesktopUrl('javascript:alert(1)', origin)).toBe(false);
    expect(externalHttpsUrl('https://example.com/path', origin)).toBe('https://example.com/path');
    expect(externalHttpsUrl('http://example.com/', origin)).toBeUndefined();
    expect(externalHttpsUrl('https://user:pass@example.com/', origin)).toBeUndefined();
    expect(safeExternalHttpsUrl('mailto:help@agline.in')).toBeUndefined();
  });

  it('accepts loopback HTTP for local tests but rejects remote HTTP', () => {
    expect(normalizeOrigin('http://127.0.0.1:4312')).toBe('http://127.0.0.1:4312');
    expect(isAllowedDesktopUrl('http://127.0.0.1:4312/desktop/incoming', 'http://127.0.0.1:4312')).toBe(true);
    expect(() => normalizeOrigin('http://agline.in')).toThrow();
    expect(() => normalizeOrigin('https://agline.in/path')).toThrow();
  });

  it('validates IPC names, origin, and call IDs', () => {
    expect(isTrustedIpcSender('open-call', 'https://agline.in/desktop/incoming', origin)).toBe(true);
    expect(isTrustedIpcSender('delete-everything', 'https://agline.in/', origin)).toBe(false);
    expect(isTrustedIpcSender('open-call', 'https://evil.example/', origin)).toBe(false);
    expect(isValidCallId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isValidCallId('../calls')).toBe(false);
  });
});
