import type {
  EraSimulationProfile,
  HavocAdaptedCandidate,
  HavocBattleInput,
  HavocBattleTeamInput,
  HavocCatalog,
  HavocCuratedRatingBand,
  HavocDraftCard,
  HavocDraftOffer,
  HavocHomeAway,
  HavocMultiplayerCommandPayload,
  HavocMultiplayerCommandRejectionCode,
  HavocMultiplayerDraftPick,
  HavocMultiplayerDraftState,
  HavocMultiplayerOfferStream,
  HavocMultiplayerParticipantId,
  HavocMultiplayerVariant,
  HavocMutationDefinition,
  HavocMutationId,
  HavocTier,
  HavocVersionSet,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION,
  HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_TURNS,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_OFFER_SIZE,
  HAVOC_OFFER_TARGET_RADIUS,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  canonicalJson,
  havocBattleInputSchema,
  havocBattleTeamInputSchema,
  havocClaimKeyOf,
  havocDraftOfferSchema,
  havocInstanceIdSchema,
  havocInstanceSeed,
  havocMultiplayerDraftStateSchema,
  havocMultiplayerGameSeed,
  havocMultiplayerOfferSeed,
  havocMultiplayerRerollSeed,
  havocMultiplayerTimeoutSeed,
  havocOverallInCuratedBand,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { compareStrings } from '../../../domain/math.ts';
import { swapAt } from '../../../sim/rng.ts';
import type { HavocDraftEnvironment } from '../api.ts';
import { HavocCatalogCoverageError } from '../api.ts';
import type { HavocCompatibleBundle } from '../compatibility.ts';
import { enumerateHavocBundles } from '../compatibility.ts';
import { teamExclusiveMutationIdsOf } from '../mutations.ts';
import { generateHavocNickname } from '../nicknames.ts';
import {
  drawHavocCardTier,
  enumerateHavocOverallWindows,
  havocOverallInWindow,
  materializeHavocBundle,
  type HavocOverallWindow,
} from '../offers.ts';
import { applyHavocMutationPackage } from '../transform.ts';
import { havocMultiplayerCuratedAssignments } from './curated.ts';
import { havocMultiplayerByteDraw } from './seed-parity.ts';

export type HavocMultiplayerDraftEnvironment = HavocDraftEnvironment;

export type HavocMultiplayerDraftCommandPayload = Extract<
  HavocMultiplayerCommandPayload,
  { kind: 'pick' | 'reroll' | 'timeout-pick' }
>;

export interface HavocMultiplayerDraftReceipt {
  readonly accepted: boolean;
  readonly rejectionCode: HavocMultiplayerCommandRejectionCode | null;
  readonly revision: number;
}

export interface HavocMultiplayerDraftCommandOutcome {
  readonly state: HavocMultiplayerDraftState;
  readonly receipt: HavocMultiplayerDraftReceipt;
}

interface HavocMultiplayerSeasonUnit {
  readonly seasonKey: string;
  readonly claimKey: string;
  readonly playableSlots: readonly Position[];
  readonly variants: readonly HavocAdaptedCandidate[];
}

interface HavocMultiplayerPersonGroup {
  readonly playerId: string;
  readonly playableSlots: readonly Position[];
  readonly units: readonly HavocMultiplayerSeasonUnit[];
}

function pickerFor(
  firstPicker: HavocMultiplayerParticipantId,
  turnOrdinal: number,
): HavocMultiplayerParticipantId {
  return turnOrdinal % 2 === 0 ? firstPicker : firstPicker === 'p1' ? 'p2' : 'p1';
}

function otherParticipant(
  participantId: HavocMultiplayerParticipantId,
): HavocMultiplayerParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export type HavocMultiplayerDraftLogic = 'legacy' | 'balanced' | 'curated';

export interface HavocMultiplayerDraftSettings {
  readonly variant: HavocMultiplayerVariant;
  readonly rulesVersion: string;
}

export function defaultHavocMultiplayerDraftSettings(
  variant: HavocMultiplayerVariant = 'standard',
): HavocMultiplayerDraftSettings {
  return { variant, rulesVersion: HAVOC_RULES_VERSION };
}

/**
 * Rooms created before the balanced-offer release locked the legacy rules
 * version and keep the offer algorithm they were drafted under. The new
 * target-window algorithm never reinterprets them.
 */
export function havocMultiplayerDraftLogicOf(
  settings: HavocMultiplayerDraftSettings,
): HavocMultiplayerDraftLogic {
  if (settings.rulesVersion === HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION) {
    if (settings.variant === 'curated') {
      throw new Error('curated havoc drafts require the current rules version');
    }
    return 'legacy';
  }
  if (settings.rulesVersion === HAVOC_RULES_VERSION) {
    return settings.variant === 'curated' ? 'curated' : 'balanced';
  }
  throw new Error(`unsupported havoc multiplayer rules version ${settings.rulesVersion}`);
}

function buildPersonGroups(
  catalog: HavocCatalog,
  claimedPlayerIds: ReadonlySet<string>,
): readonly HavocMultiplayerPersonGroup[] {
  const byPlayer = new Map<string, Map<string, HavocAdaptedCandidate[]>>();
  for (const candidate of catalog.candidates) {
    if (candidate.seasonKey === null) {
      throw new Error(
        `havoc multiplayer catalog candidate ${candidate.playerId} has no season key`,
      );
    }
    if (claimedPlayerIds.has(candidate.playerId)) continue;
    let bySeason = byPlayer.get(candidate.playerId);
    if (bySeason === undefined) {
      bySeason = new Map();
      byPlayer.set(candidate.playerId, bySeason);
    }
    const versions = bySeason.get(candidate.seasonKey);
    if (versions === undefined) bySeason.set(candidate.seasonKey, [candidate]);
    else versions.push(candidate);
  }
  const groups: HavocMultiplayerPersonGroup[] = [];
  for (const [playerId, bySeason] of byPlayer) {
    const units: HavocMultiplayerSeasonUnit[] = [];
    for (const [seasonKey, versions] of bySeason) {
      const sorted = [...versions].sort((left, right) =>
        compareStrings(left.playerVersionId ?? '', right.playerVersionId ?? ''),
      );
      const playableSlots = POSITIONS.filter((position) =>
        sorted.some((version) => version.positions.includes(position)),
      );
      if (playableSlots.length === 0) continue;
      units.push({
        seasonKey,
        claimKey: havocClaimKeyOf(playerId, seasonKey),
        playableSlots,
        variants: sorted,
      });
    }
    if (units.length === 0) continue;
    units.sort((left, right) => compareStrings(left.seasonKey, right.seasonKey));
    groups.push({
      playerId,
      playableSlots: POSITIONS.filter((position) =>
        units.some((unit) => unit.playableSlots.includes(position)),
      ),
      units,
    });
  }
  groups.sort((left, right) => compareStrings(left.playerId, right.playerId));
  return groups;
}

interface HavocMultiplayerRequirement {
  readonly slot: Position;
  readonly band: HavocCuratedRatingBand | null;
}

type HavocMultiplayerRequirementEligibility = (
  person: HavocMultiplayerPersonGroup,
  requirement: HavocMultiplayerRequirement,
) => boolean;

function eligibleOverallsFor(
  person: HavocMultiplayerPersonGroup,
  requirement: HavocMultiplayerRequirement,
): readonly number[] {
  const overalls: number[] = [];
  for (const unit of person.units) {
    for (const version of unit.variants) {
      if (!version.positions.includes(requirement.slot)) continue;
      if (
        requirement.band !== null &&
        !havocOverallInCuratedBand(version.originalOverall, requirement.band)
      ) {
        continue;
      }
      overalls.push(version.originalOverall);
    }
  }
  return overalls;
}

function versionEligibleForCard(
  version: HavocAdaptedCandidate,
  requirement: HavocMultiplayerRequirement,
  window: HavocOverallWindow | null,
): boolean {
  if (!version.positions.includes(requirement.slot)) return false;
  if (
    requirement.band !== null &&
    !havocOverallInCuratedBand(version.originalOverall, requirement.band)
  ) {
    return false;
  }
  if (window !== null && !havocOverallInWindow(version.originalOverall, window)) return false;
  return true;
}

function matchRequirements(
  requirements: readonly HavocMultiplayerRequirement[],
  persons: readonly HavocMultiplayerPersonGroup[],
  eligible: HavocMultiplayerRequirementEligibility,
  excludedPlayerIds?: ReadonlySet<string>,
): boolean {
  const assignment = new Map<number, number>();
  const search = (requirementIndex: number, visited: Set<number>): boolean => {
    const requirement = requirements[requirementIndex];
    if (requirement === undefined) return false;
    for (let personIndex = 0; personIndex < persons.length; personIndex += 1) {
      const person = persons[personIndex];
      if (person === undefined || visited.has(personIndex)) continue;
      if (excludedPlayerIds !== undefined && excludedPlayerIds.has(person.playerId)) continue;
      if (!eligible(person, requirement)) continue;
      visited.add(personIndex);
      const matchedRequirement = assignment.get(personIndex);
      if (matchedRequirement === undefined || search(matchedRequirement, visited)) {
        assignment.set(personIndex, requirementIndex);
        return true;
      }
    }
    return false;
  };
  for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
    if (!search(requirementIndex, new Set())) return false;
  }
  return true;
}

function ownedTeamExclusiveMutationIdsOfPicks(
  picks: readonly HavocMultiplayerDraftPick[],
  participantId: HavocMultiplayerParticipantId,
  definitions: readonly HavocMutationDefinition[],
): readonly HavocMutationId[] {
  const exclusive = teamExclusiveMutationIdsOf(definitions);
  const owned: HavocMutationId[] = [];
  for (const pick of picks) {
    if (pick.participantId !== participantId) continue;
    for (const entry of pick.card.mutations) {
      if (exclusive.has(entry.mutationId) && !owned.includes(entry.mutationId)) {
        owned.push(entry.mutationId);
      }
    }
  }
  return owned;
}

/**
 * Rerolled offers double-hash the named reroll seed back through the offer seed
 * function, so offer index 1 uses a disjoint deterministic stream namespace.
 */
function offerStreamSeed(
  rootSeed: Seed,
  participantId: HavocMultiplayerParticipantId,
  turnOrdinal: number,
  offerIndex: number,
  stream: HavocMultiplayerOfferStream,
): Seed {
  if (offerIndex === 0) {
    return havocMultiplayerOfferSeed(rootSeed, participantId, turnOrdinal, stream);
  }
  const rerollSeed = havocMultiplayerRerollSeed(rootSeed, participantId, turnOrdinal);
  return havocMultiplayerOfferSeed(rerollSeed, participantId, turnOrdinal, stream);
}

export interface GenerateHavocMultiplayerOfferInput {
  readonly catalog: HavocCatalog;
  readonly rootSeed: Seed;
  readonly participantId: HavocMultiplayerParticipantId;
  readonly turnOrdinal: number;
  readonly offerIndex: number;
  readonly claimedPlayerIds: readonly string[];
  readonly picks: readonly HavocMultiplayerDraftPick[];
  readonly settings: HavocMultiplayerDraftSettings;
}

export function generateHavocMultiplayerOffer(
  input: GenerateHavocMultiplayerOfferInput,
  environment: HavocMultiplayerDraftEnvironment,
): HavocDraftOffer {
  const {
    catalog,
    rootSeed,
    participantId,
    turnOrdinal,
    offerIndex,
    claimedPlayerIds,
    picks,
    settings,
  } = input;
  if (!Number.isInteger(turnOrdinal) || turnOrdinal < 0 || turnOrdinal >= HAVOC_MULTIPLAYER_TURNS) {
    throw new Error(
      `havoc multiplayer offer turn must be an integer in 0..${String(HAVOC_MULTIPLAYER_TURNS - 1)} (got ${String(turnOrdinal)})`,
    );
  }
  if (!Number.isInteger(offerIndex) || offerIndex < 0 || offerIndex > 1) {
    throw new Error(`havoc multiplayer offer index must be 0 or 1 (got ${String(offerIndex)})`);
  }
  const logic = havocMultiplayerDraftLogicOf(settings);
  const roundIndex = Math.floor(turnOrdinal / 2);
  const round = roundIndex + 1;
  const slot = POSITIONS[roundIndex];
  if (slot === undefined) {
    throw new Error(`havoc multiplayer turn ${String(turnOrdinal)} has no draft slot`);
  }

  const assignments =
    logic === 'curated'
      ? havocMultiplayerCuratedAssignments(rootSeed, environment.rngFactory)
      : null;
  const requirementFor = (
    forParticipant: HavocMultiplayerParticipantId,
    forRoundIndex: number,
  ): HavocMultiplayerRequirement => {
    const forSlot = POSITIONS[forRoundIndex];
    if (forSlot === undefined) {
      throw new Error(`havoc multiplayer round ${String(forRoundIndex + 1)} has no draft slot`);
    }
    const band = assignments === null ? null : assignments[forParticipant][forRoundIndex];
    if (band === undefined) {
      throw new Error(
        `curated havoc assignment is missing for ${forParticipant} round ${String(forRoundIndex + 1)}`,
      );
    }
    return { slot: forSlot, band };
  };

  const persons = buildPersonGroups(catalog, new Set(claimedPlayerIds));
  const currentRequirement = requirementFor(participantId, roundIndex);
  const otherOffset = roundIndex + (turnOrdinal % 2 === 1 ? 1 : 0);
  const remainingAfterPick: HavocMultiplayerRequirement[] = [];
  for (let index = roundIndex + 1; index < POSITIONS.length; index += 1) {
    remainingAfterPick.push(requirementFor(participantId, index));
  }
  for (let index = otherOffset; index < POSITIONS.length; index += 1) {
    remainingAfterPick.push(requirementFor(otherParticipant(participantId), index));
  }

  const eligibilityCache = new Map<string, boolean>();
  const eligible: HavocMultiplayerRequirementEligibility = (person, requirement) => {
    if (requirement.band === null) return person.playableSlots.includes(requirement.slot);
    const cacheKey = `${person.playerId}\u0000${requirement.slot}\u0000${requirement.band}`;
    const cached = eligibilityCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const band = requirement.band;
    const result = person.units.some((unit) =>
      unit.variants.some(
        (version) =>
          version.positions.includes(requirement.slot) &&
          havocOverallInCuratedBand(version.originalOverall, band),
      ),
    );
    eligibilityCache.set(cacheKey, result);
    return result;
  };

  const candidates: HavocMultiplayerPersonGroup[] = [];
  const overallsByPersonId = new Map<string, readonly number[]>();
  for (const person of persons) {
    if (!eligible(person, currentRequirement)) continue;
    if (!matchRequirements(remainingAfterPick, persons, eligible, new Set([person.playerId]))) {
      continue;
    }
    candidates.push(person);
    overallsByPersonId.set(person.playerId, eligibleOverallsFor(person, currentRequirement));
  }
  if (candidates.length < HAVOC_OFFER_SIZE) {
    throw new HavocCatalogCoverageError(
      slot,
      `only ${String(candidates.length)} eligible people preserve two-team completion`,
    );
  }

  let pool: HavocMultiplayerPersonGroup[];
  let selectedWindow: HavocOverallWindow | null = null;
  if (logic === 'legacy') {
    pool = [...candidates];
  } else {
    const windows = enumerateHavocOverallWindows(
      candidates.map((person) => overallsByPersonId.get(person.playerId) ?? []),
    );
    if (windows.length === 0) {
      throw new HavocCatalogCoverageError(
        slot,
        `no ±${String(HAVOC_OFFER_TARGET_RADIUS)} target window holds ${String(HAVOC_OFFER_SIZE)} eligible people`,
      );
    }
    const windowRng = environment.rngFactory(
      offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'window'),
    );
    const window = windowRng.pick(windows);
    selectedWindow = window;
    pool = candidates.filter((person) =>
      (overallsByPersonId.get(person.playerId) ?? []).some((overall) =>
        havocOverallInWindow(overall, window),
      ),
    );
    if (pool.length < HAVOC_OFFER_SIZE) {
      throw new HavocCatalogCoverageError(
        slot,
        `only ${String(pool.length)} eligible people hold the selected overall window`,
      );
    }
  }

  const playersRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'players'),
  );
  const versionRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'version'),
  );
  const tierRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'tier'),
  );
  const mutationsRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'mutations'),
  );
  const physicalRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'physical'),
  );
  const specialistRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'specialist'),
  );
  const nicknameRng = environment.rngFactory(
    offerStreamSeed(rootSeed, participantId, turnOrdinal, offerIndex, 'nickname'),
  );

  const chosen: {
    readonly person: HavocMultiplayerPersonGroup;
    readonly unit: HavocMultiplayerSeasonUnit;
    readonly version: HavocAdaptedCandidate;
  }[] = [];
  for (let cardIndex = 0; cardIndex < HAVOC_OFFER_SIZE; cardIndex += 1) {
    const swapIndex = playersRng.nextInt(cardIndex, pool.length - 1);
    swapAt(pool, cardIndex, swapIndex);
    const person = pool[cardIndex];
    if (person === undefined) throw new Error('havoc multiplayer offer person pool underflow');
    const units = person.units.filter((unit) =>
      unit.variants.some((version) =>
        versionEligibleForCard(version, currentRequirement, selectedWindow),
      ),
    );
    if (units.length === 0) {
      throw new Error(`havoc multiplayer offer has no ${slot} season for ${person.playerId}`);
    }
    const unit = playersRng.pick(units);
    const variants = unit.variants.filter((version) =>
      versionEligibleForCard(version, currentRequirement, selectedWindow),
    );
    if (variants.length === 0) {
      throw new Error(`havoc multiplayer offer has no ${slot} variant for ${unit.claimKey}`);
    }
    chosen.push({ person, unit, version: versionRng.pick(variants) });
  }

  const ownedExclusive = ownedTeamExclusiveMutationIdsOfPicks(
    picks,
    participantId,
    environment.definitions,
  );
  const bundlesByTier = new Map<HavocTier, readonly HavocCompatibleBundle[]>([
    [1, enumerateHavocBundles(environment.definitions, 1)],
    [2, enumerateHavocBundles(environment.definitions, 2)],
    [
      3,
      enumerateHavocBundles(environment.definitions, 3).filter(
        (bundle) =>
          ownedExclusive.length === 0 ||
          bundle.mutationIds.every((mutationId) => !ownedExclusive.includes(mutationId)),
      ),
    ],
  ]);

  const prepared: Array<Omit<HavocDraftCard, 'offerId'>> = [];
  for (let cardIndex = 0; cardIndex < HAVOC_OFFER_SIZE; cardIndex += 1) {
    const choice = chosen[cardIndex];
    if (choice === undefined) throw new Error('havoc multiplayer offer card choice underflow');
    const tier = drawHavocCardTier(tierRng);
    const bundles = bundlesByTier.get(tier) ?? [];
    if (bundles.length === 0) {
      throw new Error(`no compatible havoc mutation bundles are defined for tier ${String(tier)}`);
    }
    const bundle = mutationsRng.pick(bundles);
    const mutations = materializeHavocBundle(
      bundle,
      physicalRng,
      specialistRng,
      environment.definitions,
    );
    const nickname = generateHavocNickname({ slot, tier, mutations }, nicknameRng);
    const effective = applyHavocMutationPackage(choice.version, mutations, { slot });
    const cardId = `hvc-${seasonDigestHex(
      canonicalJson({
        rootSeed,
        participantId,
        turnOrdinal,
        offerIndex,
        cardIndex,
        slot,
        playerId: choice.person.playerId,
        seasonKey: choice.unit.seasonKey,
        playerVersionId: choice.version.playerVersionId,
        tier,
        mutations,
      }),
    )}`;
    prepared.push({
      cardId,
      cardIndex,
      slot,
      tier,
      source: choice.version,
      mutations,
      effective,
      nickname,
    });
  }

  const offerId = `hvo-${seasonDigestHex(
    canonicalJson({
      rootSeed,
      participantId,
      turnOrdinal,
      offerIndex,
      slot,
      cardIds: prepared.map((card) => card.cardId),
    }),
  )}`;
  return havocDraftOfferSchema.parse({
    offerId,
    offerIndex,
    round,
    slot,
    cards: prepared.map((card) => ({ ...card, offerId })),
  });
}

export function createHavocMultiplayerDraft(
  rootSeed: Seed,
  catalog: HavocCatalog,
  environment: HavocMultiplayerDraftEnvironment,
  settings: HavocMultiplayerDraftSettings,
): HavocMultiplayerDraftState {
  const firstPicker = havocMultiplayerByteDraw(rootSeed, 0);
  const offer = generateHavocMultiplayerOffer(
    {
      catalog,
      rootSeed,
      participantId: firstPicker,
      turnOrdinal: 0,
      offerIndex: 0,
      claimedPlayerIds: [],
      picks: [],
      settings,
    },
    environment,
  );
  return havocMultiplayerDraftStateSchema.parse({
    schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
    revision: 0,
    rootSeed,
    firstPicker,
    turnOrdinal: 0,
    activeParticipantId: firstPicker,
    offer,
    rerollsUsed: { p1: 0, p2: 0 },
    picks: [],
    claimedPlayerIds: [],
    status: 'drafting',
  });
}

function reject(
  state: HavocMultiplayerDraftState,
  rejectionCode: HavocMultiplayerCommandRejectionCode,
): HavocMultiplayerDraftCommandOutcome {
  return {
    state,
    receipt: { accepted: false, rejectionCode, revision: state.revision },
  };
}

function accept(nextState: HavocMultiplayerDraftState): HavocMultiplayerDraftCommandOutcome {
  return {
    state: nextState,
    receipt: { accepted: true, rejectionCode: null, revision: nextState.revision },
  };
}

function applyPick(
  state: HavocMultiplayerDraftState,
  payload: Extract<HavocMultiplayerDraftCommandPayload, { kind: 'pick' | 'timeout-pick' }>,
  catalog: HavocCatalog,
  environment: HavocMultiplayerDraftEnvironment,
  settings: HavocMultiplayerDraftSettings,
): HavocMultiplayerDraftCommandOutcome {
  const offer = state.offer;
  const activeParticipantId = state.activeParticipantId;
  if (offer === null || activeParticipantId === null) return reject(state, 'invalid-phase');
  const card = offer.cards.find((candidate) => candidate.cardId === payload.cardId);
  if (card === undefined) return reject(state, 'card-unavailable');
  if (payload.kind === 'pick') {
    if (
      payload.claimKey.playerId !== card.source.playerId ||
      payload.claimKey.seasonKey !== card.source.seasonKey
    ) {
      return reject(state, 'offer-mismatch');
    }
  }
  if (state.claimedPlayerIds.includes(card.source.playerId)) return reject(state, 'claim-taken');
  const seasonKey = card.source.seasonKey;
  if (seasonKey === null) return reject(state, 'card-unavailable');
  const pick: HavocMultiplayerDraftPick = {
    turnOrdinal: state.turnOrdinal,
    participantId: activeParticipantId,
    slot: offer.slot,
    claimKey: { playerId: card.source.playerId, seasonKey },
    card,
  };
  const picks = [...state.picks, pick];
  const claimedPlayerIds = [...state.claimedPlayerIds, card.source.playerId];
  const revision = state.revision + 1;
  if (picks.length >= HAVOC_MULTIPLAYER_TURNS) {
    return accept(
      havocMultiplayerDraftStateSchema.parse({
        ...state,
        revision,
        turnOrdinal: HAVOC_MULTIPLAYER_TURNS,
        activeParticipantId: null,
        offer: null,
        picks,
        claimedPlayerIds,
        status: 'complete',
      }),
    );
  }
  const turnOrdinal = state.turnOrdinal + 1;
  const nextParticipantId = pickerFor(state.firstPicker, turnOrdinal);
  const nextOffer = generateHavocMultiplayerOffer(
    {
      catalog,
      rootSeed: state.rootSeed,
      participantId: nextParticipantId,
      turnOrdinal,
      offerIndex: 0,
      claimedPlayerIds,
      picks,
      settings,
    },
    environment,
  );
  return accept(
    havocMultiplayerDraftStateSchema.parse({
      ...state,
      revision,
      turnOrdinal,
      activeParticipantId: nextParticipantId,
      offer: nextOffer,
      picks,
      claimedPlayerIds,
    }),
  );
}

function applyReroll(
  state: HavocMultiplayerDraftState,
  payload: Extract<HavocMultiplayerDraftCommandPayload, { kind: 'reroll' }>,
  catalog: HavocCatalog,
  environment: HavocMultiplayerDraftEnvironment,
  settings: HavocMultiplayerDraftSettings,
): HavocMultiplayerDraftCommandOutcome {
  const offer = state.offer;
  const activeParticipantId = state.activeParticipantId;
  if (offer === null || activeParticipantId === null) return reject(state, 'invalid-phase');
  if (state.rerollsUsed[activeParticipantId] >= HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT) {
    return reject(state, 'reroll-unavailable');
  }
  const nextOffer = generateHavocMultiplayerOffer(
    {
      catalog,
      rootSeed: state.rootSeed,
      participantId: activeParticipantId,
      turnOrdinal: state.turnOrdinal,
      offerIndex: 1,
      claimedPlayerIds: state.claimedPlayerIds,
      picks: state.picks,
      settings,
    },
    environment,
  );
  const rerollsUsed =
    activeParticipantId === 'p1'
      ? { p1: HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT, p2: state.rerollsUsed.p2 }
      : { p1: state.rerollsUsed.p1, p2: HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT };
  return accept(
    havocMultiplayerDraftStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      offer: nextOffer,
      rerollsUsed,
    }),
  );
}

export function applyHavocMultiplayerDraftCommand(
  state: HavocMultiplayerDraftState,
  payload: HavocMultiplayerCommandPayload,
  catalog: HavocCatalog,
  environment: HavocMultiplayerDraftEnvironment,
  settings: HavocMultiplayerDraftSettings,
): HavocMultiplayerDraftCommandOutcome {
  if (payload.kind !== 'pick' && payload.kind !== 'reroll' && payload.kind !== 'timeout-pick') {
    return reject(state, 'unknown-command');
  }
  if (state.status !== 'drafting') return reject(state, 'invalid-phase');
  if (payload.turnOrdinal !== state.turnOrdinal) return reject(state, 'wrong-turn');
  if (state.offer === null || payload.offerId !== state.offer.offerId) {
    return reject(state, 'offer-mismatch');
  }
  if (payload.kind === 'reroll') {
    return applyReroll(state, payload, catalog, environment, settings);
  }
  return applyPick(state, payload, catalog, environment, settings);
}

export interface HavocMultiplayerDraftReplayInput {
  readonly rootSeed: Seed;
  readonly catalog: HavocCatalog;
  readonly environment: HavocMultiplayerDraftEnvironment;
  readonly commands: readonly HavocMultiplayerCommandPayload[];
  readonly settings: HavocMultiplayerDraftSettings;
}

export function replayHavocMultiplayerDraft(
  input: HavocMultiplayerDraftReplayInput,
): HavocMultiplayerDraftState {
  let state = createHavocMultiplayerDraft(
    input.rootSeed,
    input.catalog,
    input.environment,
    input.settings,
  );
  for (const payload of input.commands) {
    if (payload.kind !== 'pick' && payload.kind !== 'reroll' && payload.kind !== 'timeout-pick') {
      continue;
    }
    const outcome = applyHavocMultiplayerDraftCommand(
      state,
      payload,
      input.catalog,
      input.environment,
      input.settings,
    );
    if (!outcome.receipt.accepted) {
      throw new Error(
        `havoc multiplayer draft replay rejected ${payload.kind} at turn ${String(payload.turnOrdinal)}: ${String(outcome.receipt.rejectionCode)}`,
      );
    }
    state = outcome.state;
  }
  return state;
}

export function havocMultiplayerTimeoutPick(
  state: HavocMultiplayerDraftState,
  catalog: HavocCatalog,
  environment: HavocMultiplayerDraftEnvironment,
): HavocDraftCard {
  const offer = state.offer;
  if (state.status !== 'drafting' || offer === null) {
    throw new Error('havoc multiplayer timeout pick requires an active draft offer');
  }
  // The offer revision is the state revision carrying the offer, so both clients
  // resolve the same fallback card for a given accepted log.
  const rng = environment.rngFactory(
    havocMultiplayerTimeoutSeed(state.rootSeed, state.turnOrdinal, state.revision),
  );
  return rng.pick(offer.cards);
}

function copyEffectiveProfile(profile: HavocDraftCard['effective']): HavocDraftCard['effective'] {
  return {
    ratings: { ...profile.ratings },
    tendencies: { ...profile.tendencies },
    physical: { ...profile.physical },
    authoritativeChannels: [...profile.authoritativeChannels],
  };
}

function instanceIdOf(seed: Seed, purpose: string, ...keys: readonly (string | number)[]): string {
  return havocInstanceIdSchema.parse(`hvi-${havocInstanceSeed(seed, purpose, ...keys)}`);
}

export interface BuildHavocMultiplayerTeamInput {
  readonly participantId: HavocMultiplayerParticipantId;
  readonly side: HavocHomeAway;
  readonly teamId: string;
  readonly displayName: string;
  readonly picks: readonly HavocMultiplayerDraftPick[];
  readonly rootSeed: Seed;
}

export function buildHavocMultiplayerTeam(
  input: BuildHavocMultiplayerTeamInput,
): HavocBattleTeamInput {
  const bySlot = new Map<Position, HavocMultiplayerDraftPick>();
  for (const pick of input.picks) {
    if (pick.participantId !== input.participantId) continue;
    if (bySlot.has(pick.slot)) {
      throw new Error(
        `havoc multiplayer team ${input.participantId} has two picks for ${pick.slot}`,
      );
    }
    bySlot.set(pick.slot, pick);
  }
  if (bySlot.size !== POSITIONS.length) {
    throw new Error(
      `havoc multiplayer team ${input.participantId} requires five picks (got ${String(bySlot.size)})`,
    );
  }
  const starters: HavocBattleTeamInput['starters'] = [];
  const replacements: HavocBattleTeamInput['replacements'] = [];
  const clones: HavocBattleTeamInput['clones'] = [];
  for (let slotIndex = 0; slotIndex < POSITIONS.length; slotIndex += 1) {
    const slot = POSITIONS[slotIndex];
    if (slot === undefined) throw new Error('havoc multiplayer team slot underflow');
    const pick = bySlot.get(slot);
    if (pick === undefined) {
      throw new Error(`havoc multiplayer team ${input.participantId} is missing ${slot}`);
    }
    const starterInstanceId = instanceIdOf(
      input.rootSeed,
      'multiplayer-starter',
      input.participantId,
      slotIndex,
    );
    starters.push({
      instanceId: starterInstanceId,
      kind: 'starter',
      slot,
      ownerInstanceId: null,
      mutationPackage: pick.card.mutations.map((entry) => ({ ...entry })),
      source: pick.card.source,
      effective: copyEffectiveProfile(pick.card.effective),
    });
    replacements.push({
      instanceId: instanceIdOf(
        input.rootSeed,
        'multiplayer-replacement',
        input.participantId,
        slotIndex,
      ),
      kind: 'replacement',
      slot,
      ownerInstanceId: starterInstanceId,
      mutationPackage: [],
      source: pick.card.source,
      effective: applyHavocMutationPackage(pick.card.source, [], { slot }),
    });
    if (pick.card.mutations.some((entry) => entry.mutationId === 'clone-army')) {
      clones.push({
        instanceId: instanceIdOf(
          input.rootSeed,
          'multiplayer-clone',
          input.participantId,
          slotIndex,
        ),
        kind: 'clone',
        slot,
        ownerInstanceId: starterInstanceId,
        mutationPackage: [],
        source: pick.card.source,
        effective: copyEffectiveProfile(pick.card.effective),
      });
    }
  }
  return havocBattleTeamInputSchema.parse({
    side: input.side,
    teamId: input.teamId,
    displayName: input.displayName,
    starters,
    replacements,
    clones,
  });
}

export interface BuildHavocMultiplayerGameInputInput {
  readonly rootSeed: Seed;
  readonly gameNumber: number;
  readonly homeTeam: HavocBattleTeamInput;
  readonly awayTeam: HavocBattleTeamInput;
  readonly profile: EraSimulationProfile;
  readonly versionSet: HavocVersionSet;
}

export function buildHavocMultiplayerGameInput(
  input: BuildHavocMultiplayerGameInputInput,
): HavocBattleInput {
  return havocBattleInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: input.gameNumber,
    variant: 'havoc',
    seed: havocMultiplayerGameSeed(input.rootSeed, input.gameNumber),
    profile: input.profile,
    home: { ...input.homeTeam, side: 'home' },
    away: { ...input.awayTeam, side: 'away' },
    versionSet: input.versionSet,
  });
}
