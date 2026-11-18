import { HIGH_USAGE } from './runtime-test-support.ts';
import { RIM_ATTACK } from './runtime-test-support.ts';
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
    transcriptDigest: 'ea3c6a13f073815faa60a4c9b75cafe3',
    rerollStateDigest: null,
    lockedStateDigest: 'c3a8ffa7083a6ea3528be54d4c113877',
  },
  {
    seed: 'havoc-equiv-b',
    rerollOnFirstTurn: true,
    transcriptDigest: '7440e9f102c0f2bd1c23fccf05055081',
    rerollStateDigest: '7e536ca67ee8d5baa499d444495ef6f6',
    lockedStateDigest: '196f97c0f1c1ff24c84c49feb29ebad0',
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
    inputDigest: '64b04649a2bc6df50e20a90b1c727399',
    resultDigest: 'fb591414a9767128fc361206ee3b5ae4',
    tapeDigest: '24429d054ca374c989d82f2bcabccdf5',
    humanScore: 102,
    opponentScore: 98,
    winner: 'home',
  },
  {
    key: 'normal-g1',
    inputDigest: '9998989b217b0a3f1a2620215375d90b',
    resultDigest: '56e0ed215d134a65cfd54b1f1707a771',
    tapeDigest: '2f1355c526e13e119252e81749152e95',
    humanScore: 102,
    opponentScore: 98,
    winner: 'home',
  },
  {
    key: 'havoc-g41',
    inputDigest: '9efa1b126207fc0e40e50404b0b13382',
    resultDigest: '22f15f7fd81b0d93ba4a804d04faacef',
    tapeDigest: '73900895c8bd2b7942cb0ac74a6da385',
    humanScore: 110,
    opponentScore: 106,
    winner: 'home',
  },
  {
    key: 'normal-g41',
    inputDigest: '2f7d9262fb0bdeb6e9006d88e6d00af2',
    resultDigest: 'f442a5555a2e1e310ac16e57a9146725',
    tapeDigest: 'ea7af8354f8369e1dc1f7b9bc4ce9145',
    humanScore: 110,
    opponentScore: 106,
    winner: 'home',
  },
  {
    key: 'havoc-g82',
    inputDigest: '1198159f09fb86eba9d52b4df5d25e4f',
    resultDigest: '86f575c667683a4225dca2f4c9569996',
    tapeDigest: '301be1a01645f4d40b940e724a5224b0',
    humanScore: 106,
    opponentScore: 105,
    winner: 'away',
  },
  {
    key: 'normal-g82',
    inputDigest: '2aef73eda28b5481e4d1b5c7dec9533d',
    resultDigest: '5ce7973959503d1da56d62e3c3697829',
    tapeDigest: '28346096610cd1f287aae34caf10acc6',
    humanScore: 106,
    opponentScore: 105,
    winner: 'away',
  },
];

interface PinnedGameOneSummaries {
  readonly havoc: string;
  readonly normal: string;
}

const PINNED_GAME_ONE_SUMMARY_DIGESTS: PinnedGameOneSummaries = {
  havoc: 'e74bfdc96538479d9030a2ebf6cb78d9',
  normal: '12addb1360bad257d54091891ab70203',
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
    inputDigest: '28799c0347b1b40725592bf9e2e907f3',
    resultDigest: 'c73ea50ff15b8afba3352561ade07c9f',
    tapeDigest: '4ec2baaf26e8a7b3f949caa5d654b83f',
  },
  {
    key: 'tier1-profile-package',
    seed: 'havoc-equiv-tier1-profile-package-0',
    inputDigest: '4f05597d3c128f71c753bdd7d0bab58d',
    resultDigest: '617e0c217817a39d57d8069ffb7c1191',
    tapeDigest: '1e9ea77629962432add6f16870dd3926',
  },
  {
    key: 'heat-check',
    seed: 'havoc-equiv-heat-check-2',
    inputDigest: '05e0925cc94486e89332195a59efcd4c',
    resultDigest: '6d52819deff29221238c8323b333d4ed',
    tapeDigest: 'e10e713167d4ed454cb10d0394728601',
  },
  {
    key: 'basketball-roulette',
    seed: 'havoc-equiv-basketball-roulette-0',
    inputDigest: '1bffe57d7ab8ea61701cca0bea01032d',
    resultDigest: 'aa33a22dba5d3571df356963973a461d',
    tapeDigest: '2bb07cc27453a4167bca26dcd48f71b2',
  },
  {
    key: 'double-or-nothing',
    seed: 'havoc-equiv-double-or-nothing-0',
    inputDigest: '605a7f2af06bbd46c49e34e0569a8dba',
    resultDigest: '45147cb29e24822e506c16e45101e882',
    tapeDigest: '2c2fccec155a4cd8687eea7e171df9fc',
  },
  {
    key: 'charity-casino',
    seed: 'havoc-equiv-charity-casino-0',
    inputDigest: 'b9adb67701b9d6833a531d9911283d07',
    resultDigest: '0a0873f2d16e8e5eb00833a867a3a562',
    tapeDigest: 'abc339c36f0ae4ff0335eba9f63de513',
  },
  {
    key: 'buzzer-bandit',
    seed: 'havoc-equiv-buzzer-bandit-0',
    inputDigest: '45f37398bf021b3c595a301eeb1d5668',
    resultDigest: '7c82d8cb2165b15f8dee0e7555e1563b',
    tapeDigest: 'f1dfcf0f81e56ae3ad74cce1c4d8863f',
  },
  {
    key: 'four-point-dunk',
    seed: 'havoc-equiv-four-point-dunk-0',
    inputDigest: '52fea1b1bc6919ede77cbf2bcd877cc1',
    resultDigest: '5c65ee7245b208aeeaf7dea02658b062',
    tapeDigest: '5e987f95ffdadb812b78b91faeeacbc5',
  },
  {
    key: 'time-lord',
    seed: 'havoc-equiv-time-lord-0',
    inputDigest: '2750bed8e8d5cb7403438f96deaeb6c8',
    resultDigest: '10ecbf989f872decddd6c346249f6468',
    tapeDigest: '75e3ecd47400065806ce1b86ac61e1a4',
  },
  {
    key: 'the-great-equalizer',
    seed: 'havoc-equiv-the-great-equalizer-0',
    inputDigest: '4fb068c9288d4d658687326f66a64b99',
    resultDigest: '773feb8dde76b129fdeace8f51a4057d',
    tapeDigest: '5c35da6a1b58f60e2d97a8c83353e7da',
  },
  {
    key: 'clone-army',
    seed: 'havoc-equiv-clone-army-0',
    inputDigest: '02888677a94a072bc99857f56790e3c7',
    resultDigest: '256c3a57ec6ce1bbdb49390d2b476927',
    tapeDigest: 'f33e6f80ffb8728c8b460f122493f250',
  },
  {
    key: 'body-snatcher',
    seed: 'havoc-equiv-body-snatcher-0',
    inputDigest: '636c2258b1e530acf3abf07e988d6908',
    resultDigest: 'ae13a12eb181761a17633a682e4a1c7e',
    tapeDigest: '3a29267dc92def41619e867b68fd746d',
  },
  {
    key: 'the-bounty',
    seed: 'havoc-equiv-the-bounty-1',
    inputDigest: '1f6faf4006c36e041d38093e73516150',
    resultDigest: '0a0fd7a7f591df2b0e4490416a77f5d7',
    tapeDigest: '55f4f4dd0cf21051664ca8afb3780fcd',
  },
  {
    key: 'fusion-dance',
    seed: 'havoc-equiv-fusion-dance-0',
    inputDigest: '499c93afef22d5eb88e099f9a40c51ff',
    resultDigest: 'bc47c217ffced013c83a77d950769e87',
    tapeDigest: '6b5e8f4aadfbdcbef2dcf6fc35f0c89a',
  },
  {
    key: 'basketball-darwinism',
    seed: 'havoc-equiv-basketball-darwinism-0',
    inputDigest: 'c2eb474300036557eb84282d719e5eb3',
    resultDigest: '696ff72df1a294d973fddaa7f9dc46dd',
    tapeDigest: '9a1583753f4c95b1939cc65724c357c5',
  },
  {
    key: 'reverse-basketball',
    seed: 'havoc-equiv-reverse-basketball-0',
    inputDigest: '97bdc35d52e287d1272ff38f1422082d',
    resultDigest: 'de704bcbc330327f7cd10e2da602d81b',
    tapeDigest: 'ebb0306a34a8c726eaad66c4c236b5da',
  },
  {
    key: 'the-specialist',
    seed: 'havoc-equiv-the-specialist-0',
    inputDigest: 'f4c1d35013fdf284d3a05722b0ef6080',
    resultDigest: 'e421d9afca63d4bb13d14d2122e2e81f',
    tapeDigest: 'b278d138694d551c710b26fe50104c08',
  },
  {
    key: 'growth-spurt',
    seed: 'havoc-equiv-growth-spurt-0',
    inputDigest: 'ed22a0570fe680f37dd6729db7136ca7',
    resultDigest: '59bf143bf1368adf968c13a12deec62b',
    tapeDigest: '44598ba9111db06de65064af694e6e19',
  },
  {
    key: 'physical-size',
    seed: 'havoc-equiv-physical-size-0',
    inputDigest: '11d86415f6da0ff1d9ab6ab3f5be2e45',
    resultDigest: 'f6dd27b291936dc6b972cc4cc74a0a42',
    tapeDigest: '48c03df98f0263654968e10b01b1e329',
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
  digest: 'ef6075d190ff819d0b9a3ba35e3e5d21',
  havocWins: 51,
  havocLosses: 31,
  normalWins: 51,
  normalLosses: 31,
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
    seed: 'havoc-equiv-heat-check-2',
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
