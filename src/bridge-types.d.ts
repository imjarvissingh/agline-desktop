export {};

declare global {
  interface Window {
    agline?: {
      openCall(callId: string, answerNow?: boolean): Promise<void>;
      closeIncoming(callId: string): Promise<void>;
      isRingerMuted(): Promise<boolean>;
      onRingerMuted(callback: (muted: boolean) => void): () => void;
    };
  }
}
