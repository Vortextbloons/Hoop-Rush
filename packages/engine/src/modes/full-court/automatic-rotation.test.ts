import { expect, test } from 'bun:test';
import { createEngineContext } from '../../sim/kernel.ts';
import { defaultFullCourtCoachingRotation } from './coaching.ts';
import { checkFullCourtGameResult, simulateFullCourtGame } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';

test('automatic rotations shift live minutes from tired players on both sides', () => {
  const homeRoster = fullCourtTestRoster('auto-home', 8);
  const awayRoster = fullCourtTestRoster('auto-away', 8);
  const withFatigue = (roster: typeof homeRoster) =>
    roster.map((player, index) => ({
      playerId: player.playerId,
      available: index !== 7,
      staminaRating: index === 0 ? 45 : 85,
      energy: index === 0 ? 0.35 : 1,
    }));
  const context = createEngineContext();
  const sides = ['home', 'away'] as const;
  const liveSeconds = { home: 0, away: 0 };

  for (let sample = 0; sample < 12; sample++) {
    const input = fullCourtTestInput({
      seed: `staff-rotation-${sample}`,
      homeRoster,
      awayRoster,
      homeAvailability: withFatigue(homeRoster),
      awayAvailability: withFatigue(awayRoster),
    });
    const restedTargets = (team: typeof input.home) =>
      defaultFullCourtCoachingRotation({
        ...team,
        availability: (team.availability ?? []).map((entry) => ({ ...entry, energy: 1 })),
      });
    const homeBaseline = restedTargets(input.home);
    const awayBaseline = restedTargets(input.away);
    const automatic = simulateFullCourtGame(
      {
        ...input,
        away: { ...input.away, rotation: { startingFive: awayBaseline.startingFive } },
      },
      context,
    );
    const baseline = simulateFullCourtGame(
      {
        ...input,
        home: { ...input.home, rotation: homeBaseline },
        away: { ...input.away, rotation: awayBaseline },
      },
      context,
    );

    expect(checkFullCourtGameResult(automatic)).toEqual([]);
    for (const side of sides) {
      const tiredId = input[side].roster[0]!.playerId;
      const tired = automatic[side].players.find((player) => player.playerId === tiredId)!;
      const comparison = baseline[side].players.find((player) => player.playerId === tiredId)!;
      expect(tired.plannedSeconds).toBeLessThan(comparison.plannedSeconds);
      expect(
        automatic[side].players.find(
          (player) => player.playerId === input[side].roster[7]!.playerId,
        )?.seconds,
      ).toBe(0);
      liveSeconds[side] += comparison.seconds - tired.seconds;
    }
  }

  for (const side of sides) {
    expect(liveSeconds[side] / 12).toBeGreaterThan(60);
  }
});
