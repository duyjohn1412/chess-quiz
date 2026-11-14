import { describe, expect, it } from 'vitest';
import {
  formatFriendId,
  identifierToAuthEmail,
  uidToFriendId,
} from '../../src/net/firebaseClient';
import { canonicalPairId } from '../../src/net/socialSystem';

describe('socialAndAuth helpers', () => {
  it('uidToFriendId returns a deterministic 9-digit numeric ID per UID', () => {
    const id1 = uidToFriendId('user_abc_123');
    const id2 = uidToFriendId('user_abc_123');
    const idOther = uidToFriendId('user_xyz_999');

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[1-9][0-9]{8}$/);
    expect(idOther).toMatch(/^[1-9][0-9]{8}$/);
    expect(id1).not.toBe(idOther);
  });

  it('formatFriendId groups 9-digit strings into 3-3-3 and preserves non-9-digit input', () => {
    expect(formatFriendId('482910374')).toBe('482 910 374');
    expect(formatFriendId('482-910-374')).toBe('482 910 374');
    expect(formatFriendId('12345')).toBe('12345');
  });

  it('identifierToAuthEmail maps usernames and validates emails cleanly', () => {
    expect(identifierToAuthEmail('  Duy_Chess14  ')).toBe('duy_chess14@account.chessquiz.vn');
    expect(identifierToAuthEmail('User@Example.COM')).toBe('user@example.com');

    expect(() => identifierToAuthEmail('   ')).toThrow();
    expect(() => identifierToAuthEmail('ab')).toThrow();
    expect(() => identifierToAuthEmail('bad@domain')).toThrow();
    expect(() => identifierToAuthEmail('tieng viet')).toThrow();
  });

  it('canonicalPairId is symmetric regardless of UID argument order', () => {
    expect(canonicalPairId('uidA', 'uidB')).toBe('uidA_uidB');
    expect(canonicalPairId('uidB', 'uidA')).toBe('uidA_uidB');
  });
});
