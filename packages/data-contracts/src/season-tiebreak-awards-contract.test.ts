import { describe, expect, it } from 'vitest';
import {
  SEASON_SEED_NAMESPACES,
  SEASON_TIEBREAK_VERSION,
  buildInitialPostseasonState,
  franchiseIdSchema,
  idSchema,
  playoffGameIdOf,
  seasonAwardsDigest,
  seasonAwardsSchema,
  seasonNamespaceSeed,
  seasonPostseasonStateSchema,
  seasonRunCompletionSchema,
  seasonRunSchema,
  seasonTiebreakResolutionSchema,
  seedSchema,
  type SeasonAwards,
  type SeasonPostseasonState,
  type SeasonRun,
  type SeasonTiebreakResolution,
  type PlayoffRound,
} from './index.ts';
import { buildPostseason, buildRun, SEED, fixturePlayerId } from './season-schemas-fixtures.ts';
const ALMANAC_DIGEST = 'a'.repeat(32);
export function buildTiebreakResolution(
  overrides: Partial<SeasonTiebreakResolution> = {},
): SeasonTiebreakResolution {
  return {
    resolutionId: idSchema.parse('tb-east-playin-seeds'),
    conference: 'east',
    kind: 'qualification',
    rule: 'head-to-head',
    teams: [
      franchiseIdSchema.parse('team-7'),
      franchiseIdSchema.parse('team-8'),
      franchiseIdSchema.parse('team-9'),
    ],
    slots: [7, 8, 9],
    evidence: [{ label: 'head-to-head record', value: 2 }],
    drawSeed: null,
    ...overrides,
  };
}
export function buildFinalsHomeCourtResolutions(): SeasonTiebreakResolution[] {
  const drawSeed = buildPostseason(SEED).finalsHomeCourtDrawSeed;
  return [
    buildTiebreakResolution({
      resolutionId: idSchema.parse('tb-finals-overall-record'),
      conference: 'west',
      kind: 'finals-home-court',
      rule: 'overall-record',
      teams: [franchiseIdSchema.parse('lakers'), franchiseIdSchema.parse('celtics')],
      slots: [1],
      evidence: [{ label: 'overall record', value: '57-25 vs 55-27' }],
    }),
    buildTiebreakResolution({
      resolutionId: idSchema.parse('tb-finals-head-to-head'),
      conference: 'west',
      kind: 'finals-home-court',
      rule: 'head-to-head',
      teams: [franchiseIdSchema.parse('lakers'), franchiseIdSchema.parse('celtics')],
      slots: [1],
      evidence: [{ label: 'head-to-head record', value: '2-1' }],
    }),
    buildTiebreakResolution({
      resolutionId: idSchema.parse('tb-finals-points-differential'),
      conference: 'west',
      kind: 'finals-home-court',
      rule: 'points-differential',
      teams: [franchiseIdSchema.parse('lakers'), franchiseIdSchema.parse('celtics')],
      slots: [1],
      evidence: [{ label: 'points differential', value: 8.4 }],
    }),
    buildTiebreakResolution({
      resolutionId: idSchema.parse('tb-finals-random-draw'),
      conference: 'west',
      kind: 'finals-home-court',
      rule: 'random-draw',
      teams: [franchiseIdSchema.parse('lakers'), franchiseIdSchema.parse('celtics')],
      slots: [1],
      evidence: [{ label: 'deciding rule', value: 'random-draw' }],
      drawSeed,
    }),
  ];
}
export function buildCompletedBracket(
  champion: string,
): NonNullable<SeasonPostseasonState['bracket']> {
  const challenger = champion === 'lakers' ? 'celtics' : 'lakers';
  const parsedChampion = franchiseIdSchema.parse(champion);
  const parsedChallenger = franchiseIdSchema.parse(challenger);
  const pending = (seriesId: string, round: PlayoffRound, conference: 'east' | 'west') => ({
    seriesId: idSchema.parse(seriesId),
    round,
    conference,
    higherSeed: null,
    lowerSeed: null,
    homeCourtFranchiseId: null,
    challengerFranchiseId: null,
    homeCourtWins: 0,
    challengerWins: 0,
    games: [],
    winnerFranchiseId: null,
  });
  const conferenceBracket = (conference: 'east' | 'west') => ({
    conference,
    seeds: Array.from({ length: 8 }, (_, i) => franchiseIdSchema.parse(`team-${String(i + 1)}`)),
    firstRound: [1, 2, 3, 4].map((n) =>
      pending(`${conference}-first-round-${String(n)}`, 'first-round', conference),
    ),
    semifinals: [1, 2].map((n) =>
      pending(`${conference}-semifinal-${String(n)}`, 'conference-semifinal', conference),
    ),
    conferenceFinal: pending(`${conference}-conference-final`, 'conference-final', conference),
  });
  return {
    schemaVersion: 1,
    postseasonVersion: 'postseason-v2',
    east: conferenceBracket('east'),
    west: conferenceBracket('west'),
    finals: {
      seriesId: idSchema.parse('finals'),
      round: 'finals',
      conference: null,
      higherSeed: null,
      lowerSeed: null,
      homeCourtFranchiseId: parsedChampion,
      challengerFranchiseId: parsedChallenger,
      homeCourtWins: 4,
      challengerWins: 2,
      games: [1, 2, 3, 4, 5, 6].map((gameNumber) => {
        const championHome = [1, 2, 5].includes(gameNumber);
        return {
          gameId: playoffGameIdOf('finals', gameNumber),
          gameNumber,
          homeFranchiseId: championHome ? parsedChampion : parsedChallenger,
          awayFranchiseId: championHome ? parsedChallenger : parsedChampion,
          status: 'final' as const,
          homeScore: championHome ? 104 : 99,
          awayScore: championHome ? 99 : 104,
          winnerFranchiseId: parsedChampion,
        };
      }),
      winnerFranchiseId: parsedChampion,
    },
    championFranchiseId: parsedChampion,
  };
}
export function buildCompletedPostseason(
  seed: string,
  champion = 'lakers',
  resolutions: SeasonTiebreakResolution[] = buildFinalsHomeCourtResolutions(),
): SeasonPostseasonState {
  const base = buildPostseason(seed);
  const seeds = Array.from({ length: 8 }, (_, i) =>
    franchiseIdSchema.parse(`team-${String(i + 1)}`),
  );
  const parsedChampion = franchiseIdSchema.parse(champion);
  return {
    ...base,
    tiebreakResolutions: resolutions,
    playIn: {
      east: { ...base.playIn.east, playoffSeeds: seeds },
      west: { ...base.playIn.west, playoffSeeds: seeds },
    },
    bracket: buildCompletedBracket(champion),
    championFranchiseId: parsedChampion,
  };
}
function rosterOf(run: SeasonRun, index: number): SeasonRun['rosters'][number] {
  const roster = run.rosters[index];
  if (roster === undefined) throw new Error(`fixture roster ${String(index)} missing`);
  return roster;
}
function playerOf(
  roster: SeasonRun['rosters'][number],
  slot: number,
): SeasonRun['rosters'][number]['players'][number] {
  const player = roster.players[slot];
  if (player === undefined) throw new Error(`fixture player slot ${String(slot)} missing`);
  return player;
}
export function buildAwardsForRun(run: SeasonRun): SeasonAwards {
  const recipient = (rosterIndex: number, slot: number) => {
    const roster = rosterOf(run, rosterIndex);
    const player = playerOf(roster, slot);
    return { playerVersionId: player.playerVersionId, franchiseId: roster.franchiseId };
  };
  const awards: SeasonAwards = {
    schemaVersion: 1,
    awardsVersion: 'awards-v1',
    runId: run.runId,
    mvp: recipient(0, 0),
    defensivePlayerOfYear: recipient(1, 0),
    sixthManOfYear: recipient(0, 1),
    allLeagueFirstTeam: [2, 3, 4, 5, 6].map((slot) => recipient(0, slot)),
    digest: '0'.repeat(32),
  };
  return { ...awards, digest: seasonAwardsDigest(awards) };
}
export function buildCompletedRunWithAwards(champion = 'lakers'): SeasonRun {
  const run = buildRun();
  return {
    ...run,
    stage: 'completed',
    postseason: buildCompletedPostseason(SEED, champion),
    awards: buildAwardsForRun(run),
    completion: seasonRunCompletionSchema.parse({
      championFranchiseId: champion,
      almanacDigest: ALMANAC_DIGEST,
      finalizedAtStateRevision: 17,
    }),
  };
}
describe('tiebreak resolution contract (M2.6, tiebreaker-v1)', () => {
  it('enforces teams (2-3), slots (1-10, 1-3 entries), and evidence bounds', () => {
    const schema = seasonTiebreakResolutionSchema;
    expect(
      schema.safeParse(buildTiebreakResolution({ teams: [franchiseIdSchema.parse('team-7')] }))
        .success,
    ).toBe(false);
    expect(
      schema.safeParse(
        buildTiebreakResolution({
          teams: [
            franchiseIdSchema.parse('team-7'),
            franchiseIdSchema.parse('team-8'),
            franchiseIdSchema.parse('team-9'),
            franchiseIdSchema.parse('team-10'),
          ],
        }),
      ).success,
    ).toBe(false);
    expect(schema.safeParse(buildTiebreakResolution({ slots: [] })).success).toBe(false);
    expect(schema.safeParse(buildTiebreakResolution({ slots: [0] })).success).toBe(false);
    expect(schema.safeParse(buildTiebreakResolution({ slots: [11] })).success).toBe(false);
    expect(schema.safeParse(buildTiebreakResolution({ slots: [7, 8, 9, 10] })).success).toBe(false);
    expect(schema.safeParse(buildTiebreakResolution({ slots: [10] })).success).toBe(true);
    const nineEvidence = Array.from({ length: 9 }, (_, index) => ({
      label: `fact-${String(index)}`,
      value: index,
    }));
    expect(schema.safeParse(buildTiebreakResolution({ evidence: nineEvidence })).success).toBe(
      false,
    );
    expect(
      schema.safeParse(buildTiebreakResolution({ evidence: [{ label: '', value: 1 }] })).success,
    ).toBe(false);
    expect(
      schema.safeParse(buildTiebreakResolution({ evidence: [{ label: 'x'.repeat(65), value: 1 }] }))
        .success,
    ).toBe(false);
    expect(
      seasonTiebreakResolutionSchema.safeParse({
        ...buildTiebreakResolution(),
        evidence: [{ label: 'flag', value: true }],
      }).success,
    ).toBe(false);
  });
  it('enforces identity, conference, and drawSeed shapes', () => {
    const schema = seasonTiebreakResolutionSchema;
    expect(
      schema.safeParse({ ...buildTiebreakResolution(), resolutionId: 'Bad id!' }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...buildTiebreakResolution(), conference: 'central' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...buildTiebreakResolution(), kind: 'tiebreak' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...buildTiebreakResolution(), rule: 'coin-flip' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...buildTiebreakResolution(), drawSeed: 'zzz' }).success).toBe(false);
    expect(schema.safeParse(buildTiebreakResolution({ drawSeed: null })).success).toBe(true);
  });
  it('enforces the drawSeed/rule coupling at parse time', () => {
    expect(
      seasonTiebreakResolutionSchema.safeParse(
        buildTiebreakResolution({ rule: 'head-to-head', drawSeed: seedSchema.parse(SEED) }),
      ).success,
    ).toBe(false);
    expect(
      seasonTiebreakResolutionSchema.safeParse(
        buildTiebreakResolution({ rule: 'random-draw', drawSeed: null }),
      ).success,
    ).toBe(false);
    expect(
      seasonTiebreakResolutionSchema.safeParse(
        buildTiebreakResolution({ rule: 'random-draw', drawSeed: seedSchema.parse(SEED) }),
      ).success,
    ).toBe(true);
  });
  it('records the finals-home-court decision at a positive slot (position 1)', () => {
    const resolution = buildTiebreakResolution({ kind: 'finals-home-court', slots: [1] });
    expect(seasonTiebreakResolutionSchema.safeParse(resolution).success).toBe(true);
    expect(
      seasonTiebreakResolutionSchema.safeParse(
        buildTiebreakResolution({ kind: 'finals-home-court', slots: [0] }),
      ).success,
    ).toBe(false);
  });
});
describe('finals home court representability (M2.6)', () => {
  it('accepts finals-home-court resolutions under every finals sequence rule', () => {
    for (const resolution of buildFinalsHomeCourtResolutions()) {
      const parsed = seasonTiebreakResolutionSchema.parse(resolution);
      expect(parsed.kind).toBe('finals-home-court');
    }
  });
  it('derives finalsHomeCourtDrawSeed deterministically as a pure function of the root seed', () => {
    const first = buildInitialPostseasonState(seedSchema.parse(SEED));
    const second = buildInitialPostseasonState(seedSchema.parse(SEED));
    expect(second.finalsHomeCourtDrawSeed).toBe(first.finalsHomeCourtDrawSeed);
    expect(first.finalsHomeCourtDrawSeed).toMatch(/^[0-9a-f]{32}$/);
    const tiesSeed = seasonNamespaceSeed(SEED, SEASON_SEED_NAMESPACES.postseasonTies);
    expect(first.seed).toBe(tiesSeed);
    expect(first.finalsHomeCourtDrawSeed).toBe(
      seasonNamespaceSeed(tiesSeed, SEASON_SEED_NAMESPACES.postseasonDraws, 'finals-home-court'),
    );
    expect(buildPostseason(SEED).finalsHomeCourtDrawSeed).toBe(first.finalsHomeCourtDrawSeed);
    expect(
      buildInitialPostseasonState(seedSchema.parse('f'.repeat(32))).finalsHomeCourtDrawSeed,
    ).not.toBe(first.finalsHomeCourtDrawSeed);
    expect(first.tiebreakVersion).toBe(SEASON_TIEBREAK_VERSION);
  });
  it('records the saved finals draw seed on a random-draw resolution inside a state', () => {
    const state = buildPostseason(SEED);
    const resolution = buildTiebreakResolution({
      resolutionId: idSchema.parse('tb-finals-draw'),
      conference: 'west',
      kind: 'finals-home-court',
      rule: 'random-draw',
      teams: [franchiseIdSchema.parse('lakers'), franchiseIdSchema.parse('celtics')],
      slots: [1],
      evidence: [{ label: 'deciding rule', value: 'random-draw' }],
      drawSeed: state.finalsHomeCourtDrawSeed,
    });
    const parsed = seasonTiebreakResolutionSchema.parse(resolution);
    expect(parsed.drawSeed).toBe(state.finalsHomeCourtDrawSeed);
    const completed = buildCompletedPostseason(SEED, 'lakers', [resolution]);
    expect(seasonPostseasonStateSchema.safeParse(completed).success).toBe(true);
  });
});
describe('tie resolutions on a completed postseason state (M2.6)', () => {
  it('parses a completed state with resolutions, a bracket, and a champion', () => {
    const state = buildCompletedPostseason(SEED, 'lakers');
    const parsed = seasonPostseasonStateSchema.parse(state);
    expect(parsed.tiebreakResolutions).toEqual(state.tiebreakResolutions);
    expect(parsed.tiebreakResolutions).toHaveLength(4);
    expect(parsed.championFranchiseId).toBe('lakers');
    expect(parsed).toMatchObject({ bracket: { championFranchiseId: 'lakers' } });
  });
  it('rejects a bracket whose champion does not match the state champion', () => {
    const state = buildCompletedPostseason(SEED, 'lakers');
    if (state.bracket === null) throw new Error('fixture bracket missing');
    expect(() =>
      seasonPostseasonStateSchema.parse({ ...state, championFranchiseId: null }),
    ).toThrow();
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...state,
        bracket: { ...state.bracket, championFranchiseId: 'celtics' },
      }),
    ).toThrow();
  });
});
describe('season awards contract (M2.6, awards-v1)', () => {
  it('round-trips awards referencing the fixture run rosters', () => {
    const run = buildRun();
    const parsed = seasonAwardsSchema.parse(buildAwardsForRun(run));
    expect(parsed.runId).toBe(run.runId);
    expect(parsed.mvp.franchiseId).toBe(run.rosters[0]?.franchiseId);
    const rosterVersionIds = run.rosters[0]?.players.map((player) => player.playerVersionId);
    expect(rosterVersionIds).toContain(parsed.mvp.playerVersionId);
    expect(parsed.allLeagueFirstTeam).toHaveLength(5);
  });
  it('requires exactly five All-League First Team recipients', () => {
    const awards = buildAwardsForRun(buildRun());
    const four = { ...awards, allLeagueFirstTeam: awards.allLeagueFirstTeam.slice(0, 4) };
    expect(seasonAwardsSchema.safeParse(four).success).toBe(false);
    const six = { ...awards, allLeagueFirstTeam: [...awards.allLeagueFirstTeam, awards.mvp] };
    expect(seasonAwardsSchema.safeParse(six).success).toBe(false);
  });
  it('derives a deterministic self-excluded digest that changes with recipients', () => {
    const parsed = seasonAwardsSchema.parse(buildAwardsForRun(buildRun()));
    const digest = seasonAwardsDigest(parsed);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(seasonAwardsDigest(parsed)).toBe(digest);
    expect(seasonAwardsDigest({ ...parsed, digest: 'f'.repeat(32) })).toBe(digest);
    const differentRecipient = {
      ...parsed,
      mvp: {
        playerVersionId: fixturePlayerId(99),
        franchiseId: franchiseIdSchema.parse('celtics'),
      },
    };
    expect(seasonAwardsDigest(differentRecipient)).not.toBe(digest);
  });
  it('rejects malformed recipients', () => {
    const awards = buildAwardsForRun(buildRun());
    expect(() =>
      seasonAwardsSchema.parse({ ...awards, mvp: { playerVersionId: 'bad' } }),
    ).toThrow();
    expect(() =>
      seasonAwardsSchema.parse({
        ...awards,
        mvp: { playerVersionId: fixturePlayerId(0), franchiseId: '' },
      }),
    ).toThrow();
  });
});
describe('run-level stage/completion/awards coupling (M2.6)', () => {
  it('parses a completed run carrying awards and completion state', () => {
    const parsed = seasonRunSchema.parse(buildCompletedRunWithAwards('lakers'));
    expect(parsed.stage).toBe('completed');
    expect(parsed.completion?.championFranchiseId).toBe('lakers');
    expect(parsed.postseason.championFranchiseId).toBe('lakers');
    expect(parsed.awards?.mvp.franchiseId).toBe(parsed.rosters[0]?.franchiseId);
    expect(parsed.awards?.allLeagueFirstTeam).toHaveLength(5);
  });
  it('enforces the completed-run champion and completion coupling', () => {
    const completed = buildCompletedRunWithAwards('lakers');
    expect(seasonRunSchema.safeParse(completed).success).toBe(true);
    expect(() => seasonRunSchema.parse({ ...completed, completion: null })).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...completed,
        postseason: { ...completed.postseason, championFranchiseId: null },
      }),
    ).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...completed,
        completion: { ...completed.completion, championFranchiseId: 'celtics' },
      }),
    ).toThrow();
    const active = buildRun();
    expect(() =>
      seasonRunSchema.parse({
        ...active,
        completion: seasonRunCompletionSchema.parse({
          championFranchiseId: 'lakers',
          almanacDigest: ALMANAC_DIGEST,
          finalizedAtStateRevision: 0,
        }),
      }),
    ).toThrow();
  });
  it('enforces the awards/stage coupling at parse time', () => {
    const run = buildRun();
    expect(seasonRunSchema.safeParse({ ...run, awards: buildAwardsForRun(run) }).success).toBe(
      false,
    );
    expect(
      seasonRunSchema.safeParse({
        ...buildCompletedRunWithAwards('lakers'),
        stage: 'playoffs',
        completion: null,
      }).success,
    ).toBe(true);
    expect(
      seasonRunSchema.safeParse({ ...buildCompletedRunWithAwards('lakers'), awards: null }).success,
    ).toBe(true);
  });
});
