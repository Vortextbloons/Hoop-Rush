import { POSITIONS, type CapRushDraftPick, type CapRushDraftState } from '@hoop-rush/data-contracts';
import {
  capRushCardSchema,
  capRushDraftStateSchema,
  capRushOfferIdSchema,
  capRushPlayoffGameSeed,
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushGameInput,
  buildCapRushLeagueSchedule,
  buildCapRushLockedInputs,
  capRushAssignFranchise,
  capRushBattleVersionSet,
  capRushEmptyAggregate,
  capRushLeagueSlotGames,
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushLeagueGame,
  simulateCapRushPlayoffGame,
  soloToBattleInput,
} from './src/index.ts';
import { capRushTestSetup } from './src/modes/cap-rush/cap-rush-test-support.ts';
import { auditHavocBattleGame } from './src/modes/havoc/core/battle-audit.ts';
import { simulateHavocBattleGame } from './src/modes/havoc/core/battle-game.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from './src/modes/havoc/core/battle-digests.ts';
import { battleToSoloResult } from './src/modes/havoc/core/battle-adapters.ts';
import { havocGameInputDigest, havocGameResultDigest } from './src/modes/havoc/digests.ts';
import { capRushBoxOf } from './src/modes/cap-rush/league-simulation.ts';

function buildLocked() {
  const setup = capRushTestSetup();
  const salaries = [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000];
  const picks: CapRushDraftPick[] = POSITIONS.map((slot, index) => {
    const player = setup.index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`missing ${slot}`);
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: capRushOfferIdSchema.parse(`cro-${'0'.repeat(32)}`),
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: salaries[index] ?? 0,
      }),
    };
  });
  const state: CapRushDraftState = capRushDraftStateSchema.parse({
    schemaVersion: setup.state.schemaVersion,
    runId: setup.state.runId,
    revision: 9,
    runSeed: setup.state.runSeed,
    variant: 'clash',
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    stage: 'complete',
    round: 5,
    offer: null,
    rerollsRemaining: 2,
    picks,
    spin: { status: 'unavailable' },
    locked: null,
    season: {
      games: [],
      aggregate: capRushEmptyAggregate(),
      apronTriggers: { isolations: 0, strikes: 0 },
      completedAt: null,
    },
  });
  const field = (() => {
    const opponents = setup.lockSources.bracket.opponents.map((opponent) => ({
      teamId: opponent.teamId,
      displayName: opponent.displayName,
    }));
    return opponents;
  })();
  return buildCapRushLockedInputs({
    runId: state.runId,
    runSeed: state.runSeed,
    variant: state.variant,
    versionSet: state.versionSet,
    catalog: state.catalog,
    picks: state.picks,
    spin: null,
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover: {
      franchise: capRushAssignFranchise({ runSeed: state.runSeed, field }),
      games: buildCapRushLeagueSchedule({ runSeed: state.runSeed, field }).games,
    },
  });
}

const results = new Map<string, number[]>();
function record(key: string, fn: () => void, iterations: number): void {
  const values = results.get(key) ?? [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    fn();
    values.push(performance.now() - started);
  }
  results.set(key, values);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

const locked = buildLocked();
const context = createEngineContext();
const N = 21;

const soloInput = buildCapRushGameInput({ locked, gameNumber: 1 });
const battleInput = soloToBattleInput(soloInput);
const battle = simulateHavocBattleGame(battleInput, context);
const soloResult = battleToSoloResult(battle.result, soloInput.humanSide, '0'.repeat(32));

for (let i = 0; i < 5; i += 1) simulateCapRushGame({ locked, gameNumber: 1, context });

let turn = 0;
const nextGameNumber = (): number => {
  turn += 1;
  return ((turn - 1) % 30) + 1;
};

record('build-input', () => buildCapRushGameInput({ locked, gameNumber: 1 }), N);
record('battle-input-parse', () => havocBattleInputSchema.parse(battleInput), N);
record('solo->battle parse', () => soloToBattleInput(soloInput), N);
record('battle-simulate', () => void simulateHavocBattleGame(battleInput, context), N);
record('audit', () => auditHavocBattleGame(battleInput, battle.result, battle.tape), N);
record('digest-input', () => havocBattleGameInputDigest(battleInput), N);
record('digest-solo-input', () => havocGameInputDigest(soloInput), N);
record('digest-result', () => havocBattleGameResultDigest(battle.result), N);
record('digest-solo-result', () => havocGameResultDigest(soloResult), N);
record('digest-tape', () => havocBattleGameTapeDigest(battle.tape), N);
record('result-parse', () => havocBattleResultSchema.parse(battle.result), N);
record('tape-parse', () => havocBattleTapeSchema.parse(battle.tape), N);
record('box', () => capRushBoxOf(battle.result.home, battle.result.away, 0), N);
record(
  'battle-result->solo',
  () => battleToSoloResult(battle.result, soloInput.humanSide, '0'.repeat(32)),
  N,
);

record(
  'full-season-game',
  () => void simulateCapRushGame({ locked, gameNumber: nextGameNumber(), context }),
  N,
);

const leagueEntries = capRushLeagueSlotGames(locked, 1).slice(0, 6);
record(
  'league-game',
  () => {
    const entry = leagueEntries[turn % leagueEntries.length]!;
    void simulateCapRushLeagueGame({ locked, entry, context });
  },
  N,
);

const plan = {
  seriesId: 'crs-test',
  round: 1,
  seriesSlot: 0,
  gameOrdinal: 1,
  homeTeamId: locked.human.teamId,
  awayTeamId: locked.opponents[0]!.team.teamId,
  homeSeed: 1,
  awaySeed: 8,
  userSide: 'home' as const,
  isFinals: false,
  seed: capRushPlayoffGameSeed(locked.runSeed, 1, 0, 1),
};
record('playoff-game-user', () => void simulateCapRushPlayoffGame({ locked, plan, context }), N);
const aiPlan = {
  ...plan,
  homeTeamId: locked.opponents[0]!.team.teamId,
  awayTeamId: locked.opponents[1]!.team.teamId,
  userSide: null,
};
record(
  'playoff-game-ai',
  () => void simulateCapRushPlayoffGame({ locked, plan: aiPlan, context }),
  N,
);

const rows = [...results.entries()].sort((left, right) => median(right[1]) - median(left[1]));
for (const [key, values] of rows) {
  console.log(
    `${key.padEnd(20)} median ${median(values).toFixed(3)} ms  p95 ${p95(values).toFixed(3)} ms  (n=${values.length})`,
  );
}
console.log('tape events', battle.tape.events.length, 'scoring', battle.tape.scoring.length);
console.log('league games per slot', capRushLeagueSlotGames(locked, 1).length);
