import type { HavocMutationId, SimulationPlayer } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../../sim/kernel.ts';
import type { HavocRuntimeHooks } from '../../../sim/havoc-runtime.ts';
import type { TripContext } from '../../../sim/possession.ts';
import type { SideIndex } from '../../../sim/recorder.ts';
import type {
  Attribution,
  HavocBattleEventPayload,
  HavocBattleScoringPayload,
  ParticipantState,
  RollupCounters,
  TeamRuntime,
} from './battle-runtime-types.ts';
import { fieldGoalAttributions, havocFieldGoalValue } from './battle-scoring.ts';

const HAVOC_HEAT_STREAK_ARMS_AT = 3;
const HAVOC_ROULETTE_EVERY_ATTEMPTS = 4;
const HAVOC_ROULETTE_MIN = 1;
const HAVOC_ROULETTE_MAX = 4;
export const HAVOC_DOUBLE_MISS_PENALTY = -1;
const HAVOC_BUZZER_WINDOW_TENTHS = 50;
const HAVOC_BUZZER_MISS_PENALTY = -1;
const HAVOC_DARWINISM_OWN_TEAM_REDUCTION = 3;
const HAVOC_DARWINISM_OPPONENT_REDUCTION = 5;

export interface HavocFieldGoalHost {
  readonly teams: [TeamRuntime, TeamRuntime];
  possessionId(): number;
  tripContext(): TripContext | null;
  readonly context: EngineContext;
  requireParticipant(player: SimulationPlayer): ParticipantState;
  rollupFor(participant: ParticipantState, mutation: HavocMutationId): RollupCounters | undefined;
  activeOwners(side: SideIndex, mutation: HavocMutationId): ParticipantState[];
  runtimeSeed(...parts: readonly (string | number)[]): string;
  pushEvent(event: HavocBattleEventPayload): number;
  pushScoring(entry: HavocBattleScoringPayload): number;
  attribute(attributions: readonly Attribution[]): void;
  markDarwinismDirty(): void;
}

export class HavocFieldGoalRuntime {
  private readonly host: HavocFieldGoalHost;

  constructor(host: HavocFieldGoalHost) {
    this.host = host;
  }

  onFieldGoal(args: Parameters<HavocRuntimeHooks['onFieldGoal']>[0]): void {
    const shooter = this.host.requireParticipant(args.shooter);
    const team = this.host.teams[args.offense];
    const nominal: 2 | 3 = args.three ? 3 : 2;
    const shotSequence = this.host.pushEvent({
      kind: 'shot-attempt',
      possessionId: this.host.possessionId(),
      shooterInstanceId: shooter.instanceId,
      side: team.side,
      zone: args.zone,
      shotKind: args.shotKind,
      made: args.made,
      nominalPoints: nominal,
    });
    const putbackValid = args.putback && !args.passed;
    const putbackArm = shooter.putbackArmedAt;
    if (putbackArm !== null) {
      shooter.putbackArmedAt = null;
      const counters = this.host.rollupFor(shooter, 'second-chance-jackpot');
      if (counters !== undefined) counters.triggers += 1;
    }
    const heatBefore = shooter.mutations.has('heat-check') && shooter.heatArmed;
    const bountyBefore = shooter.mutations.has('the-bounty') && shooter.bountyArmed;
    const fourPointDunk =
      args.made && args.shotKind === 'dunk' && shooter.mutations.has('four-point-dunk');
    const reverseOwners = this.host.activeOwners(args.offense, 'reverse-basketball');
    const doubleOwners = this.host.activeOwners(args.offense, 'double-or-nothing');
    const shotClockRemaining = this.host.tripContext()?.shotClock?.remaining;
    const shotClockTenths =
      shotClockRemaining === undefined ? null : Math.round(shotClockRemaining * 10);
    const buzzerQualifies =
      shooter.active &&
      shooter.mutations.has('buzzer-bandit') &&
      shotClockTenths !== null &&
      shotClockTenths <= HAVOC_BUZZER_WINDOW_TENTHS;
    let roulette: { owner: ParticipantState; rolled: number; ordinal: number } | null = null;
    if (shooter.mutations.has('basketball-roulette')) {
      shooter.fgaCount += 1;
      if (shooter.fgaCount % HAVOC_ROULETTE_EVERY_ATTEMPTS === 0) {
        const rng = this.host.context.rngFactory(
          this.host.runtimeSeed('roulette', shooter.instanceId, shooter.fgaCount),
        );
        roulette = {
          owner: shooter,
          rolled: rng.nextInt(HAVOC_ROULETTE_MIN, HAVOC_ROULETTE_MAX),
          ordinal: shooter.fgaCount,
        };
      }
    }
    let scoringSequence: number | null = null;
    if (args.made) {
      const value = havocFieldGoalValue({
        nominal,
        three: args.three,
        roulette: roulette === null ? null : roulette.rolled,
        fourPointDunk,
        reverseBasketball: reverseOwners.length > 0,
        heatCheck: heatBefore,
        putback: putbackValid,
        bounty: bountyBefore,
        doubleOrNothing: doubleOwners.length > 0,
        buzzerBandit: buzzerQualifies,
      });
      const { attributions, ownerIds } = fieldGoalAttributions(
        value.contributions,
        shooter,
        reverseOwners,
        doubleOwners,
      );
      scoringSequence = this.host.pushScoring({
        side: team.side,
        kind: 'field-goal',
        actorInstanceId: shooter.instanceId,
        beneficiaryInstanceId: null,
        nominalPoints: nominal,
        addends: value.addends,
        multipliers: value.multipliers,
        points: value.points,
        owners: ownerIds,
        originalEventSequence: shotSequence,
      });
      this.host.attribute(attributions);
      if (buzzerQualifies) {
        const counters = this.host.rollupFor(shooter, 'buzzer-bandit');
        if (counters !== undefined) counters.triggers += 1;
        this.host.pushEvent({
          kind: 'buzzer-bandit',
          outcome: 'doubled',
          ownerInstanceId: shooter.instanceId,
          shooterInstanceId: shooter.instanceId,
          side: team.side,
          shotClockTenths: shotClockTenths,
          scoringSequence,
        });
      }
    } else {
      const penaltyOwner = doubleOwners[0];
      if (penaltyOwner !== undefined) {
        scoringSequence = this.host.pushScoring({
          side: team.side,
          kind: 'adjustment',
          actorInstanceId: shooter.instanceId,
          beneficiaryInstanceId: null,
          nominalPoints: 0,
          addends: [{ source: 'double-or-nothing', points: HAVOC_DOUBLE_MISS_PENALTY }],
          multipliers: [],
          points: HAVOC_DOUBLE_MISS_PENALTY,
          owners: doubleOwners.map((owner) => owner.instanceId),
          originalEventSequence: shotSequence,
        });
        this.host.attribute([
          {
            owner: penaltyOwner,
            mutationId: 'double-or-nothing',
            points: HAVOC_DOUBLE_MISS_PENALTY,
          },
        ]);
      }
      if (buzzerQualifies) {
        const penaltySequence = this.host.pushScoring({
          side: team.side,
          kind: 'adjustment',
          actorInstanceId: shooter.instanceId,
          beneficiaryInstanceId: null,
          nominalPoints: 0,
          addends: [{ source: 'buzzer-bandit', points: HAVOC_BUZZER_MISS_PENALTY }],
          multipliers: [],
          points: HAVOC_BUZZER_MISS_PENALTY,
          owners: [shooter.instanceId],
          originalEventSequence: shotSequence,
        });
        const counters = this.host.rollupFor(shooter, 'buzzer-bandit');
        if (counters !== undefined) {
          counters.triggers += 1;
          counters.pointsDelta += HAVOC_BUZZER_MISS_PENALTY;
        }
        this.host.pushEvent({
          kind: 'buzzer-bandit',
          outcome: 'penalized',
          ownerInstanceId: shooter.instanceId,
          shooterInstanceId: shooter.instanceId,
          side: team.side,
          shotClockTenths: shotClockTenths,
          scoringSequence: penaltySequence,
        });
      }
    }
    if (args.made) {
      const darwinismOwners = [
        ...this.host.activeOwners(0, 'basketball-darwinism'),
        ...this.host.activeOwners(1, 'basketball-darwinism'),
      ];
      const primary = darwinismOwners[0];
      if (primary !== undefined) {
        const reduction = darwinismOwners.some((owner) => owner.sideIndex === shooter.sideIndex)
          ? HAVOC_DARWINISM_OWN_TEAM_REDUCTION
          : HAVOC_DARWINISM_OPPONENT_REDUCTION;
        shooter.darwinismDecayPoints += reduction;
        for (const owner of darwinismOwners) {
          const counters = this.host.rollupFor(owner, 'basketball-darwinism');
          if (counters !== undefined) {
            counters.triggers += 1;
            counters.ratingChanges += reduction;
          }
        }
        this.host.pushEvent({
          kind: 'darwinism',
          ownerInstanceId: primary.instanceId,
          side: this.host.teams[primary.sideIndex].side,
          shooterInstanceId: shooter.instanceId,
          shooterDecayAfter: shooter.darwinismDecayPoints,
        });
        this.host.markDarwinismDirty();
      }
    }
    const mutate = (participant: ParticipantState, mutationId: HavocMutationId): void => {
      const counters = this.host.rollupFor(participant, mutationId);
      if (counters !== undefined) counters.triggers += 1;
    };
    if (fourPointDunk) {
      mutate(shooter, 'four-point-dunk');
      this.host.pushEvent({
        kind: 'four-point-dunk',
        shooterInstanceId: shooter.instanceId,
        side: team.side,
        scoringSequence: scoringSequence ?? 0,
      });
    }
    if (putbackArm !== null) {
      if (putbackValid && args.made) {
        this.host.pushEvent({
          kind: 'putback',
          outcome: 'consumed',
          ownerInstanceId: shooter.instanceId,
          side: team.side,
          reboundSequence: putbackArm,
          scoringSequence,
        });
      } else {
        this.host.pushEvent({
          kind: 'putback',
          outcome: 'lost',
          ownerInstanceId: shooter.instanceId,
          side: team.side,
          reboundSequence: putbackArm,
          scoringSequence: null,
        });
      }
    }
    for (const mate of team.active) {
      if (mate.instanceId === shooter.instanceId) continue;
      const arm = mate.putbackArmedAt;
      if (arm === null) continue;
      mate.putbackArmedAt = null;
      this.host.pushEvent({
        kind: 'putback',
        outcome: 'lost',
        ownerInstanceId: mate.instanceId,
        side: team.side,
        reboundSequence: arm,
        scoringSequence: null,
      });
    }
    if (shooter.mutations.has('heat-check')) {
      if (args.made) {
        if (heatBefore) {
          shooter.heatArmed = false;
          shooter.heatArmedAt = null;
          shooter.fgStreak = 0;
          mutate(shooter, 'heat-check');
          this.host.pushEvent({
            kind: 'heat-check',
            outcome: 'consumed',
            ownerInstanceId: shooter.instanceId,
            side: team.side,
            scoringSequence,
          });
        } else {
          shooter.fgStreak += 1;
          if (shooter.fgStreak >= HAVOC_HEAT_STREAK_ARMS_AT) {
            shooter.heatArmed = true;
            shooter.heatArmedAt = this.host.possessionId();
            mutate(shooter, 'heat-check');
            this.host.pushEvent({
              kind: 'heat-check',
              outcome: 'armed',
              ownerInstanceId: shooter.instanceId,
              side: team.side,
              scoringSequence: null,
            });
          }
        }
      } else {
        shooter.fgStreak = 0;
        if (shooter.heatArmed) {
          shooter.heatArmed = false;
          shooter.heatArmedAt = null;
          this.host.pushEvent({
            kind: 'heat-check',
            outcome: 'expired',
            ownerInstanceId: shooter.instanceId,
            side: team.side,
            scoringSequence: null,
          });
        }
      }
    }
    if (args.made && bountyBefore) {
      shooter.bountyArmed = false;
      shooter.bountyArmedAt = null;
      mutate(shooter, 'the-bounty');
      this.host.pushEvent({
        kind: 'bounty',
        outcome: 'consumed',
        ownerInstanceId: shooter.instanceId,
        side: team.side,
        blockedInstanceId: null,
        scoringSequence,
      });
    }
    if (roulette !== null) {
      mutate(roulette.owner, 'basketball-roulette');
      this.host.pushEvent({
        kind: 'roulette',
        ownerInstanceId: roulette.owner.instanceId,
        side: team.side,
        attemptOrdinal: roulette.ordinal,
        rolled: roulette.rolled,
        nominal,
        scoringSequence: args.made ? scoringSequence : null,
      });
    }
  }
}
