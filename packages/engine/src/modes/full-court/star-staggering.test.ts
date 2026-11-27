import { describe, expect, it } from 'bun:test';
import type { FullCourtOffensiveHierarchy, Seed } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import {
  checkFullCourtGameResult,
  fullCourtGameDigest,
  runFullCourtGame,
  simulateFullCourtGame,
  simulateRecordedFullCourtGame,
  type FullCourtGameResult,
} from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster, fullCourtTestSeed } from './game-test-support.ts';

const ctx = createEngineContext();

const ROSTER = fullCourtTestRoster('star-stagger', 8, (index) => ({
  rating: index < 2 ? 84 : 68,
  usageRate: index < 2 ? 30 : 18,
  minutesPerGame: index < 2 ? 36 : 22,
}));
const IDS = ROSTER.map((player) => player.playerId);
const PRIMARY_ID = IDS[0] ?? '';
const SECONDARY_ID = IDS[1] ?? '';
const HIERARCHY: FullCourtOffensiveHierarchy = {
  primaryPlayerId: PRIMARY_ID,
  secondaryPlayerId: SECONDARY_ID,
};
const TARGETS: Record<string, number> = {
  [PRIMARY_ID]: 36,
  [SECONDARY_ID]: 34,
  [IDS[2] ?? '']: 32,
  [IDS[3] ?? '']: 30,
  [IDS[4] ?? '']: 28,
  [IDS[5] ?? '']: 30,
  [IDS[6] ?? '']: 26,
  [IDS[7] ?? '']: 24,
};
const STAR_IDS = new Set([PRIMARY_ID, SECONDARY_ID]);
const SEEDS = Array.from({ length: 8 }, (_value, index) =>
  fullCourtTestSeed(`star-stagger-coverage-${String(index)}`),
);

function inputFor(
  seed: Seed,
  options: {
    readonly staggerStars?: boolean;
    readonly hierarchy?: FullCourtOffensiveHierarchy;
  } = {},
) {
  return fullCourtTestInput({
    seed,
    homeRoster: ROSTER,
    homeRotation: {
      startingFive: IDS.slice(0, 5),
      minuteTargets: TARGETS,
      ...(options.staggerStars === undefined ? {} : { staggerStars: options.staggerStars }),
    },
    ...(options.hierarchy === undefined ? {} : { homeHierarchy: options.hierarchy }),
  });
}

function zeroStarSeconds(result: FullCourtGameResult): number {
  return result.home.stints
    .filter((stint) => stint.playerIds.every((playerId) => !STAR_IDS.has(playerId)))
    .reduce((sum, stint) => sum + stint.seconds, 0);
}

describe('Full Court star staggering', () => {
  it('keeps at least one assigned scorer on the floor across paired seeds', () => {
    let baselineZeroSeconds = 0;
    let treatmentZeroSeconds = 0;
    let baselineGamesWithoutScorer = 0;
    let treatmentGamesWithoutScorer = 0;

    for (const seed of SEEDS) {
      const baseline = simulateFullCourtGame(inputFor(seed, { hierarchy: HIERARCHY }), ctx);
      const treatment = simulateFullCourtGame(
        inputFor(seed, { hierarchy: HIERARCHY, staggerStars: true }),
        ctx,
      );
      expect(checkFullCourtGameResult(baseline)).toEqual([]);
      expect(checkFullCourtGameResult(treatment)).toEqual([]);

      const baselineZero = zeroStarSeconds(baseline);
      const treatmentZero = zeroStarSeconds(treatment);
      baselineZeroSeconds += baselineZero;
      treatmentZeroSeconds += treatmentZero;
      if (baselineZero > 0) baselineGamesWithoutScorer += 1;
      if (treatmentZero > 0) treatmentGamesWithoutScorer += 1;
    }

    // Without the preference a normal eight-player rotation leaves both
    // assigned scorers resting at once in several seeds.
    expect(baselineZeroSeconds).toBeGreaterThan(0);
    expect(baselineGamesWithoutScorer).toBeGreaterThan(0);
    // With it, every recorded lineup stint carries at least one scoring role.
    expect(treatmentZeroSeconds).toBe(0);
    expect(treatmentGamesWithoutScorer).toBe(0);
  });

  it('leaves disabled, no-role, and legacy plans byte-for-byte identical', () => {
    const seed = fullCourtTestSeed('star-stagger-parity');
    const legacy = simulateFullCourtGame(inputFor(seed), ctx);
    const hierarchyBaseline = simulateFullCourtGame(inputFor(seed, { hierarchy: HIERARCHY }), ctx);
    const floorGeneralHierarchy: FullCourtOffensiveHierarchy = {
      floorGeneralPlayerId: IDS[2] ?? '',
    };
    const floorGeneralBaseline = simulateFullCourtGame(
      inputFor(seed, { hierarchy: floorGeneralHierarchy }),
      ctx,
    );
    const disabled = simulateFullCourtGame(
      inputFor(seed, { hierarchy: HIERARCHY, staggerStars: false }),
      ctx,
    );
    const noScorers = simulateFullCourtGame(inputFor(seed, { staggerStars: true }), ctx);
    const floorGeneralOnly = simulateFullCourtGame(
      inputFor(seed, { hierarchy: floorGeneralHierarchy, staggerStars: true }),
      ctx,
    );

    expect(fullCourtGameDigest(noScorers)).toBe(fullCourtGameDigest(legacy));
    expect(noScorers).toEqual(legacy);
    expect(fullCourtGameDigest(disabled)).toBe(fullCourtGameDigest(hierarchyBaseline));
    expect(disabled).toEqual(hierarchyBaseline);
    expect(fullCourtGameDigest(floorGeneralOnly)).toBe(fullCourtGameDigest(floorGeneralBaseline));
    expect(floorGeneralOnly).toEqual(floorGeneralBaseline);
  });

  it('records and replays the same staggered result', () => {
    const input = inputFor(SEEDS[0] ?? fullCourtTestSeed('unused'), {
      hierarchy: HIERARCHY,
      staggerStars: true,
    });
    const plain = runFullCourtGame(input, ctx);
    const recorded = simulateRecordedFullCourtGame(input, ctx);
    const replay = simulateRecordedFullCourtGame(input, ctx);

    expect(plain.tape).toBeNull();
    expect(fullCourtGameDigest(recorded.result)).toBe(fullCourtGameDigest(plain.result));
    expect(recorded.result).toEqual(plain.result);
    expect(checkFullCourtGameResult(recorded.result)).toEqual([]);
    expect(fullCourtGameDigest(replay.result)).toBe(fullCourtGameDigest(recorded.result));
    expect(replay.tape).toEqual(recorded.tape);
  });
});
