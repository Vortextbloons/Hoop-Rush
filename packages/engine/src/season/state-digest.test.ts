import { describe, expect, it } from 'vitest';
import { seasonRunStateDigest, type SeasonRunStateDigestFacts } from './state-digest.ts';
import { buildTestRun, pipelineInput } from './block-test-support.ts';

/**
 * M2.5 run-state digest properties (spec/2.0/07, state-digest contract):
 * the canonical digest is a pure function of the recorded facts — array
 * order never matters, every single fact change changes the digest, and the
 * stored `stateDigest` field is excluded from its own computation.
 */

function baseFacts(): SeasonRunStateDigestFacts {
  const { run, catalog } = buildTestRun();
  const input = pipelineInput(run, catalog, 0);
  return {
    stateRevision: run.stateRevision,
    checkpointState: run.checkpointState,
    health: input.health,
    influence: input.influence ?? run.influence,
    transactions: input.transactions ?? [],
    trade: run.trade,
    objectives: run.objectives,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects: input.effects,
  };
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = (i * 7 + 3) % (i + 1);
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

describe('seasonRunStateDigest', () => {
  it('is independent of the order of every canonicalized array', () => {
    const facts = baseFacts();
    const reordered: SeasonRunStateDigestFacts = {
      ...facts,
      health: { ...facts.health, injuries: shuffled(facts.health.injuries) },
      influence: {
        ...facts.influence,
        ledger: shuffled(facts.influence.ledger),
      },
      transactions: shuffled(facts.transactions),
      rosters: shuffled(facts.rosters),
      ownership: shuffled(facts.ownership),
      rotations: shuffled(facts.rotations),
      effects: {
        ...facts.effects,
        playerStates: shuffled(facts.effects.playerStates),
        pairStates: shuffled(facts.effects.pairStates),
      },
    };
    expect(seasonRunStateDigest(reordered)).toBe(seasonRunStateDigest(facts));
  });

  it('changes whenever any single fact changes', () => {
    const facts = baseFacts();
    const digest = seasonRunStateDigest(facts);
    const cases: Array<[string, (facts: SeasonRunStateDigestFacts) => SeasonRunStateDigestFacts]> =
      [
        ['stateRevision', (f) => ({ ...f, stateRevision: f.stateRevision + 1 })],
        [
          'health injury record',
          (f) => ({
            ...f,
            health: {
              ...f.health,
              injuries: [
                ...f.health.injuries,
                {
                  injuryId: 'injury-x',
                  playerVersionId: 'pv-x',
                  franchiseId: 'lakers',
                  gameId: 's000001',
                  type: 'lower-body',
                  severity: 'minor',
                  occurredBeforeHalftime: false,
                  sameGameReturn: false,
                  sameGameReturned: null,
                  missedGamesTotal: 1,
                  missedGamesRemaining: 1,
                  actualReturnRound: null,
                  seasonEnding: false,
                  rehabModifier: 0,
                  recurrenceWindowRoundsRemaining: 0,
                  seedPath: ['injuries', 'x', 'occurrence'],
                },
              ],
            },
          }),
        ],
        [
          'influence balance',
          (f) => ({
            ...f,
            influence: {
              ...f.influence,
              balances: {
                ...f.influence.balances,
                lakers: (f.influence.balances['lakers'] ?? 0) + 1,
              },
            },
          }),
        ],
        [
          'influence ledger entry',
          (f) => ({
            ...f,
            influence: {
              ...f.influence,
              ledger: [
                ...f.influence.ledger,
                {
                  entryId: 'influence-x',
                  franchiseId: 'lakers',
                  source: 'initial-grant',
                  blockIndex: null,
                  commandId: null,
                  requestedDelta: 0,
                  appliedDelta: 0,
                  balanceAfter: 0,
                  explanation: 'x',
                },
              ],
            },
          }),
        ],
        [
          'transaction entry',
          (f) => ({
            ...f,
            transactions: [
              ...f.transactions,
              {
                transactionId: 'tx-x',
                commandId: 'cmd-x',
                franchiseId: 'lakers',
                type: 'block-grant',
                blockIndex: 0,
                appliedAtStateRevision: 0,
                payload: {},
                explanation: 'x',
              },
            ],
          }),
        ],
        [
          'roster player',
          (f) => ({
            ...f,
            rosters: f.rosters.map((roster, index) =>
              index === 0
                ? {
                    ...roster,
                    players: roster.players.map((player, slot) =>
                      slot === 0 ? { ...player, displayName: `${player.displayName}X` } : player,
                    ),
                  }
                : roster,
            ),
          }),
        ],
        [
          'ownership row',
          (f) => ({
            ...f,
            ownership: f.ownership.map((row, index) =>
              index === 0 ? { ...row, franchiseId: 'celtics' } : row,
            ),
          }),
        ],
        [
          'rotation starter',
          (f) => ({
            ...f,
            rotations: f.rotations.map((rotation, index) =>
              index === 0 ? { ...rotation, starters: [...rotation.starters].reverse() } : rotation,
            ),
          }),
        ],
        [
          'effects player load',
          (f) => ({
            ...f,
            effects: {
              ...f.effects,
              playerStates: f.effects.playerStates.map((state, index) =>
                index === 0 ? { ...state, fatigueBasisPoints: 1 } : state,
              ),
            },
          }),
        ],
        [
          'effects pair state',
          (f) => ({
            ...f,
            effects: {
              ...f.effects,
              pairStates: f.effects.pairStates.map((pair, index) =>
                index === 0 ? { ...pair, sharedPossessions: pair.sharedPossessions + 1 } : pair,
              ),
            },
          }),
        ],
      ];
    for (const [label, mutate] of cases) {
      expect(seasonRunStateDigest(mutate(facts)), label).not.toBe(digest);
    }
  });

  it('excludes the stored stateDigest field from its own computation', () => {
    const { run } = buildTestRun();
    const factsOfRun = (snapshot: typeof run): SeasonRunStateDigestFacts => ({
      stateRevision: snapshot.stateRevision,
      checkpointState: snapshot.checkpointState,
      health: snapshot.health,
      influence: snapshot.influence,
      transactions: snapshot.transactions,
      trade: snapshot.trade,
      objectives: snapshot.objectives,
      rosters: snapshot.rosters,
      ownership: snapshot.ownership,
      rotations: snapshot.rotations,
      effects: baseFacts().effects,
    });
    // Two snapshots identical except for the stored stateDigest (e.g. a
    // stale or tampered chain field) recompute to the same digest, because
    // the digest is a function of the recorded facts, not of itself.
    const tampered = { ...run, stateDigest: 'f'.repeat(32) };
    expect(seasonRunStateDigest(factsOfRun(run))).toBe(seasonRunStateDigest(factsOfRun(tampered)));
  });
});
