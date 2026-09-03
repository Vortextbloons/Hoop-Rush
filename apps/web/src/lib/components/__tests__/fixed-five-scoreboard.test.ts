import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { idSchema, type FixedFiveRoomSnapshot } from '@hoop-rush/data-contracts';
import FixedFiveScoreboard from '$lib/components/FixedFiveScoreboard.svelte';

function snapshot(): FixedFiveRoomSnapshot {
  return {
    roomId: idSchema.parse('room-1'),
    code: '0042',
    codeActive: true,
    settings: {
      schemaVersion: 1,
      mode: 'duel',
      sourceMode: 'classic',
      variant: 'ratings',
      timerPolicyVersion: 'fixed-five-autopick-v1',
      versions: {
        dataVersion: 'd',
        ratingVersion: 'r',
        positionNormalizationVersion: 'p',
        engineVersion: 'e',
        bracketVersion: 'b',
        scheduleVersion: 'schedule-v1',
        seedDerivationVersion: 'seed-v1',
        classicRollVersion: 'classic-roll-v1',
        profileVersion: 'prof',
        multiplayerVersion: 'fixed-five-multiplayer-v1',
        autopickVersion: 'fixed-five-autopick-v1',
      },
    },
    phase: 'drafting',
    revision: 3,
    commandCount: 3,
    digest: null,
    members: [
      {
        participantId: 'p1',
        online: true,
        ready: true,
        picksCommitted: 3,
        locked: false,
        lastSeenAt: null,
      },
      {
        participantId: 'p2',
        online: false,
        ready: false,
        picksCommitted: 1,
        locked: false,
        lastSeenAt: null,
      },
    ],
    rootSeed: null,
    deadline: null,
    resultDigest: null,
    confirmedDigest: null,
    successorRoomId: null,
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

describe('FixedFiveScoreboard', () => {
  it('renders one lane per participant with connection and roster progress', () => {
    const { getByText } = render(FixedFiveScoreboard, {
      props: { snapshot: snapshot(), selfId: 'p1' },
    });
    expect(getByText(/You · P1/)).toBeTruthy();
    expect(getByText(/Opponent · P2/)).toBeTruthy();
    expect(getByText(/3\/5 picks/)).toBeTruthy();
    expect(getByText(/1\/5 picks/)).toBeTruthy();
    expect(getByText('Online')).toBeTruthy();
    expect(getByText('Offline')).toBeTruthy();
  });
});
