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
import { opponentBracketSchema } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/context.js';
import { createRng } from '../sim/rng.js';
import { validateBracketContent } from '../challenge/commands.js';
import { evaluateLineupBalance, evaluateLineupStrength } from '../challenge/lineup-eval.js';
import { BENCHMARK_VERSION } from '../challenge/benchmarks.js';
import { playableSlotGroups } from '../domain/positions.js';
import { generateSchedule, scheduleInvariants, SCHEDULE_GENERATION_VERSION } from './schedule.js';

/** Frozen schedule version label shared by the artifact and audits. */
export const SCHEDULE_VERSION_LABEL = `schedule-${SCHEDULE_GENERATION_VERSION.replace('schedule-', '')}`;

/**
 * Bracket generation (spec/01 fixed opponent bracket). A deterministic
 * propose-review-freeze workflow: proposals are sampled per franchise from
 * the private candidate catalog, rejected when they miss a required balance
 * dimension or a legal G,G,F,F,C assignment, measured by seeded games against
 * the fixed benchmark matrix, then selected to span the configured strength
 * bands with the league median inside its band. The committed generation
 * seed, target bands, reviewed selections, and resulting artifact make
 * regeneration byte-identical.
 */

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
  /** Quality score used for weighted proposal sampling. */
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
  /** Proposals sampled per franchise; more proposals widen the selection. */
  proposalsPerFranchise?: number;
  /** Seeded games per benchmark during measurement (alternating sides). */
  samplesPerBenchmark?: number;
  /** Minimum player quality score for a proposal to be considered. */
  minPlayerScore?: number;
  engineContext: EngineContext;
}

export interface BracketSelectionReport {
  franchiseId: string;
  opponentId: string;
  winRate: number;
  percentile: number;
  targetPercentile: number;
  balance: ReturnType<typeof evaluateLineupBalance>;
}

const DEFAULT_PROPOSALS = 32;
const DEFAULT_SAMPLES = 6;
const DEFAULT_MIN_PLAYER_SCORE = 45;

interface Proposal {
  team: SimulationTeam;
  strength: number;
  gamesPlayed: number;
  players: BracketCandidatePlayer[];
  balance: ReturnType<typeof evaluateLineupBalance>;
}

function toSimulationPlayer(player: BracketCandidatePlayer): SimulationPlayer {
  return {
    playerId: player.playerId,
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
  for (const v of population) if (v < value) below += 1;
  return below / population.length;
}

/**
 * Generates the complete frozen bracket: 30 measured opponents (the opening
 * opponent unchanged plus 29 selected proposals) and the fixed 82-game
 * schedule. Throws with diagnostics when the candidate data cannot satisfy
 * the requested bands.
 */
export function generateBracket(options: BracketGenerationOptions): OpponentBracket {
  const proposalsPerFranchise = options.proposalsPerFranchise ?? DEFAULT_PROPOSALS;
  const samplesPerBenchmark = options.samplesPerBenchmark ?? DEFAULT_SAMPLES;
  const minPlayerScore = options.minPlayerScore ?? DEFAULT_MIN_PLAYER_SCORE;
  const { seed, engineContext, profile } = options;

  const byFranchise = new Map(options.candidates.map((c) => [c.franchiseId, c]));
  const franchiseIds = options.candidates.map((c) => c.franchiseId);
  if (franchiseIds.length !== 30) {
    throw new Error(`generation requires 30 franchises (got ${String(franchiseIds.length)})`);
  }
  if (!franchiseIds.includes(options.openingOpponent.teamId)) {
    throw new Error(
      `opening opponent team ${options.openingOpponent.teamId} has no candidate pool`,
    );
  }

  // ---- Propose: deterministic seeded sampling with balance rejection. ----
  const proposalsByFranchise = new Map<string, Proposal[]>();
  for (const candidates of options.candidates) {
    const eligible = candidates.players.filter((p) => p.score >= minPlayerScore);
    const guards = eligible.filter((p) => playableSlotGroups(p.positions).includes('G'));
    const forwards = eligible.filter((p) => playableSlotGroups(p.positions).includes('F'));
    const centers = eligible.filter((p) => playableSlotGroups(p.positions).includes('C'));
    if (guards.length < 2 || forwards.length < 2 || centers.length < 1) {
      throw new Error(
        `${candidates.franchiseId} cannot form a legal lineup (${String(guards.length)} guards, ${String(forwards.length)} forwards, ${String(centers.length)} centers)`,
      );
    }
    const rng = createRng(`${seed}:propose:${candidates.franchiseId}`);
    const proposals: Proposal[] = [];
    const seen = new Set<string>();
    // Cap how often one player may appear across a franchise's proposals so
    // the selection step always has conflict-free alternatives (dedup).
    const participation = new Map<string, number>();
    const maxParticipation = Math.max(6, Math.ceil(proposalsPerFranchise * 0.45));
    // Stratified sampling keeps the candidate population wide across the
    // skill spectrum, so percentile bands are meaningful (spec/01 bands).
    // Strong strata appear twice so the population's top end is populated.
    const BIASES: ReadonlyArray<'strong' | 'mid' | 'uniform'> = [
      'strong',
      'strong',
      'strong',
      'mid',
      'uniform',
    ];
    for (let k = 0; k < proposalsPerFranchise; k += 1) {
      const bias = BIASES[k % BIASES.length];
      if (bias === undefined) {
        throw new Error(`bracket: no bias for proposal ${String(k)}`);
      }
      const chosen = pickFive(rng, guards, forwards, centers, bias, (player) => {
        const count = participation.get(player.playerId) ?? 0;
        return count >= maxParticipation;
      });
      if (!chosen) continue;
      const key = chosen.map((p) => p.playerId).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      for (const player of chosen) {
        participation.set(player.playerId, (participation.get(player.playerId) ?? 0) + 1);
      }
      const players = chosen.map(toSimulationPlayer);
      const team: SimulationTeam = {
        teamId: `candidate-${candidates.franchiseId}-${String(k)}`,
        displayName: candidates.displayName,
        players,
      };
      const balance = evaluateLineupBalance(team);
      if (!balance.ok) continue;
      const measurement = evaluateLineupStrength(team, engineContext, profile, {
        samplesPerBenchmark,
        seedBase: `${seed}:strength:${candidates.franchiseId}:${String(k)}`,
      });
      proposals.push({
        team,
        strength: measurement.winRate,
        gamesPlayed: measurement.gamesPlayed,
        players: chosen,
        balance,
      });
    }
    if (proposals.length === 0) {
      throw new Error(`${candidates.franchiseId} produced no balanced proposals`);
    }
    proposalsByFranchise.set(candidates.franchiseId, proposals);
  }

  // ---- Measure the fixed opening opponent identically. ----
  const openingTeam: SimulationTeam = {
    teamId: options.openingOpponent.teamId,
    displayName: options.openingOpponent.displayName,
    players: options.openingOpponent.players,
  };
  const openingMeasurement = evaluateLineupStrength(openingTeam, engineContext, profile, {
    samplesPerBenchmark,
    seedBase: `${seed}:strength:opening`,
  });

  // ---- Candidate population for percentile ranks. ----
  const population: number[] = [openingMeasurement.winRate];
  for (const proposals of proposalsByFranchise.values()) {
    for (const p of proposals) population.push(p.strength);
  }
  population.sort((a, b) => a - b);

  // ---- Select one proposal per franchise toward evenly spaced targets. ----
  const band = options.difficulty.teamPercentileBand;
  const selectableFranchises = franchiseIds.filter((id) => id !== options.openingOpponent.teamId);
  if (selectableFranchises.length !== 29) {
    throw new Error(
      `expected 29 selectable franchises (got ${String(selectableFranchises.length)})`,
    );
  }
  const selected = new Map<string, { proposal: Proposal; target: number }>();

  // ---- Constraint repair: player dedup, band range, and league median. ----
  const medianBand = options.difficulty.leagueMedianPercentileBand;
  const openingPercentileOfPopulation = percentileOf(openingMeasurement.winRate, population);

  /** Players used by every selection plus the opening opponent (excluding one franchise). */
  function usedPlayerIds(excludingFranchise: string | null): Set<string> {
    const used = new Set<string>();
    for (const player of options.openingOpponent.players) used.add(player.playerId);
    for (const [franchiseId, current] of selected) {
      if (franchiseId === excludingFranchise) continue;
      for (const player of current.proposal.players) used.add(player.playerId);
    }
    return used;
  }

  /** Band violations dominate player conflicts, then target distance. */
  function proposalScore(
    proposal: Proposal,
    target: number,
    used: Set<string>,
  ): { score: number; conflicts: number } {
    const conflicts = proposal.players.reduce(
      (count, p) => count + (used.has(p.playerId) ? 1 : 0),
      0,
    );
    const pct = percentileOf(proposal.strength, population);
    const outOfBand = pct < band[0] || pct > band[1] ? 1 : 0;
    const distance = Math.abs(pct - target);
    return { score: outOfBand * 100 + conflicts * 10 + distance, conflicts };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    // Initial selection: in-band first, then target distance.
    const shuffled = shuffle(
      selectableFranchises,
      createRng(`${seed}:select:order:${String(attempt)}`),
    );
    selected.clear();
    const rankProposals = (proposals: readonly Proposal[], target: number): Proposal[] =>
      [...proposals].sort((a, b) =>
        inBand(a.strength, population, band) === inBand(b.strength, population, band)
          ? Math.abs(percentileOf(a.strength, population) - target) -
              Math.abs(percentileOf(b.strength, population) - target) || a.strength - b.strength
          : inBand(a.strength, population, band)
            ? -1
            : 1,
      );
    for (let i = 0; i < shuffled.length; i += 1) {
      const franchiseId = shuffled[i];
      if (franchiseId === undefined) {
        throw new Error(`bracket: missing franchise at index ${String(i)}`);
      }
      const target = band[0] + ((band[1] - band[0]) * i) / (shuffled.length - 1);
      const proposals = proposalsByFranchise.get(franchiseId) ?? [];
      const top = rankProposals(proposals, target)[0];
      if (top === undefined) {
        throw new Error(`bracket: no proposals for ${franchiseId}`);
      }
      selected.set(franchiseId, { proposal: top, target });
    }

    for (let round = 0; round < 100; round += 1) {
      let changed = false;

      // Best-improvement repair: minimize (band penalty, conflicts, distance).
      for (const franchiseId of shuffled) {
        const current = selected.get(franchiseId);
        if (!current) continue;
        const used = usedPlayerIds(franchiseId);
        const currentScore = proposalScore(current.proposal, current.target, used);
        const proposals = proposalsByFranchise.get(franchiseId) ?? [];
        const best = [...proposals].sort(
          (a, b) =>
            proposalScore(a, current.target, used).score -
              proposalScore(b, current.target, used).score || a.strength - b.strength,
        )[0];
        if (best && proposalScore(best, current.target, used).score < currentScore.score) {
          selected.set(franchiseId, { proposal: best, target: current.target });
          changed = true;
        }
      }

      // League-median adjustment: try every candidate move and apply the one
      // that brings the bracket median closest to the median band (strictly
      // closer). Target distance stays soft: the median is a hard constraint.
      const bracketMedian = (): number =>
        medianOf(bracketPercentileList(selected, openingPercentileOfPopulation, population));
      const currentMedian = bracketMedian();
      const medianAdjustment = (direction: -1 | 1): boolean => {
        let best: { franchiseId: string; proposal: Proposal; target: number; gap: number } | null =
          null;
        for (const [franchiseId, current] of selected) {
          const used = usedPlayerIds(franchiseId);
          const candidates = (proposalsByFranchise.get(franchiseId) ?? []).filter((p) =>
            direction === 1
              ? p.strength < current.proposal.strength
              : p.strength > current.proposal.strength,
          );
          const ranked = [...candidates].sort(
            (a, b) =>
              proposalScore(a, current.target, used).score -
                proposalScore(b, current.target, used).score ||
              (direction === 1 ? b.strength - a.strength : a.strength - b.strength),
          );
          const bestForFranchise = ranked[0];
          if (!bestForFranchise) continue;
          const previous = selected.get(franchiseId);
          if (previous === undefined) continue;
          selected.set(franchiseId, {
            proposal: bestForFranchise,
            target: current.target,
          });
          const movedMedian = bracketMedian();
          selected.set(franchiseId, previous);
          const gap =
            movedMedian < medianBand[0]
              ? medianBand[0] - movedMedian
              : movedMedian > medianBand[1]
                ? movedMedian - medianBand[1]
                : 0;
          if (best === null || gap < best.gap) {
            best = {
              franchiseId,
              proposal: bestForFranchise,
              target: current.target,
              gap,
            };
          }
        }
        if (best === null || best.gap >= bestDirectionGap(currentMedian, medianBand)) {
          return false;
        }
        selected.set(best.franchiseId, { proposal: best.proposal, target: best.target });
        return true;
      };
      const median = bracketMedian();
      if (median > medianBand[1]) {
        changed = medianAdjustment(1) || changed;
      } else if (median < medianBand[0]) {
        changed = medianAdjustment(-1) || changed;
      }
      if (!changed) break;
    }

    // Check the attempt: every selection in band with zero conflicts.
    let clean = true;
    for (const [franchiseId, current] of selected) {
      const pct = percentileOf(current.proposal.strength, population);
      const used = usedPlayerIds(franchiseId);
      const conflicts = current.proposal.players.reduce(
        (count, p) => count + (used.has(p.playerId) ? 1 : 0),
        0,
      );
      if (pct < band[0] || pct > band[1] || conflicts > 0) {
        clean = false;
        break;
      }
    }
    if (clean) break;
  }

  // Confirm the committed selection is clean.
  {
    let totalConflicts = 0;
    for (const [franchiseId, current] of selected) {
      const used = usedPlayerIds(franchiseId);
      totalConflicts += current.proposal.players.reduce(
        (count, p) => count + (used.has(p.playerId) ? 1 : 0),
        0,
      );
    }
    if (totalConflicts > 0) {
      throw new Error(
        `selection could not resolve player duplication (${String(totalConflicts)} conflicts)`,
      );
    }
  }

  // ---- Build the frozen artifact. ----
  const opponents: BracketOpponent[] = [];
  const usedInBracket = new Set(options.openingOpponent.players.map((p) => p.playerId));
  const opponentsByFranchise = new Map<string, BracketOpponent>();

  const openingEntry: BracketOpponent = {
    ...options.openingOpponent,
    bracketVersion: options.generationVersion,
    strength: {
      evaluationVersion: options.generationVersion,
      benchmarkVersion: BENCHMARK_VERSION,
      sampleCount: openingMeasurement.gamesPlayed,
      winRate: openingMeasurement.winRate,
      percentile: percentileOf(openingMeasurement.winRate, population),
    },
  };
  opponents.push(openingEntry);
  opponentsByFranchise.set(openingEntry.teamId, openingEntry);

  for (const franchiseId of selectableFranchises) {
    const current = selected.get(franchiseId);
    if (!current) continue;
    const candidates = byFranchise.get(franchiseId);
    if (candidates === undefined) {
      throw new Error(`bracket: missing candidates for ${franchiseId}`);
    }
    const proposal = current.proposal;
    const top = [...proposal.players].sort((a, b) => b.score - a.score)[0];
    if (top === undefined) {
      throw new Error(`bracket: proposal has no players for ${franchiseId}`);
    }
    const seasonKey = top.seasonKey;
    const opponentId = `bracket-${franchiseId}`;
    const lineup: BracketOpponent['lineup'] = {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: proposal.players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions,
      })),
    };
    for (const player of proposal.players) {
      if (usedInBracket.has(player.playerId)) {
        throw new Error(
          `player ${player.playerId} appears in more than one opponent (${franchiseId})`,
        );
      }
      usedInBracket.add(player.playerId);
    }
    const entry: BracketOpponent = {
      schemaVersion: 2,
      opponentId,
      bracketVersion: options.generationVersion,
      difficultyBand: 'medium',
      teamId: franchiseId,
      displayName: candidates.displayName,
      seasonKey,
      lineup,
      players: proposal.players.map(toSimulationPlayer),
      strength: {
        evaluationVersion: options.generationVersion,
        benchmarkVersion: BENCHMARK_VERSION,
        sampleCount: proposal.gamesPlayed,
        winRate: proposal.strength,
        percentile: percentileOf(proposal.strength, population),
      },
    };
    opponents.push(entry);
    opponentsByFranchise.set(franchiseId, entry);
  }

  if (opponents.length !== 30) {
    throw new Error(`selection produced ${String(opponents.length)} opponents, expected 30`);
  }

  const opponentIds = opponents.map((o) => o.opponentId);
  const schedule = generateSchedule(opponentIds, options.openingOpponent.opponentId, seed);

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
        teamPercentileBand: band,
        leagueMedianPercentileBand: medianBand,
      },
    },
    opponents,
    schedule,
  };

  const failures = validateBracketContent(bracket);
  failures.push(...scheduleInvariants(schedule));
  const openingPercentile = percentileOf(openingMeasurement.winRate, population);
  const bracketPercentiles = bracketPercentileList(selected, openingPercentile, population);
  const median = medianOf(bracketPercentiles);
  const selectedPercentiles = [...selected.values()].map((s) =>
    percentileOf(s.proposal.strength, population),
  );
  const minP = Math.min(...selectedPercentiles);
  const maxP = Math.max(...selectedPercentiles);
  if (median < medianBand[0] || median > medianBand[1]) {
    failures.push(
      `bracket median percentile ${median.toFixed(3)} outside ${medianBand[0].toFixed(2)}..${medianBand[1].toFixed(2)}`,
    );
  }
  if (minP < band[0] || maxP > band[1]) {
    failures.push(
      `selected percentiles span ${minP.toFixed(3)}..${maxP.toFixed(3)} outside ${band[0].toFixed(2)}..${band[1].toFixed(2)}`,
    );
  }
  if (failures.length > 0) {
    const percentileReport = opponents
      .map((o) => `${o.opponentId}=${o.strength.percentile.toFixed(3)}`)
      .join(' ');
    throw new Error(
      `generated bracket fails validation: ${failures.slice(0, 8).join('; ')} :: ${percentileReport}`,
    );
  }
  return opponentBracketSchema.parse(bracket);
}

function pickFive(
  rng: ReturnType<typeof createRng>,
  guards: readonly BracketCandidatePlayer[],
  forwards: readonly BracketCandidatePlayer[],
  centers: readonly BracketCandidatePlayer[],
  bias: 'strong' | 'mid' | 'uniform',
  isExhausted: (player: BracketCandidatePlayer) => boolean,
): BracketCandidatePlayer[] | null {
  const chosen: BracketCandidatePlayer[] = [];
  const used = new Set<string>();
  const picks: ReadonlyArray<{ pool: readonly BracketCandidatePlayer[]; count: number }> = [
    { pool: guards, count: 2 },
    { pool: forwards, count: 2 },
    { pool: centers, count: 1 },
  ];
  for (const { pool, count } of picks) {
    const available = pool.filter((p) => !used.has(p.playerId) && !isExhausted(p));
    for (let i = 0; i < count; i += 1) {
      if (available.length === 0) return null;
      const weight = (score: number) =>
        bias === 'strong'
          ? Math.pow(Math.max(1, score), 3)
          : bias === 'mid'
            ? Math.max(1, score)
            : 1 + rng.next() * 2;
      const weights = available.map((p) => Math.max(1, weight(p.score)));
      const pick = rng.weightedPick(available, weights);
      chosen.push(pick);
      used.add(pick.playerId);
      available.splice(available.indexOf(pick), 1);
    }
  }
  return chosen;
}

/** Swap two indexed positions; throws when either index is out of bounds. */
function swapAt(values: unknown[], a: number, b: number): void {
  const va = values[a];
  const vb = values[b];
  if (va === undefined || vb === undefined) {
    throw new Error(`shuffle: index out of range (${String(a)}, ${String(b)})`);
  }
  values[a] = vb;
  values[b] = va;
}

function shuffle<T>(items: readonly T[], rng: ReturnType<typeof createRng>): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    swapAt(result, i, rng.nextInt(0, i));
  }
  return result;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[mid];
    if (value === undefined) {
      throw new Error('medianOf: empty values');
    }
    return value;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) {
    throw new Error('medianOf: empty values');
  }
  return (lo + hi) / 2;
}

function inBand(strength: number, population: readonly number[], band: [number, number]): boolean {
  const p = percentileOf(strength, population);
  return p >= band[0] && p <= band[1];
}

/** How far a median sits outside its band (0 when inside). */
function bestDirectionGap(median: number, band: [number, number]): number {
  if (median < band[0]) return band[0] - median;
  if (median > band[1]) return median - band[1];
  return 0;
}

function bracketPercentileList(
  selected: Map<string, { proposal: Proposal; target: number }>,
  openingPercentile: number,
  population: readonly number[],
): number[] {
  return [
    openingPercentile,
    ...[...selected.values()].map((s) => percentileOf(s.proposal.strength, population)),
  ];
}

export { DEFAULT_PROPOSALS, DEFAULT_SAMPLES, DEFAULT_MIN_PLAYER_SCORE };
