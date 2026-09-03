import { describe, expect, it } from 'vitest';
import { formatPositions } from './player-positions';
describe('formatPositions', () => {
    it('renders detailed positions in canonical order, deduplicated', () => {
        expect(formatPositions(['SG', 'PG'])).toBe('PG/SG');
        expect(formatPositions(['SF', 'PF'])).toBe('SF/PF');
        expect(formatPositions(['C'])).toBe('C');
    });
    it('passes unknown values through after the known positions', () => {
        expect(formatPositions(['X', 'PG', 'Y'])).toBe('PG/X/Y');
        expect(formatPositions([])).toBe('');
    });
    it('never collapses coarse groups', () => {
        expect(formatPositions(['F', 'G'])).toBe('F/G');
    });
    it('memoizes by the positions array identity with identical output', () => {
        const positions = ['PG', 'SG'] as const;
        const first = formatPositions(positions);
        const second = formatPositions(positions);
        expect(second).toBe(first);
        expect(second).toBe('PG/SG');
        const other = formatPositions(['PG', 'SG']);
        expect(other).toBe('PG/SG');
    });
});
