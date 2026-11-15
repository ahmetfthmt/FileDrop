import { describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  calculateEtaSeconds,
  formatBytes,
  formatEta,
  formatSpeed,
  isValidRoomCode,
  normalizeRoomCode,
  parseJoinInput,
  sanitizeRelativePath,
} from '../shared/transfer.ts';

describe('shared transfer helpers', () => {
  it('normalizes and validates 6-character room codes', () => {
    expect(normalizeRoomCode(' ab-34xy ')).toBe('AB34XY');
    expect(isValidRoomCode('AB34XY')).toBe(true);
    expect(isValidRoomCode('AB34')).toBe(false);
    expect(isValidRoomCode('O0I1AB')).toBe(false); // ambiguous chars excluded
  });

  it('sanitizes relative folder paths against traversal', () => {
    expect(sanitizeRelativePath('../../secret/photo.png', 'photo.png')).toBe('secret/photo.png');
    expect(sanitizeRelativePath('Tatiller\\2026\\izmir.jpg', 'izmir.jpg')).toBe(
      'Tatiller/2026/izmir.jpg'
    );
    expect(sanitizeRelativePath('..', 'fallback.txt')).toBe('fallback.txt');
  });

  it('builds and parses share URLs and raw codes', () => {
    const url = buildShareUrl('https://drop.example.com/', 'K9M4P2', 'tok_abc123');
    expect(url).toBe('https://drop.example.com/?code=K9M4P2&token=tok_abc123');

    expect(parseJoinInput(url)).toEqual({ code: 'K9M4P2', token: 'tok_abc123' });
    expect(parseJoinInput('k9m4p2')).toEqual({ code: 'K9M4P2' });
    expect(parseJoinInput('invalid')).toBeNull();
  });

  it('formats sizes, speeds, and remaining time', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatSpeed(2 * 1024 * 1024)).toBe('2.0 MB/sn');
    expect(calculateEtaSeconds(10_000, 2_000)).toBe(5);
    expect(formatEta(65)).toBe('1 dk 05 sn');
  });
});
