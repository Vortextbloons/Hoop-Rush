import type {
  BracketOpponent,
  DifficultyProfile,
  EraSimulationProfile,
  OpponentBracket,
  PositionUnion,
  Seed,
  SimulationPlayer,
  SimulationAnchors,
  SimulationRatings,
  SimulationTeam,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  canPlay,
  franchiseIdSchema,
  LINEUP_STRUCTURE,
  opponentBracketSchema,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/kernel.ts';
import { simulateGame } from '../sim/game.ts';
import { validateBracketContent } from '../challenge/commands.ts';
import { evaluateLineupBalance, strengthSeed } from '../challenge/lineup-eval.ts';
import { FIELD_BENCHMARK_VERSION } from '../challenge/benchmarks.ts';
import { generateSchedule, scheduleInvariants, SCHEDULE_GENERATION_VERSION } from './schedule.ts';

export const SCHEDULE_VERSION_LABEL = `schedule-${SCHEDULE_GENERATION_VERSION.replace('schedule-', '')}`;

export const BRACKET_TARGET_LADDER: readonly (readonly [number, number])[] = [
  [0, 0.75],
  [3, 0.66],
  [7, 0.6],
  [14, 0.5],
  [19, 0.41],
  [24, 0.28],
  [29, 0.1],
];

export const BRACKET_WIN_RATE_BAND: readonly [number, number] = [0.1, 0.8];
const LEAGUE_MEDIAN_WIN_RATE_BAND: readonly [number, number] = [0.46, 0.54];
const SAMPLING_TOLERANCE = 0.03;

export interface BracketCandidatePlayer {
  playerId: string;
  displayName: string;
  positions: PositionUnion;
  heightInches: number | null;
  weightLbs: number | null;
  ratings: SimulationRatings;
  tendencies: SimulationTendencies;
  anchors?: SimulationAnchors;
  seasonKey: string;
  score: number;
}

export interface FranchiseCandidates {
  franchiseId: string;
  displayName: string;
  players: BracketCandidatePlayer[];
}

export interface BracketGenerationOptions {
  seed: Seed;
  dataVersion: string;
  generationVersion: string;
  profile: EraSimulationProfile;
  difficulty: DifficultyProfile;
  candidates: FranchiseCandidates[];
  gamesPerPair?: number;
  minPlayerScore?: number;
  engineContext: EngineContext;
}

const DEFAULT_GAMES_PER_PAIR = 12;
const DEFAULT_MIN_PLAYER_SCORE = 45;
const MAX_SEARCH_NODES = 2_000_000;

export interface SelectedFive {
  players: readonly BracketCandidatePlayer[];
  quality: number;
}

interface FieldTeam {
  key: string;
  team: SimulationTeam;
}

function toSimulationPlayer(player: BracketCandidatePlayer): SimulationPlayer {
  return {
    playerId: playerIdSchema.parse(player.playerId),
    displayName: player.displayName,
    positions: player.positions,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    ratings: player.ratings,
    tendencies: player.tendencies,
    anchors: player.anchors,
  };
}

function percentileOf(value: number, population: readonly number[]): number {
  let below = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (below + equal / 2) / population.length;
}

function totalQuality(players: readonly BracketCandidatePlayer[]): number {
  return players.reduce((sum, player) => sum + player.score, 0) / players.length;
}

function isBalanced(players: readonly BracketCandidatePlayer[]): boolean {
  return evaluateLineupBalance({
    teamId: 'probe',
    displayName: 'probe',
    players: players.map(toSimulationPlayer),
  }).ok;
}

export function bestLegalFiveWithin(
  pool: readonly BracketCandidatePlayer[],
  supportCap: number,
  requiredPlayerId?: string,
): SelectedFive | null {
  if (requiredPlayerId !== undefined) {
    const star = pool.find((player) => player.playerId === requiredPlayerId);
    return star ? bestFiveWithStar(pool, star, supportCap) : null;
  }
  if (!Number.isFinite(supportCap)) return bestFiveWithStar(pool, null, Infinity);
  const stars = [...pool].sort((a, b) => b.score - a.score).slice(0, 6);
  let best: SelectedFive | null = null;
  for (const star of [null, ...stars]) {
    const five = bestFiveWithStar(pool, star ?? null, supportCap);
    if (five && (best === null || five.quality > best.quality)) best = five;
  }
  return best;
}

function bestFiveWithStar(
  pool: readonly BracketCandidatePlayer[],
  star: BracketCandidatePlayer | null,
  supportCap: number,
): SelectedFive | null {
  const slots = LINEUP_STRUCTURE;
  const slotCount = slots.length;
  const support = pool
    .filter((player) => player.playerId !== star?.playerId && player.score <= supportCap)
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  const eligibleBySlot = slots.map((slotPosition) =>
    support.filter((player) => canPlay(player.positions, slotPosition)),
  );

  const placed: (BracketCandidatePlayer | undefined)[] = new Array<
    BracketCandidatePlayer | undefined
  >(slotCount);
  const used = new Set<string>();
  let best: SelectedFive | null = null;
  let bestQuality = -Infinity;
  let bestRoleFit = -Infinity;
  let nodes = 0;

  const remainingBound = (slot: number, placedScore: number, starPlaced: boolean): number => {
    const open = slotCount - slot;
    if (open <= 0) return placedScore;
    let bound = placedScore;
    let taken = 0;
    if (star && !starPlaced) {
      bound += star.score;
      taken += 1;
    }
    if (taken >= open) return bound;
    const openSlots = slots.slice(slot);
    for (const player of support) {
      if (taken >= open) break;
      if (used.has(player.playerId)) continue;
      let eligible = false;
      for (const slotPosition of openSlots) {
        if (canPlay(player.positions, slotPosition)) {
          eligible = true;
          break;
        }
      }
      if (!eligible) continue;
      bound += player.score;
      taken += 1;
    }
    return bound;
  };

  const evaluate = (): void => {
    const five: BracketCandidatePlayer[] = [];
    for (const entry of placed) {
      if (entry === undefined) return;
      five.push(entry);
    }
    if (star && !used.has(star.playerId)) return;
    if (!isBalanced(five)) return;
    const quality = totalQuality(five);
    const roleFit =
      (five[0]?.anchors?.assistsPerGame ?? 0) +
      (five[3]?.anchors?.reboundsPerGame ?? 0) +
      (five[4]?.heightInches ?? 0);
    if (quality > bestQuality || (quality === bestQuality && roleFit > bestRoleFit)) {
      best = { players: five, quality };
      bestQuality = quality;
      bestRoleFit = roleFit;
    }
  };

  const recurse = (slot: number, placedScore: number): void => {
    nodes += 1;
    if (nodes > MAX_SEARCH_NODES) return;
    if (slot === slotCount) {
      evaluate();
      return;
    }
    const slotPosition = slots[slot];
    if (!slotPosition) return;
    if (star && !used.has(star.playerId) && canPlay(star.positions, slotPosition)) {
      used.add(star.playerId);
      placed[slot] = star;
      const nextScore = placedScore + star.score;
      if (remainingBound(slot + 1, nextScore, true) / slotCount >= bestQuality) {
        recurse(slot + 1, nextScore);
      }
      placed[slot] = undefined;
      used.delete(star.playerId);
    }
    for (const player of eligibleBySlot[slot] ?? []) {
      if (used.has(player.playerId)) continue;
      const nextScore = placedScore + player.score;
      if (
        remainingBound(slot + 1, nextScore, star !== null && used.has(star.playerId)) / slotCount <
        bestQuality
      ) {
        break;
      }
      used.add(player.playerId);
      placed[slot] = player;
      recurse(slot + 1, nextScore);
      placed[slot] = undefined;
      used.delete(player.playerId);
    }
  };

  recurse(0, 0);
  return best;
}

function simulateRoundRobin(
  teams: readonly FieldTeam[],
  gamesPerPair: number,
  seed: Seed,
  phase: string,
  profile: EraSimulationProfile,
  engineContext: EngineContext,
): {
  winRates: Map<string, number>;
  gamesPlayed: Map<string, number>;
  population: readonly number[];
} {
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  for (const entry of teams) {
    wins.set(entry.key, 0);
    played.set(entry.key, 0);
  }
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      const home = teams[i];
      const away = teams[j];
      if (!home || !away) continue;
      for (let game = 0; game < gamesPerPair; game += 1) {
        const homeFirst = game % 2 === 0;
        const result = simulateGame(
          {
            schemaVersion: 2,
            seed: strengthSeed(`${seed}:${phase}:${home.key}:${away.key}`, 'pair', game),
            gameNumber: 1,
            dataVersion: profile.dataVersion,
            profile,
            home: homeFirst ? home.team : away.team,
            away: homeFirst ? away.team : home.team,
          },
          engineContext,
        );
        const homeWon = result.winner === (homeFirst ? 'home' : 'away');
        wins.set(home.key, (wins.get(home.key) ?? 0) + (homeWon ? 1 : 0));
        wins.set(away.key, (wins.get(away.key) ?? 0) + (homeWon ? 0 : 1));
        played.set(home.key, (played.get(home.key) ?? 0) + 1);
        played.set(away.key, (played.get(away.key) ?? 0) + 1);
      }
    }
  }
  const winRates = new Map<string, number>();
  for (const entry of teams) {
    const games = played.get(entry.key) ?? 0;
    if (games === 0) throw new Error(`bracket: ${entry.key} played no games`);
    winRates.set(entry.key, (wins.get(entry.key) ?? 0) / games);
  }
  return {
    winRates,
    gamesPlayed: played,
    population: [...winRates.values()].sort((a, b) => a - b),
  };
}

export function interpolateLadder(
  ladder: readonly (readonly [number, number])[],
  rank: number,
): number {
  const first = ladder[0];
  const last = ladder[ladder.length - 1];
  if (!first || !last) throw new Error('bracket: target ladder is empty');
  if (rank <= first[0]) return first[1];
  if (rank >= last[0]) return last[1];
  for (let i = 1; i < ladder.length; i += 1) {
    const lo = ladder[i - 1];
    const hi = ladder[i];
    if (!lo || !hi) continue;
    if (rank <= hi[0]) {
      const span = hi[0] - lo[0];
      return span === 0 ? hi[1] : lo[1] + ((rank - lo[0]) / span) * (hi[1] - lo[1]);
    }
  }
  return last[1];
}

/** Mean absolute gap between a measured field and the intended rank curve. */
export function ladderError(
  rates: readonly number[],
  ladder: readonly (readonly [number, number])[],
): number {
  const sorted = [...rates].sort((a, b) => b - a);
  let total = 0;
  for (const [index, rate] of sorted.entries()) {
    total += Math.abs(rate - interpolateLadder(ladder, index));
  }
  return total / sorted.length;
}

export function generateBracket(options: BracketGenerationOptions): OpponentBracket {
  const gamesPerPair = options.gamesPerPair ?? DEFAULT_GAMES_PER_PAIR;
  const minPlayerScore = options.minPlayerScore ?? DEFAULT_MIN_PLAYER_SCORE;
  const { seed, engineContext, profile } = options;

  const franchiseIds = options.candidates.map((candidate) => candidate.franchiseId);
  if (franchiseIds.length !== 30) {
    throw new Error(`generation requires 30 franchises (got ${String(franchiseIds.length)})`);
  }

  const pools = new Map<string, BracketCandidatePlayer[]>();
  for (const candidates of options.candidates) {
    const eligible = candidates.players.filter((player) => player.score >= minPlayerScore);
    const ordered = eligible;
    if (ordered.length < 5) {
      throw new Error(`${candidates.franchiseId} has fewer than five eligible players`);
    }
    pools.set(candidates.franchiseId, ordered);
  }

  const selections = new Map<string, SelectedFive>();
  const field: FieldTeam[] = [];
  const tierOrder = [...franchiseIds].sort();
  for (const franchiseId of tierOrder) {
    const candidates = options.candidates.find((entry) => entry.franchiseId === franchiseId);
    const pool = pools.get(franchiseId) ?? [];
    const five =
      pool.length === 5 &&
      pool.every((player, index) => {
        const slot = LINEUP_STRUCTURE[index];
        return slot !== undefined && canPlay(player.positions, slot);
      }) &&
      isBalanced(pool)
        ? { players: pool, quality: totalQuality(pool) }
        : bestLegalFiveWithin(pool, Infinity);
    if (!five || !candidates) throw new Error(`${franchiseId} cannot form a legal lineup`);
    selections.set(franchiseId, five);
    field.push({
      key: franchiseId,
      team: {
        teamId: franchiseId,
        displayName: candidates.displayName,
        players: five.players.map(toSimulationPlayer),
      },
    });
  }
  const measured = simulateRoundRobin(field, gamesPerPair, seed, 'record', profile, engineContext);
  const opponents: BracketOpponent[] = [];

  for (const franchiseId of tierOrder) {
    const five = selections.get(franchiseId);
    const candidates = options.candidates.find((entry) => entry.franchiseId === franchiseId);
    if (!five || !candidates) throw new Error(`bracket: missing selection for ${franchiseId}`);
    const winRate = measured.winRates.get(franchiseId);
    const games = measured.gamesPlayed.get(franchiseId) ?? 0;
    if (winRate === undefined) throw new Error(`bracket: ${franchiseId} was not measured`);
    const top = [...five.players].sort((a, b) => b.score - a.score)[0];
    if (!top) throw new Error(`bracket: ${franchiseId} selection is empty`);
    const assignment = five.players.map((player, slotIndex) => ({
      slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
      playerId: playerIdSchema.parse(player.playerId),
      positions: player.positions,
    }));
    for (const [slotIndex, slotPosition] of LINEUP_STRUCTURE.entries()) {
      const player = five.players[slotIndex];
      if (!player || !canPlay(player.positions, slotPosition)) {
        throw new Error(`bracket: lineup for ${franchiseId} cannot fill PG/SG/SF/PF/C`);
      }
    }
    opponents.push({
      schemaVersion: 2,
      opponentId: `bracket-${franchiseId}`,
      bracketVersion: options.generationVersion,
      difficultyBand: options.difficulty.name,
      teamId: franchiseIdSchema.parse(franchiseId),
      displayName: candidates.displayName,
      seasonKey: seasonKeySchema.parse(top.seasonKey),
      lineup: { structure: LINEUP_STRUCTURE, assignments: assignment },
      players: five.players.map(toSimulationPlayer),
      strength: {
        evaluationVersion: options.generationVersion,
        benchmarkVersion: FIELD_BENCHMARK_VERSION,
        sampleCount: games,
        winRate,
        percentile: percentileOf(winRate, measured.population),
      },
    });
  }
  if (opponents.length !== 30) {
    throw new Error(`selection produced ${String(opponents.length)} opponents, expected 30`);
  }

  const schedule = generateSchedule(
    opponents.map((o) => o.opponentId),
    seed,
  );
  const bracket: OpponentBracket = {
    schemaVersion: 1,
    bracketVersion: options.generationVersion,
    scheduleVersion: SCHEDULE_VERSION_LABEL,
    difficulty: options.difficulty,
    generation: {
      seed,
      generationVersion: options.generationVersion,
      dataVersion: options.dataVersion,
      targetBands: {
        teamPercentileBand: [BRACKET_WIN_RATE_BAND[0], BRACKET_WIN_RATE_BAND[1]],
        leagueMedianPercentileBand: [
          LEAGUE_MEDIAN_WIN_RATE_BAND[0],
          LEAGUE_MEDIAN_WIN_RATE_BAND[1],
        ],
      },
    },
    opponents,
    schedule,
  };

  const failures = validateBracketContent(bracket);
  failures.push(...scheduleInvariants(schedule));
  failures.push(...bracketStrengthFailures(opponents));
  if (failures.length > 0) {
    const rateReport = opponents
      .map((o) => `${o.opponentId}=${o.strength.winRate.toFixed(3)}`)
      .join(' ');
    throw new Error(
      `generated bracket fails validation: ${failures.slice(0, 8).join('; ')} :: ${rateReport}`,
    );
  }
  return opponentBracketSchema.parse(bracket);
}

export function bracketStrengthFailures(opponents: readonly BracketOpponent[]): string[] {
  const failures: string[] = [];
  const rates = opponents.map((opponent) => opponent.strength.winRate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  const tolerance = SAMPLING_TOLERANCE;
  if (minRate < BRACKET_WIN_RATE_BAND[0] - tolerance) {
    failures.push(
      `weakest opponent win rate ${minRate.toFixed(3)} below ${BRACKET_WIN_RATE_BAND[0].toFixed(2)}`,
    );
  }
  if (maxRate > BRACKET_WIN_RATE_BAND[1] + tolerance) {
    failures.push(
      `strongest opponent win rate ${maxRate.toFixed(3)} above ${BRACKET_WIN_RATE_BAND[1].toFixed(2)}`,
    );
  }
  const sorted = [...rates].sort((a, b) => a - b);
  const leagueMedian = ((sorted[14] ?? 0) + (sorted[15] ?? 0)) / 2;
  if (
    leagueMedian < LEAGUE_MEDIAN_WIN_RATE_BAND[0] - tolerance ||
    leagueMedian > LEAGUE_MEDIAN_WIN_RATE_BAND[1] + tolerance
  ) {
    failures.push(
      `league median win rate ${leagueMedian.toFixed(3)} outside ${LEAGUE_MEDIAN_WIN_RATE_BAND[0].toFixed(2)}..${LEAGUE_MEDIAN_WIN_RATE_BAND[1].toFixed(2)}`,
    );
  }
  return failures;
}
