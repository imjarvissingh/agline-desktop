import { describe, expect, it } from 'vitest';
import { autoUpdateAllowed, parsePublisherNames } from '../src/update-policy.js';

describe('desktop update policy (M-13)', () => {
  it('never self-updates an unpackaged run', () => {
    expect(autoUpdateAllowed('win32', false, { winSigned: true, winPublisherName: ['AGline'] })).toBe(false);
    expect(autoUpdateAllowed('darwin', false, { macSigned: true })).toBe(false);
  });
  it('disables auto-download/install on unsigned Windows builds, as on macOS', () => {
    expect(autoUpdateAllowed('win32', true, {})).toBe(false);
    expect(autoUpdateAllowed('win32', true, { macSigned: true })).toBe(false);
    expect(autoUpdateAllowed('win32', true, { winSigned: false, winPublisherName: ['AGline'] })).toBe(false);
    expect(autoUpdateAllowed('darwin', true, {})).toBe(false);
  });
  it('requires a pinned publisherName before a signed Windows build updates itself', () => {
    expect(autoUpdateAllowed('win32', true, { winSigned: true })).toBe(false);
    expect(autoUpdateAllowed('win32', true, { winSigned: true, winPublisherName: [' '] })).toBe(false);
    expect(autoUpdateAllowed('win32', true, { winSigned: true, winPublisherName: ['AGline Tech'] })).toBe(true);
    expect(autoUpdateAllowed('darwin', true, { macSigned: true })).toBe(true);
    expect(autoUpdateAllowed('linux', true, { macSigned: true, winSigned: true, winPublisherName: ['x'] })).toBe(false);
  });
  it('parses WIN_PUBLISHER_NAME', () => {
    expect(parsePublisherNames(undefined)).toEqual([]);
    expect(parsePublisherNames(' A , B ,,')).toEqual(['A', 'B']);
  });
});
