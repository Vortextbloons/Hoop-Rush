import { describe, expect, it } from 'vitest';
import { friendlyMultiplayerError } from './errors';
import { multiplayerInviteLink } from './invite-link';

describe('multiplayer boundary helpers', () => {
  it('preserves the existing invite path and validates the code', () => {
    expect(multiplayerInviteLink('0042')).toBe('/multiplayer?code=0042');
    expect(() => multiplayerInviteLink('42')).toThrow();
    expect(() => multiplayerInviteLink('1234&room=other')).toThrow();
  });
  it('formats network and protocol errors with optional mode mappings', () => {
    expect(friendlyMultiplayerError(new Error('Failed to fetch'))).toContain(
      'Check your connection',
    );
    expect(friendlyMultiplayerError(new Error('invalid-code'))).toContain('4 digits');
    expect(friendlyMultiplayerError(new Error('rate-limit'))).toContain('Wait a minute');
    expect(
      friendlyMultiplayerError(new Error('custom'), (message) =>
        message === 'custom' ? 'Mode recovery' : null,
      ),
    ).toBe('Mode recovery');
    expect(friendlyMultiplayerError(new Error('x'.repeat(300)))).toHaveLength(240);
  });
});
