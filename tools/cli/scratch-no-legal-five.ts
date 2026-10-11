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
} from '@hoop-rush/data-contracts';
import {
  SeasonBlockInvariantError,
  seasonBlockGamesOf,
  seasonFranchiseLegalFiveFacts,
  simulateSeasonBlockGame,
} from '@hoop-rush/engine';
import {
  createSeasonBlockRunner,
  runnerBlockCommand,
  runnerPipelineInput,
  type SeasonBlockRunnerState,
} from './src/commands/season-block.ts';

const VARIANT_COUNT = Number(process.argv[2] ?? '4');
const MAX_BLOCK = Number(process.argv[3] ?? '2');
const FIXTURE_PATH = resolve('src/fixtures/season-run.json');

interface ForfeitRecord {
  blockIndex: number;
  gameId: string;
  loser: string;
  pregameLegal: boolean;
  pregameUnavailable: number;
  pregameUncoveredSlots: string[];
}

interface DiagnosedSide {
  franchiseId: string;
  unavailableIds: string[];
  uncoveredSlots: string[];
  injuries: {
    playerVersionId: string;
    severity: string;
    missedRemaining: number;
    seasonEnding: boolean;
  }[];
}

interface VariantReport {
  variant: number;
  rootSeed: string;
  blocksRun: number[];
  forfeitsByBlock: Record<string, number>;
  forfeitsByFranchise: Record<string, number>;
  forfeitSplit: { tipoff: number; midGame: number };
  forfeitSamples: ForfeitRecord[];
  seasonEndingInjuriesByFranchise: Record<string, number>;
  depletionSnapshots: Record<
    string,
    {
      belowFive: string[];
      unavailableHistogram: Record<string, number>;
      newInjuriesInBlock: number;
    }
  >;
  failure: {
    blockIndex: number;
    gameId: string;
    message: string;
    home: DiagnosedSide | null;
    away: DiagnosedSide | null;
  } | null;
  interruption: { blockIndex: number; franchiseId: string } | null;
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

function positionsOf(state: SeasonBlockRunnerState): Map<string, readonly Position[]> {
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
  return seasonFranchiseLegalFiveFacts(state.run, franchiseId, health, positionsOf(state));
}

function unavailableIdsOf(
  state: SeasonBlockRunnerState,
  franchiseId: string,
  health: SeasonHealthState,
): string[] {
  const roster = state.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  return (roster?.players ?? [])
    .map((player) => player.playerVersionId)
    .filter((id) =>
      health.injuries.some(
        (record) =>
          record.playerVersionId === id &&
          record.missedGamesRemaining > 0 &&
          record.sameGameReturned !== true,
      ),
    );
}

function uncoveredSlotsOf(
  state: SeasonBlockRunnerState,
  franchiseId: string,
  health: SeasonHealthState,
): string[] {
  const roster = state.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const available = new Set(
    (roster?.players ?? [])
      .map((player) => player.playerVersionId)
      .filter((id) => !unavailableIdsOf(state, franchiseId, health).includes(id)),
  );
  const positions = positionsOf(state);
  const structure = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const uncovered: string[] = [];
  for (const slot of structure) {
    const covered = [...available].some((id) => (positions.get(id) ?? []).includes(slot));
    if (!covered) uncovered.push(slot);
  }
  return uncovered;
}

function diagnoseSide(
  state: SeasonBlockRunnerState,
  franchiseId: string,
  health: SeasonHealthState,
): DiagnosedSide {
  return {
    franchiseId,
    unavailableIds: unavailableIdsOf(state, franchiseId, health),
    uncoveredSlots: uncoveredSlotsOf(state, franchiseId, health),
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
      })),
  };
}

function sharedOptionsOf(input: SeasonBlockSimulationInput): {
  staminaByVersion: Map<string, number>;
  durabilityByVersion: Map<string, number>;
  positions: Map<string, readonly Position[]>;
} {
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

const reports: VariantReport[] = [];
for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
  const rootSeed = variant.toString(16).padStart(32, '0');
  const state = createSeasonBlockRunner({ runPath: patchedFixture(rootSeed) });
  const report: VariantReport = {
    variant,
    rootSeed,
    blocksRun: [],
    forfeitsByBlock: {},
    forfeitsByFranchise: {},
    forfeitSplit: { tipoff: 0, midGame: 0 },
    forfeitSamples: [],
    seasonEndingInjuriesByFranchise: {},
    depletionSnapshots: {},
    failure: null,
    interruption: null,
  };
  for (const record of state.health.injuries) {
    if (!record.seasonEnding) continue;
    report.seasonEndingInjuriesByFranchise[record.franchiseId] =
      (report.seasonEndingInjuriesByFranchise[record.franchiseId] ?? 0) + 1;
  }
  for (let blockIndex = 0; blockIndex <= MAX_BLOCK; blockIndex += 1) {
    const injuriesBeforeBlock = state.health.injuries.length;
    ensureChallenge(state, blockIndex);
    const command = runnerBlockCommand(state, blockIndex);
    const input = runnerPipelineInput(state, command);
    const { staminaByVersion, durabilityByVersion, positions } = sharedOptionsOf(input);
    const rotationByFranchise = new Map(
      input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
    );
    const rosterByFranchise = new Map(
      input.run.rosters.map((roster) => [roster.franchiseId, roster]),
    );
    const gameNumberById = new Map(
      input.schedule.games.map((game, index) => [game.gameId, index + 1]),
    );
    const { fromRound } = blockRoundRange(blockIndex);
    let previousRound = fromRound - 1;
    let effects: SeasonEffectsState = state.effects;
    let health: SeasonHealthState = state.health;
    let blockForfeits = 0;
    let stopped = false;
    for (const game of seasonBlockGamesOf(input.schedule, blockIndex)) {
      const homeFacts = legalFactsOf(state, game.homeFranchiseId, health);
      const awayFacts = legalFactsOf(state, game.awayFranchiseId, health);
      if (!homeFacts.legal && !awayFacts.legal) {
        report.failure = {
          blockIndex,
          gameId: game.gameId,
          message: `no legal five on either side (pregame, ${game.homeFranchiseId} vs ${game.awayFranchiseId})`,
          home: diagnoseSide(state, game.homeFranchiseId, health),
          away: diagnoseSide(state, game.awayFranchiseId, health),
        };
        stopped = true;
        break;
      }
      let outcome;
      try {
        outcome = simulateSeasonBlockGame({
          input,
          game,
          effects,
          health,
          options: {
            skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
            gameNumberById,
            rotationByFranchise,
            rosterByFranchise,
            staminaByVersion,
            durabilityByVersion,
            positions,
          },
        });
      } catch (error) {
        if (
          error instanceof SeasonBlockInvariantError &&
          error.message.includes('no legal five on either side')
        ) {
          report.failure = {
            blockIndex,
            gameId: game.gameId,
            message: error.message,
            home: diagnoseSide(state, game.homeFranchiseId, health),
            away: diagnoseSide(state, game.awayFranchiseId, health),
          };
          stopped = true;
          break;
        }
        throw error;
      }
      if ('interruption' in outcome) {
        report.interruption = {
          blockIndex,
          franchiseId: outcome.interruption.humanFranchiseId,
        };
        stopped = true;
        break;
      }
      const summary = outcome.summary as SeasonGameSummary;
      if (summary.status === 'forfeit') {
        blockForfeits += 1;
        const loser = summary.forfeitLoserFranchiseId;
        if (loser !== null) {
          report.forfeitsByFranchise[loser] = (report.forfeitsByFranchise[loser] ?? 0) + 1;
          const loserPregameLegal =
            loser === game.homeFranchiseId ? homeFacts.legal : awayFacts.legal;
          if (loserPregameLegal) report.forfeitSplit.midGame += 1;
          else report.forfeitSplit.tipoff += 1;
          if (report.forfeitSamples.length < 12) {
            report.forfeitSamples.push({
              blockIndex,
              gameId: game.gameId,
              loser,
              pregameLegal: loserPregameLegal,
              pregameUnavailable: unavailableIdsOf(state, loser, health).length,
              pregameUncoveredSlots: uncoveredSlotsOf(state, loser, health),
            });
          }
        }
      }
      effects = outcome.effects;
      health = outcome.health;
      previousRound = game.round;
    }
    report.blocksRun.push(blockIndex);
    report.forfeitsByBlock[String(blockIndex)] = blockForfeits;
    const snapshot = {
      belowFive: [] as string[],
      unavailableHistogram: {} as Record<string, number>,
      newInjuriesInBlock: state.health.injuries.length - injuriesBeforeBlock,
    };
    if (!stopped) {
      state.effects = effects;
      state.health = health;
      for (const team of state.run.league.teams) {
        const unavailableCount = unavailableIdsOf(state, team.franchiseId, state.health).length;
        snapshot.unavailableHistogram[String(unavailableCount)] =
          (snapshot.unavailableHistogram[String(unavailableCount)] ?? 0) + 1;
        if (!legalFactsOf(state, team.franchiseId, state.health).legal) {
          snapshot.belowFive.push(team.franchiseId);
        }
      }
    }
    report.depletionSnapshots[String(blockIndex)] = snapshot;
    for (const record of health.injuries) {
      if (!record.seasonEnding) continue;
      report.seasonEndingInjuriesByFranchise[record.franchiseId] =
        (report.seasonEndingInjuriesByFranchise[record.franchiseId] ?? 0) + 1;
    }
    if (stopped) break;
  }
  reports.push(report);
}

function ensureChallenge(state: SeasonBlockRunnerState, blockIndex: number): void {
  void state;
  void blockIndex;
}

const totalForfeits = reports.reduce(
  (sum, report) => sum + Object.values(report.forfeitsByBlock).reduce((a, b) => a + b, 0),
  0,
);
const failures = reports.filter((report) => report.failure !== null);
const lines: string[] = [];
lines.push(`variants=${String(VARIANT_COUNT)} maxBlock=${String(MAX_BLOCK)}`);
lines.push(`total forfeit games=${String(totalForfeits)}`);
lines.push(`deadly no-legal-five-both failures=${String(failures.length)}`);
for (const report of reports) {
  lines.push(
    `variant ${String(report.variant)} blocks=[${report.blocksRun.join(',')}] forfeits=${JSON.stringify(report.forfeitsByBlock)} split=${JSON.stringify(report.forfeitSplit)} seasonEnders=${JSON.stringify(report.seasonEndingInjuriesByFranchise)} failure=${report.failure ? `${report.failure.gameId}@b${String(report.failure.blockIndex)}` : 'none'} interruption=${report.interruption ? `b${String(report.interruption.blockIndex)}/${report.interruption.franchiseId}` : 'none'}`,
  );
  for (const [blockIndex, snapshot] of Object.entries(report.depletionSnapshots)) {
    lines.push(
      `  b${blockIndex}: belowFive=[${snapshot.belowFive.join(',')}] newInjuries=${String(snapshot.newInjuriesInBlock)} hist=${JSON.stringify(snapshot.unavailableHistogram)}`,
    );
  }
  for (const sample of report.forfeitSamples.slice(0, 6)) {
    lines.push(
      `  forfeit ${sample.gameId} loser=${sample.loser} pregameLegal=${String(sample.pregameLegal)} pregameUnavailable=${String(sample.pregameUnavailable)} uncovered=[${sample.pregameUncoveredSlots.join(',')}]`,
    );
  }
  if (report.failure !== null) {
    lines.push(`  FAILURE: ${report.failure.message}`);
    for (const side of [report.failure.home, report.failure.away]) {
      if (side === null) continue;
      lines.push(
        `    ${side.franchiseId}: unavailable=${String(side.unavailableIds.length)} uncovered=[${side.uncoveredSlots.join(',')}] injuries=${JSON.stringify(side.injuries.map((injury) => `${injury.severity}/${String(injury.missedRemaining)}${injury.seasonEnding ? '/SE' : ''}`))}`,
      );
    }
  }
}
writeFileSync('no-legal-five-diag-report.json', JSON.stringify(reports, null, 2));
console.log(lines.join('\n'));
