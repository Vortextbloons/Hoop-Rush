import { classicDraftCatalogSchema, eraIdSchema, franchiseIdSchema, playerIdSchema, seedSchema, } from '@hoop-rush/data-contracts';
import type { ClassicCatalogEntry, ClassicCompletedDraft, ClassicDraftCatalog, ClassicDraftState, ClassicPick, } from '@hoop-rush/data-contracts';
const FIXTURE_CLASSIC_SEED = 'abc123abc123abc123abc123abc123ab' as const;
const DEFAULT_CLASSIC_CATALOG: readonly ClassicCatalogEntry[] = classicDraftCatalogSchema.parse([
    {
        franchiseId: 'lakers',
        eraId: '1990s',
        players: [
            { playerId: 'p-lal-g', positions: ['PG', 'SG'] },
            { playerId: 'p-lal-gf', positions: ['PG', 'SF'] },
            { playerId: 'p-lal-c', positions: ['C'] },
        ],
    },
    {
        franchiseId: 'lakers',
        eraId: '1980s',
        players: [{ playerId: 'p-lal-f', positions: ['SF', 'PF'] }],
    },
    {
        franchiseId: 'celtics',
        eraId: '1990s',
        players: [
            { playerId: 'p-bos-g', positions: ['PG', 'SG'] },
            { playerId: 'p-bos-c', positions: ['C'] },
        ],
    },
    {
        franchiseId: 'celtics',
        eraId: '1980s',
        players: [{ playerId: 'p-bos-c2', positions: ['C'] }],
    },
    {
        franchiseId: 'bulls',
        eraId: '1990s',
        players: [
            { playerId: 'p-chi-f', positions: ['SF', 'PF'] },
            { playerId: 'p-chi-c', positions: ['C'] },
        ],
    },
    {
        franchiseId: 'bulls',
        eraId: '1980s',
        players: [{ playerId: 'p-chi-g', positions: ['PG', 'SG'] }],
    },
    {
        franchiseId: 'heat',
        eraId: '2000s',
        players: [
            { playerId: 'p-mia-fc', positions: ['PF', 'C'] },
            { playerId: 'p-mia-g', positions: ['PG', 'SG'] },
        ],
    },
    {
        franchiseId: 'knicks',
        eraId: '2010s',
        players: [
            { playerId: 'p-nyk-f', positions: ['SF', 'PF'] },
            { playerId: 'p-nyk-c', positions: ['C'] },
        ],
    },
]);
export function buildClassicCatalog(entries: readonly ClassicCatalogEntry[] = DEFAULT_CLASSIC_CATALOG): ClassicDraftCatalog {
    return classicDraftCatalogSchema.parse(entries.map((entry) => ({
        franchiseId: entry.franchiseId,
        eraId: entry.eraId,
        players: entry.players.map((player) => ({
            playerId: player.playerId,
            positions: [...player.positions],
        })),
    })));
}
export function buildClassicPick(overrides: Partial<ClassicPick> = {}): ClassicPick {
    return {
        round: 1,
        playerId: playerIdSchema.parse('p-lal-g'),
        franchiseId: franchiseIdSchema.parse('lakers'),
        eraId: eraIdSchema.parse('1990s'),
        slotIndex: 0,
        ...overrides,
    };
}
export function buildClassicDraftState(overrides: Partial<ClassicDraftState> = {}): ClassicDraftState {
    return {
        schemaVersion: 1,
        draftId: 'draft-1',
        variant: 'ratings',
        seed: seedSchema.parse(FIXTURE_CLASSIC_SEED),
        dataVersion: 'data-v1',
        round: 1,
        status: 'drafting',
        roll: {
            franchiseId: franchiseIdSchema.parse('lakers'),
            eraId: eraIdSchema.parse('1990s'),
        },
        rerolls: { franchiseSpent: false, eraSpent: false },
        picks: [],
        ...overrides,
    };
}
export function buildClassicCompletedDraft(overrides: Partial<ClassicCompletedDraft> = {}): ClassicCompletedDraft {
    const picks: ClassicPick[] = [
        buildClassicPick({
            round: 1,
            playerId: playerIdSchema.parse('p-lal-g'),
            franchiseId: franchiseIdSchema.parse('lakers'),
            eraId: eraIdSchema.parse('1990s'),
        }),
        buildClassicPick({
            round: 2,
            playerId: playerIdSchema.parse('p-bos-g'),
            franchiseId: franchiseIdSchema.parse('celtics'),
            eraId: eraIdSchema.parse('1990s'),
            slotIndex: 1,
        }),
        buildClassicPick({
            round: 3,
            playerId: playerIdSchema.parse('p-lal-f'),
            franchiseId: franchiseIdSchema.parse('lakers'),
            eraId: eraIdSchema.parse('1980s'),
            slotIndex: 2,
        }),
        buildClassicPick({
            round: 4,
            playerId: playerIdSchema.parse('p-chi-f'),
            franchiseId: franchiseIdSchema.parse('bulls'),
            eraId: eraIdSchema.parse('1990s'),
            slotIndex: 3,
        }),
        buildClassicPick({
            round: 5,
            playerId: playerIdSchema.parse('p-lal-c'),
            franchiseId: franchiseIdSchema.parse('lakers'),
            eraId: eraIdSchema.parse('1990s'),
            slotIndex: 4,
        }),
    ];
    return {
        draftId: 'draft-1',
        variant: 'ratings',
        seed: seedSchema.parse(FIXTURE_CLASSIC_SEED),
        picks,
        ...overrides,
    };
}
export function buildCompletedDraftState(overrides: Partial<ClassicDraftState> = {}): ClassicDraftState {
    const completed = buildClassicCompletedDraft();
    return buildClassicDraftState({
        draftId: completed.draftId,
        variant: completed.variant,
        seed: completed.seed,
        round: 5,
        status: 'complete',
        roll: null,
        rerolls: { franchiseSpent: true, franchiseRound: 5, eraSpent: true, eraRound: 5 },
        picks: completed.picks,
        ...overrides,
    });
}
