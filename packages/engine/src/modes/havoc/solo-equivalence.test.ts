import { describe, expect, it } from 'bun:test';
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
    transcriptDigest: '3729b1ac3d75d2b032938ae6195b287c',
    rerollStateDigest: null,
    lockedStateDigest: '3a06d29da80ce301d3988383d97efc8d',
  },
  {
    seed: 'havoc-equiv-b',
    rerollOnFirstTurn: true,
    transcriptDigest: '88c028772438a1738253542560b6e0a7',
    rerollStateDigest: '221ca70ce046fd105928f4225b9cb75c',
    lockedStateDigest: '12c71486d236c80a0596462030b403b6',
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
    inputDigest: 'a3d13009fc6ef035c1b656db4188b819',
    resultDigest: '133cb9586cff107484136916d90f2308',
    tapeDigest: '7a0469ab4fb58a8784c87a71565093bb',
    humanScore: 104,
    opponentScore: 99,
    winner: 'home',
  },
  {
    key: 'normal-g1',
    inputDigest: '6d2912cb3b63aa6fdfa04981e6f3f8fb',
    resultDigest: 'cb5105915813cb65b135fc17b5277321',
    tapeDigest: '27f2ff970b885e5b12f167098aa36a47',
    humanScore: 104,
    opponentScore: 99,
    winner: 'home',
  },
  {
    key: 'havoc-g41',
    inputDigest: '8d2880b2508d62cedd124a84db1bd562',
    resultDigest: 'b1980ce09dc85934e6058292ff048890',
    tapeDigest: '01d6d632ad7f49068cd70f384013e7a2',
    humanScore: 113,
    opponentScore: 106,
    winner: 'home',
  },
  {
    key: 'normal-g41',
    inputDigest: '81a3977e49d8ed02e58a0d246553c44e',
    resultDigest: 'aae1468a0d1d48163d9d02ec216f681a',
    tapeDigest: 'e18d4f0c110df1f8637d9cbe3b3ad3dc',
    humanScore: 113,
    opponentScore: 106,
    winner: 'home',
  },
  {
    key: 'havoc-g82',
    inputDigest: 'afb74a77f2ce5dc38a82d67512294ae7',
    resultDigest: '35c8f354aad3a4b0b479093ee1dac464',
    tapeDigest: 'b40d2744f5a60f10e5f0c3ea41139194',
    humanScore: 108,
    opponentScore: 105,
    winner: 'away',
  },
  {
    key: 'normal-g82',
    inputDigest: 'f2016a85836153b93d2ca3af429af4d5',
    resultDigest: 'a9aec096c29037eaff7ecaf49bf8e106',
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
  havoc: 'e75173f5abfe8511f7522ecbe69d01c5',
  normal: '2412f1cfc54e33d3406cfe4dae2c189f',
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
    inputDigest: 'd08f377bd9a8439f2e407851ea105beb',
    resultDigest: '880afadfb8ed57f3384ed549a59b53af',
    tapeDigest: '38c650523058765ed60db3047ababbe2',
  },
  {
    key: 'tier1-profile-package',
    seed: 'havoc-equiv-tier1-profile-package-0',
    inputDigest: '6eb7129520554ed950c9bfffc8a77165',
    resultDigest: 'aadae1d9fb5d45dd647f4993c23a38c9',
    tapeDigest: '5b902634d96d8ff8ead5120eeb5b1424',
  },
  {
    key: 'heat-check',
    seed: 'havoc-equiv-heat-check-6',
    inputDigest: '64646c0879bf76a408509936e2de54f8',
    resultDigest: '6e687f303adfe5c461454ebaa8b058c0',
    tapeDigest: '7c5a3ac1ec1910f58204a58345a4da71',
  },
  {
    key: 'basketball-roulette',
    seed: 'havoc-equiv-basketball-roulette-0',
    inputDigest: '6146ec554ca1f869a87e9d133e165945',
    resultDigest: '3641976d1e90f6e1ece25e471260869d',
    tapeDigest: '5a4928702ff7fadc8fcb2aa60dddaf00',
  },
  {
    key: 'double-or-nothing',
    seed: 'havoc-equiv-double-or-nothing-0',
    inputDigest: '4dcd65761f8953b2977b6dec0c56ea86',
    resultDigest: '49589d1fbf280d536cdc305d965b3f2f',
    tapeDigest: 'd68ea3f9338c70f5f5d0a09beaee53c9',
  },
  {
    key: 'charity-casino',
    seed: 'havoc-equiv-charity-casino-0',
    inputDigest: '90b9186fc1d0867b0b2377f14a68413f',
    resultDigest: '7ce5729082bbc6cc643f8c169ea0dac0',
    tapeDigest: '3256865a8a1fe796545f4fc4196d660a',
  },
  {
    key: 'buzzer-bandit',
    seed: 'havoc-equiv-buzzer-bandit-0',
    inputDigest: '48b8cdf469169688473d335a381f6684',
    resultDigest: 'ec0adb2a6f5b9b3eaeb5dc7c28f0fada',
    tapeDigest: 'f4a8e0a8a8ce9f7cdd87b1f6bae4cab8',
  },
  {
    key: 'four-point-dunk',
    seed: 'havoc-equiv-four-point-dunk-0',
    inputDigest: '2b52e0196089d68528799c3389a0d129',
    resultDigest: 'ba4bf34f1d8a61835e11e5515f1bb39f',
    tapeDigest: '4191d4897bb2a87ded86f80b938e1039',
  },
  {
    key: 'time-lord',
    seed: 'havoc-equiv-time-lord-0',
    inputDigest: 'c5a588c4c7eab05057801f82f92b6e34',
    resultDigest: '325d64d63b99634a34c8d5cc019d5406',
    tapeDigest: 'bb02f2b03acb15dce82d2a4ad24dbda0',
  },
  {
    key: 'the-great-equalizer',
    seed: 'havoc-equiv-the-great-equalizer-0',
    inputDigest: '76349251193c9dbdd968b4d79013b7a1',
    resultDigest: '8c8e8e1c74eac5f03cf9923a314d084c',
    tapeDigest: '2b6bc48aa5423e164edd92c4f19ed07a',
  },
  {
    key: 'clone-army',
    seed: 'havoc-equiv-clone-army-0',
    inputDigest: 'cea6fccfb9ed278389f1315d702b1fdf',
    resultDigest: '8a198e41d2582ded7c54e41fd65b56f1',
    tapeDigest: '746cc77627792e6224ddc4e4a523d2c6',
  },
  {
    key: 'body-snatcher',
    seed: 'havoc-equiv-body-snatcher-0',
    inputDigest: 'a28bd6c46ddb0c88cb0e8e0a35737374',
    resultDigest: '721a42062c7532fa81d673502acad976',
    tapeDigest: 'b912e24b87702ecf071635fdebcd3e5b',
  },
  {
    key: 'the-bounty',
    seed: 'havoc-equiv-the-bounty-1',
    inputDigest: '5fb5de0ce01b3a60f1c36a0a2134069c',
    resultDigest: '000b52ce7f3b54babf55c1849504de9e',
    tapeDigest: '57d5ee192196592d23fce757dd192869',
  },
  {
    key: 'fusion-dance',
    seed: 'havoc-equiv-fusion-dance-0',
    inputDigest: 'c65db327718838e32abfc051efa89777',
    resultDigest: 'ee24fb1620d5008a5f639dd8a7670526',
    tapeDigest: '4ecd5d448a88f60062e2cb32dae65134',
  },
  {
    key: 'basketball-darwinism',
    seed: 'havoc-equiv-basketball-darwinism-0',
    inputDigest: '48e9789b74b30d8f92e26ff59bdc22cb',
    resultDigest: 'c7ab287e638beeca3f3e63b41636bb2e',
    tapeDigest: '94ba5517033c0b93d2287085b8a0e267',
  },
  {
    key: 'reverse-basketball',
    seed: 'havoc-equiv-reverse-basketball-0',
    inputDigest: 'aae32a15114f3ab9d374e5d7d5756ee5',
    resultDigest: 'fb725af87c4b1a4c5e91839eadf496e8',
    tapeDigest: '96c36aa5615e51892da2756f57fb5a55',
  },
  {
    key: 'the-specialist',
    seed: 'havoc-equiv-the-specialist-0',
    inputDigest: '8eaf02fce43c802058ecaceeb391296c',
    resultDigest: 'b4c74f46e0dedb7a57565edcf44d52f6',
    tapeDigest: 'e405e92d958027b92e6563b74113003d',
  },
  {
    key: 'growth-spurt',
    seed: 'havoc-equiv-growth-spurt-0',
    inputDigest: '8edd175ff45b737b8d8a1f95ad2eff2f',
    resultDigest: '32278247309087dbb5a278e5686bed37',
    tapeDigest: '119cd4cce1059e480072132a2df36d3c',
  },
  {
    key: 'physical-size',
    seed: 'havoc-equiv-physical-size-0',
    inputDigest: 'bd8f822dd55e44f9a1772d9be77d549d',
    resultDigest: '2b9719b7db3a9ed394822f993118c0c7',
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
  digest: 'e60407b0b0e77b6c1c7d63f25bb20e60',
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
    ).toEqual([...PINNED_DRAFTS]);
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
    expect(rows, 'locked-input games').toEqual([...PINNED_LOCKED_GAMES]);
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
      expect(row, row.key).toEqual(pinned as PinnedScenario);
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
