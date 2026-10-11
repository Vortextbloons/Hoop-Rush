import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  blockRoundRange,
  type Position,
  type SeasonBlockSimulationInput,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonScheduleGame,
} from '@hoop-rush/data-contracts';
import {
  SeasonBlockInvariantError,
  seasonBlockGamesOf,
  seasonFranchiseLegalFiveFacts,
  simulateSeasonBlockGame,
} from '@hoop-rush/engine';
import {
  createSeasonBlockRunner,
  ensureChallengeDeal,
  runBlockThroughHandler,
  runnerBlockCommand,
  runnerPipelineInput,
  type SeasonBlockRunnerState,
} from './src/commands/season-block.ts';

const VARIANT_COUNT = Number(process.argv[2] ?? '6');
const MAX_BLOCK = Number(process.argv[3] ?? '8');
const FIXTURE_PATH = resolve('src/fixtures/season-run.json');

interface VariantReport {
  variant: number;
  rootSeed: string;
  blocksRun: number[];
  forfeitsByBlock: Record<string, number>;
  forfeitsByFranchise: Record<string, number>;
  belowLegalFivePregame: Record<string, number>;
  seasonEndingInjuriesByFranchise: Record<string, number>;
  failure: {
    blockIndex: number;
    gameId: string;
    message: string;
    home: DiagnosedSide | null;
    away: DiagnosedSide | null;
  } | null;
  interruption: { blockIndex: number; gameId: string; franchiseId: string } | null;
}

interface DiagnosedSide {
  franchiseId: string;
  availableIds: string[];
  unavailableIds: string[];
  rotationStarters: string[];
  benchOrder: string[];
  uncoveredSlots: string[];
  injuries: {
    playerVersionId: string;
    severity: string;
    missedRemaining: number;
    seasonEnding: boolean;
    gameId: string;
  }[];
}

function patchedFixture(rootSeed: string): string {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
  raw.rootSeed = rootSeed;
  const dir = join(tmpdir(), 'hr-no-legal-five-diag');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `variant-${rootSeed.slice(0, 8)}.json`);
  writeFileSync(path, JSON.stringify(raw));
  return path;
}

function expandedPositionsOf(state: SeasonBlockRunnerState): Map<string, readonly Position[]> {
  const positions = new Map<string, readonly Position[]>();
  for (const player of state.expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  return positions;
}

function legalFactsOf(
  state: SeasonBlockRunnerState,
  franchiseId: string,
  health: SeasonHealthState,
): ReturnType<typeof seasonFranchiseLegalFiveFacts> {
  return seasonFranchiseLegalFiveFacts(state.run, franchiseId, health, expandedPositionsOf(state));
}

function diagnoseSide(
  state: SeasonBlockRunnerState,
  franchiseId: string,
  health: SeasonHealthState,
): DiagnosedSide {
  const roster = state.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const rotation = state.run.rotations.find((entry) => entry.franchiseId === franchiseId);
  const positions = expandedPositionsOf(state);
  const unavailableIds = (roster?.players ?? [])
    .map((player) => player.playerVersionId)
    .filter((id) =>
      health.injuries.some(
        (record) =>
          record.playerVersionId === id &&
          record.missedGamesRemaining > 0 &&
          record.sameGameReturned !== true,
      ),
    );
  const availableIds = (roster?.players ?? [])
    .map((player) => player.playerVersionId)
    .filter((id) => !unavailableIds.includes(id));
  const structure = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const uncoveredSlots: string[] = [];
  for (const slot of structure) {
    const covered = availableIds.some((id) => (positions.get(id) ?? []).includes(slot));
    if (!covered) uncoveredSlots.push(slot);
  }
  return {
    franchiseId,
    availableIds,
    unavailableIds,
    rotationStarters: rotation?.starters ?? [],
    benchOrder: rotation?.benchOrder ?? [],
    uncoveredSlots,
    injuries: health.injuries
      .filter(
        (record) =>
          record.franchiseId === franchiseId &&
          record.missedGamesRemaining > 0 &&
          record.sameGameReturned !== true,
      )
      .map((record) => ({
        playerVersionId: record.playerVersionId,
        severity: record.severity,
        missedRemaining: record.missedGamesRemaining,
        seasonEnding: record.seasonEnding,
        gameId: record.gameId,
      })),
  };
}

function sharedOptionsOf(input: SeasonBlockSimulationInput): Record<string, unknown> {
  const staminaByVersion = new Map<string, number>();
  for (const player of input.expanded.values()) {
    const stamina = player.stamina;
    if (stamina === undefined) throw new Error('expanded player without stamina');
    staminaByVersion.set(player.playerVersionId, stamina.rating);
  }
  const durabilityByVersion = new Map<string, number>();
  for (const candidate of input.catalog.candidates) {
    durabilityByVersion.set(candidate.playerVersionId, candidate.durability.rating);
  }
  const positions = new Map<string, readonly Position[]>();
  for (const player of input.expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  return { staminaByVersion, durabilityByVersion, positions };
}

function rerunBlockWithDiagnosis(
  state: SeasonBlockRunnerState,
  blockIndex: number,
): {
  gameId: string;
  home: DiagnosedSide;
  away: DiagnosedSide;
} {
  ensureChallengeDeal(state, blockIndex);
  const command = runnerBlockCommand(state, blockIndex);
  const input = runnerPipelineInput(state, command);
  const rotationByFranchise = new Map(
    input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rosterByFranchise = new Map(
    input.run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  const gameNumberById = new Map(
    input.schedule.games.map((game, index) => [game.gameId, index + 1]),
  );
  const shared = sharedOptionsOf(input);
  const { fromRound } = blockRoundRange(blockIndex);
  let previousRound = fromRound - 1;
  let effects: SeasonEffectsState = input.effects;
  let health: SeasonHealthState = input.health;
  for (const game of seasonBlockGamesOf(input.schedule, blockIndex)) {
    const before = {
      home: legalFactsOf(state, game.homeFranchiseId, health),
      away: legalFactsOf(state, game.awayFranchiseId, health),
    };
    try {
      const outcome = simulateSeasonBlockGame({
        input,
        game,
        effects,
        health,
        options: {
          skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
          gameNumberById,
          rotationByFranchise,
          rosterByFranchise,
          ...shared,
        },
      });
      if ('interruption' in outcome) {
        throw new SeasonBlockInvariantError(
          `interruption at ${game.gameId} for ${outcome.interruption.humanFranchiseId}`,
        );
      }
      effects = outcome.effects;
      health = outcome.health;
      previousRound = game.round;
      void before;
    } catch (error) {
      if (
        error instanceof SeasonBlockInvariantError &&
        error.message.includes('no legal five on either side')
      ) {
        return {
          gameId: game.gameId,
          home: diagnoseSide(state, game.homeFranchiseId, health),
          away: diagnoseSide(state, game.awayFranchiseId, health),
        };
      }
      throw error;
    }
  }
  throw new Error(`block ${String(blockIndex)} did not fail on re-run`);
}

const reports: VariantReport[] = [];
for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
  const rootSeed = variant.toString(16).padStart(32, '0');
  const runPath = patchedFixture(rootSeed);
  const state = createSeasonBlockRunner({ runPath });
  const report: VariantReport = {
    variant,
    rootSeed,
    blocksRun: [],
    forfeitsByBlock: {},
    forfeitsByFranchise: {},
    belowLegalFivePregame: {},
    seasonEndingInjuriesByFranchise: {},
    failure: null,
    interruption: null,
  };
  const franchiseSeasonEnders = (): void => {
    for (const record of state.health.injuries) {
      if (!record.seasonEnding) continue;
      report.seasonEndingInjuriesByFranchise[record.franchiseId] =
        (report.seasonEndingInjuriesByFranchise[record.franchiseId] ?? 0) + 1;
    }
  };
  for (let blockIndex = 0; blockIndex <= MAX_BLOCK; blockIndex += 1) {
    try {
      const checkpoint = runBlockThroughHandler(state, blockIndex);
      report.blocksRun.push(blockIndex);
      let forfeits = 0;
      for (const summary of checkpoint.gameSummaries as SeasonGameSummary[]) {
        if (summary.status !== 'forfeit') continue;
        forfeits += 1;
        const loser = summary.forfeitLoserFranchiseId;
        if (loser !== null) {
          report.forfeitsByFranchise[loser] = (report.forfeitsByFranchise[loser] ?? 0) + 1;
        }
      }
      report.forfeitsByBlock[String(blockIndex)] = forfeits;
    } catch (error) {
      if (error instanceof SeasonBlockInvariantError) {
        if (error.message.includes('no legal five on either side')) {
          const match = /game (s\d+) has no legal five/.exec(error.message);
          const gameId = match?.[1] ?? 'unknown';
          const blockGames = seasonBlockGamesOf(state.schedule, blockIndex);
          const game = blockGames.find((entry: SeasonScheduleGame) => entry.gameId === gameId);
          const home = game ? diagnoseSide(state, game.homeFranchiseId, state.health) : null;
          const away = game ? diagnoseSide(state, game.awayFranchiseId, state.health) : null;
          report.failure = {
            blockIndex,
            gameId,
            message: error.message,
            home,
            away,
          };
        } else if (error.message.includes('interrupted')) {
          report.interruption = {
            blockIndex,
            gameId: 'unknown',
            franchiseId: state.humanFranchiseId ?? 'unknown',
          };
        }
        franchiseSeasonEnders();
        break;
      }
      throw error;
    }
  }
  franchiseSeasonEnders();
  reports.push(report);
}

const totalForfeits = reports.reduce(
  (sum, report) => sum + Object.values(report.forfeitsByBlock).reduce((a, b) => a + b, 0),
  0,
);
const failures = reports.filter((report) => report.failure !== null);
const interruptions = reports.filter((report) => report.interruption !== null);
const lines: string[] = [];
lines.push(`variants=${String(VARIANT_COUNT)} maxBlock=${String(MAX_BLOCK)}`);
lines.push(
  `seasons simulated=${String(reports.filter((report) => report.blocksRun.length > 0).length)}`,
);
lines.push(`total forfeit games=${String(totalForfeits)}`);
lines.push(`deadly no-legal-five-both failures=${String(failures.length)}`);
lines.push(`human invalid-roster interruptions=${String(interruptions.length)}`);
for (const report of reports) {
  lines.push(
    `variant ${String(report.variant)} blocks=[${report.blocksRun.join(',')}] forfeits=${JSON.stringify(report.forfeitsByBlock)} seasonEnders=${JSON.stringify(report.seasonEndingInjuriesByFranchise)} failure=${report.failure ? `${report.failure.gameId}@b${String(report.failure.blockIndex)}` : 'none'} interruption=${report.interruption ? `b${String(report.interruption.blockIndex)}` : 'none'}`,
  );
}
for (const report of failures) {
  const failure = report.failure;
  if (failure === null) continue;
  lines.push(
    `--- failure variant ${String(report.variant)} ${failure.gameId} block ${String(failure.blockIndex)}`,
  );
  lines.push(`message: ${failure.message}`);
  for (const side of [failure.home, failure.away]) {
    if (side === null) continue;
    lines.push(
      `side ${side.franchiseId}: unavailable=${String(side.unavailableIds.length)} uncoveredSlots=[${side.uncoveredSlots.join(',')}] seasonEnding=${String(side.injuries.filter((injury) => injury.seasonEnding).length)} injuries=${JSON.stringify(side.injuries.map((injury) => `${injury.severity}/${String(injury.missedRemaining)}${injury.seasonEnding ? '/SE' : ''}`))}`,
    );
  }
}
writeFileSync(join('no-legal-five-diag-report.json'), JSON.stringify(reports, null, 2));
console.log(lines.join('\n'));
