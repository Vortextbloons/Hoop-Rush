import type { BracketScheduleEntry, Seed } from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.js';

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
  const shuffled = [...opponentIds];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(0, i);
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
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
  for (let i = remaining.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(0, i);
    const tmp = remaining[i]!;
    remaining[i] = remaining[j]!;
    remaining[j] = tmp;
  }
  slots.push(...remaining);

  // Deterministically repair any immediate repeat by swapping with a later
  // slot that resolves it. 30 teams guarantee a repair always exists.
  for (let i = 1; i < slots.length - 1; i += 1) {
    if (slots[i] !== slots[i - 1]) continue;
    for (let j = i + 1; j < slots.length; j += 1) {
      const candidate = slots[j]!;
      const okBefore = candidate !== slots[i - 1];
      const okAfter = j + 1 < slots.length ? candidate !== slots[j + 1] : true;
      if (okBefore && okAfter) {
        slots[j] = slots[i]!;
        slots[i] = candidate;
        break;
      }
    }
  }
  // The final slot cannot repeat its predecessor by construction above; a
  // lone remaining repeat would be caught by the repair pass. As a guard,
  // if slot 1 repeats slot 0 (game one), swap with the last slot.
  if (slots.length > 1 && slots[1] === slots[0]) {
    const last = slots[slots.length - 1]!;
    if (last !== slots[0]) {
      slots[slots.length - 1] = slots[1]!;
      slots[1] = last;
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

/** Whether a generated schedule satisfies the fixed counts and no-repeat rules. */
export function scheduleInvariants(schedule: readonly BracketScheduleEntry[]): string[] {
  const failures: string[] = [];
  if (schedule.length !== 82) {
    failures.push(`schedule must have 82 games (got ${String(schedule.length)})`);
    return failures;
  }
  const counts = new Map<string, number>();
  for (const entry of schedule) {
    counts.set(entry.opponentId, (counts.get(entry.opponentId) ?? 0) + 1);
    if (entry.gameNumber < 1 || entry.gameNumber > 82) {
      failures.push(`gameNumber ${String(entry.gameNumber)} out of range`);
    }
  }
  for (let n = 1; n <= 82; n += 1) {
    const entry = schedule[n - 1];
    if (entry?.gameNumber !== n) {
      failures.push(`game ${String(n)} missing from the schedule`);
    }
    if (n > 1 && entry !== undefined && entry.opponentId === schedule[n - 2]?.opponentId) {
      failures.push(`immediate repeat of ${entry.opponentId} at game ${String(n)}`);
    }
  }
  const countsList = [...counts.values()];
  if (countsList.filter((c) => c === 3).length !== 22) {
    failures.push('expected exactly 22 opponents with three games');
  }
  if (countsList.filter((c) => c === 2).length !== 8) {
    failures.push('expected exactly eight opponents with two games');
  }
  return failures;
}
