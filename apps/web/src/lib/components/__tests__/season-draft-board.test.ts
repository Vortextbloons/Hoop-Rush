import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { SEASON_DRAFT_VERSION, type SeasonDraftCommandPayload, type SeasonDraftState, } from '@hoop-rush/data-contracts';
import { applySeasonDraftCommand } from '@hoop-rush/engine';
import { buildManifest, buildSeasonDraftCatalog, buildSeasonLeague, } from '@hoop-rush/test-fixtures';
import SeasonDraftBoard from '$lib/components/season/SeasonDraftBoard.svelte';
import { SOLO_PARTICIPANT_ID, type SeasonDraftFlowState } from '$lib/season/season-draft-flow';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
const CATALOG = buildSeasonDraftCatalog();
const MANIFEST = buildManifest();
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const DEPS = { generate: (() => null) as never };
let commandCounter = 0;
function run(state: SeasonDraftState | null, payload: SeasonDraftCommandPayload): SeasonDraftState | null {
    commandCounter += 1;
    return applySeasonDraftCommand(state, CATALOG, {
        commandId: `cmd-${String(commandCounter)}`,
        expectedRevision: state?.revision ?? 0,
        payload,
    }, DEPS).state;
}
function draftState(steps: {
    drawn?: boolean;
    picked?: boolean;
} = {}): SeasonDraftState {
    let state = run(null, {
        kind: 'create-season-draft',
        runId: 'run-test',
        rootSeed: SEED,
        league: LEAGUE,
        humanParticipantIds: [SOLO_PARTICIPANT_ID],
        catalogVersion: SEASON_DRAFT_VERSION,
    });
    if (steps.drawn) {
        state = run(state, { kind: 'draw-season-offer', participantId: SOLO_PARTICIPANT_ID });
    }
    if (steps.picked && state) {
        const offer = state.currentOffer;
        if (offer !== null) {
            const card = offer.cards.find((c) => c.selectable);
            if (card) {
                state = run(state, {
                    kind: 'select-draft-player',
                    participantId: SOLO_PARTICIPANT_ID,
                    playerVersionId: card.playerVersionId,
                });
            }
        }
    }
    if (state === null) {
        throw new Error('draft state unexpectedly null');
    }
    return state;
}
function flowState(state: SeasonDraftState): SeasonDraftFlowState {
    return { draft: state, generation: null, lastRecord: null, phase: 'drafting' };
}
function renderBoard(state: SeasonDraftState, handlers: Partial<{
    draw: () => void;
    pick: (playerVersionId: string) => void;
    finalize: () => void;
}> = {}) {
    const onDraw: () => void = handlers.draw ?? (() => undefined);
    const onPick: (playerVersionId: string) => void = handlers.pick ?? (() => undefined);
    const onFinalize: () => void = handlers.finalize ?? (() => undefined);
    return {
        ...render(SeasonDraftBoard, {
            props: {
                flow: flowState(state),
                catalog: CATALOG,
                manifest: MANIFEST,
                faces: new Map(),
                busy: false,
                error: null,
                onDraw,
                onPick,
                onFinalize,
            },
        }),
        onDraw,
        onPick,
        onFinalize,
    };
}
describe('SeasonDraftBoard component', () => {
    it('shows the round heading, franchise, and coverage needs before the first draw', () => {
        const { getByText, container } = renderBoard(draftState());
        expect(getByText('Round 1 of 10')).not.toBeNull();
        expect(getByText(/your franchise/)).not.toBeNull();
        expect(getByText('Coverage needs')).not.toBeNull();
        const dl = container.querySelector('dl');
        expect(dl?.textContent).toContain('0/4');
        expect(dl?.textContent).toContain('0/3');
    });
    it('offers the draw button before an offer and fires onDraw', async () => {
        const onDraw = vi.fn();
        const { getByRole, onDraw: wired } = renderBoard(draftState(), { draw: onDraw });
        const button = getByRole('button', { name: 'Draw round 1 offer' });
        expect(button).not.toBeNull();
        await fireEvent.click(button);
        expect(wired).toHaveBeenCalledTimes(1);
    });
    it('renders the eight-card offer with selectable cards clickable and disabled cards explained', async () => {
        const onPick = vi.fn();
        const state = draftState({ drawn: true });
        const offer = state.currentOffer;
        if (offer === null)
            throw new Error('expected a drawn offer');
        expect(offer.cards).toHaveLength(8);
        const selectable = offer.cards.filter((card) => card.selectable);
        const disabled = offer.cards.filter((card) => !card.selectable);
        const { getAllByRole, getAllByText, onPick: wired } = renderBoard(state, { pick: onPick });
        const pickButtons = getAllByRole('button', { name: 'Pick' });
        expect(pickButtons.length).toBe(selectable.length);
        for (const card of disabled) {
            expect(getAllByText(new RegExp(`Disabled · ${card.coverageReason ?? ''}`)).length).toBe(selectable.length === 0 ? 1 : 1);
        }
        const firstSelectable = selectable[0];
        if (firstSelectable !== undefined && pickButtons[0] !== undefined) {
            await fireEvent.click(pickButtons[0]);
            expect(wired).toHaveBeenCalledWith(firstSelectable.playerVersionId);
        }
    });
    it('shows the finalize action after ten picks', () => {
        let state: SeasonDraftState | null = draftState();
        for (let round = 1; round <= 10; round += 1) {
            const drawn = run(state, {
                kind: 'draw-season-offer',
                participantId: SOLO_PARTICIPANT_ID,
            });
            if (drawn === null) {
                throw new Error('draw unexpectedly failed');
            }
            const offer = drawn.currentOffer;
            if (offer === null)
                throw new Error('expected a drawn offer');
            const card = offer.cards.find((c) => c.selectable);
            if (!card)
                throw new Error('no selectable card');
            const picked = run(drawn, {
                kind: 'select-draft-player',
                participantId: SOLO_PARTICIPANT_ID,
                playerVersionId: card.playerVersionId,
            });
            if (picked === null) {
                throw new Error('pick unexpectedly failed');
            }
            state = picked;
        }
        const { getByRole, getByText } = renderBoard(state);
        expect(getByRole('button', { name: 'Finalize my roster' })).not.toBeNull();
        expect(getByText('Your ten')).not.toBeNull();
    });
});
