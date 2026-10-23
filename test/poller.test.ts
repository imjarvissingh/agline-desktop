import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, CallPoller, findIncomingCall, jitteredDelay, type RingCall } from '../src/poller.js';

const now = Date.parse('2026-10-23T12:00:00.000Z');
const ringing = (overrides: Partial<RingCall> = {}): RingCall => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'ringing',
  agent_name: 'Build agent',
  text: 'Ship the patch?',
  created_at: new Date(now - 1_000).toISOString(),
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe('call polling rules', () => {
  it('accepts recent ringing calls and ignores stale or finished calls', () => {
    const found = findIncomingCall([
      ringing({ id: '22222222-2222-4222-8222-222222222222', created_at: new Date(now - 45_001).toISOString() }),
      ringing({ id: '33333333-3333-4333-8333-333333333333', status: 'answered' }),
      ringing(),
    ], now);
    expect(found?.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('selects the newest active call and de-duplicates a call until it stops ringing', async () => {
    const onIncoming = vi.fn();
    const onEnded = vi.fn();
    let calls = [ringing(), ringing({ id: '22222222-2222-4222-8222-222222222222', created_at: new Date(now - 500).toISOString() })];
    vi.useFakeTimers();
    const poller = new CallPoller({ fetchCalls: async () => ({ kind: 'ok', calls }), onIncoming, onEnded, now: () => now, random: () => 0.5 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onIncoming).toHaveBeenCalledTimes(1);
    expect(onIncoming.mock.calls[0]?.[0].id).toBe('22222222-2222-4222-8222-222222222222');
    calls = [];
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onEnded).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    poller.stop();
  });

  it('backs off after errors and resumes polling after sign-in', async () => {
    const fetchCalls = vi.fn<() => Promise<{ kind: 'ok'; calls: RingCall[] } | { kind: 'signed-out' }>>().mockResolvedValue({ kind: 'signed-out' });
    const onStatus = vi.fn();
    vi.useFakeTimers();
    const poller = new CallPoller({ fetchCalls, onIncoming: vi.fn(), onEnded: vi.fn(), onStatus, random: () => 0.5 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenLastCalledWith('signed-out');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls).toHaveBeenCalledTimes(1);
    fetchCalls.mockResolvedValue({ kind: 'ok', calls: [] });
    poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenLastCalledWith('connected');
    fetchCalls.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onStatus).toHaveBeenLastCalledWith('offline');
    expect(backoffDelay(1, () => 0.5)).toBe(6_000);
    expect(backoffDelay(8, () => 0.5)).toBe(60_000);
    expect(jitteredDelay(3_000, () => 0)).toBe(2_700);
    poller.stop();
  });
});
