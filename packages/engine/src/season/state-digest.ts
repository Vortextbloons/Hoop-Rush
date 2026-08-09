import {
  seasonDigestHex,
  type SeasonAwards,
  type SeasonCheckpointState,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonObjectiveState,
  type SeasonOwnership,
  type SeasonPostseasonState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRunCompletion,
  type SeasonRunStage,
  type SeasonTradeState,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { canonicalJson } from './checkpoint.ts';

/**
 * M2.5/M2.6 canonical run-state digest (spec/2.0/07, LEAD DECISION in the
 * M2.5 contract §3 and §20.2). The mutable Season Run state — the facts
 * every block commit and every typed run command advances — hashes to one
 * 32-hex digest that the state chain carries on the run snapshot
 * (`stateRevision` + `stateDigest`). The digest is a pure function of the
 * recorded facts, so every execution path (worker, CLI, reload, retry)
 * produces the same digest for the same facts.
 *
 * Scope (frozen): `{ stateRevision, stage, postseason, awards, completion,
 * checkpointState, health, influence, transactions, trade, objectives,
 * rosters, ownership, rotations, effects }`. M2.6 adds `stage`, the
 * postseason-v2 state, `awards`, and `completion` so authoritative
 * postseason and award facts ride the state chain. The run's stored
 * `stateDigest` field is EXCLUDED from its own computation (mirror of the
 * checkpoint digest rule).
 *
 * Canonical ordering (frozen): rosters by franchiseId, ownership by
 * playerVersionId, rotations by franchiseId, effects per the existing
 * canonical ordering (player loads by playerVersionId, pairs by the
 * canonical a<b key), health injuries by injuryId, influence ledger by
 * entryId, transactions by transactionId, postseason tiebreak resolutions
 * by resolutionId (every other postseason array is positionally fixed by
 * its own invariants: rankings and seeds in seed order, series slots in
 * bracket order, series games by gameNumber). Object keys serialize
 * canonically (recursively sorted), so parse-reordered records hash
 * identically.
 *
 * NOTE (trade/economy workstream): the M2.5 contract places this function in
 * the health-owned checkpoint.ts module ("or a sibling state-digest module in
 * the same directory"). It lives here (a new file in season/) so the
 * trade/economy modules compile and run before the health workstream lands;
 * the canonicalization is exactly the contract's. The lead reconciles the
 * final placement at integration; if the health workstream lands its own
 * `seasonRunStateDigest` in checkpoint.ts, delete one copy (both follow the
 * frozen canonicalization, so digests agree).
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** The mutable run-state facts the digest canonicalizes (self-excluding). */
export interface SeasonRunStateDigestFacts {
  stateRevision: number;
  /** M2.6: the explicit run stage. */
  stage: SeasonRunStage;
  /** M2.6: the postseason-v2 state machine. */
  postseason: SeasonPostseasonState;
  /** M2.6: derived season awards; null until postseason qualification. */
  awards: SeasonAwards | null;
  /** M2.6: completion state; null until a champion is decided. */
  completion: SeasonRunCompletion | null;
  checkpointState: SeasonCheckpointState | null;
  health: SeasonHealthState;
  influence: SeasonInfluenceState;
  transactions: readonly SeasonTransactionEntry[];
  trade: SeasonTradeState | null;
  objectives: SeasonObjectiveState;
  rosters: readonly SeasonRoster[];
  ownership: readonly SeasonOwnership[];
  rotations: readonly SeasonRotation[];
  effects: SeasonEffectsState;
}

/** Canonical ordering helpers (frozen in the M2.5 contract). */
function sortedBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

/** Canonical projection of the postseason state (tie resolutions ordered). */
function postseasonCanonical(postseason: SeasonPostseasonState): unknown {
  return {
    schemaVersion: postseason.schemaVersion,
    postseasonVersion: postseason.postseasonVersion,
    tiebreakVersion: postseason.tiebreakVersion,
    seed: postseason.seed,
    finalsHomeCourtDrawSeed: postseason.finalsHomeCourtDrawSeed,
    tiebreakResolutions: sortedBy(
      postseason.tiebreakResolutions,
      (resolution) => resolution.resolutionId,
    ),
    playIn: postseason.playIn,
    bracket: postseason.bracket,
    championFranchiseId: postseason.championFranchiseId,
  };
}

/** Canonical 32-hex digest of the mutable run state (self-excluded). */
export function seasonRunStateDigest(facts: SeasonRunStateDigestFacts): string {
  const canonical = canonicalJson({
    stateRevision: facts.stateRevision,
    stage: facts.stage,
    postseason: postseasonCanonical(facts.postseason),
    awards: facts.awards,
    completion: facts.completion,
    checkpointState: facts.checkpointState,
    health: {
      schemaVersion: facts.health.schemaVersion,
      healthVersion: facts.health.healthVersion,
      injuries: sortedBy(facts.health.injuries, (injury) => injury.injuryId),
    },
    influence: {
      schemaVersion: facts.influence.schemaVersion,
      influenceVersion: facts.influence.influenceVersion,
      balances: facts.influence.balances,
      ledger: sortedBy(facts.influence.ledger, (entry) => entry.entryId),
      windows: facts.influence.windows,
      rehabs: facts.influence.rehabs,
    },
    transactions: sortedBy(facts.transactions, (entry) => entry.transactionId),
    trade: facts.trade,
    objectives: facts.objectives,
    rosters: sortedBy(facts.rosters, (roster) => roster.franchiseId),
    ownership: sortedBy(facts.ownership, (row) => row.playerVersionId),
    rotations: sortedBy(facts.rotations, (rotation) => rotation.franchiseId),
    effects: canonicalJson({
      schemaVersion: facts.effects.schemaVersion,
      playerStates: sortedBy(facts.effects.playerStates, (player) => player.playerVersionId),
      pairStates: [...facts.effects.pairStates].sort((a, b) =>
        a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : a.b > b.b ? 1 : 0,
      ),
    }),
  });
  return seasonDigestHex(canonical);
}
