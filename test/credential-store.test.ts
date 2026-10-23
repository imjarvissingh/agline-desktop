import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageApi } from '../src/credential-store.js';

let tempDir = '';
afterEach(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); tempDir = ''; });

function mockSafeStorage(): SafeStorageApi {
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`)),
    decryptStringAsync: vi.fn(async (value) => ({ result: Buffer.from(value.toString().slice(7), 'base64').toString(), shouldReEncrypt: false })),
  };
}

describe('credential store', () => {
  it('writes OS-encrypted data and reads it back', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agline-credential-test-'));
    const path = join(tempDir, 'auth.enc');
    const storage = mockSafeStorage();
    const store = new CredentialStore(path, storage);
    await store.write('session-token-never-plain');
    const bytes = await readFile(path);
    expect(bytes.toString()).not.toContain('session-token-never-plain');
    expect(await store.read()).toBe('session-token-never-plain');
    await store.clear();
    expect(await store.read()).toBeUndefined();
    expect(storage.encryptStringAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses to persist when OS encryption is unavailable', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agline-credential-test-'));
    const storage = mockSafeStorage();
    vi.mocked(storage.isAsyncEncryptionAvailable).mockResolvedValue(false);
    const store = new CredentialStore(join(tempDir, 'auth.enc'), storage);
    await expect(store.write('session-token')).rejects.toThrow('OS credential encryption is unavailable');
  });
});
