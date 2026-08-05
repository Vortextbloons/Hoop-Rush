import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LINEUP_STRUCTURE, playableSlotGroups } from '@hoop-rush/data-contracts';
import { assignLineup, canFillSlot, slotRequirement, validateLineup } from './lineup.ts';
import { normalizePositionUnion } from './positions.ts';

const positionArb = fc.constantFrom('PG', 'SG', 'SF', 'PF', 'C');
const unionArb = fc.array(positionArb, { minLength: 1, maxLength: 3 });

const lineupArb = fc.tuple(unionArb, unionArb, unionArb, unionArb, unionArb).map((unions) => ({
  players: unions.map((positions, i) => ({ playerId: `player-${String(i)}`, positions })),
}));

describe('position union property', () => {
  it('normalizes to a sorted, deduplicated subset of PG/SG/SF/PF/C', () => {
    fc.assert(
      fc.property(unionArb, (input) => {
        const union = normalizePositionUnion(input);
        expect(new Set(union).size).toBe(union.length);
        expect([...union]).toEqual([...union].sort());
        for (const position of union) {
          expect(['PG', 'SG', 'SF', 'PF', 'C']).toContain(position);
        }
        for (const position of input) {
          expect(union).toContain(position);
        }
      }),
    );
  });
});

describe('lineup property', () => {
  it('a produced assignment is always a legal lineup', () => {
    fc.assert(
      fc.property(lineupArb, ({ players }) => {
        const assignment = assignLineup(players);
        if (assignment === null) return;
        const validation = validateLineup({
          structure: LINEUP_STRUCTURE,
          assignments: assignment,
        });
        expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
      }),
    );
  });

  it('is deterministic for the same five players', () => {
    fc.assert(
      fc.property(lineupArb, ({ players }) => {
        const first = assignLineup(players);
        const second = assignLineup(players);
        expect(second).toEqual(first);
      }),
    );
  });

  it('slot requirements match the fixed G,G,F,F,C structure', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), (slotIndex) => {
        expect(slotRequirement(slotIndex as never)).toBe(LINEUP_STRUCTURE[slotIndex]);
      }),
    );
  });

  it('canFillSlot agrees with position membership', () => {
    fc.assert(
      fc.property(unionArb, fc.integer({ min: 0, max: 4 }), (positions, slotIndex) => {
        const requirement = LINEUP_STRUCTURE[slotIndex];
        if (requirement === undefined) {
          throw new Error(`no slot requirement for index ${String(slotIndex)}`);
        }
        expect(canFillSlot(positions, slotIndex as never)).toBe(
          playableSlotGroups(positions).includes(requirement),
        );
      }),
    );
  });
});
