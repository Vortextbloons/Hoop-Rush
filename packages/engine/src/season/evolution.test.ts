import { describe, expect, it } from 'vitest';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  franchiseIdSchema,
  playerIdSchema,
  playerVersionId,
  seasonGameIdSchema,
  seedSchema,
  seasonGameSimulationResultSchema,
  type Position,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonCompactPlayerLine,
  type SeasonGameSummary,
  type SeasonRotation,
  SEASON_DRAFT_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  type SeasonDraftCommand,
  type SeasonRun,
  buildEmptyEvolutionState,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  buildLegalSimulationTeam,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../sim/context.ts';
import { firstToSevenWinner, twentySecondClockPressure } from '../sim/evolution-rules.ts';
import { checkSeasonGameResult } from './season-game-audit.ts';
import { simulateSeasonGame } from './season-game.ts';
import {
  baseInquiryAllowanceOf,
  campaignBonusOf,
  createEvolutionDiscovery,
  evolutionGateAllowsBlock,
  purchasedInquiryCostOf,
  rehabPriceOf,
  resolveHomeGameRule,
  selectAiCourtInnovation,
  srsRuleScorerFor,
  wrapSponsorshipsForBlock,
  type AiInnovationScorer,
  type AiSelectionDataSource,
} from './evolution.ts';
import { evolutionWithBlockCommit, resolveAiCourtInnovations } from './evolution.ts';
import { buildEvolutionDataSource, evolutionSelectionGate } from './block.ts';
import {
  adjustLedgerForDeepFour,
  adjustLedgerForTwentySecondClock,
  estimateFirstToSevenRace,
  projectGameWithRule,
  scoringDistributionOf,
} from '../projection/evolution.ts';
import { handleSeasonRunCommand, type SeasonRunCommandContext } from './season-commands.ts';
import { applySeasonDraftCommand } from './draft.ts';
import { buildEconomyTestRun, zeroEffectsOf } from './season-economy-test-support.ts';
import { generateSeasonSchedule } from './schedule.ts';

const ctx = createEngineContext();
const POSITION_PLAN: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['SG', 'SF'],
  ['C'],
  ['PF', 'C'],
];

function buildSeasonTeam(
  side: 'home' | 'away',
  overrides: Partial<SeasonGameTeamInput> = {},
): SeasonGameTeamInput {
  const franchiseId = side === 'home' ? 'lakers' : 'celtics';
  const players = POSITION_PLAN.map((positions, index) => {
    const playerId = playerIdSchema.parse(`p-evo-${side}-${String(index + 1)}`);
    const base = buildSimulationPlayer();
    return {
      playerVersionId: playerVersionId(playerId, franchiseId, '1990s', '1995-96'),
      playerId,
      displayName: `${side} player ${String(index + 1)}`,
      positions: [...positions],
      heightInches: 76,
      weightLbs: 200,
      ratings: { ...base.ratings },
      tendencies: { ...base.tendencies },
    };
  });
  return {
    teamId: side === 'home' ? 'home-team' : 'away-team',
    displayName: side === 'home' ? 'Home Team' : 'Away Team',
    franchiseId: franchiseIdSchema.parse(franchiseId),
    players,
    ...overrides,
  };
}

function buildSeasonRotation(team: SeasonGameTeamInput): SeasonRotation {
  const ids = team.players.map((p) => p.playerVersionId);
  const starters = ids.slice(0, 5);
  const bench = ids.slice(5);
  const targets = SEASON_ROTATION_PRESET_TARGETS.balanced;
  return {
    franchiseId: team.franchiseId,
    starters,
    benchOrder: bench,
    targetMinutes: [
      ...starters.map((playerVersionId) => ({ playerVersionId, minutes: targets.starters })),
      ...bench.map((playerVersionId, index) => ({
        playerVersionId,
        minutes: targets.bench[index] ?? 0,
      })),
    ],
    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => {
      if (id === undefined) throw new Error('fixture closing five missing player');
      return id;
    }),
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

function buildSeasonGameInput(
  overrides: Partial<SeasonGameSimulationInput> = {},
): SeasonGameSimulationInput {
  const home = buildSeasonTeam('home');
  const away = buildSeasonTeam('away');
  return {
    schemaVersion: 1,
    seed: seedSchema.parse(seedFromString('evo-game-1')),
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: buildEraSimulationProfile(),
    home,
    away,
    homeRotation: buildSeasonRotation(home),
    awayRotation: buildSeasonRotation(away),
    availability: [...home.players, ...away.players].map((p) => ({
      playerVersionId: p.playerVersionId,
      available: true,
    })),
    removals: [],
    returns: [],
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    ...overrides,
  };
}

describe('front office policy', () => {
  it('prices risky rehabilitation per executive with a floor of one', () => {
    expect(rehabPriceOf(null)).toBe(2);
    expect(rehabPriceOf('morgan-vale')).toBe(3);
    expect(rehabPriceOf('alex-chen')).toBe(1);
    expect(rehabPriceOf('jordan-ellis')).toBe(3);
  });
  it('sets inquiry allowances and purchase costs per executive', () => {
    expect(baseInquiryAllowanceOf(null)).toBe(3);
    expect(baseInquiryAllowanceOf('morgan-vale')).toBe(4);
    expect(baseInquiryAllowanceOf('alex-chen')).toBe(3);
    expect(purchasedInquiryCostOf(null)).toBe(1);
    expect(purchasedInquiryCostOf('alex-chen')).toBe(2);
    expect(purchasedInquiryCostOf('morgan-vale')).toBe(1);
  });
  it('grants the campaign bonus only to the campaign director', () => {
    expect(campaignBonusOf(null)).toBe(0);
    expect(campaignBonusOf('jordan-ellis')).toBe(1);
    expect(campaignBonusOf('morgan-vale')).toBe(0);
  });
});

describe('court innovation discovery', () => {
  it('creates a three-choice discovery only when block two is accepted', () => {
    const discovery = createEvolutionDiscovery({
      rootSeed: seedFromString('evo'),
      acceptedBlockIndex: 2,
    });
    expect(discovery?.offeredInnovationIds).toEqual([
      'deep-four',
      'twenty-second-clock',
      'first-to-seven-overtime',
    ]);
    expect(
      createEvolutionDiscovery({ rootSeed: seedFromString('evo'), acceptedBlockIndex: 1 }),
    ).toBeNull();
    expect(
      createEvolutionDiscovery({ rootSeed: seedFromString('evo'), acceptedBlockIndex: 3 }),
    ).toBeNull();
  });
  it('gates block three on a recorded selection', () => {
    expect(evolutionGateAllowsBlock(null, 3)).toBe(true);
    expect(evolutionGateAllowsBlock({ discovery: null, selections: {} } as never, 3)).toBe(true);
    expect(
      evolutionGateAllowsBlock(
        {
          discovery: {
            blockIndex: 2,
            offeredInnovationIds: ['deep-four', 'twenty-second-clock', 'first-to-seven-overtime'],
            version: 'season-court-innovation-v1',
            seed: seedFromString('evo'),
          },
          selections: {},
        } as never,
        3,
      ),
    ).toBe(false);
  });
  it('resolves the home rule from the recorded selection', () => {
    expect(resolveHomeGameRule(null, 'lakers')).toBe('standard');
    expect(
      resolveHomeGameRule(
        {
          selections: {
            lakers: {
              franchiseId: 'lakers',
              innovationId: 'deep-four',
              version: 'season-court-innovation-v1',
              selectedByCommandId: 'cmd-1',
              aiSelected: false,
              inputDigest: null,
            },
          },
        } as never,
        'lakers',
      ),
    ).toBe('deep-four');
  });
  it('selects AI innovations deterministically with a seeded tiebreak', () => {
    const scorer: AiInnovationScorer = (id) => (id === 'deep-four' ? 2 : 1);
    const first = selectAiCourtInnovation({
      rootSeed: seedFromString('evo'),
      franchiseId: 'lakers',
      scorer,
      aiOrderIndex: 0,
    });
    const second = selectAiCourtInnovation({
      rootSeed: seedFromString('evo'),
      franchiseId: 'lakers',
      scorer,
      aiOrderIndex: 0,
    });
    expect(first.innovationId).toBe('deep-four');
    expect(second).toEqual(first);
    expect(first.inputDigest).toMatch(/^[0-9a-f]{32}$/);
    const tied = selectAiCourtInnovation({
      rootSeed: seedFromString('evo'),
      franchiseId: 'celtics',
      scorer: () => 1,
      aiOrderIndex: 3,
    });
    const tiedAgain = selectAiCourtInnovation({
      rootSeed: seedFromString('evo'),
      franchiseId: 'celtics',
      scorer: () => 1,
      aiOrderIndex: 3,
    });
    expect(tied.innovationId).toBe(tiedAgain.innovationId);
  });
});

describe('sponsorship wrapping', () => {
  const opportunities = [
    { opportunityId: 'copp-00000001', family: 'style', blockIndex: 0 },
    { opportunityId: 'copp-00000002', family: 'results', blockIndex: 0 },
  ];
  it('is deterministic for a named seed and wraps at most one card', () => {
    const first = wrapSponsorshipsForBlock({
      rootSeed: seedFromString('sponsor'),
      blockIndex: 0,
      opportunities,
    });
    const second = wrapSponsorshipsForBlock({
      rootSeed: seedFromString('sponsor'),
      blockIndex: 0,
      opportunities,
    });
    expect(second).toEqual(first);
    if (first.wrapper !== null) {
      expect(first.wrappedOpportunityId).toBe(first.wrapper.wrappedOpportunityId);
    }
  });
  it('wraps compatible brand-family pairs across many seeds', () => {
    const compatible: Record<string, readonly string[]> = {
      style: ['baseline-supply'],
      'player-role': ['second-wind'],
      'roster-response': ['second-wind'],
      results: ['cityline-sports'],
      marquee: ['cityline-sports'],
    };
    for (let block = 0; block < 8; block += 1) {
      const wrapped = wrapSponsorshipsForBlock({
        rootSeed: seedFromString(`sponsor-${String(block)}`),
        blockIndex: block,
        opportunities,
      });
      if (wrapped.wrapper === null) continue;
      const picked = opportunities.find((o) => o.opportunityId === wrapped.wrappedOpportunityId);
      expect(picked).toBeDefined();
      expect(compatible[picked?.family ?? ''] ?? []).toContain(wrapped.wrapper.sponsorId);
    }
  });
});

describe('twenty-second clock math', () => {
  it('applies no penalty at four seconds and ten percent at zero', () => {
    expect(twentySecondClockPressure(4)).toBe(1);
    expect(twentySecondClockPressure(10)).toBe(1);
    expect(twentySecondClockPressure(0)).toBeCloseTo(0.9, 10);
    expect(twentySecondClockPressure(2)).toBeCloseTo(0.95, 10);
  });
  it('resolves first-to-seven winners without a win-by-two', () => {
    expect(firstToSevenWinner(7, 4)).toBe('home');
    expect(firstToSevenWinner(4, 7)).toBe('away');
    expect(firstToSevenWinner(9, 6)).toBe('home');
    expect(firstToSevenWinner(6, 6)).toBeNull();
    expect(firstToSevenWinner(0, 0)).toBeNull();
  });
});

describe('deep-four games', () => {
  it('completes, audits clean, records separate four-point facts, and replays identically', () => {
    const input = buildSeasonGameInput({
      seed: seedSchema.parse(seedFromString('deep-four-1')),
      gameRule: 'deep-four',
    });
    const result = simulateSeasonGame(input, ctx);
    expect(result.outcome).toBe('completed');
    expect(() => seasonGameSimulationResultSchema.parse(result)).not.toThrow();
    expect(checkSeasonGameResult(result, input)).toEqual([]);
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    expect(result.gameRule).toBe('deep-four');
    const deepAttempts =
      (result.home.box.deepFours?.attempted ?? 0) + (result.away.box.deepFours?.attempted ?? 0);
    const deepMakes =
      (result.home.box.deepFours?.made ?? 0) + (result.away.box.deepFours?.made ?? 0);
    expect(deepAttempts).toBeGreaterThan(0);
    expect(deepMakes).toBeGreaterThan(0);
    for (const side of [result.home, result.away]) {
      const box = side.box;
      const d4m = box.deepFours?.made ?? 0;
      expect(box.points).toBe(
        (box.fieldGoals.made - box.threes.made - d4m) * 2 +
          box.threes.made * 3 +
          d4m * 4 +
          box.freeThrows.made,
      );
    }
    const replay = simulateSeasonGame(input, ctx);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(result));
  });
  it('leaves standard games without deep-four facts', () => {
    const input = buildSeasonGameInput({ seed: seedSchema.parse(seedFromString('deep-std-1')) });
    const result = simulateSeasonGame(input, ctx);
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    expect(result.gameRule).toBeUndefined();
    expect(result.home.box.deepFours).toBeUndefined();
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });
});

describe('twenty-second clock games', () => {
  it('completes, audits clean, and replays identically', () => {
    const input = buildSeasonGameInput({
      seed: seedSchema.parse(seedFromString('clock-1')),
      gameRule: 'twenty-second-clock',
    });
    const result = simulateSeasonGame(input, ctx);
    expect(result.outcome).toBe('completed');
    expect(() => seasonGameSimulationResultSchema.parse(result)).not.toThrow();
    expect(checkSeasonGameResult(result, input)).toEqual([]);
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    expect(result.gameRule).toBe('twenty-second-clock');
    const replay = simulateSeasonGame(input, ctx);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(result));
  });
  it('survives a slow pace that forces shot-clock violations', () => {
    const base = buildEraSimulationProfile();
    const slow = buildEraSimulationProfile({
      parameters: { ...base.parameters, pace: 45 },
    });
    const input = buildSeasonGameInput({
      seed: seedSchema.parse(seedFromString('clock-slow-1')),
      profile: slow,
      gameRule: 'twenty-second-clock',
    });
    const result = simulateSeasonGame(input, ctx);
    expect(result.outcome).toBe('completed');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });
});

describe('first-to-seven overtime games', () => {
  function findOvertimeSeeds(count: number): string[] {
    const found: string[] = [];
    for (let i = 0; i < 200 && found.length < count; i += 1) {
      const seed = `race-hunt-${String(i)}`;
      const input = buildSeasonGameInput({ seed: seedSchema.parse(seedFromString(seed)) });
      const result = simulateSeasonGame(input, ctx);
      if (result.outcome === 'completed' && result.overtimePeriods > 0) found.push(seed);
    }
    return found;
  }
  it('runs the untimed race when regulation ties and preserves regulation scores', () => {
    const seeds = findOvertimeSeeds(2);
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      const standardInput = buildSeasonGameInput({ seed: seedSchema.parse(seedFromString(seed)) });
      const standard = simulateSeasonGame(standardInput, ctx);
      if (standard.outcome !== 'completed') continue;
      const raceInput = buildSeasonGameInput({
        seed: seedSchema.parse(seedFromString(seed)),
        gameRule: 'first-to-seven-overtime',
      });
      const race = simulateSeasonGame(raceInput, ctx);
      expect(race.outcome).toBe('completed');
      expect(() => seasonGameSimulationResultSchema.parse(race)).not.toThrow();
      expect(checkSeasonGameResult(race, raceInput)).toEqual([]);
      if (race.outcome !== 'completed') throw new Error('expected a completed race game');
      expect(race.gameRule).toBe('first-to-seven-overtime');
      expect(race.overtimeRace).toBeDefined();
      const winnerPoints =
        race.winner === 'home' ? race.overtimeRace?.homePoints : race.overtimeRace?.awayPoints;
      const loserPoints =
        race.winner === 'home' ? race.overtimeRace?.awayPoints : race.overtimeRace?.homePoints;
      expect(winnerPoints ?? 0).toBeGreaterThanOrEqual(7);
      expect(loserPoints ?? 7).toBeLessThan(7);
      expect(race.overtimePeriods).toBe(1);
      for (let period = 0; period < 4; period += 1) {
        expect(race.home.periodScores[period]).toBe(standard.home.periodScores[period]);
        expect(race.away.periodScores[period]).toBe(standard.away.periodScores[period]);
      }
      const replay = simulateSeasonGame(raceInput, ctx);
      expect(JSON.stringify(replay)).toBe(JSON.stringify(race));
    }
  });
});
describe('evolution commands', () => {
  function runContext(
    run: SeasonRun,
    humanFranchiseId: string | null = 'lakers',
  ): SeasonRunCommandContext {
    return { run, pending: null, humanFranchiseId, effects: zeroEffectsOf(run) };
  }
  function frontOfficeCommand(run: SeasonRun, executiveId: string, commandId: string) {
    return {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'select-front-office',
      commandId,
      runId: run.runId,
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      executiveId,
    } as never;
  }
  it('accepts an executive during setup and rejects replacements', () => {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-cmd-1') });
    const output = handleSeasonRunCommand(
      frontOfficeCommand(run, 'morgan-vale', 'cmd-fo-1'),
      runContext(run),
    );
    expect(output.result.command).toBe('select-front-office');
    if (output.result.command !== 'select-front-office') throw new Error('wrong command');
    expect(output.result.result.status).toBe('accepted');
    const again = handleSeasonRunCommand(
      frontOfficeCommand(output.run, 'alex-chen', 'cmd-fo-2'),
      runContext(output.run),
    );
    if (again.result.command !== 'select-front-office') throw new Error('wrong command');
    expect(again.result.result.status).toBe('rejected');
    if (again.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(again.result.result.rejection.code).toBe('front-office-already-selected');
  });
  it('returns duplicate-command for a replayed acceptance', () => {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-cmd-2') });
    const first = handleSeasonRunCommand(
      frontOfficeCommand(run, 'alex-chen', 'cmd-fo-1'),
      runContext(run),
    );
    if (
      first.result.command !== 'select-front-office' ||
      first.result.result.status !== 'accepted'
    ) {
      throw new Error('expected acceptance');
    }
    const replay = handleSeasonRunCommand(
      frontOfficeCommand(run, 'alex-chen', 'cmd-fo-1'),
      runContext(first.run),
    );
    if (
      replay.result.command !== 'select-front-office' ||
      replay.result.result.status !== 'rejected'
    ) {
      throw new Error('expected rejection');
    }
    expect(replay.result.result.rejection.code).toBe('duplicate-command');
  });
  it('rejects setup choices once games have been played', () => {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-cmd-3') });
    const advanced = { ...run, cursor: { ...run.cursor, completedRounds: 10 } };
    const output = handleSeasonRunCommand(
      frontOfficeCommand(advanced, 'jordan-ellis', 'cmd-fo-1'),
      runContext(advanced),
    );
    if (
      output.result.command !== 'select-front-office' ||
      output.result.result.status !== 'rejected'
    ) {
      throw new Error('expected rejection');
    }
    expect(output.result.result.rejection.code).toBe('front-office-too-late');
  });
  it('gates court innovation selection on discovery', () => {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-cmd-4') });
    const command = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'select-court-innovation',
      commandId: 'cmd-ci-1',
      runId: run.runId,
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      innovationId: 'deep-four',
    } as never;
    const missing = handleSeasonRunCommand(command, runContext(run));
    if (
      missing.result.command !== 'select-court-innovation' ||
      missing.result.result.status !== 'rejected'
    ) {
      throw new Error('expected rejection');
    }
    expect(missing.result.result.rejection.code).toBe('innovation-not-discovered');
    const discovered = {
      ...run,
      evolution: {
        schemaVersion: 1,
        frontOfficeVersion: 'season-front-office-v1',
        courtInnovationVersion: 'season-court-innovation-v1',
        targetsVersion: 'franchise-evolution-targets-v1',
        frontOffice: null,
        discovery: {
          blockIndex: 2,
          offeredInnovationIds: ['deep-four', 'twenty-second-clock', 'first-to-seven-overtime'],
          version: 'season-court-innovation-v1',
          seed: seedFromString('evo-disc'),
        },
        selections: {},
      },
    } as never;
    const accepted = handleSeasonRunCommand(command, runContext(discovered));
    if (
      accepted.result.command !== 'select-court-innovation' ||
      accepted.result.result.status !== 'accepted'
    ) {
      throw new Error('expected acceptance');
    }
    const repeated = handleSeasonRunCommand(command, runContext(accepted.run));
    if (
      repeated.result.command !== 'select-court-innovation' ||
      repeated.result.result.status !== 'rejected'
    ) {
      throw new Error('expected rejection');
    }
    expect(repeated.result.result.rejection.code).toBe('duplicate-command');
  });
});
describe('draft front office', () => {
  function draftCommand(
    commandId: string,
    expectedRevision: number,
    payload: SeasonDraftCommand['payload'],
  ): SeasonDraftCommand {
    return { commandId, expectedRevision, payload };
  }
  it('selects an executive during setup and rejects replacements', () => {
    const catalog = buildSeasonDraftCatalog();
    const league = buildSeasonLeague();
    const created = applySeasonDraftCommand(
      null,
      catalog,
      draftCommand('c-create', 0, {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: seedSchema.parse(seedFromString('evo-draft-1')),
        league,
        humanParticipantIds: ['p1'],
        catalogVersion: SEASON_DRAFT_VERSION,
      }),
      {
        generate: () => {
          throw new Error('must not generate');
        },
      },
    );
    if (created.state === null) throw new Error('expected draft state');
    expect(created.state.frontOffice).toBeNull();
    const selected = applySeasonDraftCommand(
      created.state,
      catalog,
      draftCommand('c-fo-1', 1, {
        kind: 'select-draft-front-office',
        participantId: 'p1',
        executiveId: 'jordan-ellis',
      }),
      {
        generate: () => {
          throw new Error('must not generate');
        },
      },
    );
    if (selected.state === null || selected.record.status !== 'accepted')
      throw new Error('expected acceptance');
    expect(selected.state.frontOffice?.executiveId).toBe('jordan-ellis');
    const replaced = applySeasonDraftCommand(
      selected.state,
      catalog,
      draftCommand('c-fo-2', 2, {
        kind: 'select-draft-front-office',
        participantId: 'p1',
        executiveId: 'morgan-vale',
      }),
      {
        generate: () => {
          throw new Error('must not generate');
        },
      },
    );
    expect(replaced.record.status).toBe('rejected');
    if (replaced.record.status !== 'rejected') throw new Error('expected rejection');
    expect(replaced.record.errorCode).toBe('INVALID_FRONT_OFFICE');
  });
});
describe('block commit evolution', () => {
  const rootSeed = seedFromString('evo-commit-1');
  it('creates discovery on block two and resolves AI selections on block three', () => {
    const empty = buildEmptyEvolutionState();
    const afterTwo = evolutionWithBlockCommit({
      rootSeed,
      blockIndex: 2,
      evolution: empty,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ['lakers', 'celtics'],
      data: null,
    });
    expect(afterTwo.discovery).not.toBeNull();
    expect(afterTwo.selections).toEqual({});
    const humanSelected = {
      ...afterTwo,
      selections: {
        lakers: {
          franchiseId: 'lakers',
          innovationId: 'deep-four',
          version: 'season-court-innovation-v1',
          selectedByCommandId: 'cmd-human',
          aiSelected: false,
          inputDigest: null,
        },
      },
    } as never;
    const afterThree = evolutionWithBlockCommit({
      rootSeed,
      blockIndex: 3,
      evolution: humanSelected,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ['lakers', 'celtics'],
      data: null,
    });
    const celtics = (
      afterThree.selections as Record<
        string,
        {
          aiSelected: boolean;
          innovationId: string;
          inputDigest: string | null;
          candidateScores: unknown;
        }
      >
    )['celtics'];
    expect(celtics?.aiSelected).toBe(true);
    expect(['deep-four', 'twenty-second-clock', 'first-to-seven-overtime']).toContain(
      celtics?.innovationId,
    );
    expect(celtics?.inputDigest).toMatch(/^[0-9a-f]{32}$/);
    expect((afterThree.selections as Record<string, unknown>)['lakers']).toEqual(
      (humanSelected as unknown as { selections: Record<string, unknown> }).selections['lakers'],
    );
    const again = evolutionWithBlockCommit({
      rootSeed,
      blockIndex: 3,
      evolution: afterThree,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ['lakers', 'celtics'],
      data: null,
    });
    expect(again).toBe(afterThree);
  });
  it('leaves other blocks untouched', () => {
    const empty = buildEmptyEvolutionState();
    for (const blockIndex of [0, 1, 4, 8]) {
      const next = evolutionWithBlockCommit({
        rootSeed,
        blockIndex,
        evolution: empty,
        humanFranchiseId: 'lakers',
        aiFranchiseIds: ['lakers', 'celtics'],
        data: null,
      });
      expect(next).toBe(empty);
    }
  });
  it('gates block three on the human selection', () => {
    const empty = buildEmptyEvolutionState();
    const run = { evolution: empty, league: { teams: [] } } as never;
    expect(evolutionSelectionGate({ blockIndex: 2, run, humanFranchiseId: 'lakers' })).toBeNull();
    expect(evolutionSelectionGate({ blockIndex: 3, run, humanFranchiseId: 'lakers' })).toBeNull();
    const discovered = evolutionWithBlockCommit({
      rootSeed,
      blockIndex: 2,
      evolution: empty,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ['lakers'],
      data: null,
    });
    const gated = evolutionSelectionGate({
      blockIndex: 3,
      run: {
        evolution: discovered,
        league: { teams: [{ franchiseId: 'lakers', control: 'human' }] },
      } as never,
      humanFranchiseId: 'lakers',
    });
    expect(gated).toEqual({ code: 'evolution-selection-required', blockIndex: 3 });
  });
  it('builds no AI data source without a schedule', () => {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-commit-2') });
    const candidate = { completedRounds: 30, retainedDetails: [] } as never;
    expect(buildEvolutionDataSource({ run, candidate })).toBeNull();
  });
  it('builds an SRS data source from prior and candidate summaries', () => {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-commit-3') });
    const schedule = generateSeasonSchedule({ league: run.league, seed: run.schedule.generationSeed });
    const prior = [{ gameId: 's000001' }] as never;
    const current = [{ gameId: 's000002' }] as never;
    const candidate = { completedRounds: 30, gameSummaries: current, retainedDetails: [] } as never;
    const source = buildEvolutionDataSource({ run, candidate, priorSummaries: prior, schedule });
    expect(source?.summaries.map((summary) => summary.gameId)).toEqual(['s000001', 's000002']);
    expect(source?.completedRounds).toBe(30);
    expect(source?.rotations).toBe(run.rotations);
    expect(source?.schedule).toBe(schedule);
    expect(typeof source?.aiOrderIndexOf('lakers')).toBe('number');
  });
  it('resolves AI selections without touching existing choices', () => {
    const empty = buildEmptyEvolutionState();
    const resolved = resolveAiCourtInnovations({
      rootSeed,
      evolution: empty,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ['lakers', 'celtics', 'bulls'],
      data: null,
    });
    expect(Object.keys(resolved.selections).sort()).toEqual(['bulls', 'celtics']);
  });
});
describe('projection adapters', () => {
  const profile = buildEraSimulationProfile();
  const home = buildLegalSimulationTeam({ teamId: 'home', displayName: 'Home' });
  const away = buildLegalSimulationTeam({ teamId: 'away', displayName: 'Away' });
  it('projects rule-aware games with adapter versions and digests', () => {
    const standard = projectGameWithRule({
      homeUnit: home.players,
      awayUnit: away.players,
      profile,
      rule: 'standard',
    });
    expect(standard.adapterVersion).toBe('season-court-innovation-v1');
    expect(standard.inputDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(standard.overtime).toEqual({ kind: 'timed' });
    const deep = projectGameWithRule({
      homeUnit: home.players,
      awayUnit: away.players,
      profile,
      rule: 'deep-four',
    });
    expect(deep.facts['homeDeepAttempts'] ?? 0).toBeGreaterThan(0);
    expect(deep.facts['homeDeepMakes'] ?? 0).toBeGreaterThan(0);
    expect(deep.homePointsPer100).not.toBe(standard.homePointsPer100);
    const clock = projectGameWithRule({
      homeUnit: home.players,
      awayUnit: away.players,
      profile,
      rule: 'twenty-second-clock',
    });
    expect(clock.facts['makeMultiplier'] ?? 1).toBeLessThanOrEqual(1);
    const race = projectGameWithRule({
      homeUnit: home.players,
      awayUnit: away.players,
      profile,
      rule: 'first-to-seven-overtime',
    });
    expect(race.overtime.kind).toBe('first-to-seven');
    expect(race.homePointsPer100).toBe(standard.homePointsPer100);
  });
  it('estimates symmetric races at one half with finite length', () => {
    const even = estimateFirstToSevenRace(
      { p0: 0.6, p1: 0.1, p2: 0.2, p3: 0.1 },
      { p0: 0.6, p1: 0.1, p2: 0.2, p3: 0.1 },
    );
    expect(even.homeWinProb).toBeCloseTo(0.5, 6);
    expect(even.expectedPossessions).toBeGreaterThan(0);
    expect(even.expectedPossessions).toBeLessThan(200);
    const strong = estimateFirstToSevenRace(
      { p0: 0.4, p1: 0.1, p2: 0.35, p3: 0.15 },
      { p0: 0.7, p1: 0.1, p2: 0.15, p3: 0.05 },
    );
    expect(strong.homeWinProb).toBeGreaterThan(0.5);
  });
  it('derives scoring distributions that sum to one', () => {
    const even = estimateFirstToSevenRace(
      scoringDistributionOf({
        threePointMakes: 10,
        fieldGoalMakes: 40,
        freeThrowMakes: 15,
      } as never),
      scoringDistributionOf({
        threePointMakes: 10,
        fieldGoalMakes: 40,
        freeThrowMakes: 15,
      } as never),
    );
    expect(even.homeWinProb).toBeCloseTo(0.5, 6);
  });
  it('adjusts ledgers with documented deep-four and clock facts', () => {
    const ledger = {
      threePointAttempts: 30,
      threePointMakes: 10,
      threePointPct: 1 / 3,
      fieldGoalAttempts: 90,
      fieldGoalMakes: 40,
      freeThrowAttempts: 20,
      freeThrowMakes: 15,
    } as never;
    const deep = adjustLedgerForDeepFour({
      ledger,
      aboveBreakShareOfThrees: 0.7,
      unit: home.players,
      opponent: away.players,
      profile,
    });
    expect(deep.deepAttempts).toBeCloseTo(30 * 0.7 * 0.2, 10);
    expect(deep.deepMakes).toBeGreaterThan(0);
    expect(deep.threePointAttemptsDelta).toBeCloseTo(-deep.deepAttempts, 10);
    const clock = adjustLedgerForTwentySecondClock({ ledger, profile });
    expect(clock.makeMultiplier).toBeLessThanOrEqual(1);
    expect(clock.violationsPer100).toBeGreaterThanOrEqual(0);
  });
});
describe('srs AI selection', () => {
  interface SrsTeamTotals {
    possessions: number;
    threes: number;
    points: number;
    freeThrows: number;
  }
  function splitTotal(total: number, parts: number): number[] {
    const base = Math.floor(total / parts);
    const remainder = total - base * parts;
    return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
  }
  function srsSide(
    run: SeasonRun,
    franchiseId: string,
    totals: SrsTeamTotals,
  ): { lines: SeasonCompactPlayerLine[]; box: SeasonGameSummary['homeBox'] } {
    const rotation = run.rotations.find((entry) => entry.franchiseId === franchiseId);
    if (rotation === undefined) throw new Error(`missing rotation for ${franchiseId}`);
    const versionIds = rotation.targetMinutes.map((entry) => entry.playerVersionId);
    const threes = splitTotal(totals.threes, versionIds.length);
    const points = splitTotal(totals.points, versionIds.length);
    const freeThrows = splitTotal(totals.freeThrows, versionIds.length);
    const lines = versionIds.map((playerVersionId, index) => {
      const made = (threes[index] ?? 0) + Math.ceil(Math.max(0, (points[index] ?? 0) - (threes[index] ?? 0) * 3 - (freeThrows[index] ?? 0)) / 2);
      return {
        playerVersionId,
        seconds: 600,
        points: points[index] ?? 0,
        fieldGoalsMade: made,
        fieldGoalsAttempted: made + 4,
        threePointersMade: threes[index] ?? 0,
        threePointersAttempted: (threes[index] ?? 0) + 3,
        freeThrowsMade: freeThrows[index] ?? 0,
        freeThrowsAttempted: (freeThrows[index] ?? 0) + 1,
        offensiveRebounds: 1,
        defensiveRebounds: 2,
        assists: 1,
        steals: 0,
        blocks: 0,
        turnovers: 1,
        fouls: 1,
      } satisfies SeasonCompactPlayerLine;
    });
    const sum = (pick: (line: SeasonCompactPlayerLine) => number): number =>
      lines.reduce((total, line) => total + pick(line), 0);
    return {
      lines,
      box: {
        franchiseId: franchiseIdSchema.parse(franchiseId),
        points: sum((line) => line.points),
        fieldGoalsMade: sum((line) => line.fieldGoalsMade),
        fieldGoalsAttempted: sum((line) => line.fieldGoalsAttempted),
        threePointersMade: sum((line) => line.threePointersMade),
        threePointersAttempted: sum((line) => line.threePointersAttempted),
        freeThrowsMade: sum((line) => line.freeThrowsMade),
        freeThrowsAttempted: sum((line) => line.freeThrowsAttempted),
        offensiveRebounds: sum((line) => line.offensiveRebounds),
        defensiveRebounds: sum((line) => line.defensiveRebounds),
        assists: sum((line) => line.assists),
        steals: 0,
        blocks: 0,
        turnovers: sum((line) => line.turnovers),
        fouls: sum((line) => line.fouls),
        possessions: totals.possessions,
      },
    };
  }
  function srsSummary(
    run: SeasonRun,
    input: {
      gameNumber: number;
      round: number;
      homeFranchiseId: string;
      awayFranchiseId: string;
      home: SrsTeamTotals;
      away: SrsTeamTotals;
    },
  ): SeasonGameSummary {
    const home = srsSide(run, input.homeFranchiseId, input.home);
    const away = srsSide(run, input.awayFranchiseId, input.away);
    return {
      schemaVersion: 1,
      summaryVersion: SEASON_GAME_SUMMARY_VERSION,
      gameId: seasonGameIdSchema.parse(`s${String(input.gameNumber).padStart(6, '0')}`),
      round: input.round,
      homeFranchiseId: franchiseIdSchema.parse(input.homeFranchiseId),
      awayFranchiseId: franchiseIdSchema.parse(input.awayFranchiseId),
      status: 'final',
      overtimePeriods: 0,
      homeScore: home.box.points,
      awayScore: away.box.points,
      forfeitLoserFranchiseId: null,
      homeBox: home.box,
      awayBox: away.box,
      homePlayers: home.lines,
      awayPlayers: away.lines,
      injuryEvents: [],
    };
  }
  function buildSrsData(): { run: SeasonRun; data: AiSelectionDataSource; ids: string[] } {
    const { run } = buildEconomyTestRun({ seed: seedFromString('evo-ai-srs') });
    const bombers = 'knicks';
    const grinders = 'bulls';
    const sprinters = 'celtics';
    const average = 'heat';
    const filler = 'lakers';
    for (const id of [bombers, grinders, sprinters, average, filler]) {
      if (!run.league.teams.some((team) => team.franchiseId === id)) {
        throw new Error(`economy league is missing ${id}`);
      }
    }
    const styles: Record<string, SrsTeamTotals> = {
      [bombers]: { possessions: 100, threes: 15, points: 112, freeThrows: 18 },
      [grinders]: { possessions: 92, threes: 6, points: 104, freeThrows: 20 },
      [sprinters]: { possessions: 104, threes: 9, points: 108, freeThrows: 16 },
      [average]: { possessions: 98, threes: 9, points: 106, freeThrows: 17 },
      [filler]: { possessions: 98, threes: 8, points: 105, freeThrows: 17 },
    };
    const games: Array<[string, string]> = [
      [bombers, grinders],
      [sprinters, average],
      [grinders, sprinters],
      [average, bombers],
      [bombers, filler],
      [filler, grinders],
    ];
    const summaries = games.map(([home, away], index) =>
      srsSummary(run, {
        gameNumber: 910001 + index,
        round: index + 1,
        homeFranchiseId: home,
        awayFranchiseId: away,
        home: styles[home] ?? { possessions: 98, threes: 8, points: 105, freeThrows: 17 },
        away: styles[away] ?? { possessions: 98, threes: 8, points: 105, freeThrows: 17 },
      }),
    );
    const schedule = generateSeasonSchedule({ league: run.league, seed: run.schedule.generationSeed });
    const order = new Map(run.aiAssignments.map((assignment, index) => [assignment.franchiseId, index] as const));
    const data: AiSelectionDataSource = {
      summaries,
      rotations: run.rotations,
      schedule,
      completedRounds: 30,
      aiOrderIndexOf: (franchiseId: string) => order.get(franchiseId as never) ?? 0,
    };
    return { run, data, ids: [bombers, grinders, sprinters, average] };
  }
  it('ranks innovations from recorded facts with bounded scores', () => {
    const { data, ids } = buildSrsData();
    const [bombers, grinders, sprinters] = ids as [string, string, string, string];
    const bombersScorer = srsRuleScorerFor(data, bombers);
    const grindersScorer = srsRuleScorerFor(data, grinders);
    const sprintersScorer = srsRuleScorerFor(data, sprinters);
    for (const scorer of [bombersScorer, grindersScorer, sprintersScorer]) {
      for (const innovation of ['deep-four', 'twenty-second-clock', 'first-to-seven-overtime'] as const) {
        const score = scorer(innovation);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
    expect(bombersScorer('deep-four')).toBeGreaterThan(grindersScorer('deep-four'));
    expect(sprintersScorer('twenty-second-clock')).toBeGreaterThan(
      grindersScorer('twenty-second-clock'),
    );
    expect(bombersScorer('first-to-seven-overtime')).toBeGreaterThan(
      grindersScorer('first-to-seven-overtime'),
    );
  });
  it('resolves AI selections deterministically from the SRS data source', () => {
    const { run, data, ids } = buildSrsData();
    const empty = buildEmptyEvolutionState();
    const first = resolveAiCourtInnovations({
      rootSeed: run.rootSeed,
      evolution: empty,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ids,
      data,
    });
    expect(Object.keys(first.selections).sort()).toEqual([...ids].sort());
    for (const selection of Object.values(first.selections)) {
      expect(selection.aiSelected).toBe(true);
      expect(selection.inputDigest).toMatch(/^[0-9a-f]{32}$/);
      expect(selection.candidateScores).toHaveLength(3);
    }
    const second = resolveAiCourtInnovations({
      rootSeed: run.rootSeed,
      evolution: empty,
      humanFranchiseId: 'lakers',
      aiFranchiseIds: ids,
      data,
    });
    expect(second).toEqual(first);
  });
});