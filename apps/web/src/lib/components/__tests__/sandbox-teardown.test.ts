import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { HoopRushManifest, PlayersIndex, PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import SandboxPage from '../../../routes/sandbox/+page.svelte';
mockSvelteKitApp();
vi.mock('$lib/data', async () => {
    const { buildManifest, buildPool } = await import('@hoop-rush/test-fixtures');
    const entries: PlayersIndexEntry[] = [];
    const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
    for (let i = 0; i < 60; i += 1) {
        const position = positions[i % 5] as (typeof positions)[number];
        entries.push({
            playerId: `player-${String(i).padStart(3, '0')}`,
            franchiseId: 'lakers',
            eraId: '1990s',
            seasonKey: '1996-97',
            firstName: `First${String(i)}`,
            lastName: `Last${String(i)}`,
            displayName: `First${String(i)} Last${String(i)}`,
            playerExternalId: String(i),
            altIds: { nbaHeadshotAvailable: false },
            positionsPlayable: [position],
            overall: 50 + (i % 40),
            offense: 50,
            defense: 50,
            selectionScore: 100 - (i % 50),
        });
    }
    const manifest: HoopRushManifest = buildManifest({
        pools: [
            {
                franchiseId: 'lakers',
                eraId: '1990s',
                url: 'pools/lakers-1990s.json',
                contentHash: 'hash',
            },
        ],
    });
    const index: PlayersIndex = {
        schemaVersion: 4,
        dataVersion: 'data-v1',
        players: entries,
    };
    return {
        getManifest: () => Promise.resolve(manifest),
        getPlayersIndex: () => Promise.resolve(index),
        getPool: (entry: {
            franchiseId: string;
            eraId: string;
        }) => Promise.resolve(buildPool([], { franchiseId: entry.franchiseId, eraId: entry.eraId })),
        clearDataLoaderCaches: () => { },
    };
});
vi.mock('$lib/sandbox-run', () => ({
    startSandboxRun: vi.fn(async () => { }),
}));
describe('sandbox teardown', () => {
    it('unmounting with the picker open and a pending debounce does not throw', async () => {
        const { container, unmount } = render(SandboxPage);
        await waitFor(() => {
            expect(container.querySelectorAll('li button')).not.toHaveLength(0);
        }, { timeout: 2000 });
        const cards = container.querySelectorAll('li button');
        expect(cards.length).toBeGreaterThan(0);
        (cards[0] as HTMLButtonElement).click();
        await waitFor(() => {
            expect(document.body.querySelector('[aria-label^="Place "]')).not.toBeNull();
        });
        const searchbox = container.querySelector('input[type="search"]') as HTMLInputElement;
        await fireEvent.input(searchbox, { target: { value: 'First1' } });
        unmount();
    });
});
