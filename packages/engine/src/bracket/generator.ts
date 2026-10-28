import type {
  BracketOpponent,
  DifficultyProfile,
  EraSimulationProfile,
  OpponentBracket,
  OpponentTeam,
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
import { createRng, shuffle } from '../sim/rng.ts';
import { simulateGame } from '../sim/game.ts';
import { validateBracketContent } from '../challenge/commands.ts';
import { evaluateLineupBalance, strengthSeed } from '../challenge/lineup-eval.ts';
import { FIELD_BENCHMARK_VERSION } from '../challenge/benchmarks.ts';
import { generateSchedule, scheduleInvariants, SCHEDULE_GENERATION_VERSION } from './schedule.ts';

export const SCHEDULE_VERSION_LABEL = `schedule-${SCHEDULE_GENERATION_VERSION.replace('schedule-', '')}`;

/**
 * Target win rate by rank, taken from the historical NBA spread of the same 30
 * franchises. Rank 1 plays like a 64-win team, the middle of the league sits
 * near .500, and rank 30 plays like a 17-win team. Values are interpolated by
 * rank, so the middle of the bracket stays competitive instead of collapsing
 * toward the extremes.
 */
export const BRACKET_TARGET_LADDER: readonly (readonly [number, number])[] = [
  [0, 0.8],
  [3, 0.685],
  [7, 0.62],
  [14, 0.5],
  [19, 0.42],
  [24, 0.29],
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
  openingOpponent: OpponentTeam;
  difficulty: DifficultyProfile;
  candidates: FranchiseCandidates[];
  gamesPerPair?: number;
  minPlayerScore?: number;
  engineContext: EngineContext;
}

const DEFAULT_GAMES_PER_PAIR = 12;
const DEFAULT_MIN_PLAYER_SCORE = 45;
const MAX_SEARCH_NODES = 2_000_000;
const CALIBRATION_STEPS = 7;
const STAR_CANDIDATES = 6;

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

/**
 * Strongest legal PG/SG/SF/PF/C five under a per-player score cap. Capping each
 * player (rather than the lineup mean) keeps tiers coherent: an elite team gets
 * five strong players, a weak team gets five weak ones, and no tier turns into
 * one star carrying four fringe players.
 */
/**
 * Strongest legal PG/SG/SF/PF/C five in which every player except the lineup's
 * best scorer is rated at or below `supportCap`.
 *
 * Capping only the supporting players is what gives each tier a believable
 * roster: an elite tier clears the cap comfortably, a mid tier fields a star
 * with real weaknesses around him, and the weakest tier is one genuine player
 * dragging four replacement-level teammates. No tier silently loses its star.
 */
export function bestLegalFiveWithin(
  pool: readonly BracketCandidatePlayer[],
  supportCap: number,
): SelectedFive | null {
  if (!Number.isFinite(supportCap)) {
    return bestFiveWithStar(pool, null, Infinity);
  }
  const stars = [...pool].sort((a, b) => b.score - a.score).slice(0, STAR_CANDIDATES);
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
  const support = pool
    .filter((player) => player.playerId !== star?.playerId && player.score <= supportCap)
    .sort((a, b) => b.score - a.score);
  const slots = [...LINEUP_STRUCTURE];

  const placed: (BracketCandidatePlayer | undefined)[] = new Array<
    BracketCandidatePlayer | undefined
  >(slots.length);
  const used = new Set<string>();
  let best: SelectedFive | null = null;
  let nodes = 0;

  const evaluate = (): void => {
    const five: BracketCandidatePlayer[] = [];
    for (const entry of placed) {
      if (entry === undefined) return;
      five.push(entry);
    }
    if (!isBalanced(five)) return;
    const quality = totalQuality(five);
    if (best === null || quality > best.quality) best = { players: five, quality };
  };

  const recurse = (slot: number): void => {
    nodes += 1;
    if (nodes > MAX_SEARCH_NODES) return;
    if (slot === slots.length) {
      evaluate();
      return;
    }
    const slotPosition = slots[slot];
    if (!slotPosition) return;
    if (star && !used.has(star.playerId) && canPlay(star.positions, slotPosition)) {
      used.add(star.playerId);
      placed[slot] = star;
      recurse(slot + 1);
      placed[slot] = undefined;
      used.delete(star.playerId);
    }
    for (const player of support) {
      if (used.has(player.playerId)) continue;
      if (!canPlay(player.positions, slotPosition)) continue;
      used.add(player.playerId);
      placed[slot] = player;
      recurse(slot + 1);
      placed[slot] = undefined;
      used.delete(player.playerId);
    }
  };

  recurse(0);
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

interface CalibrationPoint {
  scale: number;
  field: FieldTeam[];
  selections: Map<string, SelectedFive>;
  measured: ReturnType<typeof simulateRoundRobin>;
  spread: number;
}

export function generateBracket(options: BracketGenerationOptions): OpponentBracket {
  const gamesPerPair = options.gamesPerPair ?? DEFAULT_GAMES_PER_PAIR;
  const minPlayerScore = options.minPlayerScore ?? DEFAULT_MIN_PLAYER_SCORE;
  const { seed, engineContext, profile } = options;

  const franchiseIds = options.candidates.map((candidate) => candidate.franchiseId);
  if (franchiseIds.length !== 30) {
    throw new Error(`generation requires 30 franchises (got ${String(franchiseIds.length)})`);
  }
  if (!franchiseIds.includes(options.openingOpponent.teamId)) {
    throw new Error(
      `opening opponent team ${options.openingOpponent.teamId} has no candidate pool`,
    );
  }

  const pools = new Map<string, BracketCandidatePlayer[]>();
  for (const candidates of options.candidates) {
    const eligible = candidates.players.filter((player) => player.score >= minPlayerScore);
    const ordered = shuffle([...eligible], createRng(`${seed}:pool:${candidates.franchiseId}`));
    ordered.sort((a, b) => b.score - a.score);
    if (ordered.length < 5) {
      throw new Error(`${candidates.franchiseId} has fewer than five eligible players`);
    }
    pools.set(candidates.franchiseId, ordered);
  }

  const selectableFranchises = franchiseIds.filter((id) => id !== options.openingOpponent.teamId);
  if (selectableFranchises.length !== 29) {
    throw new Error(
      `expected 29 selectable franchises (got ${String(selectableFranchises.length)})`,
    );
  }

  const ceilings = new Map<string, number>();
  for (const franchiseId of franchiseIds) {
    const pool = pools.get(franchiseId) ?? [];
    const best = bestLegalFiveWithin(pool, Infinity);
    if (!best) {
      const counts = LINEUP_STRUCTURE.map((slot) =>
        String(pool.filter((player) => canPlay(player.positions, slot)).length),
      ).join('/');
      throw new Error(
        `${franchiseId} cannot form a legal lineup (PG/SG/SF/PF/C eligible: ${counts})`,
      );
    }
    ceilings.set(franchiseId, best.quality);
  }

  // Roster quality decides the tier, so an elite pool always gets an elite
  // build. Ties break by id to keep generation deterministic.
  const tierOrder = [...selectableFranchises].sort((a, b) => {
    const diff = (ceilings.get(b) ?? 0) - (ceilings.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  const rankOf = new Map(tierOrder.map((id, index) => [id, index]));

  const openingTeam: FieldTeam = {
    key: options.openingOpponent.opponentId,
    team: {
      teamId: options.openingOpponent.teamId,
      displayName: options.openingOpponent.displayName,
      players: options.openingOpponent.players,
    },
  };

  /**
   * Each tier gets a support ceiling: the four players around the roster's best
   * scorer must sit at or below `floorSupport` for the weakest tier, rising to
   * the top of the pool for the strongest. That produces the shapes the game
   * wants — an elite team is good all round, a weak team is one real star
   * dragging four modest teammates — without any tier losing its star.
   */
  const globalScores = [...pools.values()]
    .flat()
    .map((player) => player.score)
    .sort((a, b) => a - b);
  const topSupport = globalScores[globalScores.length - 1] ?? 70;
  const bottomSupport = globalScores[0] ?? 45;

  const build = (
    floorSupport: number,
  ): { field: FieldTeam[]; selections: Map<string, SelectedFive> } => {
    const selections = new Map<string, SelectedFive>();
    const field: FieldTeam[] = [openingTeam];
    for (const franchiseId of tierOrder) {
      const rank = rankOf.get(franchiseId) ?? 0;
      const position = tierOrder.length === 1 ? 0 : rank / (tierOrder.length - 1);
      const ceiling = topSupport - (topSupport - floorSupport) * position;
      const pool = pools.get(franchiseId) ?? [];
      const candidates = options.candidates.find((entry) => entry.franchiseId === franchiseId);
      if (!candidates) throw new Error(`bracket: missing candidates for ${franchiseId}`);
      const five =
        bestLegalFiveWithin(pool, ceiling) ??
        bestLegalFiveWithin(pool, ceilings.get(franchiseId) ?? topSupport);
      if (!five) throw new Error(`bracket: ${franchiseId} produced no legal five`);
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
    return { field, selections };
  };

  const measure = (field: FieldTeam[], phase: string) =>
    simulateRoundRobin(field, gamesPerPair, seed, phase, profile, engineContext);

  let best: CalibrationPoint | null = null;
  let bestScore = Infinity;
  const steps = CALIBRATION_STEPS;
  for (let step = 0; step < steps; step += 1) {
    const fraction = step / (steps - 1);
    const floorSupport = topSupport - (topSupport - bottomSupport) * fraction;
    const { field, selections } = build(floorSupport);
    const measured = measure(field, `fit${String(step)}`);
    const rates = field.map((entry) => measured.winRates.get(entry.key) ?? 0.5);
    const spread = Math.max(...rates) - Math.min(...rates);
    const score = ladderError(rates, BRACKET_TARGET_LADDER);
    if (score < bestScore) {
      bestScore = score;
      best = { scale: fraction, field, selections, measured, spread };
    }
  }
  if (best === null) throw new Error('bracket: calibration produced no field');

  // The stored win rate is a fresh, independent measurement of the frozen field.
  // Calibration searched many fields, so reusing its numbers would bake in the
  // optimism of having picked the best of several noisy trials.
  const final = simulateRoundRobin(
    best.field,
    gamesPerPair,
    seed,
    'record',
    profile,
    engineContext,
  );

  const { field, selections } = best;
  const measured = final;
  const opponents: BracketOpponent[] = [];
  const openingRate = measured.winRates.get(options.openingOpponent.opponentId);
  const openingGames = measured.gamesPlayed.get(options.openingOpponent.opponentId) ?? 0;
  if (openingRate === undefined) throw new Error('bracket: opening opponent was not measured');
  opponents.push({
    ...options.openingOpponent,
    bracketVersion: options.generationVersion,
    strength: {
      evaluationVersion: options.generationVersion,
      benchmarkVersion: FIELD_BENCHMARK_VERSION,
      sampleCount: openingGames,
      winRate: openingRate,
      percentile: percentileOf(openingRate, measured.population),
    },
  });

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
    options.openingOpponent.opponentId,
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
  failures.push(...bracketStrengthFailures(opponents, options.openingOpponent.opponentId));
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

export function bracketStrengthFailures(
  opponents: readonly BracketOpponent[],
  openingOpponentId = 'lakers-1990s-opening',
): string[] {
  const failures: string[] = [];
  // The opening opponent is an authored fixed entry, so it is excluded from the
  // generated band the same way `bracket audit` treats it.
  const generated = opponents.filter((opponent) => opponent.opponentId !== openingOpponentId);
  const rates = opponents.map((opponent) => opponent.strength.winRate);
  const generatedRates = generated.map((opponent) => opponent.strength.winRate);
  const minRate = Math.min(...generatedRates);
  const maxRate = Math.max(...generatedRates);
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
