import type {
  HavocCatalog,
  HavocCommandRejectionCode,
  HavocCreateDraftCommand,
  HavocDraftPick,
  HavocDraftState,
  HavocLockLineupCommand,
  HavocMutationDefinition,
  HavocPickCardCommand,
  HavocRerollOfferCommand,
  HavocRunState,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_DRAFT_ROUNDS,
  HAVOC_REROLL_LIMIT,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  havocClaimKeyOf,
  havocCommandResultSchema,
  havocCreateDraftCommandSchema,
  havocDraftStateSchema,
  havocRunStateSchema,
} from '@hoop-rush/data-contracts';
import { createRng, type Rng } from '../../sim/rng.ts';
import type { HavocCommandOutcome, HavocDraftEnvironment, HavocLockSources } from './api.ts';
import { assertHavocCatalogSourceMatches } from './catalog.ts';
import { HAVOC_MUTATION_DEFINITIONS } from './mutations.ts';
import { GenerateHavocOffer } from './offers.ts';
import { buildHavocLockedInputs } from './opponents.ts';
import { zeroHavocSeasonAggregate } from './aggregate.ts';
import { HavocStateDigest } from './state-digest.ts';

export interface HavocCommandEnvironment extends HavocDraftEnvironment {
  readonly catalog?: HavocCatalog;
}

export interface HavocCommandEnvironmentOptions {
  readonly rngFactory?: (seed: string) => Rng;
  readonly definitions?: readonly HavocMutationDefinition[];
}

export function createHavocCommandEnvironment(
  catalog: HavocCatalog,
  options: HavocCommandEnvironmentOptions = {},
): HavocCommandEnvironment {
  return {
    rngFactory: options.rngFactory ?? createRng,
    definitions: options.definitions ?? HAVOC_MUTATION_DEFINITIONS,
    catalog,
  };
}

export interface HavocCommandIdentity {
  readonly commandId: string;
  readonly runId: string;
}

export function rejectHavocCommand(
  state: HavocRunState,
  command: HavocCommandIdentity,
  code: HavocCommandRejectionCode,
  message: string,
): HavocCommandOutcome {
  const result = havocCommandResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'rejected',
    revisionBefore: state.revision,
    revisionAfter: state.revision,
    stateDigest: HavocStateDigest(state),
    rejection: { code, message },
  });
  return { state, result };
}

export function acceptHavocCommand(
  state: HavocRunState,
  command: HavocCommandIdentity,
  nextState: HavocRunState,
): HavocCommandOutcome {
  const result = havocCommandResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'accepted',
    revisionBefore: state.revision,
    revisionAfter: nextState.revision,
    stateDigest: HavocStateDigest(nextState),
    rejection: null,
  });
  return { state: nextState, result };
}

function requireHavocCatalog(
  environment: HavocCommandEnvironment,
  draft: HavocDraftState,
): HavocCatalog {
  const catalog = environment.catalog;
  if (catalog === undefined) {
    throw new Error(
      'havoc command environment is missing the adapted catalog required to advance the draft',
    );
  }
  assertHavocCatalogSourceMatches(catalog.source, draft.catalog);
  return catalog;
}

function draftedClaimKeysOf(draft: HavocDraftState): string[] {
  return draft.picks.map((pick) =>
    havocClaimKeyOf(pick.claimKey.playerId, pick.claimKey.seasonKey),
  );
}

export function CreateHavocRunState(
  command: HavocCreateDraftCommand,
  catalog: HavocCatalog,
  environment: HavocDraftEnvironment,
): HavocRunState {
  const parsed = havocCreateDraftCommandSchema.parse(command);
  assertHavocCatalogSourceMatches(catalog.source, parsed.catalog);
  const offer = GenerateHavocOffer(
    {
      catalog,
      runSeed: parsed.runSeed,
      round: 1,
      slot: 'PG',
      offerIndex: 0,
      draftedClaimKeys: [],
      rerollUsed: false,
    },
    environment,
  );
  const draft = havocDraftStateSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId: parsed.runId,
    revision: 0,
    runSeed: parsed.runSeed,
    versionSet: parsed.versionSet,
    catalog: parsed.catalog,
    round: 1,
    slot: 'PG',
    offerId: offer.offerId,
    offerIndex: offer.offerIndex,
    cards: offer.cards,
    rerollUsed: false,
    picks: [],
    status: 'drafting',
  });
  return havocRunStateSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId: parsed.runId,
    revision: 0,
    runSeed: parsed.runSeed,
    versionSet: parsed.versionSet,
    phase: 'draft',
    draft,
    locked: null,
    havocCursor: 0,
    normalCursor: 0,
    havocAggregate: zeroHavocSeasonAggregate(),
    normalAggregate: zeroHavocSeasonAggregate(),
    perfectSeason: false,
    comparisonStatus: 'not-started',
    completionState: 'draft',
  });
}

function applyRerollOffer(
  state: HavocRunState,
  draft: HavocDraftState,
  command: HavocRerollOfferCommand,
  environment: HavocCommandEnvironment,
): HavocCommandOutcome {
  if (draft.status !== 'drafting') {
    return rejectHavocCommand(state, command, 'not-drafting', 'the draft is already complete');
  }
  if (draft.rerollUsed) {
    return rejectHavocCommand(state, command, 'reroll-spent', 'the draft-wide reroll is spent');
  }
  if (command.offerId !== draft.offerId) {
    return rejectHavocCommand(
      state,
      command,
      'offer-mismatch',
      `command offer ${command.offerId} does not match the current offer ${draft.offerId}`,
    );
  }
  const offerIndex = draft.offerIndex + 1;
  if (offerIndex > HAVOC_REROLL_LIMIT) {
    return rejectHavocCommand(state, command, 'reroll-spent', 'the draft-wide reroll is spent');
  }
  const catalog = requireHavocCatalog(environment, draft);
  const offer = GenerateHavocOffer(
    {
      catalog,
      runSeed: state.runSeed,
      round: draft.round,
      slot: draft.slot,
      offerIndex,
      draftedClaimKeys: draftedClaimKeysOf(draft),
      rerollUsed: true,
    },
    environment,
  );
  const nextDraft = havocDraftStateSchema.parse({
    ...draft,
    offerId: offer.offerId,
    offerIndex,
    cards: offer.cards,
    rerollUsed: true,
  });
  return acceptHavocCommand(state, command, {
    ...state,
    revision: state.revision + 1,
    draft: nextDraft,
  });
}

function applyPickCard(
  state: HavocRunState,
  draft: HavocDraftState,
  command: HavocPickCardCommand,
  environment: HavocCommandEnvironment,
): HavocCommandOutcome {
  if (draft.status !== 'drafting') {
    return rejectHavocCommand(state, command, 'not-drafting', 'the draft is already complete');
  }
  if (command.offerId !== draft.offerId) {
    return rejectHavocCommand(
      state,
      command,
      'offer-mismatch',
      `command offer ${command.offerId} does not match the current offer ${draft.offerId}`,
    );
  }
  const card = draft.cards.find((candidate) => candidate.cardId === command.cardId);
  if (card === undefined) {
    return rejectHavocCommand(
      state,
      command,
      'unknown-card',
      `card ${command.cardId} is not part of the current offer`,
    );
  }
  if (card.slot !== draft.slot || !card.source.positions.includes(draft.slot)) {
    return rejectHavocCommand(
      state,
      command,
      'illegal-position',
      `card ${card.cardId} cannot fill ${draft.slot}`,
    );
  }
  const seasonKey = card.source.seasonKey;
  if (seasonKey === null) {
    return rejectHavocCommand(
      state,
      command,
      'illegal-claim',
      `card ${card.cardId} has no season key to claim`,
    );
  }
  const alreadyDrafted = draft.picks.some(
    (pick) =>
      pick.claimKey.playerId === card.source.playerId && pick.claimKey.seasonKey === seasonKey,
  );
  if (alreadyDrafted) {
    return rejectHavocCommand(
      state,
      command,
      'illegal-claim',
      `claim ${card.source.playerId}::${seasonKey} is already drafted`,
    );
  }
  const pick: HavocDraftPick = {
    pickOrdinal: draft.picks.length,
    slot: draft.slot,
    claimKey: { playerId: card.source.playerId, seasonKey },
    card,
  };
  const picks = [...draft.picks, pick];
  let nextDraft: HavocDraftState;
  if (picks.length >= HAVOC_DRAFT_ROUNDS) {
    nextDraft = havocDraftStateSchema.parse({ ...draft, picks, status: 'complete' });
  } else {
    const round = picks.length + 1;
    const slot = POSITIONS[picks.length];
    if (slot === undefined) {
      throw new Error(`havoc draft has no slot for pick ${String(picks.length + 1)}`);
    }
    const catalog = requireHavocCatalog(environment, draft);
    const offer = GenerateHavocOffer(
      {
        catalog,
        runSeed: state.runSeed,
        round,
        slot,
        offerIndex: 0,
        draftedClaimKeys: picks.map((entry) =>
          havocClaimKeyOf(entry.claimKey.playerId, entry.claimKey.seasonKey),
        ),
        rerollUsed: draft.rerollUsed,
      },
      environment,
    );
    nextDraft = havocDraftStateSchema.parse({
      ...draft,
      round,
      slot,
      offerId: offer.offerId,
      offerIndex: 0,
      cards: offer.cards,
      picks,
      status: 'drafting',
    });
  }
  return acceptHavocCommand(state, command, {
    ...state,
    revision: state.revision + 1,
    draft: nextDraft,
  });
}

function applyLockLineup(
  state: HavocRunState,
  draft: HavocDraftState,
  command: HavocLockLineupCommand,
  lockSources: HavocLockSources,
): HavocCommandOutcome {
  if (draft.status !== 'complete') {
    return rejectHavocCommand(state, command, 'not-drafting', 'the draft is not complete');
  }
  const matches =
    command.picks.length === HAVOC_DRAFT_ROUNDS &&
    command.picks.every((entry, index) => {
      const pick = draft.picks[index];
      return pick !== undefined && pick.slot === entry.slot && pick.card.cardId === entry.cardId;
    });
  if (!matches) {
    return rejectHavocCommand(
      state,
      command,
      'incomplete-lineup',
      'the locked picks do not match the completed draft',
    );
  }
  const locked = buildHavocLockedInputs({
    runId: state.runId,
    runSeed: state.runSeed,
    versionSet: state.versionSet,
    picks: draft.picks,
    bracket: lockSources.bracket,
    profile: lockSources.profile,
  });
  const nextState = havocRunStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    phase: 'run',
    draft: null,
    locked,
    completionState: 'season',
  });
  return acceptHavocCommand(state, command, nextState);
}

export function applyHavocDraftCommand(
  state: HavocRunState,
  command: HavocRerollOfferCommand | HavocPickCardCommand | HavocLockLineupCommand,
  environment: HavocCommandEnvironment,
  lockSources: HavocLockSources,
): HavocCommandOutcome {
  if (command.runId !== state.runId) {
    return rejectHavocCommand(
      state,
      command,
      'run-mismatch',
      `command targets run ${command.runId}, active state is ${state.runId}`,
    );
  }
  if (command.expectedRevision !== state.revision) {
    return rejectHavocCommand(
      state,
      command,
      'stale-revision',
      `expected revision ${String(command.expectedRevision)}, current revision ${String(state.revision)}`,
    );
  }
  if (state.phase !== 'draft' || state.draft === null) {
    return rejectHavocCommand(
      state,
      command,
      'not-a-draft',
      'draft commands require the run to be in the draft phase',
    );
  }
  const draft = state.draft;
  switch (command.command) {
    case 'reroll-havoc-offer':
      return applyRerollOffer(state, draft, command, environment);
    case 'pick-havoc-card':
      return applyPickCard(state, draft, command, environment);
    case 'lock-havoc-lineup':
      return applyLockLineup(state, draft, command, lockSources);
  }
}
