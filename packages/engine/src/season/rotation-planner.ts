import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';

/**
 * M2.2 deterministic substitution planner (spec/2.0/04, rotation-planner-v1).
 * This file is the authoritative rotation-planner contract: presets belong to
 * season/rotation.ts (applySeasonRotationPreset), and legal-five enumeration,
 * initial-unit selection, and mid-game unit planning live here.
 *
 * The planner consumes NO RNG and produces identical results for identical
 * inputs, so calibration cohorts, worker counts, and execution order can
 * never change a Season game's decisions.
 *
 * ## Frozen planner rules (spec/2.0/04 M2.2)
 *
 * - Lineups are ordered G, G, F, F, C and must be legal five-player
 *   assignments of available, non-fouled-out players.
 * - `chooseInitialUnit`: the configured starters when they are all available
 *   and legal in their configured slot order; otherwise the first
 *   deterministic legal contingency.
 * - `planUnit` normal scoring (regulation, outside the closing window)
 *   minimizes the projected absolute target-minute deviation at the next
 *   checkpoint: for every candidate unit U,
 *     projected(i) = actualSeconds(i) + delta * onCourt(i)
 *     score(U)     = sum over the ten rostered versions of
 *                    | projected(i) - targetSeconds(i) |
 *   where delta is the seconds until the next whole-minute checkpoint of the
 *   current period (60 when the boundary was reached on a whole minute,
 *   otherwise secondsRemaining % 60), clamped to secondsRemaining.
 * - Tie-breaks, applied in order: retain more current players (higher
 *   current-unit overlap), then bench hierarchy, then canonical ascending
 *   playerVersionId order of the candidate unit.
 * - Closing window: the final five regulation minutes (period 4 with
 *   secondsRemaining <= 300) when the score margin is <= 12. Within the
 *   window, prefer the configured closing five; otherwise choose the closest
 *   legal contingency by (closing-five overlap desc, current-unit continuity
 *   desc, bench hierarchy, canonical ascending ids).
 * - Overtime (period > 4): the preferred closing unit starts every overtime
 *   period; planUnit never chases regulation targets in overtime. Foul-outs
 *   and removals still force contingency planning with the closing-preference
 *   ordering.
 * - Bench hierarchy comparator: for two units, compare the sorted ascending
 *   tuples of their players' benchOrder indices (players outside the bench
 *   count as index -1); the lexicographically smaller tuple wins. This
 *   prefers starters, then earlier bench roles.
 * - `planUnit` returns null when no legal five can be formed from the
 *   available players; the controller turns that into a typed forfeit.
 */

export interface PlannerMember {
  playerVersionId: string;
  playable: readonly Position[];
}

/** Rotation facts the planner reads: rotation, positions, regulation targets. */
export interface PlannerRotationContext {
  rotation: SeasonRotation;
  /** Playable positions per rostered playerVersionId. */
  members: ReadonlyMap<string, readonly Position[]>;
  /** Regulation target seconds per rostered playerVersionId (target minutes x 60). */
  targets: ReadonlyMap<string, number>;
}

/** Everything the planner needs for one mid-game unit decision. */
export interface PlannerUnitRequest {
  side: 'home' | 'away';
  /** Current ordered unit (G, G, F, F, C). */
  currentUnit: readonly string[];
  /** Players unavailable right now (fouled out, removed, pregame unavailable). */
  unavailable: ReadonlySet<string>;
  /** Regulation seconds played by each rostered version so far. */
  actualSeconds: ReadonlyMap<string, number>;
  /** 1-based period. */
  period: number;
  /** Game clock seconds remaining in the current period. */
  secondsRemaining: number;
  /** True when the closing window applies (period 4, <=300s, margin <= 12). */
  closingWindow: boolean;
  /** |home - away| score margin at the pause. */
  scoreMargin: number;
}

/**
 * All legal ordered G, G, F, F, C assignments over the available players,
 * in deterministic enumeration order: for each slot in order, candidates are
 * considered in bench hierarchy order (starters first via bench index -1,
 * then benchOrder ascending), then canonical ascending playerVersionId.
 */
export function enumerateLegalFives(
  members: readonly PlannerMember[],
  available: ReadonlySet<string>,
): string[][] {
  void members;
  void available;
  throw new Error('not implemented: M2.2 rotation planner (subagent A)');
}

/**
 * Tipoff unit: the configured starters when all are available and legal in
 * slot order; otherwise the first deterministic legal contingency from
 * enumerateLegalFives. Returns null when no legal five exists.
 */
export function chooseInitialUnit(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): string[] | null {
  void context;
  void unavailable;
  throw new Error('not implemented: M2.2 rotation planner (subagent A)');
}

/**
 * Best unit for the next interval under the frozen scoring and tie-break
 * rules above. Returns the current unit when it scores best (the controller
 * records a substitution only when the unit actually changes), and null when
 * no legal five exists.
 */
export function planUnit(
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
): string[] | null {
  void context;
  void request;
  throw new Error('not implemented: M2.2 rotation planner (subagent A)');
}
