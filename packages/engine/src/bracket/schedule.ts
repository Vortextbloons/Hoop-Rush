import type { BracketScheduleEntry, Seed } from '@hoop-rush/data-contracts';
import { createRng, shuffle, swapAt } from '../sim/rng.ts';

/**
 * Fixed schedule generation (spec/01 challenge schedule). One seeded,
 * deterministic 82-game schedule shared by every mode: every opponent at
 * least twice (22 opponents three times, eight twice), the authored opening
 * opponent forced into game one, and no immediate repeats. The frozen
 * schedule ships with its own version inside the bracket artifact.
 */

export const SCHEDULE_GENERATION_VERSION = 'schedule-v1';

/** Counts assignment: which opponents appear twice instead of three times. */
export function pickTwoGameOpponents(opponentIds: readonly string[], seed: Seed): Set<string> {
  const rng = createRng(`${seed}:counts`);
  const shuffled = shuffle(opponentIds, rng);
  return new Set(shuffled.slice(0, 8));
}

/** Builds the 82-entry schedule; game one is always the opening opponent. */
export function generateSchedule(
  opponentIds: readonly string[],
  openingOpponentId: string,
  seed: Seed,
): BracketScheduleEntry[] {
  if (opponentIds.length !== 30) {
    throw new Error(`schedule requires exactly 30 opponents (got ${String(opponentIds.length)})`);
  }
  if (!opponentIds.includes(openingOpponentId)) {
    throw new Error(`opening opponent ${openingOpponentId} is not in the bracket`);
  }
  const distinct = [...new Set(opponentIds)];
  if (distinct.length !== 30) {
    throw new Error('schedule requires 30 distinct opponent ids');
  }

  const twoGames = pickTwoGameOpponents(opponentIds, seed);
  const counts = new Map<string, number>();
  for (const id of opponentIds) counts.set(id, twoGames.has(id) ? 2 : 3);

  const rng = createRng(`${seed}:order`);
  const slots: string[] = [openingOpponentId];
  const remaining: string[] = [];
  counts.set(openingOpponentId, (counts.get(openingOpponentId) ?? 0) - 1);
  for (const id of distinct) {
    for (let i = 0; i < (counts.get(id) ?? 0); i += 1) remaining.push(id);
  }
  slots.push(...shuffle(remaining, rng));

  // Deterministically repair any immediate repeat by swapping with a later
  // slot that resolves it. 30 teams guarantee a repair always exists.
  for (let i = 1; i < slots.length - 1; i += 1) {
    if (slots[i] !== slots[i - 1]) continue;
    for (let j = i + 1; j < slots.length; j += 1) {
      const candidate = slots[j];
      if (candidate === undefined) continue;
      const okBefore = candidate !== slots[i - 1];
      const okAfter = j + 1 < slots.length ? candidate !== slots[j + 1] : true;
      if (okBefore && okAfter) {
        swapAt(slots, i, j);
        break;
      }
    }
  }
  // The final slot cannot repeat its predecessor by construction above; a
  // lone remaining repeat would be caught by the repair pass. As a guard,
  // if slot 1 repeats slot 0 (game one), swap with the last slot.
  if (slots.length > 1 && slots[1] === slots[0]) {
    const last = slots[slots.length - 1];
    if (last !== undefined && last !== slots[0]) {
      swapAt(slots, 1, slots.length - 1);
    }
  }

  const schedule: BracketScheduleEntry[] = slots.map((opponentId, index) => ({
    gameNumber: index + 1,
    opponentId,
  }));
  if (schedule[0]?.opponentId !== openingOpponentId) {
    throw new Error('schedule game one must be the opening opponent');
  }
  return schedule;
}

/** Per-entry schedule audit facts, in schedule order. */
export interface ScheduleEntryAuditFacts {
  gameNumber: number;
  opponentId: string;
  /** gameNumber outside 1..82. */
  outOfRange: boolean;
  /** gameNumber seen in an earlier entry. */
  repeatedNumber: boolean;
  /** opponentId not present in the bracket's known opponent ids. */
  unknownOpponent: boolean;
  /** Repeat vs the entry referenced by gameNumber-1 (validateSchedule semantics). */
  repeatsPreviousByGameNumber: boolean;
  /** Repeat vs the previous array position (scheduleInvariants semantics). */
  repeatsPreviousByPosition: boolean;
  /** gameNumber differs from the entry's 1-based array position. */
  gameNumberMismatchAtPosition: boolean;
}

/** Structured 82-game schedule audit facts shared by both validators. */
export interface ScheduleAuditFacts {
  length: number;
  entries: ScheduleEntryAuditFacts[];
  /** gameNumbers 1..82 absent from the schedule, ascending. */
  missingNumbers: number[];
  /** Opponents with exactly three scheduled games. */
  threeCount: number;
  /** Opponents with exactly two scheduled games. */
  twoCount: number;
}

/**
 * Shared 82-game schedule audit core (single implementation of the counts,
 * range, reference, and immediate-repeat checks). The two validators
 * (`scheduleInvariants` here and `validateSchedule` in challenge/commands.ts)
 * format their own failure messages from these facts; the two immediate-
 * repeat semantics are both reported because the historical validators index
 * differently (position order vs gameNumber order) and both behaviors are
 * preserved.
 */
export function auditScheduleEntries(
  schedule: readonly BracketScheduleEntry[],
  knownOpponentIds: ReadonlySet<string>,
): ScheduleAuditFacts {
  const counts = new Map<string, number>();
  const seenNumbers = new Set<number>();
  const entries: ScheduleEntryAuditFacts[] = [];
  for (let index = 0; index < schedule.length; index += 1) {
    const entry = schedule[index];
    if (entry === undefined) continue;
    const repeatsPreviousByPosition =
      index > 0 && entry.opponentId === schedule[index - 1]?.opponentId;
    const repeatsPreviousByGameNumber =
      entry.gameNumber > 1 && entry.opponentId === schedule[entry.gameNumber - 2]?.opponentId;
    entries.push({
      gameNumber: entry.gameNumber,
      opponentId: entry.opponentId,
      outOfRange: entry.gameNumber < 1 || entry.gameNumber > 82,
      repeatedNumber: seenNumbers.has(entry.gameNumber),
      unknownOpponent: !knownOpponentIds.has(entry.opponentId),
      repeatsPreviousByGameNumber,
      repeatsPreviousByPosition,
      gameNumberMismatchAtPosition: entry.gameNumber !== index + 1,
    });
    seenNumbers.add(entry.gameNumber);
    counts.set(entry.opponentId, (counts.get(entry.opponentId) ?? 0) + 1);
  }
  const missingNumbers: number[] = [];
  for (let n = 1; n <= 82; n += 1) {
    if (!seenNumbers.has(n)) missingNumbers.push(n);
  }
  const countsList = [...counts.values()];
  return {
    length: schedule.length,
    entries,
    missingNumbers,
    threeCount: countsList.filter((c) => c === 3).length,
    twoCount: countsList.filter((c) => c === 2).length,
  };
}

/** Whether a generated schedule satisfies the fixed counts and no-repeat rules. */
export function scheduleInvariants(schedule: readonly BracketScheduleEntry[]): string[] {
  const failures: string[] = [];
  const facts = auditScheduleEntries(schedule, new Set(schedule.map((e) => e.opponentId)));
  if (facts.length !== 82) {
    failures.push(`schedule must have 82 games (got ${String(facts.length)})`);
    return failures;
  }
  for (const entry of facts.entries) {
    if (entry.outOfRange) {
      failures.push(`gameNumber ${String(entry.gameNumber)} out of range`);
    }
  }
  for (let n = 1; n <= 82; n += 1) {
    const entry = facts.entries[n - 1];
    if (entry !== undefined && entry.gameNumberMismatchAtPosition) {
      failures.push(`game ${String(n)} missing from the schedule`);
    }
    if (n > 1 && entry !== undefined && entry.repeatsPreviousByPosition) {
      failures.push(`immediate repeat of ${entry.opponentId} at game ${String(n)}`);
    }
  }
  if (facts.threeCount !== 22) {
    failures.push('expected exactly 22 opponents with three games');
  }
  if (facts.twoCount !== 8) {
    failures.push('expected exactly eight opponents with two games');
  }
  return failures;
}
