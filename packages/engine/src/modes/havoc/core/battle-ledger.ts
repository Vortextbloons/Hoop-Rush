import type { HavocParticipantKind } from '@hoop-rush/data-contracts';

/**
 * Numeric layout of the shared possession kernel's event and scoring records.
 * `battle-wasm.ts` decodes these into typed tape objects for playback; games
 * without playback audit the same records in place instead.
 */
export const BATTLE_LEDGER_EVENT_FIELDS = 25;
export const BATTLE_LEDGER_SCORING_FIELDS = 44;

/** Kernel event kind numbers, matching `decodeEvents` in `battle-wasm.ts`. */
export const BATTLE_LEDGER_EVENT = {
  periodStart: 1,
  periodEnd: 2,
  possessionStart: 3,
  shotAttempt: 4,
  freeThrowAttempt: 5,
  rebound: 6,
  assist: 7,
  steal: 8,
  block: 9,
  turnover: 10,
  turnoverCancelled: 11,
  foul: 12,
  substitution: 13,
  shotClockViolation: 14,
  extraPossession: 15,
  clone: 16,
  timeLord: 17,
  bodySnatcher: 18,
  greatEqualizer: 19,
  fourPointDunk: 20,
  goldenAssist: 21,
  heatCheck: 22,
  putback: 23,
  andOneBonus: 24,
  doubleOrNothingFoul: 25,
  possessionRefund: 26,
  reboundLoop: 27,
  bounty: 28,
  foulRelief: 29,
  roulette: 30,
  buzzerBandit: 31,
  charityCasino: 32,
  fusionDance: 33,
  darwinism: 34,
  coldBlooded: 35,
  tripleThreat: 36,
  oopsAllCenters: 37,
  hostileTakeover: 38,
  gameEnd: 39,
} as const;

/** Kernel scoring entry kinds, matching `decodeScoring` in `battle-wasm.ts`. */
export const BATTLE_LEDGER_SCORING_KIND = {
  fieldGoal: 0,
  freeThrow: 1,
  adjustment: 2,
  bonus: 3,
} as const;

/** Kernel scoring source index order, matching `decodeScoring`. */
export const BATTLE_LEDGER_SCORING_SOURCES = [
  'roulette',
  'four-point-dunk',
  'reverse-basketball',
  'golden-assist',
  'double-or-nothing',
  'heat-check',
  'second-chance-jackpot',
  'the-bounty',
  'buzzer-bandit',
  'charity-casino',
  'cold-blooded',
  'triple-threat',
] as const;

/**
 * Participant identity exactly as the kernel indexes it in the numeric ledger:
 * all home starters, replacements, and clones, then the same away order.
 */
export interface HavocBattleLedgerParticipant {
  readonly instanceId: string;
  readonly sideIndex: 0 | 1;
  readonly kind: HavocParticipantKind;
  readonly slot: string;
  readonly ownerInstanceId: string | null;
  readonly sourcePlayerId: string;
  readonly sourcePlayerVersionId: string | null;
  readonly mutations: ReadonlySet<string>;
}

/**
 * Compact, playback-free view of a battle: the kernel's own numeric event and
 * scoring records plus the participant index they refer to. Every accounting
 * check that a full tape audit performs reads only these fields.
 */
export interface HavocBattleLedger {
  readonly participants: readonly HavocBattleLedgerParticipant[];
  readonly events: Float64Array;
  readonly eventCount: number;
  readonly scoring: Float64Array;
  readonly scoringCount: number;
}
