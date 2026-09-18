import {
  canPlay,
  createEngineContext,
  createRng,
  DRAFT_FIT_REFINE_DEFAULT,
  DRAFT_FIT_REFINE_MAX,
  evaluateLineupStrength,
  planLineupReposition,
  scoreDraftPool,
  shuffle,
  toSimulationPlayer,
  type DraftFitScore,
} from '@hoop-rush/engine';
import {
  LINEUP_STRUCTURE,
  PROJECTION_SLOTS,
  seedFromString,
  seedSchema,
  type EraSimulationProfile,
  type PeakPlayerSeason,
  type ProjectionModelArtifact,
  type ProjectionSlot,
  type SimulationPlayer,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import { parseCount, UsageError } from '../args.ts';
import { makeReport, type CliReport } from '../report.ts';
import { draftFitBenchmarkReportSchema } from '../report-schemas.ts';
import { loadPackagedData, PackagedData } from './data-loader.ts';

export const DRAFT_FIT_BENCHMARK_OPTIONS: Record<string, boolean> = {
  manifest: true,
  seed: true,
  samples: true,
  games: true,
  'refine-top': true,
  era: true,
  franchise: true,
  format: true,
  verbose: false,
};

type OverallLineup = [
  PeakPlayerSeason,
  PeakPlayerSeason,
  PeakPlayerSeason,
  PeakPlayerSeason,
  PeakPlayerSeason,
];

type AssignedLineup = Array<PeakPlayerSeason | null>;

type OverallState = {
  score: number;
  players: AssignedLineup;
};

type DraftPick = {
  pick: number;
  playerId: string;
  displayName: string;
  overall: number;
  recommendedSlot: ProjectionSlot | null;
  netDelta: number | null;
  worstNetDelta: number | null;
  tier: DraftFitScore['tier'];
  refined: boolean;
};

type SuggestedLineup = {
  players: OverallLineup;
  picks: DraftPick[];
};

type StrategyMetric = {
  wins: number;
  games: number;
  winRate: number;
};

const SLOT_INDEXES = [0, 1, 2, 3, 4] as const;

function overall(player: PeakPlayerSeason): number {
  return player.summaryRatings.overallRating;
}

function lineupKey(players: readonly (PeakPlayerSeason | null)[]): string {
  return players.map((player) => player?.playerId ?? '').join('|');
}

function betterOverallState(
  next: { score: number; players: AssignedLineup },
  current: { score: number; players: AssignedLineup } | undefined,
): boolean {
  if (current === undefined) return true;
  if (next.score !== current.score) return next.score > current.score;
  return lineupKey(next.players) < lineupKey(current.players);
}

export function highestOverallLineup(pool: readonly PeakPlayerSeason[]): OverallLineup | null {
  const sorted = [...pool].sort(
    (a, b) => overall(b) - overall(a) || a.playerId.localeCompare(b.playerId),
  );
  const states: Array<OverallState | undefined> = new Array<OverallState | undefined>(32).fill(
    undefined,
  );
  states[0] = { score: 0, players: [null, null, null, null, null] };
  for (const player of sorted) {
    const previous = states.slice();
    for (let mask = 0; mask < previous.length; mask += 1) {
      const state = previous[mask];
      if (state === undefined) continue;
      for (const slotIndex of SLOT_INDEXES) {
        const bit = 1 << slotIndex;
        if ((mask & bit) !== 0) continue;
        const requirement = LINEUP_STRUCTURE[slotIndex];
        if (!canPlay(player.positions.playable, requirement)) continue;
        const players = [...state.players] as AssignedLineup;
        players[slotIndex] = player;
        const next = {
          score: state.score + overall(player),
          players,
        };
        const nextMask = mask | bit;
        if (betterOverallState(next, states[nextMask])) states[nextMask] = next;
      }
    }
  }
  const result = states[31]?.players;
  if (result === undefined || result.some((player) => player === null)) return null;
  return result as OverallLineup;
}

function slotIndexOf(slot: ProjectionSlot): number {
  const index = PROJECTION_SLOTS.indexOf(slot);
  if (index < 0) throw new Error(`unknown projection slot ${slot}`);
  return index;
}

function repositionDraftLineup(
  assigned: AssignedLineup,
  locked: readonly PeakPlayerSeason[],
  candidate: PeakPlayerSeason,
  targetSlot: number | null,
): AssignedLineup {
  const repositionPlayers = assigned.flatMap((player, slotIndex) =>
    player === null
      ? []
      : [
          {
            playerId: player.playerId,
            positions: player.positions.playable,
            slotIndex,
          },
        ],
  );
  const subject = {
    playerId: candidate.playerId,
    positions: candidate.positions.playable,
  };
  const targets =
    targetSlot === null
      ? SLOT_INDEXES
      : [targetSlot, ...SLOT_INDEXES.filter((slotIndex) => slotIndex !== targetSlot)];
  let plan: ReturnType<typeof planLineupReposition> = null;
  for (const target of targets) {
    plan = planLineupReposition(repositionPlayers, subject, target);
    if (plan !== null) break;
  }
  if (plan === null) {
    throw new Error(
      `cannot place ${candidate.displayName} in slot ${targetSlot === null ? 'any legal slot' : String(targetSlot)}`,
    );
  }
  const byId = new Map([...locked, candidate].map((player) => [player.playerId, player]));
  const next: AssignedLineup = [null, null, null, null, null];
  for (const placement of plan.placements) {
    const player = byId.get(placement.playerId);
    if (player === undefined) throw new Error(`reposition omitted ${placement.playerId}`);
    next[placement.slotIndex] = player;
  }
  return next;
}

function lockedSlotsOf(
  locked: readonly PeakPlayerSeason[],
  assigned: readonly (PeakPlayerSeason | null)[],
): ProjectionSlot[] {
  return locked.map((player) => {
    const index = assigned.findIndex((candidate) => candidate?.playerId === player.playerId);
    if (index < 0) throw new Error(`locked player ${player.playerId} has no slot`);
    const slot = PROJECTION_SLOTS[index];
    if (slot === undefined) throw new Error(`locked player ${player.playerId} has bad slot`);
    return slot;
  });
}

function buildSuggestedLineup(
  pool: readonly PeakPlayerSeason[],
  eraProfile: EraSimulationProfile,
  model: ProjectionModelArtifact,
  refineTopN: number,
): SuggestedLineup {
  const simulationPool = pool.map(toSimulationPlayer);
  const byId = new Map<string, PeakPlayerSeason>(pool.map((player) => [player.playerId, player]));
  const locked: PeakPlayerSeason[] = [];
  let assigned: AssignedLineup = [null, null, null, null, null];
  const picks: DraftPick[] = [];
  while (locked.length < 5) {
    const report = scoreDraftPool({
      candidates: simulationPool,
      locked: locked.map(toSimulationPlayer),
      lockedSlots: locked.length > 0 ? lockedSlotsOf(locked, assigned) : undefined,
      allowDisplacement: true,
      projection: { eraProfile, model, refineTopN },
    });
    const suggestion = report.top[0] ?? report.scores[0];
    if (suggestion === undefined) throw new Error('suggestions produced no legal candidate');
    const candidate = byId.get(suggestion.playerId);
    if (candidate === undefined)
      throw new Error(`suggestion ${suggestion.playerId} is not in pool`);
    const targetSlot =
      suggestion.recommendedSlot === null ? null : slotIndexOf(suggestion.recommendedSlot);
    assigned = repositionDraftLineup(assigned, locked, candidate, targetSlot);
    locked.push(candidate);
    picks.push({
      pick: locked.length,
      playerId: candidate.playerId,
      displayName: candidate.displayName,
      overall: overall(candidate),
      recommendedSlot: suggestion.recommendedSlot,
      netDelta: suggestion.netDelta,
      worstNetDelta: suggestion.worstNetDelta,
      tier: suggestion.tier,
      refined: suggestion.refined,
    });
  }
  if (assigned.some((player) => player === null)) throw new Error('suggested lineup is incomplete');
  return { players: assigned as OverallLineup, picks };
}

function teamForLineup(
  players: readonly PeakPlayerSeason[],
  teamId: string,
  displayName: string,
): SimulationTeam {
  const simulationPlayers: SimulationPlayer[] = players.map(toSimulationPlayer);
  return { teamId, displayName, players: simulationPlayers };
}

function strategyMetric(measurement: ReturnType<typeof evaluateLineupStrength>): StrategyMetric {
  let wins = 0;
  let games = 0;
  for (const value of Object.values(measurement.byBenchmark)) {
    wins += value.wins;
    games += value.games;
  }
  return { wins, games, winRate: games === 0 ? 0 : wins / games };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function parseSeed(value: string | undefined): string {
  const seed = value ?? seedFromString('draft-fit-benchmark-v1');
  const parsed = seedSchema.safeParse(seed);
  if (!parsed.success) throw new UsageError('--seed must be hex (at least 16 characters)');
  return parsed.data;
}

export function draftFitBenchmark(args: {
  manifest?: string;
  seed?: string;
  samples?: string;
  games?: string;
  'refine-top'?: string;
  era?: string;
  franchise?: string;
  verbose?: boolean;
}): CliReport {
  const rolls = parseCount(args.samples, '--samples', 10);
  const games = parseCount(args.games, '--games', 10);
  const refineTopN = parseCount(args['refine-top'], '--refine-top', DRAFT_FIT_REFINE_DEFAULT);
  if (rolls < 1) throw new UsageError('--samples must be >= 1');
  if (games < 1) throw new UsageError('--games must be >= 1');
  if (refineTopN > DRAFT_FIT_REFINE_MAX) {
    throw new UsageError(`--refine-top must be <= ${String(DRAFT_FIT_REFINE_MAX)}`);
  }
  const seed = parseSeed(args.seed);
  const loaded = loadPackagedData(args.manifest);
  const data = new PackagedData(loaded.manifest, loaded.dir);
  const model = data.projectionModel();
  const refs = loaded.manifest.pools
    .filter((entry) => args.era === undefined || entry.eraId === args.era)
    .filter((entry) => args.franchise === undefined || entry.franchiseId === args.franchise)
    .map((entry) => ({ franchiseId: entry.franchiseId, eraId: entry.eraId }))
    .filter(
      (entry, index, all) =>
        index ===
        all.findIndex(
          (candidate) =>
            candidate.franchiseId === entry.franchiseId && candidate.eraId === entry.eraId,
        ),
    )
    .filter((entry) => model.references[entry.eraId] !== undefined)
    .filter(
      (entry) => highestOverallLineup(data.pool(entry.franchiseId, entry.eraId).players) !== null,
    )
    .sort((a, b) => `${a.franchiseId}/${a.eraId}`.localeCompare(`${b.franchiseId}/${b.eraId}`));
  if (refs.length === 0) {
    throw new UsageError('no eligible franchise/era pools remain after filtering');
  }
  const order = shuffle(refs, createRng(seed));
  const context = createEngineContext();
  const rows: Array<{
    roll: number;
    franchiseId: string;
    eraId: string;
    baseline: { lineup: OverallLineup; metric: StrategyMetric };
    suggested: { lineup: OverallLineup; picks: DraftPick[]; metric: StrategyMetric };
    deltaWinRate: number;
    winner: 'highest-overall' | 'suggested' | 'tie';
  }> = [];
  for (let index = 0; index < rolls; index += 1) {
    const ref = order[index % order.length];
    if (ref === undefined) throw new Error(`missing pool roll ${String(index)}`);
    const pool = data.pool(ref.franchiseId, ref.eraId);
    const profile = data.eraProfile(ref.eraId);
    const baselineLineup = highestOverallLineup(pool.players);
    if (baselineLineup === null)
      throw new Error(`no legal highest-Overall five for ${ref.franchiseId}/${ref.eraId}`);
    const suggested = buildSuggestedLineup(pool.players, profile, model, refineTopN);
    const baselineTeam = teamForLineup(
      baselineLineup,
      `overall-${String(index)}`,
      'Highest Overall',
    );
    const suggestedTeam = teamForLineup(
      suggested.players,
      `suggested-${String(index)}`,
      'Suggested',
    );
    const seedBase = `${seed}|draft-fit-roll|${String(index)}|${ref.franchiseId}|${ref.eraId}`;
    const baselineMetric = strategyMetric(
      evaluateLineupStrength(baselineTeam, context, profile, {
        samplesPerBenchmark: games,
        seedBase,
      }),
    );
    const suggestedMetric = strategyMetric(
      evaluateLineupStrength(suggestedTeam, context, profile, {
        samplesPerBenchmark: games,
        seedBase,
      }),
    );
    const deltaWinRate = suggestedMetric.winRate - baselineMetric.winRate;
    rows.push({
      roll: index + 1,
      franchiseId: ref.franchiseId,
      eraId: ref.eraId,
      baseline: { lineup: baselineLineup, metric: baselineMetric },
      suggested: { lineup: suggested.players, picks: suggested.picks, metric: suggestedMetric },
      deltaWinRate,
      winner: deltaWinRate > 0 ? 'suggested' : deltaWinRate < 0 ? 'highest-overall' : 'tie',
    });
  }
  const baselineWins = rows.reduce((sum, row) => sum + row.baseline.metric.wins, 0);
  const suggestedWins = rows.reduce((sum, row) => sum + row.suggested.metric.wins, 0);
  const gamesPlayed = rows.reduce((sum, row) => sum + row.baseline.metric.games, 0);
  const baselineWinRate = baselineWins / Math.max(1, gamesPlayed);
  const suggestedWinRate = suggestedWins / Math.max(1, gamesPlayed);
  const suggestedBetterRolls = rows.filter((row) => row.winner === 'suggested').length;
  const baselineBetterRolls = rows.filter((row) => row.winner === 'highest-overall').length;
  const tiedRolls = rows.filter((row) => row.winner === 'tie').length;
  const payload = draftFitBenchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'benchmark draft-fit',
    seed,
    rolls,
    gamesPerBenchmark: games,
    refineTopN,
    eligiblePools: refs.length,
    engineVersion: context.engineVersion,
    dataVersion: loaded.manifest.dataVersion,
    modelVersion: model.modelVersion,
    rows: rows.map((row) => ({
      roll: row.roll,
      franchiseId: row.franchiseId,
      eraId: row.eraId,
      baseline: {
        lineup: row.baseline.lineup.map((player, slot) => ({
          slot: PROJECTION_SLOTS[slot],
          playerId: player.playerId,
          displayName: player.displayName,
          overall: overall(player),
        })),
        metric: row.baseline.metric,
      },
      suggested: {
        lineup: row.suggested.lineup.map((player, slot) => ({
          slot: PROJECTION_SLOTS[slot],
          playerId: player.playerId,
          displayName: player.displayName,
          overall: overall(player),
        })),
        picks: row.suggested.picks,
        metric: row.suggested.metric,
      },
      deltaWinRate: row.deltaWinRate,
      winner: row.winner,
    })),
    summary: {
      highestOverall: {
        wins: baselineWins,
        games: gamesPlayed,
        winRate: baselineWinRate,
        averageRollWinRate: average(rows.map((row) => row.baseline.metric.winRate)),
      },
      suggested: {
        wins: suggestedWins,
        games: gamesPlayed,
        winRate: suggestedWinRate,
        averageRollWinRate: average(rows.map((row) => row.suggested.metric.winRate)),
      },
      suggestedBetterRolls,
      highestOverallBetterRolls: baselineBetterRolls,
      tiedRolls,
      averageWinRateDelta: average(rows.map((row) => row.deltaWinRate)),
      winner:
        suggestedWinRate > baselineWinRate
          ? 'suggested'
          : suggestedWinRate < baselineWinRate
            ? 'highest-overall'
            : 'tie',
    },
  });
  const details = [
    `seed ${seed} · ${String(rolls)} rolls · ${String(games)} games per benchmark tier · refine top ${String(refineTopN)}`,
    `eligible pools: ${String(refs.length)} · engine ${context.engineVersion} · data ${loaded.manifest.dataVersion} · model ${model.modelVersion}`,
    ...rows.map((row) => {
      const baselineNames = row.baseline.lineup.map((player) => player.displayName).join(' / ');
      const suggestedNames = row.suggested.lineup.map((player) => player.displayName).join(' / ');
      return `roll ${String(row.roll)} ${row.franchiseId}/${row.eraId}: highest-Overall ${(row.baseline.metric.winRate * 100).toFixed(1)}% vs suggested ${(row.suggested.metric.winRate * 100).toFixed(1)}% (${row.deltaWinRate >= 0 ? '+' : ''}${(row.deltaWinRate * 100).toFixed(1)} pp) · OVR [${baselineNames}] · fit [${suggestedNames}]`;
    }),
    `aggregate: highest-Overall ${(baselineWinRate * 100).toFixed(1)}% (${String(baselineWins)}/${String(gamesPlayed)}) · suggested ${(suggestedWinRate * 100).toFixed(1)}% (${String(suggestedWins)}/${String(gamesPlayed)}) · average delta ${((suggestedWinRate - baselineWinRate) * 100).toFixed(1)} pp`,
    `roll wins: suggested ${String(suggestedBetterRolls)} · highest-Overall ${String(baselineBetterRolls)} · ties ${String(tiedRolls)} · winner ${payload.summary.winner}`,
  ];
  if (args.verbose) {
    for (const row of rows) {
      details.push(
        `  roll ${String(row.roll)} picks: ${row.suggested.picks.map((pick) => `${String(pick.pick)}:${pick.displayName}${pick.recommendedSlot ? `@${pick.recommendedSlot}` : ''}${pick.netDelta === null ? '' : ` ${pick.netDelta >= 0 ? '+' : ''}${pick.netDelta.toFixed(1)} NET`}`).join(' · ')}`,
      );
    }
  }
  return makeReport(
    'benchmark draft-fit',
    {
      manifest: args.manifest ?? 'default',
      seed,
      rolls,
      games,
      refineTopN,
      ...(args.era === undefined ? {} : { era: args.era }),
      ...(args.franchise === undefined ? {} : { franchise: args.franchise }),
    },
    { details, payload },
  );
}
