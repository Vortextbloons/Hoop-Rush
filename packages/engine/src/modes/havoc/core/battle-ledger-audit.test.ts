import { describe, expect, it } from 'bun:test';
import type {
  HavocBattleInput,
  HavocBattleTape,
  HavocGameAudit,
  HavocMutationId,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_IDS,
  HAVOC_SCHEMA_VERSION,
  havocBattleInputSchema,
  havocBattleResultSchema,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildHavocGameInput } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../../sim/kernel.ts';
import { CapRushApronRuntime } from '../../cap-rush/apron-runtime.ts';
import { buildScenarioTeam } from '../runtime-test-support.ts';
import { apronTargetOf, PARITY_SCENARIOS } from '../parity/scenario-inputs.ts';
import { auditHavocBattleGame, auditHavocBattleLedger } from './battle-audit.ts';
import {
  simulateAuditedHavocBattleGame,
  simulateAuditedHavocBattleSummary,
} from './battle-game.ts';
import { havocBattleGameInputDigest } from './battle-digests.ts';
import {
  BATTLE_LEDGER_EVENT,
  BATTLE_LEDGER_EVENT_FIELDS,
  type HavocBattleLedger,
} from './battle-ledger.ts';
import { HavocBattleWasmSimulation } from './battle-wasm.ts';

function bindApron(
  scenario: (typeof PARITY_SCENARIOS)[number],
  input: HavocBattleInput,
): CapRushApronRuntime | null {
  if (scenario.apron === undefined) return null;
  const target = apronTargetOf(input, scenario);
  const apron = new CapRushApronRuntime({
    side: scenario.apron.side,
    rules: { payrollStatus: scenario.apron.payrollStatus },
    targetInstanceId: target.participant.instanceId,
    targetSlot: scenario.apron.targetSlot,
  });
  apron.bindTarget({
    playerId: target.participant.source.playerId,
    ...(target.participant.source.playerVersionId === null
      ? {}
      : { playerVersionId: target.participant.source.playerVersionId }),
    displayName: target.participant.source.displayName,
    positions: target.participant.source.positions,
    heightInches: target.participant.effective.physical.heightInches,
    weightLbs: target.participant.effective.physical.weightLbs,
    ratings: target.participant.effective.ratings,
    tendencies: target.participant.effective.tendencies,
  });
  return apron;
}

function compactLedger(input: HavocBattleInput): {
  result: ReturnType<typeof simulateAuditedHavocBattleSummary>['result'];
  ledger: HavocBattleLedger;
} {
  const context = createEngineContext();
  const simulation = new HavocBattleWasmSimulation(input, context).runWithLedger();
  const result = havocBattleResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: input.gameNumber,
    variant: input.variant,
    seed: input.seed,
    engineVersion: context.engineVersion,
    rulesVersion: input.rulesVersion,
    mutationCatalogVersion: input.mutationCatalogVersion,
    profileVersion: input.profile.profileVersion,
    dataVersion: input.versionSet.dataVersion,
    home: simulation.home,
    away: simulation.away,
    winner: simulation.home.points > simulation.away.points ? 'home' : 'away',
    overtimePeriods: simulation.overtimePeriods,
    inputDigest: havocBattleGameInputDigest(input),
    rollups: simulation.rollups,
    highlights: simulation.highlights,
  });
  return { result, ledger: simulation.ledger };
}

function cloneLedger(ledger: HavocBattleLedger): HavocBattleLedger {
  return {
    participants: ledger.participants,
    events: new Float64Array(ledger.events),
    eventCount: ledger.eventCount,
    scoring: new Float64Array(ledger.scoring),
    scoringCount: ledger.scoringCount,
  };
}

function eventRecord(ledger: HavocBattleLedger, kind: number): number {
  for (let record = 0; record < ledger.eventCount; record += 1) {
    if ((ledger.events[record * BATTLE_LEDGER_EVENT_FIELDS] ?? 0) === kind) return record;
  }
  throw new Error(`ledger has no event kind ${String(kind)}`);
}

function swapEventRecords(events: Float64Array, leftRecord: number, rightRecord: number): void {
  const left = events.slice(
    leftRecord * BATTLE_LEDGER_EVENT_FIELDS,
    leftRecord * BATTLE_LEDGER_EVENT_FIELDS + BATTLE_LEDGER_EVENT_FIELDS,
  );
  events.set(
    events.slice(
      rightRecord * BATTLE_LEDGER_EVENT_FIELDS,
      rightRecord * BATTLE_LEDGER_EVENT_FIELDS + BATTLE_LEDGER_EVENT_FIELDS,
    ),
    leftRecord * BATTLE_LEDGER_EVENT_FIELDS,
  );
  events.set(left, rightRecord * BATTLE_LEDGER_EVENT_FIELDS);
}

function mutationBattleInput(mutation: HavocMutationId, seedText: string): HavocBattleInput {
  const base = buildHavocGameInput();
  const home = buildScenarioTeam('human', [
    { slot: 'PG', mutations: [mutation] },
    { slot: 'SG', mutations: [] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  const away = buildScenarioTeam('opponent', [
    { slot: 'PG', mutations: [] },
    { slot: 'SG', mutations: [] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  return havocBattleInputSchema.parse({
    ...base,
    seed: seedSchema.parse(seedFromString(seedText)),
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
  });
}

function expectSameFindings(
  input: HavocBattleInput,
  result: ReturnType<typeof compactLedger>['result'],
  tape: HavocBattleTape,
  ledger: HavocBattleLedger,
): HavocGameAudit {
  const tapeAudit = auditHavocBattleGame(input, result, tape);
  const ledgerAudit = auditHavocBattleLedger(input, result, ledger);
  expect(ledgerAudit, 'compact findings').toEqual(tapeAudit);
  return ledgerAudit;
}

describe('compact battle ledger audit', () => {
  it('matches the full tape audit across every parity scenario and seed', () => {
    for (const scenario of PARITY_SCENARIOS) {
      if (scenario.kind !== 'battle') continue;
      for (let index = 0; index < 3; index += 1) {
        const input = scenario.build(
          `${scenario.seedText}-ledger-${String(index)}`,
        ) as HavocBattleInput;
        const context = createEngineContext();
        const apron = bindApron(scenario, input);
        const full = simulateAuditedHavocBattleGame(
          input,
          context,
          apron === null ? {} : { apron },
        );
        const facts = apron?.recordedFacts() ?? [];
        apron?.dispose();
        const compactApron = bindApron(scenario, input);
        const compact = simulateAuditedHavocBattleSummary(
          input,
          context,
          compactApron === null ? {} : { apron: compactApron },
        );
        const compactFacts = compactApron?.recordedFacts() ?? [];
        compactApron?.dispose();
        expect(compact.result, `${scenario.id} result`).toEqual(full.result);
        expect(compact.audit, `${scenario.id} audit`).toEqual(full.audit);
        expect(compactFacts, `${scenario.id} apron facts`).toEqual(facts);
        expect(compact.audit.ok, `${scenario.id} accounting`).toBe(true);
      }
    }
  });

  it('matches the tape audit for every mutation package', () => {
    const context = createEngineContext();
    for (const mutation of HAVOC_MUTATION_IDS) {
      // These two entries need sampled package fields that the shared scenario
      // builder does not set; every other mutation is exercised here.
      if (mutation === 'growth-spurt' || mutation === 'the-specialist') continue;
      for (let seed = 0; seed < 2; seed += 1) {
        const input = mutationBattleInput(mutation, `ledger-mutation-${mutation}-${String(seed)}`);
        const full = simulateAuditedHavocBattleGame(input, context);
        const compact = simulateAuditedHavocBattleSummary(input, context);
        expect(compact.result, mutation).toEqual(full.result);
        expect(compact.audit, mutation).toEqual(full.audit);
        expect(compact.audit.ok, mutation).toBe(true);
      }
    }
  }, 120_000);

  it('reports the same findings as the tape audit for corrupted ledgers', () => {
    const scenario = PARITY_SCENARIOS.find((entry) => entry.id === 'havoc-mutations');
    if (scenario === undefined) throw new Error('missing parity scenario');
    const input = scenario.build(scenario.seedText) as HavocBattleInput;
    const context = createEngineContext();
    const full = simulateAuditedHavocBattleGame(input, context);
    const { result, ledger } = compactLedger(input);
    expect(result).toEqual(full.result);

    // A tampered shot result must break the scoring and count ledgers.
    {
      const tape = structuredClone(full.tape);
      const event = tape.events.find((candidate) => candidate.kind === 'shot-attempt');
      if (event === undefined) throw new Error('missing shot');
      event.made = !event.made;
      const corrupted = cloneLedger(ledger);
      const record = eventRecord(corrupted, BATTLE_LEDGER_EVENT.shotAttempt);
      corrupted.events[record * BATTLE_LEDGER_EVENT_FIELDS + 9] =
        (corrupted.events[record * BATTLE_LEDGER_EVENT_FIELDS + 9] ?? 0) === 0 ? 1 : 0;
      const audit = expectSameFindings(input, result, tape, corrupted);
      expect(audit.ok).toBe(false);
      expect(audit.findings.some((finding) => finding.code === 'counts')).toBe(true);
    }

    // A rebound attributed to the wrong side is not an active actor.
    {
      const tape = structuredClone(full.tape);
      const event = tape.events.find((candidate) => candidate.kind === 'rebound');
      if (event === undefined) throw new Error('missing rebound');
      event.side = event.side === 'home' ? 'away' : 'home';
      const corrupted = cloneLedger(ledger);
      const record = eventRecord(corrupted, BATTLE_LEDGER_EVENT.rebound);
      corrupted.events[record * BATTLE_LEDGER_EVENT_FIELDS + 6] =
        (corrupted.events[record * BATTLE_LEDGER_EVENT_FIELDS + 6] ?? 0) === 0 ? 1 : 0;
      const audit = expectSameFindings(input, result, tape, corrupted);
      expect(audit.ok).toBe(false);
      expect(audit.findings.some((finding) => finding.code === 'actor-eligibility')).toBe(true);
    }

    // A tampered scoring entry must fail the points and period ledgers.
    {
      const tape = structuredClone(full.tape);
      const entry = tape.scoring[0];
      if (entry === undefined) throw new Error('missing scoring entry');
      entry.points += 1;
      const corrupted = cloneLedger(ledger);
      corrupted.scoring[10] = (corrupted.scoring[10] ?? 0) + 1;
      const audit = expectSameFindings(input, result, tape, corrupted);
      expect(audit.ok).toBe(false);
      expect(
        audit.findings.some(
          (finding) => finding.code === 'points-ledger' || finding.code === 'period-ledger',
        ),
      ).toBe(true);
    }

    // Swapping event records must break event ordering.
    {
      const tape = structuredClone(full.tape);
      const first = tape.events[0];
      const later = tape.events[5];
      if (first === undefined || later === undefined) throw new Error('missing events');
      tape.events[0] = later;
      tape.events[5] = first;
      const corrupted = cloneLedger(ledger);
      swapEventRecords(corrupted.events, 0, 5);
      const audit = expectSameFindings(input, result, tape, corrupted);
      expect(audit.ok).toBe(false);
      expect(audit.findings.some((finding) => finding.code === 'event-order')).toBe(true);
    }

    // A foul credited to the wrong side must be caught by the replay.
    {
      const tape = structuredClone(full.tape);
      const event = tape.events.find((candidate) => candidate.kind === 'foul');
      if (event === undefined) throw new Error('missing foul');
      event.side = event.side === 'home' ? 'away' : 'home';
      const corrupted = cloneLedger(ledger);
      const record = eventRecord(corrupted, BATTLE_LEDGER_EVENT.foul);
      corrupted.events[record * BATTLE_LEDGER_EVENT_FIELDS + 6] =
        (corrupted.events[record * BATTLE_LEDGER_EVENT_FIELDS + 6] ?? 0) === 0 ? 1 : 0;
      const audit = expectSameFindings(input, result, tape, corrupted);
      expect(audit.ok).toBe(false);
      expect(
        audit.findings.some((finding) => finding.code === 'fouls' || finding.code === 'counts'),
      ).toBe(true);
    }
  });
});
