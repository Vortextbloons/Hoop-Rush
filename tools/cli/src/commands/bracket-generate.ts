import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateBracket,
  createEngineContext,
  simulateGame,
  toSimulationPlayer,
  type EngineContext,
  bestLegalFiveWithin,
  type BracketCandidatePlayer,
  type FranchiseCandidates,
} from '@hoop-rush/engine';
import {
  REQUIRED_RATING_KEYS,
  contentHashSchema,
  seedSchema,
  seedFromString,
  playerIdSchema,
  type SimulationTeam,
  type EraSimulationProfile,
  type DifficultyProfile,
  type HoopRushManifest,
  type OpponentBracket,
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
import { resolvePoolLineup } from './challenge.ts';

const COMMITTED_GENERATION_SEED: Seed = seedSchema.parse('8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d');
const GENERATION_VERSION = 'bracket-m3-v8';
const SINGLE_DIFFICULTY: DifficultyProfile = {
  profileVersion: 'm3-single-v5',
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
const MIN_TEAM_GAMES = 20;

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

interface Stint extends SeasonStats {
  teamExternalId: string;
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
    fieldGoalAttemptsPerGame: stats.fga / games,
    fieldGoalPct: opponent.shrunkRatio(stats.fgm, stats.fga, 0.45),
    threePointPct: stats.tpa > 0 ? opponent.shrunkRatio(stats.tpm, stats.tpa, 0.34) : null,
    freeThrowPct: opponent.shrunkRatio(stats.ftm, stats.fta, 0.75),
    threePointAttemptRate: Math.min(1, opponent.ratio(stats.tpa, stats.fga, 0)),
    freeThrowAttemptRate: Math.min(1, opponent.ratio(stats.fta, stats.fga, 0.2)),
  };
}

export function seasonPositions(
  player: Pick<RosterPlayer, 'position' | 'secondaryPositions'>,
): PositionUnion {
  const labels = [player.position, ...(player.secondaryPositions ?? [])];
  const positions = labels.flatMap((label) => {
    switch (label) {
      case 'G-F':
      case 'F-G':
        return ['SG', 'SF'] as const;
      case 'F-C':
      case 'C-F':
        return ['PF', 'C'] as const;
      default:
        return pools.normalizePositionLabels([label]).detailed;
    }
  });
  return [...new Set(positions)].sort();
}

export function selectSeasonFive(
  players: readonly (BracketCandidatePlayer & { minutes: number; offensiveInvolvement: number })[],
): BracketCandidatePlayer[] | null {
  const cornerstone = [...players].sort(
    (a, b) =>
      b.offensiveInvolvement - a.offensiveInvolvement ||
      b.minutes - a.minutes ||
      a.playerId.localeCompare(b.playerId),
  )[0];
  if (!cornerstone) return null;
  const rotation = players.map((player) => ({ ...player, score: player.minutes }));
  const selected = bestLegalFiveWithin(rotation, Infinity, cornerstone.playerId);
  if (!selected) return null;
  return selected.players.map((selectedPlayer) => {
    const original = players.find((player) => player.playerId === selectedPlayer.playerId);
    if (!original) throw new Error(`missing selected player ${selectedPlayer.playerId}`);
    return original;
  });
}

export function buildCandidateCatalog(
  manifest: HoopRushManifest,
  verbose: boolean,
  seasonSeed: string,
  benchmark: { team: SimulationTeam; profile: EraSimulationProfile; context: EngineContext },
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
  }

  interface PeakCandidate {
    playerId: string;
    displayName: string;
    seasonKey: string;
    heightInches: number | null;
    weightLbs: number | null;
    minutes: number;
    offensiveInvolvement: number;
    positions: PositionUnion;
    ratings: BracketCandidatePlayer['ratings'];
    tendencies: BracketCandidatePlayer['tendencies'];
    anchors?: SimulationAnchors;
    score: number;
  }

  const candidates: FranchiseCandidates[] = [];
  const details: string[] = [];
  const claimedPlayers = new Set<string>();
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
        const stats = stint;
        const minutes = Math.trunc(stint.minutes);
        const selectionKey = pools.candidateKey({
          season,
          player: player as unknown as Record<string, unknown>,
          stint: stint as unknown as Record<string, unknown>,
          stats: stats as unknown as Record<string, unknown>,
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
        teamPlayers.set(key, {
          playerId: key,
          displayName: `${player.firstName} ${player.lastName}`.trim(),
          seasonKey: season,
          heightInches: player.heightInches ?? null,
          weightLbs: player.weightLbs ?? null,
          minutes,
          offensiveInvolvement: (stint.points + 2 * stint.assists) / stint.gamesPlayed,
          positions,
          ratings,
          tendencies,
          anchors: anchorsFromStats(stats, positions),
          score: selectionKey[0] ?? 0,
        });
      }
      if (teamPlayers.size >= 5) perSeason.set(season, teamPlayers);
    }

    const seasonOrder = shuffle(
      [...perSeason.keys()].sort(),
      createRng(`${seasonSeed}:teamseason:${slot.franchiseId}`),
    );
    const rank = shuffle(
      manifest.modernFranchiseSlots.map((franchise) => franchise.franchiseId),
      createRng(`${seasonSeed}:absolute-tiers`),
    ).indexOf(slot.franchiseId);
    const targetWinRate = 0.005 + (rank / 29) * 0.06;
    let chosenSeason: string | undefined;
    let bestGap = Infinity;
    for (const season of seasonOrder) {
      const roster = perSeason.get(season);
      if (!roster) continue;
      const five = selectSeasonFive([...roster.values()]);
      if (!five || five.some((player) => claimedPlayers.has(player.playerId))) continue;
      const team: SimulationTeam = {
        teamId: slot.franchiseId,
        displayName: slot.displayName,
        players: five.map((player) => ({
          ...player,
          playerId: playerIdSchema.parse(player.playerId),
        })),
      };
      let wins = 0;
      const games = 160;
      for (let game = 0; game < games; game += 1) {
        const homeFirst = game % 2 === 0;
        const result = simulateGame(
          {
            schemaVersion: 2,
            seed: seedSchema.parse(
              seedFromString(
                `${seasonSeed}:absolute-fit:${slot.franchiseId}:${season}:${String(game)}`,
              ),
            ),
            gameNumber: 1,
            dataVersion: benchmark.profile.dataVersion,
            profile: benchmark.profile,
            home: homeFirst ? team : benchmark.team,
            away: homeFirst ? benchmark.team : team,
          },
          benchmark.context,
        );
        if (result.winner === (homeFirst ? 'home' : 'away')) wins += 1;
      }
      const gap = Math.abs(wins / games - targetWinRate);
      if (gap < bestGap) {
        bestGap = gap;
        chosenSeason = season;
      }
    }
    if (chosenSeason === undefined) {
      throw new Error(`no collision-free legal season for ${slot.franchiseId}`);
    }
    const chosenRoster = perSeason.get(chosenSeason);
    if (chosenRoster === undefined) {
      throw new Error(`missing roster for ${slot.franchiseId} ${chosenSeason}`);
    }
    const players = selectSeasonFive([...chosenRoster.values()]);
    if (!players) throw new Error(`no season five for ${slot.franchiseId} ${chosenSeason}`);
    for (const player of players) claimedPlayers.add(player.playerId);
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
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const profile = data.eraProfile();
  const context = createEngineContext();
  const reference = resolvePoolLineup(
    "Stephen Curry@warriors,Michael Jordan@bulls,LeBron James@cavaliers,Tim Duncan@spurs,Shaquille O'Neal@lakers",
    data,
  );
  const { candidates, details } = buildCandidateCatalog(manifest, args.verbose === true, seed, {
    team: {
      teamId: 'legendary-reference',
      displayName: 'Legendary reference',
      players: reference.map(toSimulationPlayer),
    },
    profile,
    context,
  });
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
      engineContext: context,
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
