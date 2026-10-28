import { describe, expect, it } from 'bun:test';
import type { HavocGameResult, HavocGameTape } from '@hoop-rush/data-contracts';
import { auditHavocGame } from './audit.ts';
import {
  buildScenarioTeam,
  runScenario,
  searchScenario,
  type ScenarioRun,
} from './runtime-test-support.ts';

function corruptedRun(seedText = 'havoc-audit'): ScenarioRun {
  const human = buildScenarioTeam('human', [
    { slot: 'PG', mutations: ['four-point-dunk', 'clone-army'] },
    { slot: 'SG', mutations: ['reverse-basketball'] },
    { slot: 'SF', mutations: ['double-or-nothing'] },
    { slot: 'PF', mutations: ['heat-check'] },
    { slot: 'C', mutations: ['second-chance-jackpot'] },
  ]);
  const away = buildScenarioTeam('opponent', [
    { slot: 'PG', mutations: [] },
    { slot: 'SG', mutations: [] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  return runScenario(human, away, seedText);
}

function cloneResult(result: HavocGameResult): HavocGameResult {
  return structuredClone(result);
}

function cloneTape(tape: HavocGameTape): HavocGameTape {
  return structuredClone(tape);
}

describe('havoc audit', () => {
  it('passes on a simulated game and its tape', () => {
    const run = corruptedRun();
    const audit = auditHavocGame(run.input, run.result, run.tape);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(auditHavocGame(run.input, run.result).ok).toBe(true);
  });

  it('retains the solo human-side and input-digest checks', () => {
    const run = corruptedRun();
    const wrongSide = cloneResult(run.result);
    wrongSide.humanSide = run.input.humanSide === 'home' ? 'away' : 'home';
    expect(auditHavocGame(run.input, wrongSide, run.tape).findings).toContainEqual({
      code: 'input-identity',
      message: 'result human side differs from input',
    });
    const wrongDigest = cloneResult(run.result);
    wrongDigest.inputDigest = '0'.repeat(32);
    expect(auditHavocGame(run.input, wrongDigest, run.tape).findings).toContainEqual({
      code: 'input-digest',
      message: 'result input digest does not match the supplied input',
    });
  });

  it('detects a tampered team score', () => {
    const run = corruptedRun();
    const result = cloneResult(run.result);
    result.home.points += 2;
    const audit = auditHavocGame(run.input, result, run.tape);
    expect(audit.ok).toBe(false);
    expect(
      audit.findings.some(
        (finding) => finding.code === 'winner' || finding.code === 'points-ledger',
      ),
    ).toBe(true);
  });

  it('detects tampered period totals', () => {
    const run = corruptedRun();
    const result = cloneResult(run.result);
    result.home.periods[0] = (result.home.periods[0] ?? 0) + 1;
    const audit = auditHavocGame(run.input, result);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.code === 'period-ledger')).toBe(true);
  });

  it('detects tampered court time', () => {
    const run = corruptedRun();
    const result = cloneResult(run.result);
    const line = result.home.participants[0];
    if (line === undefined) throw new Error('missing participant');
    line.secondsPlayed += 10;
    line.minutes = Math.round(line.secondsPlayed / 60);
    const audit = auditHavocGame(run.input, result, run.tape);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.code === 'court-time')).toBe(true);
  });

  it('detects a tape with a missing rebound event', () => {
    const run = corruptedRun();
    const tape = cloneTape(run.tape);
    const index = tape.events.findIndex((event) => event.kind === 'rebound');
    expect(index).toBeGreaterThanOrEqual(0);
    tape.events.splice(index, 1);
    const audit = auditHavocGame(run.input, run.result, tape);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.code === 'counts')).toBe(true);
  });

  it('detects a tampered scoring entry', () => {
    const run = corruptedRun();
    const tape = cloneTape(run.tape);
    const entry = tape.scoring[0];
    if (entry === undefined) throw new Error('missing scoring entry');
    entry.points += 1;
    const audit = auditHavocGame(run.input, run.result, tape);
    expect(audit.ok).toBe(false);
    expect(
      audit.findings.some(
        (finding) => finding.code === 'points-ledger' || finding.code === 'period-ledger',
      ),
    ).toBe(true);
  });

  it('detects an identity mismatch between input and result', () => {
    const run = corruptedRun();
    const otherInput = corruptedRun('havoc-audit-other').input;
    const audit = auditHavocGame(otherInput, run.result, run.tape);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.code === 'input-digest')).toBe(true);
  });

  it('detects out-of-order event sequences', () => {
    const run = corruptedRun();
    const tape = cloneTape(run.tape);
    const first = tape.events[0];
    const later = tape.events[5];
    if (first === undefined || later === undefined) throw new Error('missing events');
    tape.events[0] = later;
    tape.events[5] = first;
    const audit = auditHavocGame(run.input, run.result, tape);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.code === 'event-order')).toBe(true);
  });

  it('detects a missing double or nothing foul gift', () => {
    const human = buildScenarioTeam('human', [
      { slot: 'PG', mutations: ['double-or-nothing'] },
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
    const run = searchScenario(48, human, away, (candidate) =>
      candidate.tape.events.some((event) => event.kind === 'double-or-nothing-foul'),
    );
    expect(run, 'expected a double or nothing foul gift').not.toBeNull();
    if (run === null) return;
    const tape = cloneTape(run.tape);
    const index = tape.events.findIndex((event) => event.kind === 'double-or-nothing-foul');
    expect(index).toBeGreaterThanOrEqual(0);
    tape.events.splice(index, 1);
    const audit = auditHavocGame(run.input, run.result, tape);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.code === 'double-or-nothing')).toBe(true);
  });
});
