import { describe, expect, it } from 'vitest';
import { franchiseIdSchema, seasonGameIdSchema } from '@hoop-rush/data-contracts';
import { seasonRunStateDigest, type SeasonRunStateDigestFacts } from './state-digest.ts';
import { buildTestRun, pipelineInput } from './block-test-support.ts';
function baseFacts(): SeasonRunStateDigestFacts {
  const { run, catalog } = buildTestRun();
  const input = pipelineInput(run, catalog, 0);
  return {
    stateRevision: run.stateRevision,
    stage: run.stage,
    postseason: run.postseason,
    awards: run.awards,
    completion: run.completion,
    checkpointState: run.checkpointState,
    health: input.health,
    influence: input.influence ?? run.influence,
    transactions: input.transactions ?? [],
    trade: run.trade,
    freeAgency: run.freeAgency,
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
                  franchiseId: franchiseIdSchema.parse('lakers'),
                  gameId: seasonGameIdSchema.parse('s000001'),
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
      ];
    for (const [label, mutate] of cases) {
      expect(seasonRunStateDigest(mutate(facts)), label).not.toBe(digest);
    }
  });
  it('excludes the stored stateDigest field from its own computation', () => {
    const { run } = buildTestRun();
    const factsOfRun = (snapshot: typeof run): SeasonRunStateDigestFacts => ({
      stateRevision: snapshot.stateRevision,
      stage: snapshot.stage,
      postseason: snapshot.postseason,
      awards: snapshot.awards,
      completion: snapshot.completion,
      checkpointState: snapshot.checkpointState,
      health: snapshot.health,
      influence: snapshot.influence,
      transactions: snapshot.transactions,
      trade: snapshot.trade,
      freeAgency: snapshot.freeAgency,
      objectives: snapshot.objectives,
      rosters: snapshot.rosters,
      ownership: snapshot.ownership,
      rotations: snapshot.rotations,
      effects: baseFacts().effects,
    });
    const tampered = { ...run, stateDigest: 'f'.repeat(32) };
    expect(seasonRunStateDigest(factsOfRun(run))).toBe(seasonRunStateDigest(factsOfRun(tampered)));
  });
});
