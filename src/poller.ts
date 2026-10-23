export type RingCall = {
  id: string;
  status: string;
  agent_name: string;
  text: string;
  created_at: string;
};

export type FetchCallsResult = { kind: 'ok'; calls: RingCall[] } | { kind: 'signed-out' };
export type PollerStatus = 'connected' | 'offline' | 'signed-out';

export const DEFAULT_POLL_MS = 3_000;
export const MAX_BACKOFF_MS = 60_000;
export const RING_MAX_AGE_MS = 45_000;

export function findIncomingCall(calls: RingCall[], now = Date.now()): RingCall | undefined {
  return calls
    .filter((call) => call.status === 'ringing' && now - new Date(call.created_at).getTime() < RING_MAX_AGE_MS)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

export function jitteredDelay(baseMs: number, random = Math.random, spread = 0.1): number {
  const bounded = Math.max(0, Math.min(1, random()));
  return Math.max(1, Math.round(baseMs * (1 - spread + bounded * spread * 2)));
}

export function backoffDelay(failureCount: number, random = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, DEFAULT_POLL_MS * 2 ** Math.max(1, failureCount));
  return jitteredDelay(exponential, random, 0.2);
}

type PollerOptions = {
  fetchCalls: () => Promise<FetchCallsResult>;
  onIncoming: (call: RingCall) => void;
  onEnded: (callId: string) => void;
  onStatus?: (status: PollerStatus) => void;
  now?: () => number;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

export class CallPoller {
  private running = false;
  private paused = false;
  private failures = 0;
  private currentId: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(private readonly options: PollerOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  resume(): void {
    this.running = true;
    this.paused = false;
    this.failures = 0;
    this.clearScheduled();
    this.schedule(0);
  }

  pauseSignedOut(): void {
    this.paused = true;
    this.clearScheduled();
    this.endCurrent();
    this.options.onStatus?.('signed-out');
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.clearScheduled();
    this.endCurrent();
  }

  async pollOnce(): Promise<void> {
    if (!this.running || this.paused) return;
    try {
      const result = await this.options.fetchCalls();
      if (result.kind === 'signed-out') {
        this.pauseSignedOut();
        return;
      }
      this.failures = 0;
      this.options.onStatus?.('connected');
      const call = findIncomingCall(result.calls, this.now());
      if (!call) this.endCurrent();
      else if (call.id !== this.currentId) {
        this.endCurrent();
        this.currentId = call.id;
        this.options.onIncoming(call);
      }
    } catch {
      this.failures += 1;
      this.options.onStatus?.('offline');
      throw new Error('call poll failed');
    }
  }

  private endCurrent(): void {
    if (!this.currentId) return;
    const id = this.currentId;
    this.currentId = undefined;
    this.options.onEnded(id);
  }

  private clearScheduled(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule(delay: number): void {
    if (!this.running || this.paused) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    try {
      await this.pollOnce();
      if (this.running && !this.paused) this.schedule(jitteredDelay(DEFAULT_POLL_MS, this.random));
    } catch {
      if (this.running && !this.paused) this.schedule(backoffDelay(this.failures, this.random));
    }
  }
}
