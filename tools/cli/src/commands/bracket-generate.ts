import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateBracket,
  createEngineContext,
  type BracketCandidatePlayer,
  type FranchiseCandidates,
} from '@hoop-rush/engine';
import {
  opponentTeamSchema,
  type DifficultyProfile,
  type HoopRushManifest,
  type OpponentBracket,
  type OpponentTeam,
  type PositionUnion,
  type Seed,
  type SimulationAnchors,
  playableSlotGroups,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { bracketGenerateReportSchema } from '../report-schemas.ts';
import { loadPackagedData, PackagedData, REPO_ROOT } from './data-loader.ts';
import { pools } from '@hoop-rush/importer';
import { UsageError } from './sim.ts';
import { parseCount } from '../args.ts';

/**
 * `bracket generate` (dev tool, spec/01): authors the frozen 30-team bracket
 * through the pure propose-review-freeze workflow. The candidate catalog is
 * built privately from the packaged normalized NBA season data; the browser
 * never loads it and no new player pools are advertised. Regeneration with
 * the same data and committed seed is byte-identical.
 */

export const BRACKET_GENERATE_OPTIONS: Record<string, boolean> = {
  seed: true,
  proposals: true,
  samples: true,
  'min-score': true,
  'data-version': true,
  format: true,
  verbose: false,
};

/** Committed seed of the frozen bracket artifact; regeneration uses it. */
const COMMITTED_GENERATION_SEED: Seed = '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d';
const GENERATION_VERSION = 'bracket-m3-v3';
const MIN_BRACKET_SAMPLES = 32;

const NBA_ROOT = resolve(REPO_ROOT, 'raw-data/nba');
const OPPONENTS_DIR = resolve(REPO_ROOT, 'apps/web/static/data/opponents');
const MANIFEST_PATH = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');

const RATING_KEYS = [
  'insideScoring',
  'closeShot',
  'midrange',
  'threePoint',
  'freeThrow',
  'ballHandling',
  'passing',
  'offensiveIq',
  'offensiveRebound',
  'defensiveRebound',
  'perimeterDefense',
  'interiorDefense',
  'steal',
  'block',
  'defensiveIq',
  'speed',
  'strength',
  'vertical',
] as const;

const TENDENCY_KEYS = [
  'usageRate',
  'passRate',
  'shotRate',
  'driveRate',
  'postUpRate',
  'rimFrequency',
  'shortMidFrequency',
  'longMidFrequency',
  'cornerThreeFrequency',
  'aboveBreakThreeFrequency',
  'threePointRate',
  'freeThrowRate',
  'turnoverRate',
  'isolationRate',
  'pickAndRollBallHandlerRate',
  'pickAndRollRollManRate',
  'spotUpRate',
  'transitionRate',
  'cutRate',
  'foulRate',
  'stealAttemptRate',
  'blockAttemptRate',
  'crashOffensiveGlassRate',
] as const;

const MIN_TEAM_GAMES = 40;

interface RosterPlayer {
  externalId: string;
  firstName: string;
  lastName: string;
  position: string;
  secondaryPositions?: string[];
  heightInches: number | null;
  weightLbs: number | null;
  teamExternalId: string;
  ratings: Record<string, number>;
  tendencies: Record<string, number>;
  summaryRatings: { overallRating: number; offenseRating: number; defenseRating: number } | null;
  ratingProfile?: { rawOverallScore?: number; canonicalOverall?: number };
}

interface SeasonStats {
  playerExternalId: string;
  gamesPlayed: number;
  minutes: number;
  points: number;
  rebounds: number;
  offensiveRebounds?: number;
  defensiveRebounds?: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  usageRate?: number | null;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
}

interface Stint {
  playerExternalId: string;
  teamExternalId: string;
  gamesPlayed: number;
  minutes: number;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function clampRating(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampTendency(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function ratio(numerator: number, denominator: number, fallback: number): number {
  return denominator > 0 ? numerator / denominator : fallback;
}

function shrunkRatio(
  numerator: number,
  denominator: number,
  prior: number,
  priorAttempts = 80,
): number {
  return denominator > 0
    ? (numerator + prior * priorAttempts) / (denominator + priorAttempts)
    : prior;
}

function anchorsFromStats(
  stats: SeasonStats | undefined,
  positions: PositionUnion,
): SimulationAnchors | undefined {
  if (!stats || stats.gamesPlayed <= 0) return undefined;
  const games = Math.max(1, stats.gamesPlayed);
  const groups = playableSlotGroups(positions);
  const offensive = stats.offensiveRebounds;
  const defensive = stats.defensiveRebounds;
  const hasReliableSplit =
    offensive !== undefined &&
    defensive !== undefined &&
    (offensive > 0 ||
      (!groups.includes('C') && !(groups.includes('F') && stats.rebounds / games > 2.5)));
  const offensiveRebounds = hasReliableSplit ? offensive : stats.rebounds * 0.2;
  const defensiveRebounds = hasReliableSplit
    ? defensive
    : Math.max(0, stats.rebounds - offensiveRebounds);
  return {
    gamesPlayed: stats.gamesPlayed,
    minutesPerGame: Math.min(60, stats.minutes / games),
    pointsPerGame: stats.points / games,
    reboundsPerGame: stats.rebounds / games,
    offensiveReboundsPerGame: offensiveRebounds / games,
    defensiveReboundsPerGame: defensiveRebounds / games,
    assistsPerGame: stats.assists / games,
    stealsPerGame: stats.steals / games,
    blocksPerGame: stats.blocks / games,
    turnoversPerGame: stats.turnovers / games,
    fieldGoalPct: shrunkRatio(stats.fgm, stats.fga, 0.45),
    threePointPct: stats.tpa > 0 ? shrunkRatio(stats.tpm, stats.tpa, 0.34) : null,
    freeThrowPct: shrunkRatio(stats.ftm, stats.fta, 0.75),
    threePointAttemptRate: Math.min(1, ratio(stats.tpa, stats.fga, 0)),
    freeThrowAttemptRate: Math.min(1, ratio(stats.fta, stats.fga, 0.2)),
  };
}

/** Detailed career-wide playable union for a set of source labels (shared importer normalization). */
function playablePositions(labels: ReadonlySet<string>): PositionUnion {
  return pools.normalizePositionLabels(labels).detailed as PositionUnion;
}

/** Builds the private candidate catalog from the packaged NBA season data. */
export function buildCandidateCatalog(
  manifest: HoopRushManifest,
  verbose: boolean,
): { candidates: FranchiseCandidates[]; details: string[] } {
  const seasonDirs = [
    '1990-91',
    '1991-92',
    '1992-93',
    '1993-94',
    '1994-95',
    '1995-96',
    '1996-97',
    '1997-98',
    '1998-99',
    '1999-00',
    '2000-01',
    '2001-02',
    '2002-03',
    '2003-04',
    '2004-05',
    '2005-06',
    '2006-07',
    '2007-08',
    '2008-09',
    '2009-10',
    '2010-11',
    '2011-12',
    '2012-13',
    '2013-14',
    '2014-15',
    '2015-16',
    '2016-17',
    '2017-18',
    '2018-19',
    '2019-20',
    '2020-21',
    '2021-22',
    '2022-23',
    '2023-24',
    '2024-25',
    '2025-26',
  ];

  const byTeamExternalId = new Map<string, string>();
  for (const slot of manifest.modernFranchiseSlots) {
    byTeamExternalId.set(slot.teamExternalId, slot.franchiseId);
  }
  void byTeamExternalId;

  // Career position labels across every season (career-wide union, spec/02).
  const careerLabels = new Map<string, Set<string>>();
  const rosterBySeason = new Map<string, Map<string, RosterPlayer>>();
  const statsBySeason = new Map<string, Map<string, SeasonStats>>();
  for (const season of seasonDirs) {
    let roster: unknown[];
    try {
      roster = readJson(resolve(NBA_ROOT, season, 'roster.json')) as unknown[];
    } catch {
      continue;
    }
    if (!Array.isArray(roster)) continue;
    const byId = new Map<string, RosterPlayer>();
    for (const raw of roster) {
      const player = raw as RosterPlayer;
      if (!player.externalId) continue;
      byId.set(player.externalId, player);
      const labels = careerLabels.get(player.externalId) ?? new Set<string>();
      labels.add(player.position);
      if (Array.isArray(player.secondaryPositions)) {
        for (const secondary of player.secondaryPositions) {
          if (typeof secondary === 'string' && secondary !== '') labels.add(secondary);
        }
      }
      careerLabels.set(player.externalId, labels);
    }
    rosterBySeason.set(season, byId);

    try {
      const rawStats = readJson(resolve(NBA_ROOT, season, 'season-stats.json'));
      const byPlayer = new Map<string, SeasonStats>();
      if (Array.isArray(rawStats)) {
        for (const raw of rawStats) {
          const stats = raw as SeasonStats;
          if (stats.playerExternalId) byPlayer.set(stats.playerExternalId, stats);
        }
      }
      statsBySeason.set(season, byPlayer);
    } catch {
      statsBySeason.set(season, new Map());
    }
  }

  // Per franchise: player -> best eligible season by the same selection score
  // blend the pool importer uses.
  interface PeakCandidate {
    playerId: string;
    displayName: string;
    seasonKey: string;
    heightInches: number | null;
    weightLbs: number | null;
    minutes: number;
    positions: PositionUnion;
    ratings: BracketCandidatePlayer['ratings'];
    tendencies: BracketCandidatePlayer['tendencies'];
    anchors?: SimulationAnchors;
    score: number;
  }
  const candidates: FranchiseCandidates[] = [];
  const details: string[] = [];
  const selectionKeys = new Map<string, readonly number[]>();

  for (const slot of manifest.modernFranchiseSlots) {
    const perPlayer = new Map<string, PeakCandidate>();
    for (const season of seasonDirs) {
      const roster = rosterBySeason.get(season);
      let stints: Stint[];
      try {
        stints = readJson(resolve(NBA_ROOT, season, 'stints.json')) as unknown[] as Stint[];
      } catch {
        continue;
      }
      if (!Array.isArray(stints) || !roster) continue;
      for (const stint of stints) {
        if (stint.teamExternalId !== slot.teamExternalId) continue;
        if (stint.gamesPlayed < MIN_TEAM_GAMES) continue;
        const player = roster.get(stint.playerExternalId);
        if (!player?.summaryRatings) continue;
        const key = `p-${stint.playerExternalId}`;
        const summary = player.summaryRatings;
        const stats = statsBySeason.get(season)?.get(stint.playerExternalId);
        const minutes = Math.trunc(stint.minutes);
        const games = Math.trunc(stint.gamesPlayed);
        const score = pools.selectionScore(
          pools.rawOverallScoreFor(player as unknown as Record<string, unknown>, summary),
          summary.offenseRating,
          summary.defenseRating,
          stats?.usageRate ?? null,
          minutes,
          games,
        );
        const seasonStart = Number.parseInt(season.slice(0, 4), 10);
        const selectionKey = [score, minutes, games, -seasonStart] as const;
        const selectionKeyId = `${slot.franchiseId}/${key}`;
        const previous = perPlayer.get(key);
        const previousKey = selectionKeys.get(selectionKeyId);
        if (
          previous === undefined ||
          previousKey === undefined ||
          pools.compareSelectionKeys(selectionKey, previousKey) > 0
        ) {
          const ratings = {} as BracketCandidatePlayer['ratings'];
          for (const keyName of RATING_KEYS) {
            const value = player.ratings[keyName];
            ratings[keyName] = typeof value === 'number' ? clampRating(value) : 50;
          }
          const tendencies = {} as BracketCandidatePlayer['tendencies'];
          for (const keyName of TENDENCY_KEYS) {
            const value = player.tendencies[keyName];
            tendencies[keyName] = typeof value === 'number' ? clampTendency(value) : 0;
          }
          const positions = playablePositions(
            careerLabels.get(stint.playerExternalId) ?? new Set(),
          );
          const anchors = anchorsFromStats(stats, positions);
          selectionKeys.set(selectionKeyId, selectionKey);
          perPlayer.set(key, {
            playerId: key,
            displayName: `${player.firstName} ${player.lastName}`.trim(),
            seasonKey: season,
            heightInches: player.heightInches ?? null,
            weightLbs: player.weightLbs ?? null,
            minutes,
            positions,
            ratings,
            tendencies,
            anchors,
            score,
          });
        }
      }
    }
    const players = [...perPlayer.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
    if (players.length === 0) {
      throw new Error(`no candidate players for franchise ${slot.franchiseId}`);
    }
    candidates.push({
      franchiseId: slot.franchiseId,
      displayName: slot.displayName,
      players,
    });
    if (verbose) {
      details.push(`catalog ${slot.franchiseId}: ${String(players.length)} players`);
    }
  }

  // Every player appears in exactly one franchise's catalog: keep the peak
  // stint with the highest selection score and remove duplicate entries from
  // the other catalogs. A fixed bracket opponent can only field a player
  // once, so a player with qualifying stints on two franchises (trades)
  // represents the franchise where their peak is best.
  {
    const owner = new Map<string, { franchiseId: string; key: readonly number[] }>();
    for (const candidate of candidates) {
      for (const player of candidate.players) {
        const selectionKey = selectionKeys.get(`${candidate.franchiseId}/${player.playerId}`);
        if (selectionKey === undefined) {
          throw new Error(`missing selection key for ${candidate.franchiseId}/${player.playerId}`);
        }
        const current = owner.get(player.playerId);
        const comparison = current ? pools.compareSelectionKeys(selectionKey, current.key) : 1;
        if (
          current === undefined ||
          comparison > 0 ||
          (comparison === 0 && candidate.franchiseId < current.franchiseId)
        ) {
          owner.set(player.playerId, {
            franchiseId: candidate.franchiseId,
            key: selectionKey,
          });
        }
      }
    }
    for (const candidate of candidates) {
      const before = candidate.players.length;
      candidate.players = candidate.players.filter(
        (player) => owner.get(player.playerId)?.franchiseId === candidate.franchiseId,
      );
      if (candidate.players.length === 0) {
        throw new Error(`no candidate players for franchise ${candidate.franchiseId}`);
      }
      if (verbose) {
        details.push(
          `catalog ${candidate.franchiseId}: ${String(candidate.players.length)}/${String(before)} after cross-franchise dedup`,
        );
      }
    }
  }
  return { candidates, details };
}

/** Builds the frozen bracket artifact and commits it with the manifest. */
export function bracketGenerate(args: {
  seed?: string;
  proposals?: string;
  samples?: string;
  'min-score'?: string;
  'data-version'?: string;
  verbose?: boolean;
}): CliReport {
  const seed = args.seed ?? COMMITTED_GENERATION_SEED;
  if (!/^[0-9a-f]{16,64}$/.test(seed)) {
    throw new UsageError(`--seed must be hex (got "${seed}")`);
  }
  const proposals = parseCount(args.proposals, '--proposals', 32);
  const samples = parseCount(args.samples, '--samples', MIN_BRACKET_SAMPLES);
  if (samples < MIN_BRACKET_SAMPLES) {
    throw new UsageError(
      `--samples must be at least ${String(MIN_BRACKET_SAMPLES)} for stable bracket percentile separation`,
    );
  }
  const minScore = parseCount(args['min-score'], '--min-score', 45);
  const dataVersion = args['data-version'];

  const packaged = loadPackagedData();
  const manifest = packaged.manifest;
  const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();

  const { candidates, details } = buildCandidateCatalog(manifest, args.verbose === true);
  const openingRaw = readJson(resolve(OPPONENTS_DIR, 'lakers-1990s-opening.json'));
  const openingParsed = opponentTeamSchema.safeParse(openingRaw);
  if (!openingParsed.success) {
    return makeReport(
      'bracket generate',
      { seed },
      {
        failures: [
          `opening opponent fails validation: ${openingParsed.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const openingOpponent: OpponentTeam = openingParsed.data;

  const difficulty: DifficultyProfile = {
    profileVersion: 'm3-medium-v4',
    name: 'medium',
    leagueMedianPercentileBand: [0.4, 0.52],
    teamPercentileBand: [0.23, 0.6],
  };

  let bracket: OpponentBracket;
  try {
    bracket = generateBracket({
      seed,
      dataVersion: dataVersion ?? manifest.dataVersion,
      generationVersion: GENERATION_VERSION,
      profile,
      openingOpponent,
      difficulty,
      candidates,
      proposalsPerFranchise: proposals,
      samplesPerBenchmark: samples,
      minPlayerScore: minScore,
      engineContext: createEngineContext(),
    });
  } catch (error) {
    return makeReport(
      'bracket generate',
      { seed },
      {
        failures: [`generation failed: ${(error as Error).message}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }

  const outPath = resolve(OPPONENTS_DIR, 'bracket.json');
  writeFileSync(outPath, `${JSON.stringify(bracket, null, 2)}\n`, 'utf8');
  const contentHash = createHash('sha256').update(readFileSync(outPath)).digest('hex');

  const manifestPath = MANIFEST_PATH;
  const nextManifest = { ...manifest } as HoopRushManifest & { opponents?: unknown };
  delete nextManifest.opponents;
  nextManifest.bracket = {
    url: 'opponents/bracket.json',
    contentHash,
  };
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  const payload = bracketGenerateReportSchema.parse({
    schemaVersion: 1,
    command: 'bracket generate',
    seed,
    generationVersion: GENERATION_VERSION,
    dataVersion: dataVersion ?? manifest.dataVersion,
    bracketVersion: bracket.bracketVersion,
    scheduleVersion: bracket.scheduleVersion,
    contentHash,
    opponents: bracket.opponents.map((o) => ({
      opponentId: o.opponentId,
      teamId: o.teamId,
      winRate: o.strength.winRate,
      percentile: o.strength.percentile,
      players: o.players.map((p) => p.playerId),
    })),
    schedule: bracket.schedule.map((s) => s.opponentId),
  });

  const sorted = [...bracket.opponents].sort(
    (a, b) => a.strength.percentile - b.strength.percentile,
  );
  const medianPct = sorted[Math.floor(sorted.length / 2)]?.strength.percentile ?? 0;
  const reportDetails = [
    `wrote ${outPath} (${contentHash.slice(0, 12)}…)`,
    `bracket ${bracket.bracketVersion} · schedule ${bracket.scheduleVersion} · seed ${seed}`,
    ...details,
    `median percentile ${medianPct.toFixed(3)} (band ${difficulty.leagueMedianPercentileBand[0].toFixed(2)}..${difficulty.leagueMedianPercentileBand[1].toFixed(2)})`,
    ...sorted.map(
      (o) =>
        `  ${o.opponentId}: pct ${o.strength.percentile.toFixed(3)} · winRate ${o.strength.winRate.toFixed(3)} · ${o.players.map((p) => p.displayName).join(', ')}`,
    ),
  ];
  return makeReport('bracket generate', { seed }, { details: reportDetails, payload });
}
