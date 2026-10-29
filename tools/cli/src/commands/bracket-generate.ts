import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateBracket,
  createEngineContext,
  bestLegalFiveWithin,
  type BracketCandidatePlayer,
  type FranchiseCandidates,
} from '@hoop-rush/engine';
import {
  REQUIRED_RATING_KEYS,
  contentHashSchema,
  opponentTeamSchema,
  seedSchema,
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
import { opponent, pools } from '@hoop-rush/importer';
import { createRng, shuffle } from '@hoop-rush/engine';
import { UsageError } from './sim.ts';
import { parseCount } from '../args.ts';
import { readJson, sha256Hex } from '../io.ts';

const COMMITTED_GENERATION_SEED: Seed = seedSchema.parse('8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d');
const GENERATION_VERSION = 'bracket-m3-v6';
const SINGLE_DIFFICULTY: DifficultyProfile = {
  profileVersion: 'm3-single-v3',
  name: 'medium',
  leagueMedianPercentileBand: [0.45, 0.55],
  teamPercentileBand: [0, 1],
};
const MIN_BRACKET_PAIRS = 4;
const NBA_ROOT = resolve(REPO_ROOT, 'raw-data/nba');
const OPPONENTS_DIR = resolve(REPO_ROOT, 'apps/web/static/data/opponents');
const MANIFEST_PATH = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');
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
  summaryRatings: {
    overallRating: number;
    offenseRating: number;
    defenseRating: number;
  } | null;
  ratingProfile?: {
    rawOverallScore?: number;
    canonicalOverall?: number;
  };
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

function clampRating(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampTendency(value: number): number {
  return Math.min(100, Math.max(0, value));
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
    fieldGoalPct: opponent.shrunkRatio(stats.fgm, stats.fga, 0.45),
    threePointPct: stats.tpa > 0 ? opponent.shrunkRatio(stats.tpm, stats.tpa, 0.34) : null,
    freeThrowPct: opponent.shrunkRatio(stats.ftm, stats.fta, 0.75),
    threePointAttemptRate: Math.min(1, opponent.ratio(stats.tpa, stats.fga, 0)),
    freeThrowAttemptRate: Math.min(1, opponent.ratio(stats.fta, stats.fga, 0.2)),
  };
}

/**
 * Positions come from the season that supplies the player snapshot, not from a
 * career union. A career union turns a guard who once played forward into a
 * four-position player, which is how guards end up starting at power forward.
 */
function seasonPositions(player: RosterPlayer): PositionUnion {
  const labels = new Set<string>();
  if (typeof player.position === 'string' && player.position !== '') labels.add(player.position);
  if (Array.isArray(player.secondaryPositions)) {
    for (const secondary of player.secondaryPositions) {
      if (typeof secondary === 'string' && secondary !== '') labels.add(secondary);
    }
  }
  return pools.normalizePositionLabels(labels).detailed;
}

export function buildCandidateCatalog(
  manifest: HoopRushManifest,
  verbose: boolean,
  seasonSeed: string,
): {
  candidates: FranchiseCandidates[];
  details: string[];
} {
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
  const claimedPlayers = new Set<string>();
  const selectionKeys = new Map<string, readonly number[]>();
  for (const slot of manifest.modernFranchiseSlots) {
    const perSeason = new Map<string, Map<string, PeakCandidate>>();
    for (const season of seasonDirs) {
      const roster = rosterBySeason.get(season);
      let stints: Stint[];
      try {
        stints = readJson(resolve(NBA_ROOT, season, 'stints.json')) as unknown[] as Stint[];
      } catch {
        continue;
      }
      if (!Array.isArray(stints) || !roster) continue;
      const teamPlayers = new Map<string, PeakCandidate>();
      for (const stint of stints) {
        if (stint.teamExternalId !== slot.teamExternalId) continue;
        if (stint.gamesPlayed < MIN_TEAM_GAMES) continue;
        const player = roster.get(stint.playerExternalId);
        if (!player?.summaryRatings) continue;
        const key = `p-${stint.playerExternalId}`;
        const stats = statsBySeason.get(season)?.get(stint.playerExternalId);
        const minutes = Math.trunc(stint.minutes);
        const selectionKey = pools.candidateKey({
          season,
          player: player as unknown as Record<string, unknown>,
          stint: stint as unknown as Record<string, unknown>,
          stats: (stats ?? {}) as Record<string, unknown>,
        });
        const ratings = {} as BracketCandidatePlayer['ratings'];
        for (const keyName of REQUIRED_RATING_KEYS) {
          const value = player.ratings[keyName];
          ratings[keyName] = typeof value === 'number' ? clampRating(value) : 50;
        }
        const tendencies = {} as BracketCandidatePlayer['tendencies'];
        for (const keyName of TENDENCY_KEYS) {
          const value = player.tendencies[keyName];
          tendencies[keyName] = typeof value === 'number' ? clampTendency(value) : 0;
        }
        const positions = seasonPositions(player);
        selectionKeys.set(`${slot.franchiseId}/${key}`, selectionKey);
        teamPlayers.set(key, {
          playerId: key,
          displayName: `${player.firstName} ${player.lastName}`.trim(),
          seasonKey: season,
          heightInches: player.heightInches ?? null,
          weightLbs: player.weightLbs ?? null,
          minutes,
          positions,
          ratings,
          tendencies,
          anchors: anchorsFromStats(stats, positions),
          score: selectionKey[0] ?? 0,
        });
      }
      if (teamPlayers.size >= 5) perSeason.set(season, teamPlayers);
    }

    // One real season per franchise: the roster a team actually fielded, so the
    // league has genuine stars, role players and weak teams instead of every
    // franchise's all-time peaks. A player can suit up for two franchises in
    // different seasons, so seasons are taken in seeded order and the first one
    // whose roster shares no player with an already-claimed team wins.
    const seasonOrder = shuffle(
      [...perSeason.keys()].sort(),
      createRng(`${seasonSeed}:teamseason:${slot.franchiseId}`),
    );
    const chosenSeason = seasonOrder.find((season) => {
      const roster = perSeason.get(season);
      if (roster === undefined) return false;
      for (const playerId of roster.keys()) {
        if (claimedPlayers.has(playerId)) return false;
      }
      return bestLegalFiveWithin([...roster.values()], Infinity) !== null;
    });
    if (chosenSeason === undefined) {
      throw new Error(`no collision-free legal season for ${slot.franchiseId}`);
    }
    const chosenRoster = perSeason.get(chosenSeason);
    if (chosenRoster === undefined) {
      throw new Error(`missing roster for ${slot.franchiseId} ${chosenSeason}`);
    }
    for (const playerId of chosenRoster.keys()) claimedPlayers.add(playerId);
    const players = [...chosenRoster.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
    candidates.push({
      franchiseId: slot.franchiseId,
      displayName: slot.displayName,
      players,
    });
    if (verbose) {
      details.push(
        `catalog ${slot.franchiseId}: ${String(players.length)} players from ${chosenSeason}`,
      );
    }
  }

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
  return { candidates, details };
}

export function bracketGenerate(args: {
  seed?: string;
  'games-per-pair'?: string;
  'min-score'?: string;
  'data-version'?: string;
  out?: string;
  verbose?: boolean;
  opponentsDir?: string;
  manifestPath?: string;
}): CliReport {
  const rawSeed = args.seed ?? COMMITTED_GENERATION_SEED;
  const parsedSeed = seedSchema.safeParse(rawSeed);
  if (!parsedSeed.success) {
    throw new UsageError(`--seed must be hex (got "${rawSeed}")`);
  }
  const seed = parsedSeed.data;
  const gamesPerPair = parseCount(args['games-per-pair'], '--games-per-pair', 12);
  if (gamesPerPair < MIN_BRACKET_PAIRS) {
    throw new UsageError(
      `--games-per-pair must be at least ${String(MIN_BRACKET_PAIRS)} for stable field win rates`,
    );
  }
  const minScore = parseCount(args['min-score'], '--min-score', 45);
  const dataVersion = args['data-version'];
  const difficulty: DifficultyProfile = { ...SINGLE_DIFFICULTY };
  const generationVersion = GENERATION_VERSION;
  const packaged = loadPackagedData();
  const manifest = packaged.manifest;
  const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
  const { candidates, details } = buildCandidateCatalog(manifest, args.verbose === true, seed);
  const opponentsDir = args.opponentsDir ?? OPPONENTS_DIR;

  let bracket: OpponentBracket;
  try {
    bracket = generateBracket({
      seed,
      dataVersion: dataVersion ?? manifest.dataVersion,
      generationVersion,
      profile,
      difficulty,
      candidates,
      gamesPerPair,
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

  const outFile = args.out ?? 'bracket.json';
  const outPath = resolve(opponentsDir, outFile);
  writeFileSync(outPath, `${JSON.stringify(bracket, null, 2)}\n`, 'utf8');
  const contentHash = contentHashSchema.parse(sha256Hex(readFileSync(outPath)));
  const manifestPath = args.manifestPath ?? MANIFEST_PATH;
  const nextManifest = { ...manifest } as HoopRushManifest & {
    opponents?: unknown;
    bracketCasual?: unknown;
  };
  delete nextManifest.opponents;
  delete nextManifest.bracketCasual;
  nextManifest.bracket = {
    url: 'opponents/bracket.json',
    contentHash,
  };
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  const payload = bracketGenerateReportSchema.parse({
    schemaVersion: 1,
    command: 'bracket generate',
    seed,
    generationVersion,
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

  const sorted = [...bracket.opponents].sort((a, b) => b.strength.winRate - a.strength.winRate);
  const rates = sorted.map((o) => o.strength.winRate);
  const leagueMedian = ((rates[14] ?? 0) + (rates[15] ?? 0)) / 2;
  const reportDetails = [
    `wrote ${outPath} (${contentHash.slice(0, 12)}…)`,
    `bracket ${bracket.bracketVersion} · schedule ${bracket.scheduleVersion} · seed ${seed}`,
    ...details,
    `league median win rate ${leagueMedian.toFixed(3)} · span ${(rates[rates.length - 1] ?? 0).toFixed(3)}..${(rates[0] ?? 0).toFixed(3)}`,
    ...sorted.map(
      (o) =>
        `  ${o.opponentId}: ${(o.strength.winRate * 100).toFixed(1)}% (${String(Math.round(o.strength.winRate * 82))}W) · ${o.players.map((p) => p.displayName).join(', ')}`,
    ),
  ];
  return makeReport('bracket generate', { seed }, { details: reportDetails, payload });
}
