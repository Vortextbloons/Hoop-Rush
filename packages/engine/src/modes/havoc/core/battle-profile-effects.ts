import type { SimulationRatings } from '@hoop-rush/data-contracts';
import { HAVOC_SCORING_RATING_FIELDS, REQUIRED_RATING_KEYS } from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from '../../../sim/constants.ts';
import { type TripContext } from '../../../sim/possession.ts';
import { type SideIndex } from '../../../sim/recorder.ts';
import type { HavocMutationLedger } from './battle-mutation-ledger.ts';
import type { HavocParticipants } from './battle-participants.ts';
import type { ParticipantState, TeamRuntime } from './battle-runtime-types.ts';
const HAVOC_EQUALIZER_CAP = 85;
const HAVOC_FUSION_DONOR_RATING = 40;
const HAVOC_CENTERS_HEIGHT_INCHES = 87;
const HAVOC_CENTERS_ELITE_RATING = 95;
const HAVOC_CENTERS_SPEED_CAP = 35;
const HAVOC_CENTERS_HANDLING_CAP = 35;
const HAVOC_CENTERS_THREE_CAP = 40;
function capRatings(ratings: SimulationRatings, cap: number): SimulationRatings {
  return {
    insideScoring: Math.min(cap, ratings.insideScoring),
    closeShot: Math.min(cap, ratings.closeShot),
    midrange: Math.min(cap, ratings.midrange),
    threePoint: Math.min(cap, ratings.threePoint),
    freeThrow: Math.min(cap, ratings.freeThrow),
    ballHandling: Math.min(cap, ratings.ballHandling),
    passing: Math.min(cap, ratings.passing),
    offensiveIq: Math.min(cap, ratings.offensiveIq),
    offensiveRebound: Math.min(cap, ratings.offensiveRebound),
    defensiveRebound: Math.min(cap, ratings.defensiveRebound),
    perimeterDefense: Math.min(cap, ratings.perimeterDefense),
    interiorDefense: Math.min(cap, ratings.interiorDefense),
    steal: Math.min(cap, ratings.steal),
    block: Math.min(cap, ratings.block),
    defensiveIq: Math.min(cap, ratings.defensiveIq),
    speed: Math.min(cap, ratings.speed),
    strength: Math.min(cap, ratings.strength),
    vertical: Math.min(cap, ratings.vertical),
  };
}
function centersRatings(ratings: SimulationRatings): SimulationRatings {
  return {
    ...ratings,
    strength: Math.max(ratings.strength, HAVOC_CENTERS_ELITE_RATING),
    interiorDefense: Math.max(ratings.interiorDefense, HAVOC_CENTERS_ELITE_RATING),
    offensiveRebound: Math.max(ratings.offensiveRebound, HAVOC_CENTERS_ELITE_RATING),
    defensiveRebound: Math.max(ratings.defensiveRebound, HAVOC_CENTERS_ELITE_RATING),
    speed: Math.min(ratings.speed, HAVOC_CENTERS_SPEED_CAP),
    ballHandling: Math.min(ratings.ballHandling, HAVOC_CENTERS_HANDLING_CAP),
    threePoint: Math.min(ratings.threePoint, HAVOC_CENTERS_THREE_CAP),
  };
}
interface ProfileOptions {
  fullShotClock(side: SideIndex): number;
  tripContext(): TripContext | null;
}
export class HavocProfileEffects {
  private lastTimeLord: [number, number] = [
    ENGINE_CONSTANTS.shotClockSeconds,
    ENGINE_CONSTANTS.shotClockSeconds,
  ];
  private lastCapped: [string[], string[]] = [[], []];
  private equalizerApplied: [boolean, boolean] = [false, false];
  private readonly participants: HavocParticipants;
  private readonly ledger: HavocMutationLedger;
  private readonly options: ProfileOptions;
  constructor(
    participants: HavocParticipants,
    ledger: HavocMutationLedger,
    options: ProfileOptions,
  ) {
    this.participants = participants;
    this.ledger = ledger;
    this.options = options;
  }
  private get teams(): [TeamRuntime, TeamRuntime] {
    return this.participants.teams;
  }
  private get tripContext(): TripContext | null {
    return this.options.tripContext();
  }
  equalizerApplies(participant: ParticipantState): boolean {
    return this.teams.some(
      (team) =>
        team.sideIndex !== participant.sideIndex &&
        this.participants.activeOwners(team.sideIndex, 'the-great-equalizer').length > 0,
    );
  }
  recomputeEqualizer(tipoff: boolean): boolean {
    let changed = false;
    for (const sideIndex of [0, 1] as const) {
      const owners = this.participants.activeOwners(sideIndex, 'the-great-equalizer');
      if (owners.length === 0) continue;
      const cappedIds = this.teams[(1 - sideIndex) as SideIndex].active
        .map((participant) => participant.instanceId)
        .sort();
      if (!tipoff && cappedIds.join(',') === this.lastCapped[sideIndex].join(',')) continue;
      this.lastCapped[sideIndex] = cappedIds;
      changed = true;
      const owner = owners[0];
      if (owner === undefined) continue;
      const counters = this.ledger.rollupFor(owner, 'the-great-equalizer');
      if (counters !== undefined) counters.triggers += 1;
      this.ledger.pushEvent({
        kind: 'great-equalizer',
        outcome: this.equalizerApplied[sideIndex] ? 'updated' : 'applied',
        ownerInstanceId: owner.instanceId,
        cappedInstanceIds: cappedIds.slice(0, 10),
      });
      this.equalizerApplied[sideIndex] = true;
    }
    if (!tipoff && changed) this.rebuildBattleProfiles();
    return changed;
  }
  recomputeTimeLord(source: 'tipoff' | 'owner-exit'): boolean {
    const limits: [number, number] = [this.options.fullShotClock(0), this.options.fullShotClock(1)];
    const changed = limits[0] !== this.lastTimeLord[0] || limits[1] !== this.lastTimeLord[1];
    if (!changed) return false;
    const previous = [...this.lastTimeLord] as [number, number];
    this.lastTimeLord = limits;
    for (const side of [0, 1] as const) {
      if (limits[side] === previous[side]) continue;
      this.ledger.pushEvent({
        kind: 'time-lord',
        side: this.teams[side].side,
        fullSeconds: limits[side],
        reboundSeconds: Math.min(14, limits[side]),
        source,
      });
      if (
        this.tripContext !== null &&
        this.tripContext.shotClock !== undefined &&
        source === 'owner-exit'
      ) {
        this.tripContext.shotClock.remaining = Math.min(
          this.tripContext.shotClock.remaining,
          limits[side],
        );
      }
    }
    return true;
  }
  rebuildBattleProfiles(): void {
    for (const team of this.teams) {
      for (const participant of team.participants) {
        let ratings = { ...participant.effective.ratings };
        let tendencies = { ...participant.effective.tendencies };
        if (participant.fusionDonorInstanceId !== null) {
          const donor = this.participants.globalById(participant.fusionDonorInstanceId);
          if (donor !== null && participant.active) {
            for (const field of REQUIRED_RATING_KEYS) {
              ratings[field] = Math.max(ratings[field], donor.effective.ratings[field]);
            }
            tendencies.usageRate = 99;
          }
        } else if (participant.fusionOwnerInstanceId !== null) {
          const owner = this.participants.globalById(participant.fusionOwnerInstanceId);
          if (owner !== null && owner.active) {
            for (const field of REQUIRED_RATING_KEYS) {
              ratings[field] = HAVOC_FUSION_DONOR_RATING;
            }
          }
        }
        if (participant.swapWith !== null) {
          const target = this.participants.globalById(participant.swapWith);
          if (target !== null) {
            ratings = { ...target.source.profile.ratings };
            tendencies = { ...target.source.profile.tendencies };
          }
        } else if (participant.swappedBy !== null) {
          const owner = this.participants.globalById(participant.swappedBy);
          if (owner !== null) {
            ratings = { ...owner.source.profile.ratings };
            tendencies = { ...owner.source.profile.tendencies };
          }
        }
        if (participant.takeoverWith !== null) {
          const target = this.participants.globalById(participant.takeoverWith);
          if (target !== null) {
            ratings = { ...target.effective.ratings };
            tendencies = { ...target.effective.tendencies };
          }
        } else if (participant.takeoverBy !== null) {
          const owner = this.participants.globalById(participant.takeoverBy);
          if (owner !== null) {
            ratings = { ...owner.effective.ratings };
            tendencies = { ...owner.effective.tendencies };
          }
        }
        let heightInches = participant.effective.physical.heightInches;
        if (team.centersOwner !== null && participant.kind !== 'clone') {
          heightInches = HAVOC_CENTERS_HEIGHT_INCHES;
          ratings = centersRatings(ratings);
        }
        if (participant.darwinismDecayPoints > 0) {
          for (const field of HAVOC_SCORING_RATING_FIELDS) {
            ratings[field] = Math.max(0, ratings[field] - participant.darwinismDecayPoints);
          }
        }
        if (this.equalizerApplies(participant)) {
          ratings = capRatings(ratings, HAVOC_EQUALIZER_CAP);
        }
        participant.evidence =
          participant.effective.authoritativeChannels.length === 0
            ? undefined
            : {
                isAuthoritative: (channel) =>
                  participant.effective.authoritativeChannels.includes(channel),
              };
        participant.simPlayer = {
          playerId: participant.source.playerId,
          ...(participant.source.playerVersionId === null
            ? {}
            : { playerVersionId: participant.source.playerVersionId }),
          displayName: participant.source.displayName,
          positions: participant.source.positions,
          heightInches,
          weightLbs: participant.effective.physical.weightLbs,
          ratings,
          tendencies,
          ...(participant.source.profile.anchors === undefined
            ? {}
            : { anchors: participant.source.profile.anchors }),
          ...(participant.source.profile.reconstructedThreePoint === undefined
            ? {}
            : { reconstructedThreePoint: participant.source.profile.reconstructedThreePoint }),
          overall: participant.source.originalOverall,
        };
      }
    }
    this.participants.reindex();
  }
}
