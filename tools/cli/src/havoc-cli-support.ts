import { z } from 'zod';
import {
  HAVOC_DRAFT_ROUNDS,
  HAVOC_GAME_COUNT,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
  POSITIONS,
  canonicalJson,
  commandIdSchema,
  havocCardIdSchema,
  havocCatalogSourceSchema,
  havocClaimKeySchema,
  havocCreateDraftCommandSchema,
  havocDigestSchema,
  havocDraftCardSchema,
  havocDraftPickSchema,
  havocGameSummarySchema,
  havocLockLineupCommandSchema,
  havocMutationEntrySchema,
  havocPickCardCommandSchema,
  havocRerollOfferCommandSchema,
  havocSeasonAggregateSchema,
  havocSeasonTotalsSchema,
  havocSourcePlayerSchema,
  havocTierSchema,
  havocVariantSchema,
  havocVersionSetSchema,
  idSchema,
  playerIdSchema,
  playerVersionIdSchema,
  positionSchema,
  seasonDigestHex,
  seedSchema,
  type EraSimulationProfile,
  type HavocCatalog,
  type HavocCatalogSource,
  type HavocCommand,
  type HavocDraftCard,
  type HavocDraftPick,
  type HavocGameInput,
  type HavocGameResult,
  type HavocGameSummary,
  type HavocGameTape,
  type HavocLockedInputs,
  type HavocMutationEntry,
  type HavocMutationId,
  type HavocMutationRollup,
  type HavocRunState,
  type HavocSeasonAggregate,
  type HavocSeasonTotals,
  type HavocVariant,
  type HavocVersionSet,
  type OpponentBracket,
  type Position,
  type SeasonDraftCatalog,
  type Seed,
} from '@hoop-rush/data-contracts';
import {
  AdaptHavocCatalog,
  ApplyHavocCommand,
  CreateHavocRunState,
  ENGINE_VERSION,
  FoldHavocAggregate,
  HavocSimulationExhaustedError,
  HavocStateDigest,
  applyHavocMutationPackage,
  auditHavocGame,
  buildHavocGameInput,
  buildHavocLockedInputs,
  createEngineContext,
  createHavocCommandEnvironment,
  havocBundleIsCompatible,
  havocGameInputDigest,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
  HAVOC_MUTATION_DEFINITIONS,
  simulateHavocGame,
  type EngineContext,
  type HavocCommandEnvironment,
  type HavocLockSources,
} from '@hoop-rush/engine';
import { DEFAULT_MANIFEST, PackagedData, loadPackagedData } from './commands/data-loader.ts';
import { loadSeasonDraftCatalog, resolveSeasonArtifact } from './commands/season-data.ts';

export const HAVOC_CLI_ERA_ID = '2010s';
export const HAVOC_CLI_REPORT_DIGEST_PREFIX = 'havoc-cli-report-v1';
export const HAVOC_CLI_CALIBRATION_BASE = 'hoop-rush/havoc/calibrate-v1';
/** Matches ENGINE_CONSTANTS.shotClockSeconds; only used to label an unobserved full clock. */
export const HAVOC_CLI_DEFAULT_FULL_SHOT_CLOCK_SECONDS = 24;

export class HavocCliError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HavocCliError';
    this.code = code;
  }
}

// ---------------------------------------------------------------- assets

export interface HavocCliAssets {
  readonly manifestPath: string;
  readonly catalog: SeasonDraftCatalog;
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
  readonly source: HavocCatalogSource;
  readonly versionSet: HavocVersionSet;
}

export function havocCatalogSourceOf(
  catalog: SeasonDraftCatalog,
  catalogHash: string,
): HavocCatalogSource {
  return havocCatalogSourceSchema.parse({
    catalogVersion: catalog.catalogVersion,
    catalogHash,
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  });
}

export function havocVersionSetOf(input: {
  catalog: SeasonDraftCatalog;
  catalogHash: string;
  bracketHash: string;
  profile: EraSimulationProfile;
  profileHash: string;
}): HavocVersionSet {
  return havocVersionSetSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
    engineVersion: ENGINE_VERSION,
    profileVersion: input.profile.profileVersion,
    dataVersion: input.catalog.dataVersion,
    catalogVersion: input.catalog.catalogVersion,
    catalogHash: input.catalogHash,
    bracketHash: input.bracketHash,
    profileHash: input.profileHash,
  });
}

export function loadHavocCliAssets(manifestPath: string = DEFAULT_MANIFEST): HavocCliAssets {
  const packaged = loadPackagedData(manifestPath);
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const catalog = loadSeasonDraftCatalog(manifestPath);
  const bracket = data.bracket();
  const profile = data.eraProfile(HAVOC_CLI_ERA_ID);
  const catalogRef = resolveSeasonArtifact(manifestPath, 'draftCatalog');
  const bracketRef = packaged.manifest.bracket;
  if (bracketRef === undefined) {
    throw new HavocCliError('assets', `manifest ${manifestPath} has no bracket entry`);
  }
  const profileRef = packaged.manifest.eraSimulationProfiles.find(
    (entry) => entry.eraId === HAVOC_CLI_ERA_ID,
  );
  if (profileRef === undefined) {
    throw new HavocCliError(
      'assets',
      `manifest ${manifestPath} has no ${HAVOC_CLI_ERA_ID} era simulation profile`,
    );
  }
  const source = havocCatalogSourceOf(catalog, catalogRef.contentHash);
  const versionSet = havocVersionSetOf({
    catalog,
    catalogHash: catalogRef.contentHash,
    bracketHash: bracketRef.contentHash,
    profile,
    profileHash: profileRef.contentHash,
  });
  return { manifestPath, catalog, bracket, profile, source, versionSet };
}

export function adaptHavocCliCatalog(assets: {
  readonly catalog: SeasonDraftCatalog;
  readonly source: HavocCatalogSource;
}): HavocCatalog {
  return AdaptHavocCatalog(assets.catalog, assets.source);
}

export function havocCliLockSourcesOf(assets: HavocCliAssets): HavocLockSources {
  return { bracket: assets.bracket, profile: assets.profile };
}

// ----------------------------------------------------------------- draft

export interface HavocCliDraftPin {
  readonly slot: Position;
  readonly playerVersionId: string;
}

export interface HavocCliDraftPlan {
  /** Null selects the first card of every offer (the default auto-pick policy). */
  readonly pins: readonly HavocCliDraftPin[] | null;
  /** Null lets a pinned pick spend the single reroll only when it is required. */
  readonly rerollRound: number | null;
}

export interface HavocCliDraftReplay {
  readonly state: HavocRunState;
  readonly locked: HavocLockedInputs;
  readonly commands: readonly HavocCommand[];
  readonly rerollRoundUsed: number | null;
  readonly plan: HavocCliDraftPlan;
}

export function havocCliRunIdOf(seed: Seed): string {
  return idSchema.parse(`havoc-cli-${seed.slice(0, 16)}`);
}

function havocCliCommandId(seed: Seed, suffix: string): string {
  return commandIdSchema.parse(`havoc-cli-${seed.slice(0, 8)}-${suffix}`);
}

function requireDraftState(state: HavocRunState): NonNullable<HavocRunState['draft']> {
  if (state.draft === null) {
    throw new HavocCliError('draft-phase', `run ${state.runId} has no draft state`);
  }
  return state.draft;
}

function applyOrThrow(
  state: HavocRunState,
  command: HavocCommand,
  environment: HavocCommandEnvironment,
  lockSources: HavocLockSources,
): HavocRunState {
  const outcome = ApplyHavocCommand(state, command, environment, lockSources);
  if (outcome.result.status !== 'accepted') {
    const rejection = outcome.result.rejection;
    throw new HavocCliError(
      'command-rejected',
      `havoc command ${command.command} (${command.commandId}) was rejected: ${rejection?.code ?? 'unknown'} ${rejection?.message ?? ''}`,
    );
  }
  return outcome.state;
}

function cardForPin(
  draft: NonNullable<HavocRunState['draft']>,
  pin: HavocCliDraftPin,
): HavocDraftCard | undefined {
  return draft.cards.find((card) => card.source.playerVersionId === pin.playerVersionId);
}

export function replayHavocCliDraft(input: {
  readonly runId: string;
  readonly runSeed: Seed;
  readonly versionSet: HavocVersionSet;
  readonly catalog: HavocCatalog;
  readonly environment: HavocCommandEnvironment;
  readonly lockSources: HavocLockSources;
  readonly plan: HavocCliDraftPlan;
}): HavocCliDraftReplay {
  const { runId, runSeed, versionSet, catalog, environment, lockSources, plan } = input;
  const pins = plan.pins;
  if (pins !== null) {
    if (pins.length !== HAVOC_DRAFT_ROUNDS) {
      throw new HavocCliError(
        'picks',
        `picks must pin exactly five slots (got ${String(pins.length)})`,
      );
    }
    pins.forEach((pin, index) => {
      const expected = POSITIONS[index];
      if (pin.slot !== expected) {
        throw new HavocCliError(
          'picks',
          `picks[${String(index)}] must fill ${String(expected)} (got ${String(pin.slot)})`,
        );
      }
    });
  }
  if (
    plan.rerollRound !== null &&
    (plan.rerollRound < 1 || plan.rerollRound > HAVOC_DRAFT_ROUNDS)
  ) {
    throw new HavocCliError('picks', 'rerollRound must be an integer from 1..5');
  }
  const createCommand = havocCreateDraftCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: havocCliCommandId(runSeed, 'create'),
    runId,
    command: 'create-havoc-draft',
    runSeed,
    versionSet,
    catalog: catalog.source,
  });
  let state = CreateHavocRunState(createCommand, catalog, environment);
  const commands: HavocCommand[] = [createCommand];
  let rerollRoundUsed: number | null = null;
  for (let round = 1; round <= HAVOC_DRAFT_ROUNDS; round += 1) {
    let draft = requireDraftState(state);
    const pin = pins?.[round - 1];
    const rerollSpent = draft.rerollUsed;
    const explicitReroll = !rerollSpent && plan.rerollRound === round;
    const autoReroll =
      !rerollSpent &&
      plan.rerollRound === null &&
      pin !== undefined &&
      cardForPin(draft, pin) === undefined;
    if (explicitReroll || autoReroll) {
      const rerollCommand = havocRerollOfferCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: havocCliCommandId(runSeed, `reroll-${String(round)}`),
        runId,
        expectedRevision: state.revision,
        command: 'reroll-havoc-offer',
        offerId: draft.offerId,
      });
      state = applyOrThrow(state, rerollCommand, environment, lockSources);
      commands.push(rerollCommand);
      rerollRoundUsed = round;
      draft = requireDraftState(state);
    }
    const card = pin === undefined ? draft.cards[0] : cardForPin(draft, pin);
    if (card === undefined) {
      const available = draft.cards.map((entry) => entry.source.playerVersionId ?? 'null');
      throw new HavocCliError(
        'pin-missing',
        `round ${String(round)} (${String(draft.slot)}) offer does not contain pinned version ${String(pin?.playerVersionId)}; available: ${available.join(', ')}${draft.rerollUsed ? ' (reroll spent)' : ''}`,
      );
    }
    const pickCommand = havocPickCardCommandSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: havocCliCommandId(runSeed, `pick-${String(round)}`),
      runId,
      expectedRevision: state.revision,
      command: 'pick-havoc-card',
      offerId: draft.offerId,
      cardId: card.cardId,
    });
    state = applyOrThrow(state, pickCommand, environment, lockSources);
    commands.push(pickCommand);
  }
  const completed = requireDraftState(state);
  const lockCommand = havocLockLineupCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: havocCliCommandId(runSeed, 'lock'),
    runId,
    expectedRevision: state.revision,
    command: 'lock-havoc-lineup',
    picks: completed.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
  });
  state = applyOrThrow(state, lockCommand, environment, lockSources);
  commands.push(lockCommand);
  if (state.locked === null) {
    throw new HavocCliError('lock', 'lock-havoc-lineup accepted without locked inputs');
  }
  return { state, locked: state.locked, commands, rerollRoundUsed, plan };
}

export function havocCliLineupOf(picks: readonly HavocDraftPick[]): HavocCliLineupEntry[] {
  return picks.map((pick) => ({
    slot: pick.slot,
    playerId: pick.card.source.playerId,
    playerVersionId: pick.card.source.playerVersionId,
    displayName: pick.card.source.displayName,
    nickname: pick.card.nickname,
    tier: pick.card.tier,
    mutations: pick.card.mutations.map((entry) => ({ ...entry })),
    cardId: pick.card.cardId,
    claimKey: {
      playerId: pick.claimKey.playerId,
      seasonKey: pick.claimKey.seasonKey,
    },
    originalOverall: pick.card.source.originalOverall,
  }));
}

// ---------------------------------------------------- constructed lineups

export interface HavocCliConstructedSlot {
  readonly slot: Position;
  readonly tier: 1 | 2 | 3;
  readonly mutationIds: readonly HavocMutationId[];
}

export function materializeHavocCliPackage(
  mutationIds: readonly HavocMutationId[],
): HavocMutationEntry[] {
  return mutationIds.map((mutationId) =>
    mutationId === 'growth-spurt' ? { mutationId, sampledHeightDelta: 8 } : { mutationId },
  );
}

export function assertHavocCliPackageCompatible(
  tier: 1 | 2 | 3,
  mutationIds: readonly HavocMutationId[],
): void {
  if (!havocBundleIsCompatible({ tier, mutationIds }, HAVOC_MUTATION_DEFINITIONS)) {
    throw new HavocCliError(
      'constructed-package',
      `constructed tier ${String(tier)} package [${mutationIds.join(', ')}] is not a compatible mutation bundle`,
    );
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildConstructedHavocLockedInputs(input: {
  readonly catalog: HavocCatalog;
  readonly runId: string;
  readonly runSeed: Seed;
  readonly versionSet: HavocVersionSet;
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
  readonly slots: readonly HavocCliConstructedSlot[];
  readonly label: string;
}): HavocLockedInputs {
  const usedClaims = new Set<string>();
  const picks: HavocDraftPick[] = [];
  for (const [index, slotSpec] of input.slots.entries()) {
    const expected = POSITIONS[index];
    if (slotSpec.slot !== expected) {
      throw new HavocCliError(
        'constructed-lineup',
        `constructed slot ${String(index)} must be ${String(expected)} (got ${String(slotSpec.slot)})`,
      );
    }
    assertHavocCliPackageCompatible(slotSpec.tier, slotSpec.mutationIds);
    const candidates = input.catalog.candidates
      .filter(
        (candidate) =>
          candidate.positions.includes(slotSpec.slot) &&
          candidate.seasonKey !== null &&
          !usedClaims.has(`${candidate.playerId}::${String(candidate.seasonKey)}`),
      )
      .sort(
        (left, right) =>
          right.originalOverall - left.originalOverall ||
          compareStrings(left.playerVersionId ?? '', right.playerVersionId ?? '') ||
          compareStrings(left.playerId, right.playerId),
      );
    const candidate = candidates[0];
    if (candidate === undefined || candidate.seasonKey === null) {
      throw new HavocCliError(
        'constructed-lineup',
        `catalog has no eligible constructed candidate for ${String(slotSpec.slot)}`,
      );
    }
    usedClaims.add(`${candidate.playerId}::${candidate.seasonKey}`);
    const mutations = materializeHavocCliPackage(slotSpec.mutationIds);
    const source = havocSourcePlayerSchema.parse(candidate);
    const effective = applyHavocMutationPackage(source, mutations, { slot: slotSpec.slot });
    const card = havocDraftCardSchema.parse({
      cardId: `hvc-${seasonDigestHex(
        canonicalJson({
          label: input.label,
          slot: slotSpec.slot,
          playerVersionId: candidate.playerVersionId,
          tier: slotSpec.tier,
          mutations,
        }),
      )}`,
      offerId: `hvo-${seasonDigestHex(
        canonicalJson({ label: input.label, slot: slotSpec.slot }),
      )}`,
      cardIndex: 0,
      slot: slotSpec.slot,
      tier: slotSpec.tier,
      source,
      mutations,
      effective,
      nickname: `${input.label} ${slotSpec.slot}`,
    });
    picks.push(
      havocDraftPickSchema.parse({
        pickOrdinal: index,
        slot: slotSpec.slot,
        claimKey: havocClaimKeySchema.parse({
          playerId: candidate.playerId,
          seasonKey: candidate.seasonKey,
        }),
        card,
      }),
    );
  }
  return buildHavocLockedInputs({
    runId: input.runId,
    runSeed: input.runSeed,
    versionSet: input.versionSet,
    picks,
    bracket: input.bracket,
    profile: input.profile,
  });
}

// ------------------------------------------------------------ simulation

export interface HavocCliGameEntry {
  readonly gameNumber: number;
  readonly opponentId: string;
  readonly humanHome: boolean;
  readonly seed: Seed;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly tapeDigest: string;
  readonly summary: HavocGameSummary;
}

export interface HavocCliFailure {
  readonly variant: HavocVariant;
  readonly gameNumber: number;
  readonly code: string;
  readonly message: string;
}

export interface HavocCliGameFacts {
  readonly variant: HavocVariant;
  readonly gameNumber: number;
  readonly seed: Seed;
  readonly outcome: 'win' | 'loss';
  readonly humanScore: number;
  readonly opponentScore: number;
  readonly margin: number;
  readonly humanTurnovers: number;
  readonly opponentTurnovers: number;
  readonly humanRebounds: number;
  readonly opponentRebounds: number;
  readonly humanOffensiveRebounds: number;
  readonly opponentOffensiveRebounds: number;
  readonly humanFouls: number;
  readonly opponentFouls: number;
  readonly humanAssists: number;
  readonly opponentAssists: number;
  readonly humanFieldGoalsMade: number;
  readonly humanFieldGoalsAttempted: number;
  readonly humanThreesMade: number;
  readonly humanThreesAttempted: number;
  readonly humanFreeThrowsAttempted: number;
  readonly opponentFieldGoalsMade: number;
  readonly opponentFieldGoalsAttempted: number;
  readonly humanAdjustments: number;
  readonly humanShotClockViolations: number;
  readonly opponentShotClockViolations: number;
  readonly overtimePeriods: number;
  readonly cloneSeconds: number;
  readonly clonePoints: number;
  readonly cloneRebounds: number;
  readonly cloneAssists: number;
  readonly humanFullShotClock: number | null;
  readonly opponentFullShotClock: number | null;
  readonly rollups: readonly HavocMutationRollup[];
  readonly auditFindings: number;
}

export interface HavocCliVariantRun {
  readonly variant: HavocVariant;
  readonly games: readonly HavocCliGameEntry[];
  readonly aggregate: HavocSeasonAggregate;
  readonly facts: readonly HavocCliGameFacts[];
  readonly failures: readonly HavocCliFailure[];
  readonly auditFindings: number;
}

export function havocCliGameNumbers(count: number = HAVOC_GAME_COUNT): number[] {
  if (!Number.isInteger(count) || count < 1 || count > HAVOC_GAME_COUNT) {
    throw new HavocCliError(
      'games',
      `game count must be an integer from 1..${String(HAVOC_GAME_COUNT)} (got ${String(count)})`,
    );
  }
  return Array.from({ length: count }, (_value, index) => index + 1);
}

function humanAndOpponent(
  input: HavocGameInput,
  result: HavocGameResult,
): { human: HavocGameResult['home']; opponent: HavocGameResult['home'] } {
  return result.humanSide === 'home'
    ? { human: result.home, opponent: result.away }
    : { human: result.away, opponent: result.home };
}

function shotClockViolationsOf(tape: HavocGameTape, side: 'human' | 'opponent'): number {
  let count = 0;
  for (const event of tape.events) {
    if (event.kind === 'shot-clock-violation' && event.offenseSide === side) count += 1;
  }
  return count;
}

function fullShotClockOf(tape: HavocGameTape, side: 'human' | 'opponent'): number | null {
  let limit: number | null = null;
  for (const event of tape.events) {
    if (event.kind === 'time-lord' && event.side === side) limit = event.fullSeconds;
  }
  return limit;
}

function factsOf(
  input: HavocGameInput,
  result: HavocGameResult,
  tape: HavocGameTape,
  summary: HavocGameSummary,
  auditFindings: number,
): HavocCliGameFacts {
  const { human, opponent } = humanAndOpponent(input, result);
  let cloneSeconds = 0;
  let clonePoints = 0;
  let cloneRebounds = 0;
  let cloneAssists = 0;
  for (const line of human.participants) {
    if (line.kind !== 'clone') continue;
    cloneSeconds += line.secondsPlayed;
    clonePoints += line.points;
    cloneRebounds += line.rebounds.total;
    cloneAssists += line.assists;
  }
  return {
    variant: input.variant,
    gameNumber: input.gameNumber,
    seed: input.seed,
    outcome: summary.outcome,
    humanScore: human.points,
    opponentScore: opponent.points,
    margin: human.points - opponent.points,
    humanTurnovers: human.turnovers,
    opponentTurnovers: opponent.turnovers,
    humanRebounds: human.rebounds.total,
    opponentRebounds: opponent.rebounds.total,
    humanOffensiveRebounds: human.rebounds.offensive,
    opponentOffensiveRebounds: opponent.rebounds.offensive,
    humanFouls: human.fouls,
    opponentFouls: opponent.fouls,
    humanAssists: human.assists,
    opponentAssists: opponent.assists,
    humanFieldGoalsMade: human.fieldGoals.made,
    humanFieldGoalsAttempted: human.fieldGoals.attempted,
    humanThreesMade: human.threes.made,
    humanThreesAttempted: human.threes.attempted,
    humanFreeThrowsAttempted: human.freeThrows.attempted,
    opponentFieldGoalsMade: opponent.fieldGoals.made,
    opponentFieldGoalsAttempted: opponent.fieldGoals.attempted,
    humanAdjustments: human.adjustments,
    humanShotClockViolations: shotClockViolationsOf(tape, 'human'),
    opponentShotClockViolations: shotClockViolationsOf(tape, 'opponent'),
    overtimePeriods: result.overtimePeriods,
    cloneSeconds,
    clonePoints,
    cloneRebounds,
    cloneAssists,
    humanFullShotClock: fullShotClockOf(tape, 'human'),
    opponentFullShotClock: fullShotClockOf(tape, 'opponent'),
    rollups: result.rollups.map((rollup) => ({ ...rollup })),
    auditFindings,
  };
}

export function simulateHavocCliVariant(input: {
  readonly locked: HavocLockedInputs;
  readonly variant: HavocVariant;
  readonly gameNumbers: readonly number[];
  readonly context?: EngineContext;
}): HavocCliVariantRun {
  const context = input.context ?? createEngineContext();
  const games: HavocCliGameEntry[] = [];
  const facts: HavocCliGameFacts[] = [];
  const failures: HavocCliFailure[] = [];
  let aggregate: HavocSeasonAggregate = {
    games: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    adjustments: 0,
  };
  let auditFindings = 0;
  for (const gameNumber of input.gameNumbers) {
    const entry = input.locked.schedule[gameNumber - 1];
    if (entry === undefined) {
      throw new HavocCliError(
        'schedule',
        `locked schedule has no entry for game ${String(gameNumber)}`,
      );
    }
    const gameInput = buildHavocGameInput({
      locked: input.locked,
      gameNumber,
      variant: input.variant,
    });
    let result: HavocGameResult;
    let tape: HavocGameTape;
    try {
      ({ result, tape } = simulateHavocGame(gameInput, context));
    } catch (error) {
      if (error instanceof HavocSimulationExhaustedError) {
        failures.push({
          variant: input.variant,
          gameNumber,
          code: error.code,
          message: error.message.slice(0, 512),
        });
        continue;
      }
      throw error;
    }
    const resultDigest = havocGameResultDigest(result);
    const summary = havocGameSummaryOf(result, resultDigest);
    const audit = auditHavocGame(gameInput, result, tape);
    if (!audit.ok) {
      for (const finding of audit.findings) {
        failures.push({
          variant: input.variant,
          gameNumber,
          code: `audit:${finding.code}`.slice(0, 64),
          message: finding.message.slice(0, 512),
        });
      }
      auditFindings += audit.findings.length;
    }
    games.push({
      gameNumber,
      opponentId: entry.opponentId,
      humanHome: entry.humanHome,
      seed: gameInput.seed,
      inputDigest: havocGameInputDigest(gameInput),
      resultDigest,
      tapeDigest: havocGameTapeDigest(tape),
      summary,
    });
    facts.push(factsOf(gameInput, result, tape, summary, audit.findings.length));
    aggregate = FoldHavocAggregate(aggregate, summary);
  }
  return { variant: input.variant, games, aggregate, facts, failures, auditFindings };
}

// ----------------------------------------------------------- comparison

export function havocSeasonTotalsOf(games: readonly HavocGameSummary[]): HavocSeasonTotals {
  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let adjustments = 0;
  let largestPointsFor = Number.NEGATIVE_INFINITY;
  let largestPointsAgainst = Number.NEGATIVE_INFINITY;
  for (const game of games) {
    if (game.outcome === 'win') wins += 1;
    else losses += 1;
    pointsFor += game.humanScore;
    pointsAgainst += game.opponentScore;
    adjustments += game.adjustments;
    largestPointsFor = Math.max(largestPointsFor, game.humanScore);
    largestPointsAgainst = Math.max(largestPointsAgainst, game.opponentScore);
  }
  const count = games.length;
  return havocSeasonTotalsSchema.parse({
    games: count,
    wins,
    losses,
    pointsFor,
    pointsAgainst,
    differential: pointsFor - pointsAgainst,
    averagePointsFor: count === 0 ? 0 : pointsFor / count,
    averagePointsAgainst: count === 0 ? 0 : pointsAgainst / count,
    largestPointsFor: count === 0 ? 0 : largestPointsFor,
    largestPointsAgainst: count === 0 ? 0 : largestPointsAgainst,
    adjustments,
  });
}

export interface HavocCliMatchedGame {
  readonly gameNumber: number;
  readonly opponentId: string;
  readonly humanHome: boolean;
  readonly havoc: {
    readonly humanScore: number;
    readonly opponentScore: number;
    readonly outcome: 'win' | 'loss';
    readonly resultDigest: string;
  };
  readonly normal: {
    readonly humanScore: number;
    readonly opponentScore: number;
    readonly outcome: 'win' | 'loss';
    readonly resultDigest: string;
  };
  readonly deltas: {
    readonly pointsFor: number;
    readonly pointsAgainst: number;
    readonly margin: number;
  };
  readonly flips: {
    readonly havocWinNormalLoss: boolean;
    readonly normalWinHavocLoss: boolean;
  };
}

export interface HavocCliComparison {
  readonly kind: 'paired-evidence';
  readonly havoc: HavocSeasonTotals;
  readonly normal: HavocSeasonTotals;
  readonly winsGained: number;
  readonly differentialDelta: number;
  readonly games: readonly HavocCliMatchedGame[];
}

export function havocCliComparisonOf(
  havoc: HavocCliVariantRun,
  normal: HavocCliVariantRun,
): HavocCliComparison {
  const normalByNumber = new Map(normal.games.map((game) => [game.gameNumber, game]));
  const games: HavocCliMatchedGame[] = [];
  for (const havocGame of havoc.games) {
    const normalGame = normalByNumber.get(havocGame.gameNumber);
    if (normalGame === undefined) {
      throw new HavocCliError(
        'comparison',
        `normal season is missing paired game ${String(havocGame.gameNumber)}`,
      );
    }
    const havocHuman = havocGame.summary.humanScore;
    const havocOpponent = havocGame.summary.opponentScore;
    const normalHuman = normalGame.summary.humanScore;
    const normalOpponent = normalGame.summary.opponentScore;
    games.push({
      gameNumber: havocGame.gameNumber,
      opponentId: havocGame.opponentId,
      humanHome: havocGame.humanHome,
      havoc: {
        humanScore: havocHuman,
        opponentScore: havocOpponent,
        outcome: havocGame.summary.outcome,
        resultDigest: havocGame.resultDigest,
      },
      normal: {
        humanScore: normalHuman,
        opponentScore: normalOpponent,
        outcome: normalGame.summary.outcome,
        resultDigest: normalGame.resultDigest,
      },
      deltas: {
        pointsFor: havocHuman - normalHuman,
        pointsAgainst: havocOpponent - normalOpponent,
        margin: havocHuman - havocOpponent - (normalHuman - normalOpponent),
      },
      flips: {
        havocWinNormalLoss:
          havocGame.summary.outcome === 'win' && normalGame.summary.outcome === 'loss',
        normalWinHavocLoss:
          havocGame.summary.outcome === 'loss' && normalGame.summary.outcome === 'win',
      },
    });
  }
  const havocTotals = havocSeasonTotalsOf(havoc.games.map((game) => game.summary));
  const normalTotals = havocSeasonTotalsOf(normal.games.map((game) => game.summary));
  return {
    kind: 'paired-evidence',
    havoc: havocTotals,
    normal: normalTotals,
    winsGained: havocTotals.wins - normalTotals.wins,
    differentialDelta: havocTotals.differential - normalTotals.differential,
    games,
  };
}

// ------------------------------------------------------- report schemas

export const havocCliLineupEntrySchema = z.object({
  slot: positionSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  displayName: z.string().min(1).max(96),
  nickname: z.string().min(1).max(64),
  tier: havocTierSchema,
  mutations: z.array(havocMutationEntrySchema).max(3),
  cardId: havocCardIdSchema,
  claimKey: havocClaimKeySchema,
  originalOverall: z.number().int().min(0).max(100),
});
export type HavocCliLineupEntry = z.infer<typeof havocCliLineupEntrySchema>;

export const havocCliGameEntrySchema = z.object({
  gameNumber: z.number().int().min(1).max(HAVOC_GAME_COUNT),
  opponentId: z.string().min(1).max(64),
  humanHome: z.boolean(),
  seed: seedSchema,
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  tapeDigest: havocDigestSchema,
  summary: havocGameSummarySchema,
});
export type HavocCliGameEntryReport = z.infer<typeof havocCliGameEntrySchema>;

export const havocCliFailureSchema = z.object({
  variant: havocVariantSchema,
  gameNumber: z.number().int().min(1).max(HAVOC_GAME_COUNT),
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});

export const havocCliDraftPinSchema = z.object({
  slot: positionSchema,
  playerVersionId: playerVersionIdSchema,
});
export type HavocCliDraftPinReport = z.infer<typeof havocCliDraftPinSchema>;

export const havocCliDraftReportSchema = z.object({
  mode: z.enum(['auto', 'pinned']),
  pins: z.array(havocCliDraftPinSchema).length(HAVOC_DRAFT_ROUNDS).nullable(),
  rerollRound: z.number().int().min(1).max(HAVOC_DRAFT_ROUNDS).nullable(),
  rerollUsed: z.boolean(),
  commandCount: z.number().int().nonnegative(),
  lockedDigest: havocDigestSchema,
  stateDigest: havocDigestSchema,
});

export const havocCliVariantReportSchema = z.object({
  variant: havocVariantSchema,
  games: z.array(havocCliGameEntrySchema).min(1).max(HAVOC_GAME_COUNT),
  aggregate: havocSeasonAggregateSchema,
});

export const havocCliMatchedGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(HAVOC_GAME_COUNT),
  opponentId: z.string().min(1).max(64),
  humanHome: z.boolean(),
  havoc: z.object({
    humanScore: z.number().int(),
    opponentScore: z.number().int(),
    outcome: z.enum(['win', 'loss']),
    resultDigest: havocDigestSchema,
  }),
  normal: z.object({
    humanScore: z.number().int(),
    opponentScore: z.number().int(),
    outcome: z.enum(['win', 'loss']),
    resultDigest: havocDigestSchema,
  }),
  deltas: z.object({
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    margin: z.number().int(),
  }),
  flips: z.object({
    havocWinNormalLoss: z.boolean(),
    normalWinHavocLoss: z.boolean(),
  }),
});

export const havocCliComparisonSchema = z.object({
  kind: z.literal('paired-evidence'),
  havoc: havocSeasonTotalsSchema,
  normal: havocSeasonTotalsSchema,
  winsGained: z.number().int(),
  differentialDelta: z.number().int(),
  games: z.array(havocCliMatchedGameSchema).min(1).max(HAVOC_GAME_COUNT),
});

export const havocSimulateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('havoc simulate'),
  reportDigest: havocDigestSchema,
  runId: idSchema,
  runSeed: seedSchema,
  catalog: havocCatalogSourceSchema,
  versionSet: havocVersionSetSchema,
  lineup: z.array(havocCliLineupEntrySchema).length(HAVOC_DRAFT_ROUNDS),
  draft: havocCliDraftReportSchema,
  havoc: havocCliVariantReportSchema,
  normal: havocCliVariantReportSchema.nullable(),
  comparison: havocCliComparisonSchema.nullable(),
  failures: z.array(havocCliFailureSchema),
  audits: z.object({
    games: z.number().int().nonnegative(),
    findings: z.number().int().nonnegative(),
  }),
  pass: z.boolean(),
});
export type HavocSimulateReport = z.infer<typeof havocSimulateReportSchema>;

export const havocAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('havoc audit'),
  input: z.string().min(1),
  reportDigest: z.string().min(1).max(64),
  recomputedReportDigest: z.string().min(1).max(64),
  findings: z.array(z.string().min(1).max(512)).max(200),
  checks: z.object({
    reportSchema: z.boolean(),
    assetsMatch: z.boolean(),
    draftReplay: z.boolean(),
    havocGames: z.number().int().nonnegative(),
    normalGames: z.number().int().nonnegative(),
    paired: z.boolean(),
    aggregates: z.boolean(),
    digests: z.boolean(),
  }),
  pass: z.boolean(),
});
export type HavocAuditReport = z.infer<typeof havocAuditReportSchema>;

export function havocCliReportDigest(report: HavocSimulateReport): string {
  const material = { ...report, reportDigest: undefined };
  return seasonDigestHex(`${HAVOC_CLI_REPORT_DIGEST_PREFIX}\u0000${canonicalJson(material)}`);
}

export function lockedInputsDigest(locked: HavocLockedInputs): string {
  return seasonDigestHex(canonicalJson(locked));
}

// ---------------------------------------------------------------- picks

export const havocCliPicksSchema = z.object({
  schemaVersion: z.literal(1),
  picks: z
    .array(
      z.object({
        slot: positionSchema,
        playerVersionId: playerVersionIdSchema,
      }),
    )
    .length(HAVOC_DRAFT_ROUNDS),
  rerollRound: z.number().int().min(1).max(HAVOC_DRAFT_ROUNDS).nullable().optional(),
});
export type HavocCliPicks = z.infer<typeof havocCliPicksSchema>;

export function havocCliDraftPlanOf(picks: HavocCliPicks | null): HavocCliDraftPlan {
  if (picks === null) return { pins: null, rerollRound: null };
  return {
    pins: picks.picks.map((pick) => ({ slot: pick.slot, playerVersionId: pick.playerVersionId })),
    rerollRound: picks.rerollRound ?? null,
  };
}

// -------------------------------------------------------------- auditing

export interface HavocCliReplayedRun {
  readonly locked: HavocLockedInputs;
  readonly state: HavocRunState;
  readonly lineup: HavocCliLineupEntry[];
}

export function replayHavocCliRunFromReport(
  report: HavocSimulateReport,
  assets: HavocCliAssets,
): HavocCliReplayedRun {
  const catalog = adaptHavocCliCatalog(assets);
  const environment = createHavocCommandEnvironment(catalog);
  const plan: HavocCliDraftPlan = {
    pins: report.draft.pins,
    rerollRound: report.draft.rerollRound,
  };
  const replay = replayHavocCliDraft({
    runId: report.runId,
    runSeed: report.runSeed,
    versionSet: report.versionSet,
    catalog,
    environment,
    lockSources: havocCliLockSourcesOf(assets),
    plan,
  });
  return {
    locked: replay.locked,
    state: replay.state,
    lineup: havocCliLineupOf(replay.locked.picks),
  };
}

export function havocCliInputPairCheck(
  havocInput: HavocGameInput,
  normalInput: HavocGameInput,
): string[] {
  const findings: string[] = [];
  if (havocInput.gameNumber !== normalInput.gameNumber) {
    findings.push(
      `paired game numbers differ: ${String(havocInput.gameNumber)} vs ${String(normalInput.gameNumber)}`,
    );
  }
  if (havocInput.seed !== normalInput.seed) {
    findings.push(
      `paired seeds differ at game ${String(havocInput.gameNumber)}: ${havocInput.seed} vs ${normalInput.seed}`,
    );
  }
  if (havocInput.humanSide !== normalInput.humanSide) {
    findings.push(`paired human sides differ at game ${String(havocInput.gameNumber)}`);
  }
  if (havocInput.variant !== 'havoc' || normalInput.variant !== 'normal') {
    findings.push(`paired variants are wrong at game ${String(havocInput.gameNumber)}`);
  }
  const opponentOf = (input: HavocGameInput) => (input.humanSide === 'home' ? input.away : input.home);
  const humanOf = (input: HavocGameInput) => (input.humanSide === 'home' ? input.home : input.away);
  const havocOpponent = opponentOf(havocInput);
  const normalOpponent = opponentOf(normalInput);
  if (havocOpponent.teamId !== normalOpponent.teamId) {
    findings.push(`paired opponent ids differ at game ${String(havocInput.gameNumber)}`);
  }
  const havocOpponentIds = havocOpponent.starters.map((starter) => starter.instanceId).join(',');
  const normalOpponentIds = normalOpponent.starters.map((starter) => starter.instanceId).join(',');
  if (havocOpponentIds !== normalOpponentIds) {
    findings.push(`paired opponent instances differ at game ${String(havocInput.gameNumber)}`);
  }
  const havocHuman = humanOf(havocInput);
  const normalHuman = humanOf(normalInput);
  const havocHumanIds = havocHuman.starters.map((starter) => starter.instanceId).join(',');
  const normalHumanIds = normalHuman.starters.map((starter) => starter.instanceId).join(',');
  if (havocHumanIds !== normalHumanIds) {
    findings.push(`paired human instances differ at game ${String(havocInput.gameNumber)}`);
  }
  const havocVersions = havocHuman.starters
    .map((starter) => starter.source.playerVersionId ?? 'null')
    .join(',');
  const normalVersions = normalHuman.starters
    .map((starter) => starter.source.playerVersionId ?? 'null')
    .join(',');
  if (havocVersions !== normalVersions) {
    findings.push(`paired human source versions differ at game ${String(havocInput.gameNumber)}`);
  }
  if (canonicalJson(havocInput.profile) !== canonicalJson(normalInput.profile)) {
    findings.push(`paired simulation profiles differ at game ${String(havocInput.gameNumber)}`);
  }
  if (canonicalJson(havocInput.versionSet) !== canonicalJson(normalInput.versionSet)) {
    findings.push(`paired version sets differ at game ${String(havocInput.gameNumber)}`);
  }
  return findings;
}
