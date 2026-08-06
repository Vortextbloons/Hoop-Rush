import {
  seasonDigestHex,
  type SeasonCheckpointState,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonObjectiveState,
  type SeasonOwnership,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonTradeState,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';

/**
 * Canonical digest of the mutable Season Run state (M2.5, spec/2.0 §3 +
 * LEAD ADDENDUM item 2). The digest canonicalizes `{ stateRevision,
 * checkpointState, health, influence, transactions, trade, objectives,
 * rosters, ownership, rotations, effects }` — canonically ordered: rosters
 * by franchiseId, ownership by playerVersionId, rotations by franchiseId,
 * health injuries by injuryId, transactions by transactionId, the influence
 * ledger by entryId, the effects state by the existing canonical
 * player/pair order — and the `stateDigest` field itself is EXCLUDED from
 * its own computation (mirror of the checkpoint digest).
 *
 * TEMPORARY BINDING (persistence workstream): the engine's trade/economy
 * workstream owns the authoritative `seasonRunStateDigest` in
 * `engine/season/state-digest.ts` (canonicalization frozen in the M2.5
 * contract; the lead wires the engine export at integration). Until then
 * the production seam (`engine-seam.ts`) binds to THIS local mirror, which
 * is byte-for-byte the same canonicalization as the engine implementation
 * (raw trade/objectives/windows records through the recursively
 * key-sorted serializer; windows and rotations in their stored order), so
 * swapping the binding at integration cannot change any digest for the
 * same facts. The stub test seam keeps this mirror forever (documented
 * pure semantics).
 */

/** The mutable run-state facts the digest covers (self-excluded digest). */
export interface SeasonRunStateDigestFacts {
  stateRevision: number;
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

/**
 * Order-independent JSON serialization (mirror of the engine's checkpoint
 * canonicalJson): object keys sorted recursively, array order preserved.
 */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sortedBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

/** Canonical 32-hex digest of the mutable run state facts (self-excluded). */
export function seasonRunStateDigest(facts: SeasonRunStateDigestFacts): string {
  const canonical = canonicalJson({
    stateRevision: facts.stateRevision,
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

/** Canonical serialization of the mutable run state facts (exposed for tests). */
export function seasonRunStateCanonical(facts: SeasonRunStateDigestFacts): string {
  const canonical = canonicalJson({
    stateRevision: facts.stateRevision,
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
  return canonical;
}
