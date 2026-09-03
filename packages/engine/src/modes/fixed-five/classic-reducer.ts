import type {
  ClassicDraftCatalog,
  ClassicDraftState,
  Seed,
  SlotIndex,
} from '@hoop-rush/data-contracts';
import {
  classicRollCandidates,
  createClassicDraft,
  draftClassicPlayer,
  rerollClassicEra,
  rerollClassicFranchise,
} from '../classic/draft.ts';
import type { EngineContext } from '../../sim/context.ts';

export type ClassicBuilderCommand =
  | { kind: 'reroll'; axis: 'franchise' | 'era' }
  | { kind: 'classic-pick'; playerId: string; slotIndex: SlotIndex };

export type PoolEligibilityPolicy = (entry: ClassicDraftCatalog[number]) => boolean;

export function applyClassicBuilderCommand(
  state: ClassicDraftState,
  catalog: ClassicDraftCatalog,
  command: ClassicBuilderCommand,
  context: EngineContext,
  eligibility?: PoolEligibilityPolicy,
): ClassicDraftState {
  const effectiveCatalog = eligibility ? catalog.filter(eligibility) : catalog;
  if (command.kind === 'reroll') {
    return command.axis === 'franchise'
      ? rerollClassicFranchise(state, effectiveCatalog, context)
      : rerollClassicEra(state, effectiveCatalog, context);
  }
  return draftClassicPlayer(
    state,
    effectiveCatalog,
    { playerId: command.playerId, slotIndex: command.slotIndex },
    context,
  );
}

export function createParticipantClassicDraft(
  draftId: string,
  variant: ClassicDraftState['variant'],
  participantSeed: Seed,
  dataVersion: string,
  catalog: ClassicDraftCatalog,
  context: EngineContext,
): ClassicDraftState {
  return createClassicDraft(
    { draftId, variant, seed: participantSeed, dataVersion, catalog },
    context,
  );
}

export function classicSafePickCount(state: ClassicDraftState): number {
  return state.picks.length;
}

export function classicDraftEligibleEntries(
  catalog: ClassicDraftCatalog,
  state: ClassicDraftState,
  eligibility?: PoolEligibilityPolicy,
): ClassicDraftCatalog[number][] {
  const effective = eligibility ? catalog.filter(eligibility) : catalog;
  return classicRollCandidates(effective, state, 'initial');
}
