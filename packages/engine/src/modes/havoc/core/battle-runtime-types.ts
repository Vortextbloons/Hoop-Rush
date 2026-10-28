import type {
  HavocBattleEvent,
  HavocBattleScoringEntry,
  HavocBattleTeamInput,
  HavocHomeAway,
  HavocMutationId,
  HavocParticipant,
  HavocParticipantKind,
  HavocScoringSource,
  Position,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { HavocEvidence } from '../../../sim/havoc-runtime.ts';
import type { SideIndex } from '../../../sim/recorder.ts';

export interface RollupCounters {
  triggers: number;
  pointsDelta: number;
  freeThrowsGranted: number;
  turnoversCancelled: number;
  extraPossessionsEarned: number;
  extraPossessionsUsed: number;
  extraPossessionsExpired: number;
  swapPoints: number;
  ratingChanges: number;
}

export interface ParticipantState {
  instanceId: string;
  kind: HavocParticipantKind;
  slot: Position;
  slotIndex: number;
  ownerInstanceId: string | null;
  source: HavocParticipant['source'];
  effective: HavocParticipant['effective'];
  mutations: Set<HavocMutationId>;
  sideIndex: SideIndex;
  rosterIndex: number;
  active: boolean;
  started: boolean;
  replaced: boolean;
  cloneExited: boolean;
  committedFouls: number;
  chargedFouls: number;
  swapWith: string | null;
  swappedBy: string | null;
  fgStreak: number;
  heatArmed: boolean;
  heatArmedAt: number | null;
  fgaCount: number;
  assistCount: number;
  shootingFoulsDrawn: number;
  refundUsed: boolean[];
  reboundLoopCount: number;
  putbackArmedAt: number | null;
  bountyArmed: boolean;
  bountyArmedAt: number | null;
  activeSeconds: number;
  darwinismDecayPoints: number;
  fusionDonorInstanceId: string | null;
  fusionOwnerInstanceId: string | null;
  simPlayer: SimulationPlayer;
  evidence: HavocEvidence | undefined;
  rollup: Map<HavocMutationId, RollupCounters>;
}

export interface TeamRuntime {
  sideIndex: SideIndex;
  side: HavocHomeAway;
  input: HavocBattleTeamInput;
  participants: ParticipantState[];
  active: ParticipantState[];
  byId: Map<string, ParticipantState>;
  extraQueue: Array<{ ownerInstanceId: string; side: HavocHomeAway }>;
}

export type HavocBattleEventPayload = HavocBattleEvent extends infer E
  ? E extends HavocBattleEvent
    ? Omit<E, 'sequence' | 'gameNumber' | 'period' | 'clockSeconds'>
    : never
  : never;

export type HavocBattleScoringPayload = Omit<
  HavocBattleScoringEntry,
  'sequence' | 'gameNumber' | 'period' | 'clockSeconds' | 'possessionId'
>;

export interface Attribution {
  owner: ParticipantState;
  mutationId: HavocScoringSource;
  points: number;
}
