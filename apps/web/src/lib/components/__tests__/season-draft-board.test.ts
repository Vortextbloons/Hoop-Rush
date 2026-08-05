// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { SeasonDraftCommandPayload, SeasonDraftState } from '@hoop-rush/data-contracts';
import { applySeasonDraftCommand } from '@hoop-rush/engine';
import {
  buildManifest,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
} from '@hoop-rush/test-fixtures';
import SeasonDraftBoard from '$lib/components/season/SeasonDraftBoard.svelte';
import { SOLO_PARTICIPANT_ID, type SeasonDraftFlowState } from '$lib/season/season-draft-flow';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * SeasonDraftBoard component tests (M2.3 setup): the live ten-round board
 * renders engine facts — round, rolled options with deterministic recovery,
 * coverage needs, claims, and the revealed pool — and routes interactions
 * through the page callbacks.
 */

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
const CATALOG = buildSeasonDraftCatalog();
const MANIFEST = buildManifest();
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const DEPS = { generate: (() => null) as never };

let commandCounter = 0;

function run(
  state: SeasonDraftState | null,
  payload: SeasonDraftCommandPayload,
): SeasonDraftState | null {
  commandCounter += 1;
  return applySeasonDraftCommand(
    state,
    CATALOG,
    {
      commandId: `cmd-${String(commandCounter)}`,
      expectedRevision: state?.revision ?? 0,
      payload,
    },
    DEPS,
  ).state;
}

/** Drives engine commands to a draft state with the given step count. */
function draftState(steps: { revealed?: boolean; claimed?: boolean } = {}): SeasonDraftState {
  let state = run(null, {
    kind: 'create-season-draft',
    runId: 'run-test',
    rootSeed: SEED,
    league: LEAGUE,
    humanParticipantIds: [SOLO_PARTICIPANT_ID],
    catalogVersion: CATALOG.catalogVersion,
  });
  if (steps.revealed) {
    state = run(state, { kind: 'reveal-draft-roll', participantId: SOLO_PARTICIPANT_ID });
  }
  if (steps.claimed && state) {
    const last = state.currentReveal?.attempts.at(-1);
    if (last) {
      state = run(state, {
        kind: 'claim-draft-pool',
        participantId: SOLO_PARTICIPANT_ID,
        franchiseId: last.franchiseId,
        eraId: last.eraId,
      });
    }
  }
  if (state === null) {
    throw new Error('draft state unexpectedly null');
  }
  return state;
}

/** Picks the first candidate of the revealed pool the engine accepts. */
function pickFromRevealed(state: SeasonDraftState): SeasonDraftState {
  const reveal = state.currentReveal;
  if (reveal === null) {
    throw new Error('no revealed draft state');
  }
  const last = reveal.attempts.at(-1);
  if (last === undefined) {
    throw new Error('no revealed attempt');
  }
  const pool = CATALOG.pools.find(
    (p) => p.franchiseId === last.franchiseId && p.eraId === last.eraId,
  );
  if (pool === undefined) {
    throw new Error(`no catalog pool for ${last.franchiseId} ${last.eraId}`);
  }
  for (const playerVersionId of pool.playerVersionIds) {
    const result = applySeasonDraftCommand(
      state,
      CATALOG,
      {
        commandId: `cmd-${String(++commandCounter)}`,
        expectedRevision: state.revision,
        payload: {
          kind: 'select-draft-player',
          participantId: SOLO_PARTICIPANT_ID,
          playerVersionId,
        },
      },
      DEPS,
    );
    if (result.record.status === 'accepted' && result.state !== null) return result.state;
  }
  return state;
}

function flowState(state: SeasonDraftState): SeasonDraftFlowState {
  return { draft: state, generation: null, lastRecord: null, phase: 'drafting' };
}

function renderBoard(
  state: SeasonDraftState,
  handlers: Partial<{
    reveal: () => void;
    claim: () => void;
    pick: (playerVersionId: string) => void;
    finalize: () => void;
  }> = {},
) {
  const onReveal: () => void = handlers.reveal ?? (() => undefined);
  const onClaim: () => void = handlers.claim ?? (() => undefined);
  const onPick: (playerVersionId: string) => void = handlers.pick ?? (() => undefined);
  const onFinalize: () => void = handlers.finalize ?? (() => undefined);
  return {
    ...render(SeasonDraftBoard, {
      props: {
        flow: flowState(state),
        catalog: CATALOG,
        manifest: MANIFEST,
        busy: false,
        error: null,
        onReveal,
        onClaim,
        onPick,
        onFinalize,
      },
    }),
    onReveal,
    onClaim,
    onPick,
    onFinalize,
  };
}

describe('SeasonDraftBoard component', () => {
  it('shows the round heading, franchise, and coverage needs before the first roll', () => {
    const { getByText, container } = renderBoard(draftState());
    expect(getByText('Round 1 of 10')).not.toBeNull();
    expect(getByText(/your franchise/)).not.toBeNull();
    expect(getByText('Coverage needs')).not.toBeNull();
    // dd text is split across text + span nodes; read the definition list.
    const dl = container.querySelector('dl');
    expect(dl?.textContent).toContain('0/4');
    expect(dl?.textContent).toContain('0/3');
  });

  it('offers the roll button before a reveal and fires onReveal', async () => {
    const onReveal = vi.fn();
    const { getByRole, onReveal: wired } = renderBoard(draftState(), { reveal: onReveal });
    const button = getByRole('button', { name: 'Roll round 1' });
    expect(button).not.toBeNull();
    await fireEvent.click(button);
    expect(wired).toHaveBeenCalledTimes(1);
  });

  it('shows rolled options with recovery attempts and a claim button', async () => {
    const onClaim = vi.fn();
    const {
      getByText,
      getAllByText,
      onClaim: wired,
    } = renderBoard(draftState({ revealed: true }), { claim: onClaim });
    expect(getByText('Rolled options · pick 1')).not.toBeNull();
    // Every attempt is listed; the usable one carries the "Playable" badge.
    expect(getAllByText('Playable').length).toBeGreaterThanOrEqual(1);
    const claim = getByText('Claim this pool').closest('button');
    expect(claim).not.toBeNull();
    if (claim !== null) {
      await fireEvent.click(claim);
    }
    expect(wired).toHaveBeenCalledTimes(1);
  });

  it('lists the claimed pool and the revealed pool rows after claiming', async () => {
    const onPick = vi.fn();
    const state = draftState({ revealed: true, claimed: true });
    const { getByText, getAllByText, onPick: wired } = renderBoard(state, { pick: onPick });
    expect(getByText('Claimed pools')).not.toBeNull();
    expect(getAllByText('Claimed').length).toBeGreaterThanOrEqual(1);
    // Pool rows render with a Pick button per candidate.
    const pickButtons = getAllByText('Pick');
    expect(pickButtons.length).toBeGreaterThan(0);
    const firstPick = pickButtons[0]?.closest('button');
    if (firstPick !== null && firstPick !== undefined) {
      await fireEvent.click(firstPick);
    }
    expect(wired).toHaveBeenCalledTimes(1);
  });

  it('shows the finalize action after ten picks', () => {
    let state: SeasonDraftState = draftState();
    for (let round = 1; round <= 10; round += 1) {
      const revealed = run(state, {
        kind: 'reveal-draft-roll',
        participantId: SOLO_PARTICIPANT_ID,
      });
      if (revealed === null) {
        throw new Error('reveal unexpectedly failed');
      }
      state = pickFromRevealed(revealed);
    }
    const { getByRole } = renderBoard(state);
    expect(getByRole('button', { name: 'Finalize my roster' })).not.toBeNull();
  });
});
