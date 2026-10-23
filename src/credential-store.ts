import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type SafeStorageApi = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

export class CredentialStore {
  constructor(private readonly filePath: string, private readonly safeStorage: SafeStorageApi) {}

  async write(value: string): Promise<void> {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS credential encryption is unavailable');
    const encrypted = await this.safeStorage.encryptStringAsync(value);
    const tempPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(tempPath, encrypted, { mode: 0o600 });
    await rename(tempPath, this.filePath);
  }

  async read(): Promise<string | undefined> {
    let encrypted: Buffer;
    try { encrypted = await readFile(this.filePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS credential encryption is unavailable');
    const decrypted = await this.safeStorage.decryptStringAsync(encrypted);
    return decrypted.result;
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
