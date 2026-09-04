import { describe, expect, it } from 'vitest';
import { SEASON_BLOCK_COUNT } from '@hoop-rush/data-contracts';
import { freshState, runBlock } from './block-test-support.ts';
describe('season block determinism and accounting (M2.3)', () => {
    it('produces identical per-block digests across two complete full-season runs', () => {
        const digests = (): string[] => {
            const state = freshState();
            const all: string[] = [];
            for (let i = 0; i < SEASON_BLOCK_COUNT; i += 1) {
                all.push(runBlock(state, i).digest);
            }
            return all;
        };
        expect(digests()).toEqual(digests());
    }, 300000);
});
