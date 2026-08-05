import type {
  SeasonGameSimulationInput,
  SeasonGameSimulationResult,
  SeasonRemoval,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/context.ts';

/**
 * M2.2 Season Run game controller (spec/2.0/04, season-game-v1). Orchestrates
 * a single game around the authoritative possession pipeline with ten-player
 * rotations, substitution planning, foul-outs, exact seconds, unit stints,
 * rotation deviations, and typed forfeits. Classic games route through the
 * fixed-five adapter in sim/game.ts and must stay byte-identical to today.
 *
 * ## Frozen controller rules (spec/2.0/04 M2.2)
 *
 * - Identity: `playerVersionId` is the authoritative simulation and recorder
 *   identity; `playerId` is person-level metadata. The recorder translates
 *   the active five slots into ten-roster records keyed by playerVersionId,
 *   so two historical versions of one person on one roster never merge.
 * - Possession execution is resumable: the controller may pause only after
 *   made baskets, completed foul/free-throw sequences, inbound-producing
 *   fouls, dead-ball team rebounds, and period endings. Live turnovers, live
 *   rebounds, and unresolved shot/free-throw sequences never trigger
 *   substitutions. An and-one made basket is followed immediately by its
 *   free throw; no pause splits the sequence.
 * - Reconsider the lineup at period boundaries, at the first eligible dead
 *   ball after each whole-minute checkpoint, and immediately after the legal
 *   boundary following a foul-out, injected removal, or other availability
 *   change. The planner produces the next unit; a substitution is recorded
 *   only when the unit changes.
 * - Six personal fouls remove the player at the next legal pause (no rating
 *   penalty beforehand). Injected removals from the availability seam apply
 *   at the next legal boundary at or after their recorded clock.
 * - If one team cannot field a legal five at tipoff or after a removal, the
 *   controller returns the typed 2-0 forfeit with the losing franchise and
 *   trigger fact and no player statistics. If both teams are invalid before
 *   tipoff, return the `no-legal-five-both` variant instead of choosing a
 *   loser.
 * - Exact playing time is integer seconds. Regulation reconciles each side
 *   to 14,400 player-seconds (five on-court players x 2,880 seconds) plus
 *   1,500 per overtime period. Display minutes are seconds / 60.
 * - Per-player regulation deviations are emitted only when actual seconds
 *   differ from target seconds (target minutes x 60). Reasons are the union
 *   of causes that affected the player: dead-ball timing, closing
 *   preference, foul-out, pregame unavailability, injected injury removal,
 *   and contingency legality.
 * - Possession preparation tables are rebuilt after a substitution;
 *   rebuilding consumes no RNG.
 * - The controller consumes RNG only through the possession pipeline. The
 *   planner and the availability seam never draw RNG, and no presentation
 *   randomness exists in M2.2.
 */

/**
 * Deterministic availability/removal seam (M2.2 uses pregame availability
 * only; tests and CLI fixtures inject same-game removals; M2.5 supplies the
 * seeded injury model through this seam). The default seam derives from the
 * input's `availability` and `removals`; tests may substitute their own.
 */
export interface SeasonGameAvailabilitySeam {
  /** Pregame availability per playerVersionId (both sides). */
  pregame: ReadonlyMap<string, boolean>;
  /** Same-game removals, applied at the next legal boundary at/after their clock. */
  removals: readonly SeasonRemoval[];
}

/**
 * Simulates one Season game (season-game-v1). Deterministic: identical input
 * and seed produce a byte-identical result including substitutions, unit
 * stints, deviations, foul-outs, and removals.
 */
export function simulateSeasonGame(
  input: SeasonGameSimulationInput,
  context: EngineContext,
  options: { seam?: SeasonGameAvailabilitySeam } = {},
): SeasonGameSimulationResult {
  void input;
  void context;
  void options;
  throw new Error('not implemented: M2.2 season game controller (subagent B)');
}

/**
 * Audits a Season game result against its input: legality (no player plays
 * while unavailable/fouled out or for both teams), ownership, exact-seconds
 * reconciliation (14,400 per side in regulation plus 1,500 per overtime),
 * substitution timestamps on approved boundaries, player/team accounting,
 * unit-stint intervals, foul totals, deviation facts, and determinism
 * evidence. Returns failure strings; empty means valid.
 */
export function checkSeasonGameResult(
  result: SeasonGameSimulationResult,
  input: SeasonGameSimulationInput,
): string[] {
  void result;
  void input;
  throw new Error('not implemented: M2.2 season game controller (subagent B)');
}
