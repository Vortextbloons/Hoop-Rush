import { describe, expect, it } from 'vitest';
import { challengeRunSchema, classicCompletedDraftSchema, classicDraftCatalogSchema, classicDraftStateSchema, franchiseEraPoolSchema, hoopRushManifestSchema, peakPlayerSeasonSchema, } from '@hoop-rush/data-contracts';
import { buildChallengeRun, buildClassicCatalog, buildClassicCompletedDraft, buildClassicDraftState, buildCompletedDraftState, buildManifest, buildPlayerSeason, buildPool, seedFromString, } from './index.ts';
describe('fixture builders', () => {
    it('build a schema-valid peak player season', () => {
        const player = buildPlayerSeason();
        expect(peakPlayerSeasonSchema.safeParse(player).success).toBe(true);
    });
    it('build a schema-valid pool', () => {
        const pool = buildPool([buildPlayerSeason(), buildPlayerSeason({ playerId: 'p-2' })]);
        expect(franchiseEraPoolSchema.safeParse(pool).success).toBe(true);
    });
    it('build a schema-valid manifest', () => {
        expect(hoopRushManifestSchema.safeParse(buildManifest()).success).toBe(true);
    });
    it('build a schema-valid challenge run', () => {
        const run = buildChallengeRun();
        expect(challengeRunSchema.safeParse(run).success).toBe(true);
        expect(run.bracket.opponents).toHaveLength(30);
        expect(run.bracket.schedule).toHaveLength(82);
    });
    it('produces deterministic seeds', () => {
        expect(seedFromString('x')).toBe(seedFromString('x'));
        expect(seedFromString('x')).not.toBe(seedFromString('y'));
        expect(seedFromString('x')).toMatch(/^[0-9a-f]{32}$/);
    });
});
describe('classic fixtures', () => {
    it('builds a schema-valid mini-catalog across franchises and eras', () => {
        const catalog = buildClassicCatalog();
        expect(catalog.length).toBeGreaterThanOrEqual(6);
        expect(new Set(catalog.map((entry) => entry.franchiseId)).size).toBeGreaterThanOrEqual(4);
        expect(new Set(catalog.map((entry) => entry.eraId)).size).toBeGreaterThanOrEqual(3);
        for (const entry of catalog) {
            expect(entry.players.length).toBeGreaterThan(0);
            for (const player of entry.players) {
                expect(player.playerId).toMatch(/^[a-z0-9][a-z0-9._:-]*$/);
                expect(player.positions.length).toBeGreaterThan(0);
            }
        }
        expect(classicDraftCatalogSchema.safeParse(catalog).success).toBe(true);
    });
    it('builds a completed draft with five unique picks in legal slots', () => {
        const completed = buildClassicCompletedDraft();
        expect(completed.picks).toHaveLength(5);
        expect(new Set(completed.picks.map((pick) => pick.playerId)).size).toBe(5);
        expect(new Set(completed.picks.map((pick) => pick.slotIndex)).size).toBe(5);
        expect(completed.picks.map((pick) => pick.round)).toEqual([1, 2, 3, 4, 5]);
        expect(classicCompletedDraftSchema.safeParse(completed).success).toBe(true);
    });
    it('builds a drafting draft state and a completed one that both parse', () => {
        const drafting = buildClassicDraftState();
        expect(drafting.round).toBe(1);
        expect(drafting.status).toBe('drafting');
        expect(drafting.roll).not.toBeNull();
        expect(classicDraftStateSchema.safeParse(drafting).success).toBe(true);
        const complete = buildCompletedDraftState();
        expect(complete.status).toBe('complete');
        expect(complete.roll).toBeNull();
        expect(complete.picks).toHaveLength(5);
        expect(complete.rerolls.franchiseSpent).toBe(true);
        expect(complete.rerolls.eraSpent).toBe(true);
        expect(classicDraftStateSchema.safeParse(complete).success).toBe(true);
    });
});
