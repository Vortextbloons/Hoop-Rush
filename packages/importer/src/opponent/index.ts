/**
 * Authors the first permanent bracket entry: the medium-strength 1990s Lakers
 * opening opponent (Van Exel, Threatt, A.C. Green, Horry, Divac in legal
 * G,G,F,F,C assignments). Port of scripts/import-nba/author_opening_opponent.py.
 *
 * M3 includes this artifact unchanged in the full bracket. Player records are
 * converted to the explicit SimulationPlayer contract; summary Overall ratings
 * never enter the engine.
 *
 * Output: `apps/web/static/data/opponents/lakers-1990s-opening.json`
 */
import { parseOpponentTeam } from '@hoop-rush/data-contracts';
import { playableSlotGroups, type Position } from '@hoop-rush/data-contracts';
import { join } from 'node:path';
import { PUBLIC_DATA } from '../config.js';
import { clamp, readJson, writeJsonRetry } from '../json.js';

export const OPPONENT_ID = 'lakers-1990s-opening';
export const BRACKET_VERSION = 'bracket-m3-v3';
export const SEASON_KEY = '1995-96';
export const OPPONENTS_DIR = join(PUBLIC_DATA, 'opponents');
export const POOL_PATH = join(PUBLIC_DATA, 'pools', 'lakers-1990s.json');

// Van Exel, Threatt, A.C. Green, Horry, Divac -> G, G, F, F, C.
export const LINEUP = [
  { playerId: 'p-89', slotIndex: 0, position: 'G' },
  { playerId: 'p-9', slotIndex: 1, position: 'G' },
  { playerId: 'p-920', slotIndex: 2, position: 'F' },
  { playerId: 'p-109', slotIndex: 3, position: 'F' },
  { playerId: 'p-124', slotIndex: 4, position: 'C' },
] as const;

export const RATING_KEYS = [
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

export const TENDENCY_KEYS = [
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

export interface PoolPlayer {
  playerId: string;
  displayName: string;
  heightInches: number;
  weightLbs: number;
  positions: { playable: string[] };
  detailedRatings: Record<string, number>;
  tendencies: Record<string, number>;
  /** Stint-derived stat totals; the anchor derivation treats null like Python's None. */
  stats: Record<string, number | null>;
}

export interface PlayerAnchors {
  gamesPlayed: number;
  minutesPerGame: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  offensiveReboundsPerGame: number;
  defensiveReboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  turnoversPerGame: number;
  fieldGoalPct: number;
  threePointPct: number | null;
  freeThrowPct: number;
  threePointAttemptRate: number;
  freeThrowAttemptRate: number;
}

export interface SimPlayerRatings {
  insideScoring: number;
  closeShot: number;
  midrange: number;
  threePoint: number;
  freeThrow: number;
  ballHandling: number;
  passing: number;
  offensiveIq: number;
  offensiveRebound: number;
  defensiveRebound: number;
  perimeterDefense: number;
  interiorDefense: number;
  steal: number;
  block: number;
  defensiveIq: number;
  speed: number;
  strength: number;
  vertical: number;
}

export interface SimPlayerTendencies {
  usageRate: number;
  passRate: number;
  shotRate: number;
  driveRate: number;
  postUpRate: number;
  rimFrequency: number;
  shortMidFrequency: number;
  longMidFrequency: number;
  cornerThreeFrequency: number;
  aboveBreakThreeFrequency: number;
  threePointRate: number;
  freeThrowRate: number;
  turnoverRate: number;
  isolationRate: number;
  pickAndRollBallHandlerRate: number;
  pickAndRollRollManRate: number;
  spotUpRate: number;
  transitionRate: number;
  cutRate: number;
  foulRate: number;
  stealAttemptRate: number;
  blockAttemptRate: number;
  crashOffensiveGlassRate: number;
}

export interface SimPlayer {
  playerId: string;
  displayName: string;
  positions: string[];
  heightInches: number;
  weightLbs: number;
  ratings: SimPlayerRatings;
  tendencies: SimPlayerTendencies;
  anchors: PlayerAnchors;
}

export interface OpponentArtifact {
  schemaVersion: 2;
  opponentId: string;
  bracketVersion: string;
  difficultyBand: 'medium';
  teamId: 'lakers';
  displayName: 'Los Angeles Lakers';
  seasonKey: string;
  lineup: {
    structure: readonly ['G', 'G', 'F', 'F', 'C'];
    assignments: { slotIndex: number; playerId: string; positions: string[] }[];
  };
  players: SimPlayer[];
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

/** Observed player-season anchors used by the possession engine, shrunk for
 * low sample sizes (mirrors the Python `anchors_for_player`). */
export function anchorsForPlayer(player: PoolPlayer): PlayerAnchors {
  const stats = player.stats;
  const games = Math.max(1, stats['gamesPlayed'] ?? 0);
  const slotGroups = playableSlotGroups(player.positions.playable as Position[]);
  const fallbackShare = slotGroups.includes('C') ? 0.28 : slotGroups.includes('F') ? 0.22 : 0.15;
  // Mirror `x is not None`: JSON null and missing keys both disable the split.
  const offensiveKnown =
    stats['offensiveRebounds'] !== null && stats['offensiveRebounds'] !== undefined;
  const defensiveKnown =
    stats['defensiveRebounds'] !== null && stats['defensiveRebounds'] !== undefined;
  const hasSplit =
    offensiveKnown &&
    defensiveKnown &&
    ((stats['offensiveRebounds'] ?? 0) > 0 ||
      (!slotGroups.includes('C') &&
        !(slotGroups.includes('F') && (stats['rebounds'] ?? 0) / games > 2.5)));
  const rebounds = stats['rebounds'] ?? 0;
  const offensive = hasSplit
    ? (stats['offensiveRebounds'] ?? 0)
    : Math.round(rebounds * fallbackShare);
  const defensive = hasSplit
    ? (stats['defensiveRebounds'] ?? 0)
    : Math.max(0, rebounds - offensive);
  return {
    gamesPlayed: stats['gamesPlayed'] ?? 0,
    minutesPerGame: Math.min(60, (stats['minutes'] ?? 0) / games),
    pointsPerGame: (stats['points'] ?? 0) / games,
    reboundsPerGame: rebounds / games,
    offensiveReboundsPerGame: offensive / games,
    defensiveReboundsPerGame: defensive / games,
    assistsPerGame: (stats['assists'] ?? 0) / games,
    stealsPerGame: (stats['steals'] ?? 0) / games,
    blocksPerGame: (stats['blocks'] ?? 0) / games,
    turnoversPerGame: (stats['turnovers'] ?? 0) / games,
    fieldGoalPct: shrunkRatio(
      stats['fieldGoalsMade'] ?? 0,
      stats['fieldGoalsAttempted'] ?? 0,
      0.45,
    ),
    threePointPct:
      (stats['threesAttempted'] ?? 0) > 0
        ? shrunkRatio(stats['threesMade'] ?? 0, stats['threesAttempted'] ?? 0, 0.34)
        : null,
    freeThrowPct: shrunkRatio(
      stats['freeThrowsMade'] ?? 0,
      stats['freeThrowsAttempted'] ?? 0,
      0.75,
    ),
    threePointAttemptRate: ratio(
      stats['threesAttempted'] ?? 0,
      stats['fieldGoalsAttempted'] ?? 0,
      0,
    ),
    freeThrowAttemptRate: ratio(
      stats['freeThrowsAttempted'] ?? 0,
      stats['fieldGoalsAttempted'] ?? 0,
      0.2,
    ),
  };
}

/** Build the full opponent artifact from a packaged pool (pure; exposed for tests). */
export function buildOpponentArtifact(pool: { players: PoolPlayer[] }): OpponentArtifact {
  const byId = new Map(pool.players.map((p) => [p.playerId, p]));
  const missing = LINEUP.map((entry) => entry.playerId).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`missing pool player ${missing.join(', ')}`);
  }

  const assignments: OpponentArtifact['lineup']['assignments'] = [];
  const players: SimPlayer[] = [];
  for (const entry of LINEUP) {
    const p = byId.get(entry.playerId) as PoolPlayer;
    const playable = p.positions.playable;
    assignments.push({
      slotIndex: entry.slotIndex,
      playerId: entry.playerId,
      positions: playable,
    });

    // Python: ratings clamp(round(v), 0, 100); tendencies clamp(v, 0, 100)
    // (pool tendencies are already rounded to two decimals at pool build time).
    const ratings = {} as SimPlayerRatings;
    for (const key of RATING_KEYS) {
      ratings[key] = clamp(Math.round(p.detailedRatings[key] ?? 50), 0, 100);
    }
    const tendencies = {} as SimPlayerTendencies;
    for (const key of TENDENCY_KEYS) {
      tendencies[key] = clamp(p.tendencies[key] ?? 0, 0, 100);
    }

    players.push({
      playerId: entry.playerId,
      displayName: p.displayName,
      positions: playable,
      heightInches: p.heightInches,
      weightLbs: p.weightLbs,
      ratings,
      tendencies,
      anchors: anchorsForPlayer(p),
    });
  }

  return {
    schemaVersion: 2,
    opponentId: OPPONENT_ID,
    bracketVersion: BRACKET_VERSION,
    difficultyBand: 'medium',
    teamId: 'lakers',
    displayName: 'Los Angeles Lakers',
    seasonKey: SEASON_KEY,
    lineup: { structure: ['G', 'G', 'F', 'F', 'C'], assignments },
    players,
  };
}

export function run(options?: { poolPath?: string; outPath?: string }): void {
  const poolPath = options?.poolPath ?? POOL_PATH;
  const pool = readJson(poolPath) as { players: PoolPlayer[] };
  const artifact = buildOpponentArtifact(pool);
  // The artifact is a whole OpponentTeam file: the packaged schema covers it
  // (lineup legality, strict ratings/tendencies key sets, five players), so
  // validate before writing.
  parseOpponentTeam(artifact);
  const out = options?.outPath ?? join(OPPONENTS_DIR, `${OPPONENT_ID}.json`);
  // Dev servers, sync clients, and antivirus scanners can briefly hold this
  // packaged artifact open on Windows. Use the import pipeline's bounded
  // retry writer instead of failing the entire rebuild on a transient lock.
  writeJsonRetry(out, artifact, true);
  for (const player of artifact.players) {
    console.log(
      `${player.playerId}: ${player.displayName} ${player.positions.join('/')} ft=${String(player.ratings.freeThrow)} pass=${String(player.ratings.passing)}`,
    );
  }
  console.log(`wrote ${out}`);
}
