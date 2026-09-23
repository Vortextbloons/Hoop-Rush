import { describe, expect, it } from 'vitest';
import { ultimateNextActionOf } from './ultimate-hub.ts';

const readyTeam = { exists: true, valid: true, saved: true };

describe('ultimateNextActionOf', () => {
  it('uses the documented stable priority from starter through useful pack', () => {
    expect(
      ultimateNextActionOf({
        starterClaimed: false,
        team: readyTeam,
        pendingMatchup: true,
        unviewedResult: true,
        affordablePackId: 'tip-off',
      }).kind,
    ).toBe('claim-starter');
    expect(
      ultimateNextActionOf({
        starterClaimed: true,
        team: { ...readyTeam, valid: false },
        pendingMatchup: true,
        unviewedResult: true,
        affordablePackId: 'tip-off',
      }).kind,
    ).toBe('finish-team');
    expect(
      ultimateNextActionOf({
        starterClaimed: true,
        team: readyTeam,
        pendingMatchup: true,
        unviewedResult: true,
        affordablePackId: 'tip-off',
      }).kind,
    ).toBe('resume-matchup');
    expect(
      ultimateNextActionOf({
        starterClaimed: true,
        team: readyTeam,
        pendingMatchup: false,
        unviewedResult: true,
        affordablePackId: 'tip-off',
      }).kind,
    ).toBe('view-result');
    expect(
      ultimateNextActionOf({
        starterClaimed: true,
        team: readyTeam,
        pendingMatchup: false,
        unviewedResult: false,
        affordablePackId: 'tip-off',
      }).kind,
    ).toBe('open-pack');
  });

  it('falls back to play when no pack is affordable', () => {
    expect(
      ultimateNextActionOf({
        starterClaimed: true,
        team: readyTeam,
        pendingMatchup: false,
        unviewedResult: false,
        affordablePackId: null,
      }).kind,
    ).toBe('play');
  });
});
