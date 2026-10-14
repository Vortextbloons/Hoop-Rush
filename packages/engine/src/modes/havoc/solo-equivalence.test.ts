import { describe, expect, it } from 'vitest';
import type {
  HavocEvent,
  HavocMutationEntry,
  HavocRunState,
  HavocTeamInput,
  Position,
  Seed,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SCHEMA_VERSION,
  canonicalJson,
  havocClaimKeyOf,
  havocLockLineupCommandSchema,
  havocPickCardCommandSchema,
  havocRerollOfferCommandSchema,
  seasonDigestHex,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildFixtureBracket, buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import type { HavocLockSources, HavocStoredGame } from './api.ts';
import { auditHavocGame } from './audit.ts';
import { compareHavocSeasons } from './comparison.ts';
import {
  havocGameInputDigest,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
} from './digests.ts';
import { CreateHavocRunState } from './draft-commands.ts';
import { simulateHavocGame } from './game.ts';
import { buildHavocGameInput } from './input.ts';
import { ApplyHavocCommand } from './run-commands.ts';
import { HavocStateDigest } from './state-digest.ts';
import { applyHavocMutationPackage } from './transform.ts';
import {
  buildHavocCatalogFixture,
  buildHavocCreateCommandFixture,
  buildHavocEnvironmentFixture,
  buildHavocEraProfileFixture,
} from './havoc-test-support.ts';
import type { ScenarioRun, ScenarioSlot } from './runtime-test-support.ts';
import { buildScenarioTeam, runScenario } from './runtime-test-support.ts';

declare const process: {
  env: Record<string, string | undefined>;
  stdout: { write: (chunk: string) => void };
};

const CAPTURE_ENV_VAR = 'HAVOC_SOLO_EQUIVALENCE_CAPTURE';
const CAPTURE_MODE = process.env[CAPTURE_ENV_VAR] === '1';
const DIGEST_PATTERN = /^[0-9a-f]{32}$/;
const GAME_COUNT = 82;

function assertDigest(value: string, label: string): void {
  expect(value, label).toMatch(DIGEST_PATTERN);
}

function emitCapture(label: string, value: unknown): void {
  process.stdout.write(`${CAPTURE_ENV_VAR}=1 ${label}=${JSON.stringify(value)}\n`);
}

interface PinnedDraft {
  readonly seed: string;
  readonly rerollOnFirstTurn: boolean;
  readonly transcriptDigest: string;
  readonly rerollStateDigest: string | null;
  readonly lockedStateDigest: string;
}

interface SoloDraftCard {
  readonly cardId: string;
  readonly playerId: string;
  readonly claimKey: string | null;
  readonly seasonKey: string | null;
  readonly tier: number;
  readonly mutations: readonly HavocMutationEntry[];
  readonly nickname: string;
}

interface SoloDraftRound {
  readonly round: number;
  readonly slot: Position;
  readonly offerId: string;
  readonly offerIndex: number;
  readonly rerollUsed: boolean;
  readonly cards: readonly SoloDraftCard[];
  readonly pickedCardId: string;
}

interface SoloDraftTranscript {
  readonly seed: string;
  readonly runSeed: Seed;
  readonly rounds: readonly SoloDraftRound[];
}

interface SoloDraftRow {
  readonly pinned: PinnedDraft;
  readonly transcript: SoloDraftTranscript;
}

const PINNED_DRAFTS: readonly PinnedDraft[] = [
  {
    seed: 'havoc-equiv-a',
    rerollOnFirstTurn: false,
    transcriptDigest: 'ca68f9a2a38a484e645ef65cf493fe72',
    rerollStateDigest: null,
    lockedStateDigest: '562a0685a295a6f9c7aec4ab794c47b5',
  },
  {
    seed: 'havoc-equiv-b',
    rerollOnFirstTurn: true,
    transcriptDigest: 'da908a9b7cc2524f64f3cdfdadfdcecb',
    rerollStateDigest: 'ebda9c662633549aae987088862945b6',
    lockedStateDigest: '497bf3cb350538e7ef68ced1e21d9ddb',
  },
];

interface PinnedGame {
  readonly key: string;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly tapeDigest: string;
  readonly humanScore: number;
  readonly opponentScore: number;
  readonly winner: 'home' | 'away';
}

const PINNED_LOCKED_GAMES: readonly PinnedGame[] = [
  {
    key: 'havoc-g1',
    inputDigest: '31954291cc6e82fd4c186593d9906461',
    resultDigest: '21ee8be42355a698969b3516d2582c94',
    tapeDigest: '7a0469ab4fb58a8784c87a71565093bb',
    humanScore: 104,
    opponentScore: 99,
    winner: 'home',
  },
  {
    key: 'normal-g1',
    inputDigest: 'c36b06bb8b7401df58c7e4712d2d786b',
    resultDigest: 'b24efffa3592bad69d185048fc47e2ea',
    tapeDigest: '27f2ff970b885e5b12f167098aa36a47',
    humanScore: 104,
    opponentScore: 99,
    winner: 'home',
  },
  {
    key: 'havoc-g41',
    inputDigest: '5a33d0aab1a0a6a6db1acaac2936391a',
    resultDigest: '090d7949f0084d4dc94b13d725c73679',
    tapeDigest: '01d6d632ad7f49068cd70f384013e7a2',
    humanScore: 113,
    opponentScore: 106,
    winner: 'home',
  },
  {
    key: 'normal-g41',
    inputDigest: '0ae4f78e551a4ad22816646c924d585e',
    resultDigest: 'b55b851c9e7906885b25006a97dc982c',
    tapeDigest: 'e18d4f0c110df1f8637d9cbe3b3ad3dc',
    humanScore: 113,
    opponentScore: 106,
    winner: 'home',
  },
  {
    key: 'havoc-g82',
    inputDigest: '83e974f793bcd59316ad4235d8b5b8a7',
    resultDigest: 'f138dff4aac122b8c3a023eec2e90784',
    tapeDigest: 'b40d2744f5a60f10e5f0c3ea41139194',
    humanScore: 108,
    opponentScore: 105,
    winner: 'away',
  },
  {
    key: 'normal-g82',
    inputDigest: '4a2c858d20a43471814bdf07dff1a7dd',
    resultDigest: '6940cc4a08868636290dcc04d547d7fa',
    tapeDigest: '98586982cd7b122623035eb4775237b2',
    humanScore: 108,
    opponentScore: 105,
    winner: 'away',
  },
];

interface PinnedGameOneSummaries {
  readonly havoc: string;
  readonly normal: string;
}

const PINNED_GAME_ONE_SUMMARY_DIGESTS: PinnedGameOneSummaries = {
  havoc: 'f7d7823fdf00ac6b93dbb36548619a2f',
  normal: '1b36c6a8a3fdaaa4965da33eca301578',
};

interface PinnedScenario {
  readonly key: string;
  readonly seed: string;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly tapeDigest: string;
}

const PINNED_SCENARIOS: readonly PinnedScenario[] = [
  {
    key: 'control-no-mutations',
    seed: 'havoc-equiv-control-no-mutations-0',
    inputDigest: 'ed18eaa38d2ffaa733cbace961384e13',
    resultDigest: 'eb36ff6e5952a3f2596696f8cb60c47e',
    tapeDigest: '38c650523058765ed60db3047ababbe2',
  },
  {
    key: 'tier1-profile-package',
    seed: 'havoc-equiv-tier1-profile-package-0',
    inputDigest: '8fc4aa8d25aff8b160df3e87c03a029d',
    resultDigest: 'e3bc3024a35100286dcd10fe57f525f4',
    tapeDigest: '5b902634d96d8ff8ead5120eeb5b1424',
  },
  {
    key: 'heat-check',
    seed: 'havoc-equiv-heat-check-6',
    inputDigest: '32cd3bb07b3f2e5c95a30096fd6c4a60',
    resultDigest: 'aad23da7f8eeb2335e1355613667da57',
    tapeDigest: '185afbaef8e85d9aca4ce41c1130e3be',
  },
  {
    key: 'basketball-roulette',
    seed: 'havoc-equiv-basketball-roulette-0',
    inputDigest: 'c9a3a5cd1db82541e820f3bb22f01a3d',
    resultDigest: 'e238584d5af043a9d956e567345ce7fd',
    tapeDigest: 'cb8fc9bd072329812cc7ad0f3028846d',
  },
  {
    key: 'double-or-nothing',
    seed: 'havoc-equiv-double-or-nothing-0',
    inputDigest: 'cfb4389667cdf50201440324de112ca6',
    resultDigest: '8bbabbdaf5e927ce1fe1f8e45a53bbea',
    tapeDigest: 'd1db195d25057c61eb11a5b31a61a8ad',
  },
  {
    key: 'charity-casino',
    seed: 'havoc-equiv-charity-casino-0',
    inputDigest: '077089c75cb0d3330c75a8d95a973117',
    resultDigest: 'f1bfe5a6764f3e7256a3354069cd7c16',
    tapeDigest: '3256865a8a1fe796545f4fc4196d660a',
  },
  {
    key: 'buzzer-bandit',
    seed: 'havoc-equiv-buzzer-bandit-0',
    inputDigest: '8e59ce1c40b8e9c092d65ffa1c7f28ec',
    resultDigest: '6b5589be12d8e4121eceb598b0f1f10e',
    tapeDigest: '263385e5b65e9af94dc53bfbcc8973b5',
  },
  {
    key: 'four-point-dunk',
    seed: 'havoc-equiv-four-point-dunk-0',
    inputDigest: '42d148717dd2ee5dd5d526bbfeeaf301',
    resultDigest: 'e52a541727b476032dd5ea8525f619a7',
    tapeDigest: '4191d4897bb2a87ded86f80b938e1039',
  },
  {
    key: 'time-lord',
    seed: 'havoc-equiv-time-lord-0',
    inputDigest: '9be0603c583e4df8530e301214e8902c',
    resultDigest: 'eb94e84c25b50a4821dd0f6e3eefe75c',
    tapeDigest: 'bb02f2b03acb15dce82d2a4ad24dbda0',
  },
  {
    key: 'the-great-equalizer',
    seed: 'havoc-equiv-the-great-equalizer-0',
    inputDigest: '92bf56b987e2ce45e233464fcb9b9949',
    resultDigest: '2a8e9bc2c863514ee4674cf8477b51d2',
    tapeDigest: '2b6bc48aa5423e164edd92c4f19ed07a',
  },
  {
    key: 'clone-army',
    seed: 'havoc-equiv-clone-army-0',
    inputDigest: '71c06ce7c24d689b9c215ea5fcfe77f7',
    resultDigest: '34bf569bc36917b703ad26594e8eeeab',
    tapeDigest: '746cc77627792e6224ddc4e4a523d2c6',
  },
  {
    key: 'body-snatcher',
    seed: 'havoc-equiv-body-snatcher-0',
    inputDigest: 'bcfc007cbbe5edb0abbb5a7a9ae9e02c',
    resultDigest: '93566b1126d6525d2476a297edc8f561',
    tapeDigest: 'b912e24b87702ecf071635fdebcd3e5b',
  },
  {
    key: 'the-bounty',
    seed: 'havoc-equiv-the-bounty-1',
    inputDigest: '5d6532544bbb797873e67fea99667fe4',
    resultDigest: '2743b168393cad8cfb6790e6c69d94f8',
    tapeDigest: '5e197b2f04f432ab22f2e74941e330bf',
  },
  {
    key: 'fusion-dance',
    seed: 'havoc-equiv-fusion-dance-0',
    inputDigest: '34fc645f8e62333bf6b08f39cbef856f',
    resultDigest: 'e1519bc575852c29393a7063bd7432f5',
    tapeDigest: '4ecd5d448a88f60062e2cb32dae65134',
  },
  {
    key: 'basketball-darwinism',
    seed: 'havoc-equiv-basketball-darwinism-0',
    inputDigest: '45223603f10e4517ebc047cda5a14073',
    resultDigest: '7146fbf3022b45cfc0bf5a7dc72ff143',
    tapeDigest: '25b6e1d2a6717e5e01088658a6c33382',
  },
  {
    key: 'reverse-basketball',
    seed: 'havoc-equiv-reverse-basketball-0',
    inputDigest: '55be1f7dfc0c2e41dc3f774fbaaab50d',
    resultDigest: '82acd3e41e50e9f0edebbfcaa2e3f714',
    tapeDigest: '96c36aa5615e51892da2756f57fb5a55',
  },
  {
    key: 'the-specialist',
    seed: 'havoc-equiv-the-specialist-0',
    inputDigest: '7e394a5e4718385ab8029b10acda23ee',
    resultDigest: '2e51e55bc26ef14fae33fafd3a11660b',
    tapeDigest: '0c2e2f5a28d5baa6f788198c45da1f6a',
  },
  {
    key: 'growth-spurt',
    seed: 'havoc-equiv-growth-spurt-0',
    inputDigest: '28f89ff346a6fcbf3b36817d67a76883',
    resultDigest: '35b689d1d6507e0d15f060ff06622cc1',
    tapeDigest: '119cd4cce1059e480072132a2df36d3c',
  },
  {
    key: 'physical-size',
    seed: 'havoc-equiv-physical-size-0',
    inputDigest: '959521b56265f041552782d32fb884e5',
    resultDigest: '9d616c2f9fb8dbc31eb8ffd12d2f945f',
    tapeDigest: '2e71c9969094168a5b689bf010c8ee46',
  },
];

interface PinnedComparison {
  readonly digest: string;
  readonly havocWins: number;
  readonly havocLosses: number;
  readonly normalWins: number;
  readonly normalLosses: number;
  readonly winsGained: number;
  readonly mvpSlot: Position;
  readonly mvpGain: number;
}

const PINNED_COMPARISON: PinnedComparison = {
  digest: 'de2e45ebd7211e376d5a41010dd80adb',
  havocWins: 41,
  havocLosses: 41,
  normalWins: 41,
  normalLosses: 41,
  winsGained: 0,
  mvpSlot: 'SF',
  mvpGain: 0,
};

const DRAFT_RUNS: readonly { seed: string; rerollOnFirstTurn: boolean }[] = [
  { seed: 'havoc-equiv-a', rerollOnFirstTurn: false },
  { seed: 'havoc-equiv-b', rerollOnFirstTurn: true },
];

const draftFixture = buildHavocCatalogFixture();
const draftEnvironment = buildHavocEnvironmentFixture(draftFixture.adapted);
const draftLockSources: HavocLockSources = {
  bracket: buildFixtureBracket(),
  profile: buildHavocEraProfileFixture(),
};

function rerollOfferCommand(state: HavocRunState) {
  const draft = state.draft;
  if (draft === null) throw new Error('havoc equivalence: no active draft');
  return havocRerollOfferCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-reroll-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'reroll-havoc-offer',
    offerId: draft.offerId,
  });
}

function pickCardCommand(state: HavocRunState, cardId: string) {
  const draft = state.draft;
  if (draft === null) throw new Error('havoc equivalence: no active draft');
  return havocPickCardCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-pick-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'pick-havoc-card',
    offerId: draft.offerId,
    cardId,
  });
}

function lockLineupCommand(state: HavocRunState) {
  const draft = state.draft;
  if (draft === null) throw new Error('havoc equivalence: no active draft');
  return havocLockLineupCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-lock-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'lock-havoc-lineup',
    picks: draft.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
  });
}

function runSeededDraft(entry: { seed: string; rerollOnFirstTurn: boolean }): SoloDraftRow {
  const runSeed = seedSchema.parse(seedFromString(entry.seed));
  let state = CreateHavocRunState(
    buildHavocCreateCommandFixture(draftFixture, { runSeed }),
    draftFixture.adapted,
    draftEnvironment,
  );
  let rerollStateDigest: string | null = null;
  if (entry.rerollOnFirstTurn) {
    const outcome = ApplyHavocCommand(
      state,
      rerollOfferCommand(state),
      draftEnvironment,
      draftLockSources,
    );
    expect(outcome.result.status, `${entry.seed} reroll`).toBe('accepted');
    state = outcome.state;
    rerollStateDigest = HavocStateDigest(state);
  }
  const rounds: SoloDraftRound[] = [];
  while (state.draft !== null && state.draft.status === 'drafting') {
    const draft = state.draft;
    const picked = draft.cards[0];
    if (picked === undefined) throw new Error(`havoc equivalence: empty offer for ${entry.seed}`);
    rounds.push({
      round: draft.round,
      slot: draft.slot,
      offerId: draft.offerId,
      offerIndex: draft.offerIndex,
      rerollUsed: draft.rerollUsed,
      cards: draft.cards.map((card) => ({
        cardId: card.cardId,
        playerId: card.source.playerId,
        claimKey:
          card.source.seasonKey === null
            ? null
            : havocClaimKeyOf(card.source.playerId, card.source.seasonKey),
        seasonKey: card.source.seasonKey,
        tier: card.tier,
        mutations: card.mutations.map((mutation) => ({ ...mutation })),
        nickname: card.nickname,
      })),
      pickedCardId: picked.cardId,
    });
    const outcome = ApplyHavocCommand(
      state,
      pickCardCommand(state, picked.cardId),
      draftEnvironment,
      draftLockSources,
    );
    expect(outcome.result.status, `${entry.seed} pick round ${String(draft.round)}`).toBe(
      'accepted',
    );
    state = outcome.state;
  }
  expect(state.draft?.status, `${entry.seed} completed draft`).toBe('complete');
  const locked = ApplyHavocCommand(
    state,
    lockLineupCommand(state),
    draftEnvironment,
    draftLockSources,
  );
  expect(locked.result.status, `${entry.seed} lock`).toBe('accepted');
  const transcript: SoloDraftTranscript = { seed: entry.seed, runSeed, rounds };
  return {
    pinned: {
      seed: entry.seed,
      rerollOnFirstTurn: entry.rerollOnFirstTurn,
      transcriptDigest: seasonDigestHex(canonicalJson(transcript)),
      rerollStateDigest,
      lockedStateDigest: HavocStateDigest(locked.state),
    },
    transcript,
  };
}

const RIM_ATTACK: Partial<SimulationRatings> = {
  insideScoring: 99,
  closeShot: 95,
  midrange: 80,
  threePoint: 55,
  freeThrow: 90,
  ballHandling: 95,
  passing: 75,
  offensiveIq: 90,
  offensiveRebound: 90,
  defensiveRebound: 60,
  perimeterDefense: 70,
  interiorDefense: 60,
  steal: 65,
  block: 55,
  defensiveIq: 70,
  speed: 99,
  strength: 85,
  vertical: 99,
};

const HIGH_USAGE: Partial<SimulationTendencies> = {
  usageRate: 45,
  shotRate: 99,
  driveRate: 95,
  rimFrequency: 100,
  shortMidFrequency: 35,
  longMidFrequency: 5,
  cornerThreeFrequency: 5,
  aboveBreakThreeFrequency: 5,
  threePointRate: 10,
  freeThrowRate: 95,
  turnoverRate: 35,
  isolationRate: 45,
  pickAndRollBallHandlerRate: 40,
  pickAndRollRollManRate: 20,
  spotUpRate: 10,
  transitionRate: 30,
  cutRate: 20,
  foulRate: 35,
  stealAttemptRate: 15,
  blockAttemptRate: 10,
  crashOffensiveGlassRate: 95,
  passRate: 5,
};

const FOUL_PRONE: Partial<SimulationTendencies> = {
  ...HIGH_USAGE,
  usageRate: 20,
  shotRate: 30,
  foulRate: 20,
};

const BLOCKER_RATINGS: Partial<SimulationRatings> = {
  ...RIM_ATTACK,
  block: 99,
  interiorDefense: 99,
  vertical: 99,
  perimeterDefense: 40,
};

function scenarioSlot(
  slot: Position,
  mutations: ScenarioSlot['mutations'],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot {
  return { slot, mutations, ratings: RIM_ATTACK, tendencies: HIGH_USAGE, ...overrides };
}

function plainSlots(): ScenarioSlot[] {
  return (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((slot) => scenarioSlot(slot, []));
}

function humanSlotMutation(
  slot: Position,
  mutations: ScenarioSlot['mutations'],
  overrides: Partial<ScenarioSlot> = {},
): ScenarioSlot[] {
  return plainSlots().map((entry) =>
    entry.slot === slot ? scenarioSlot(slot, mutations, overrides) : entry,
  );
}

function plainAway(): HavocTeamInput {
  return buildScenarioTeam('opponent', plainSlots());
}

function sampledTeam(
  team: HavocTeamInput,
  slot: Position,
  entry: HavocMutationEntry,
): HavocTeamInput {
  return {
    ...team,
    starters: team.starters.map((starter) =>
      starter.slot === slot
        ? {
            ...starter,
            mutationPackage: [entry],
            effective: applyHavocMutationPackage(starter.source, [entry]),
          }
        : starter,
    ),
  };
}

const hasEvent = (run: ScenarioRun, kind: HavocEvent['kind']): boolean =>
  run.tape.events.some((event) => event.kind === kind);

interface SoloScenario {
  readonly key: string;
  readonly seed: string;
  readonly human: HavocTeamInput;
  readonly away: HavocTeamInput;
  readonly driven: (run: ScenarioRun) => boolean;
}

const SCENARIOS: readonly SoloScenario[] = [
  {
    key: 'control-no-mutations',
    seed: 'havoc-equiv-control-no-mutations-0',
    human: buildScenarioTeam('human', plainSlots()),
    away: plainAway(),
    driven: (run) =>
      run.input.home.starters.every((starter) => starter.mutationPackage.length === 0),
  },
  {
    key: 'tier1-profile-package',
    seed: 'havoc-equiv-tier1-profile-package-0',
    human: buildScenarioTeam(
      'human',
      humanSlotMutation('PG', ['sniper-gene', 'glass-eater', 'point-god']),
    ),
    away: plainAway(),
    driven: (run) =>
      run.input.home.starters.some((starter) => starter.mutationPackage.length === 3) &&
      hasEvent(run, 'shot-attempt'),
  },
  {
    key: 'heat-check',
    seed: 'havoc-equiv-heat-check-6',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['heat-check'])),
    away: plainAway(),
    driven: (run) =>
      run.tape.events.some((event) => event.kind === 'heat-check' && event.outcome === 'consumed'),
  },
  {
    key: 'basketball-roulette',
    seed: 'havoc-equiv-basketball-roulette-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['basketball-roulette'])),
    away: plainAway(),
    driven: (run) => hasEvent(run, 'roulette'),
  },
  {
    key: 'double-or-nothing',
    seed: 'havoc-equiv-double-or-nothing-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['double-or-nothing'])),
    away: plainAway(),
    driven: (run) =>
      run.tape.scoring.some(
        (entry) =>
          entry.multipliers.some((multiplier) => multiplier.source === 'double-or-nothing') ||
          entry.addends.some((addend) => addend.source === 'double-or-nothing'),
      ),
  },
  {
    key: 'charity-casino',
    seed: 'havoc-equiv-charity-casino-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['charity-casino'])),
    away: plainAway(),
    driven: (run) => hasEvent(run, 'charity-casino'),
  },
  {
    key: 'buzzer-bandit',
    seed: 'havoc-equiv-buzzer-bandit-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['buzzer-bandit'])),
    away: plainAway(),
    driven: (run) => hasEvent(run, 'buzzer-bandit'),
  },
  {
    key: 'four-point-dunk',
    seed: 'havoc-equiv-four-point-dunk-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['four-point-dunk'])),
    away: plainAway(),
    driven: (run) => hasEvent(run, 'four-point-dunk'),
  },
  {
    key: 'time-lord',
    seed: 'havoc-equiv-time-lord-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['time-lord'])),
    away: plainAway(),
    driven: (run) => hasEvent(run, 'time-lord'),
  },
  {
    key: 'the-great-equalizer',
    seed: 'havoc-equiv-the-great-equalizer-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['the-great-equalizer'])),
    away: plainAway(),
    driven: (run) =>
      run.tape.events.some(
        (event) => event.kind === 'great-equalizer' && event.outcome === 'applied',
      ),
  },
  {
    key: 'clone-army',
    seed: 'havoc-equiv-clone-army-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['clone-army'])),
    away: plainAway(),
    driven: (run) =>
      run.input.home.clones.length === 1 &&
      run.tape.events.some((event) => event.kind === 'clone' && event.outcome === 'entered'),
  },
  {
    key: 'body-snatcher',
    seed: 'havoc-equiv-body-snatcher-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['body-snatcher'])),
    away: buildScenarioTeam(
      'opponent',
      plainSlots().map((entry, index) => ({ ...entry, overall: index === 4 ? 95 : 70 + index })),
    ),
    driven: (run) =>
      run.tape.events.some(
        (event) => event.kind === 'body-snatcher' && event.outcome === 'applied',
      ),
  },
  {
    key: 'the-bounty',
    seed: 'havoc-equiv-the-bounty-1',
    human: buildScenarioTeam(
      'human',
      humanSlotMutation('PG', ['the-bounty'], { ratings: BLOCKER_RATINGS }),
    ),
    away: buildScenarioTeam(
      'opponent',
      plainSlots().map((entry, index) => ({ ...entry, overall: index === 4 ? 99 : 70 + index })),
    ),
    driven: (run) => hasEvent(run, 'bounty'),
  },
  {
    key: 'fusion-dance',
    seed: 'havoc-equiv-fusion-dance-0',
    human: buildScenarioTeam('human', [
      scenarioSlot('PG', ['fusion-dance'], { overall: 80, tendencies: FOUL_PRONE }),
      scenarioSlot('SG', [], { overall: 70, tendencies: FOUL_PRONE }),
      scenarioSlot('SF', [], { overall: 90, tendencies: FOUL_PRONE }),
      scenarioSlot('PF', [], { overall: 85, tendencies: FOUL_PRONE }),
      scenarioSlot('C', [], { overall: 75, tendencies: FOUL_PRONE }),
    ]),
    away: plainAway(),
    driven: (run) =>
      run.tape.events.some((event) => event.kind === 'fusion-dance' && event.outcome === 'applied'),
  },
  {
    key: 'basketball-darwinism',
    seed: 'havoc-equiv-basketball-darwinism-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['basketball-darwinism'])),
    away: plainAway(),
    driven: (run) => hasEvent(run, 'darwinism'),
  },
  {
    key: 'reverse-basketball',
    seed: 'havoc-equiv-reverse-basketball-0',
    human: buildScenarioTeam('human', humanSlotMutation('PG', ['reverse-basketball'])),
    away: plainAway(),
    driven: (run) =>
      run.tape.scoring.some((entry) =>
        entry.addends.some((addend) => addend.source === 'reverse-basketball'),
      ),
  },
  {
    key: 'the-specialist',
    seed: 'havoc-equiv-the-specialist-0',
    human: sampledTeam(buildScenarioTeam('human', humanSlotMutation('PG', [])), 'PG', {
      mutationId: 'the-specialist',
      specialistCategory: 'scoring',
    }),
    away: plainAway(),
    driven: (run) =>
      run.input.home.starters.some(
        (starter) =>
          starter.effective.ratings.insideScoring === 99 &&
          starter.mutationPackage.some((mutation) => mutation.specialistCategory === 'scoring'),
      ),
  },
  {
    key: 'growth-spurt',
    seed: 'havoc-equiv-growth-spurt-0',
    human: sampledTeam(buildScenarioTeam('human', humanSlotMutation('PG', [])), 'PG', {
      mutationId: 'growth-spurt',
      sampledHeightDelta: 8,
    }),
    away: plainAway(),
    driven: (run) =>
      run.input.home.starters.some((starter) => starter.effective.physical.heightInches === 86),
  },
  {
    key: 'physical-size',
    seed: 'havoc-equiv-physical-size-0',
    human: buildScenarioTeam(
      'human',
      plainSlots().map((entry) => ({
        ...entry,
        physical: { heightInches: 86, wingspanDeltaInches: 18, reachUnits: 2 },
      })),
    ),
    away: plainAway(),
    driven: (run) =>
      run.input.home.starters.every(
        (starter) =>
          starter.effective.physical.heightInches === 86 &&
          starter.effective.physical.wingspanDeltaInches === 18 &&
          starter.effective.physical.reachUnits === 2,
      ),
  },
];

describe('havoc solo equivalence', () => {
  it('pins the seeded solo draft transcripts and run-state digests', () => {
    const rows = DRAFT_RUNS.map((entry) => runSeededDraft(entry));
    for (const row of rows) {
      assertDigest(row.pinned.transcriptDigest, `${row.pinned.seed} transcript digest`);
      assertDigest(row.pinned.lockedStateDigest, `${row.pinned.seed} locked state digest`);
      if (row.pinned.rerollStateDigest !== null) {
        assertDigest(row.pinned.rerollStateDigest, `${row.pinned.seed} reroll state digest`);
      }
    }
    if (CAPTURE_MODE) {
      emitCapture(
        'pinnedDrafts',
        rows.map((row) => row.pinned),
      );
      emitCapture(
        'draftTranscripts',
        rows.map((row) => row.transcript),
      );
      return;
    }
    expect(
      rows.map((row) => row.pinned),
      'pinned drafts',
    ).toEqual(PINNED_DRAFTS);
  });

  it('pins locked-input games 1, 41, and 82 for both variants', () => {
    const locked = buildHavocLockedInputs();
    const context = createEngineContext();
    const rows: PinnedGame[] = [];
    const summaries: { havoc: string; normal: string } = { havoc: '', normal: '' };
    for (const gameNumber of [1, 41, GAME_COUNT]) {
      for (const variant of ['havoc', 'normal'] as const) {
        const input = buildHavocGameInput({ locked, gameNumber, variant });
        const simulation = simulateHavocGame(input, context);
        const audit = auditHavocGame(input, simulation.result, simulation.tape);
        expect(audit.ok, `${variant} game ${String(gameNumber)} audit`).toBe(true);
        const result = simulation.result;
        const human = result.humanSide === 'home' ? result.home : result.away;
        const opponent = result.humanSide === 'home' ? result.away : result.home;
        const resultDigest = havocGameResultDigest(result);
        rows.push({
          key: `${variant}-g${String(gameNumber)}`,
          inputDigest: havocGameInputDigest(input),
          resultDigest,
          tapeDigest: havocGameTapeDigest(simulation.tape),
          humanScore: human.points,
          opponentScore: opponent.points,
          winner: result.winner,
        });
        if (gameNumber === 1) {
          summaries[variant] = seasonDigestHex(
            canonicalJson(havocGameSummaryOf(result, resultDigest)),
          );
        }
      }
    }
    for (const row of rows) {
      assertDigest(row.inputDigest, `${row.key} input digest`);
      assertDigest(row.resultDigest, `${row.key} result digest`);
      assertDigest(row.tapeDigest, `${row.key} tape digest`);
    }
    assertDigest(summaries.havoc, 'havoc game 1 summary digest');
    assertDigest(summaries.normal, 'normal game 1 summary digest');
    if (CAPTURE_MODE) {
      emitCapture('pinnedLockedGames', rows);
      emitCapture('pinnedGameOneSummaryDigests', summaries);
      return;
    }
    expect(rows, 'locked-input games').toEqual(PINNED_LOCKED_GAMES);
    expect(summaries, 'game 1 summary digests').toEqual(PINNED_GAME_ONE_SUMMARY_DIGESTS);
  });

  it('pins the fixed-seed scenario matrix', () => {
    expect(SCENARIOS.length, 'scenario coverage').toBeGreaterThanOrEqual(12);
    const rows: PinnedScenario[] = [];
    for (const scenario of SCENARIOS) {
      const run = runScenario(scenario.human, scenario.away, scenario.seed);
      expect(scenario.driven(run), `${scenario.key} driver event`).toBe(true);
      rows.push({
        key: scenario.key,
        seed: scenario.seed,
        inputDigest: run.inputDigest,
        resultDigest: run.resultDigest,
        tapeDigest: run.tapeDigest,
      });
      assertDigest(run.inputDigest, `${scenario.key} input digest`);
      assertDigest(run.resultDigest, `${scenario.key} result digest`);
      assertDigest(run.tapeDigest, `${scenario.key} tape digest`);
    }
    if (CAPTURE_MODE) {
      emitCapture('pinnedScenarios', rows);
      return;
    }
    expect(rows.length, 'pinned scenario count').toBe(PINNED_SCENARIOS.length);
    for (const row of rows) {
      const pinned = PINNED_SCENARIOS.find((candidate) => candidate.key === row.key);
      expect(pinned, `${row.key} pinned scenario`).toBeDefined();
      expect(row, row.key).toEqual(pinned);
    }
  });

  it('pins the full paired season comparison', () => {
    const locked = buildHavocLockedInputs();
    const context = createEngineContext();
    const havocGames: HavocStoredGame[] = [];
    const normalGames: HavocStoredGame[] = [];
    for (let gameNumber = 1; gameNumber <= GAME_COUNT; gameNumber += 1) {
      for (const variant of ['havoc', 'normal'] as const) {
        const input = buildHavocGameInput({ locked, gameNumber, variant });
        const simulation = simulateHavocGame(input, context);
        const stored: HavocStoredGame = {
          gameNumber,
          result: simulation.result,
          resultDigest: havocGameResultDigest(simulation.result),
        };
        if (variant === 'havoc') havocGames.push(stored);
        else normalGames.push(stored);
      }
    }
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames,
      normalGames,
    });
    const row: PinnedComparison = {
      digest: seasonDigestHex(canonicalJson(comparison)),
      havocWins: comparison.havoc.wins,
      havocLosses: comparison.havoc.losses,
      normalWins: comparison.normal.wins,
      normalLosses: comparison.normal.losses,
      winsGained: comparison.winsGained,
      mvpSlot: comparison.mvp.slot,
      mvpGain: comparison.mvp.gain,
    };
    assertDigest(row.digest, 'season comparison digest');
    if (CAPTURE_MODE) {
      emitCapture('pinnedComparison', row);
      return;
    }
    expect(row, 'season comparison').toEqual(PINNED_COMPARISON);
  }, 45000);
});
