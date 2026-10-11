import { describe, expect, it } from 'vitest';
import {
  buildHavocCard,
  buildHavocDraftPick,
  buildHavocDraftState,
  buildHavocGameInput,
  buildHavocGameResult,
  buildHavocGameSummary,
  buildHavocLockedInputs,
  buildHavocRunState,
  buildHavocRunStateLocked,
  buildHavocTeamInput,
} from './havoc.ts';

describe('havoc fixtures', () => {
  it('builds draft fixtures the schemas accept', () => {
    const draft = buildHavocDraftState();
    expect(draft.cards).toHaveLength(3);
    expect(draft.picks).toHaveLength(0);

    const picks = [0, 1, 2, 3, 4].map((ordinal) => buildHavocDraftPick(ordinal));
    expect(
      new Set(picks.map((pick) => `${pick.claimKey.playerId}::${pick.claimKey.seasonKey}`)).size,
    ).toBe(5);

    const complete = buildHavocDraftState({
      round: 5,
      slot: 'C',
      picks: picks.slice(0, 4),
      cards: [0, 1, 2].map((index) =>
        buildHavocCard({
          slot: 'C',
          offerId: draft.offerId,
          cardId: `hvc-${String(index + 1).repeat(32)}`,
        }),
      ),
      offerIndex: 1,
      rerollUsed: true,
      status: 'drafting',
    });
    expect(complete.picks).toHaveLength(4);
  });

  it('builds teams with matching replacement owners', () => {
    const human = buildHavocTeamInput('human');
    human.replacements.forEach((replacement, index) => {
      expect(replacement.ownerInstanceId).toBe(human.starters[index]?.instanceId);
      expect(replacement.slot).toBe(human.starters[index]?.slot);
    });
    expect(new Set([...human.starters, ...human.replacements].map((p) => p.instanceId)).size).toBe(
      10,
    );
  });

  it('builds locked inputs, run states, and games that parse', () => {
    const locked = buildHavocLockedInputs();
    expect(locked.schedule).toHaveLength(82);
    expect(locked.picks).toHaveLength(5);

    const run = buildHavocRunStateLocked();
    expect(run.phase).toBe('run');
    const draft = buildHavocRunState();
    expect(draft.phase).toBe('draft');

    const input = buildHavocGameInput();
    expect(input.humanSide).toBe('home');
    expect(input.home.side).toBe('human');
    expect(input.away.side).toBe('opponent');

    const result = buildHavocGameResult();
    expect(result.winner).toBe('home');
    const summary = buildHavocGameSummary();
    expect(summary.outcome).toBe('win');
  });
});
