/** Build facts written by scripts/after-pack.cjs into resources/desktop-build.json. */
export type BuildMetadata = { macSigned?: boolean; winSigned?: boolean; winPublisherName?: string[] };

/**
 * Self-updating is allowed only for packaged builds that are code-signed on their platform.
 * Windows additionally needs a configured publisherName so electron-updater verifies the
 * Authenticode signer of a downloaded update before installing it (M-13). Anything else
 * (unsigned Windows or macOS, dev runs, other platforms) must not download or install updates;
 * "Check for updates" opens the download page instead.
 */
export function autoUpdateAllowed(platform: string, packaged: boolean, meta: BuildMetadata): boolean {
  if (!packaged) return false;
  if (platform === 'darwin') return meta.macSigned === true;
  if (platform === 'win32') return meta.winSigned === true && Array.isArray(meta.winPublisherName) && meta.winPublisherName.some((n) => typeof n === 'string' && n.trim().length > 0);
  return false;
}

/** Publisher names from WIN_PUBLISHER_NAME (comma-separated exact certificate CNs). */
export function parsePublisherNames(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
