import type {
  HavocBattleInput,
  HavocBattleTeamInput,
  HavocMutationId,
  HavocParticipant,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { HAVOC_PERSONAL_FOUL_LIMIT, POSITIONS } from '@hoop-rush/data-contracts';
import type { HavocEvidence } from '../../../sim/havoc-runtime.ts';
import { type TripContext } from '../../../sim/possession.ts';
import { prepareTeam } from '../../../sim/prepare.ts';
import { GameRecorder, type SideIndex } from '../../../sim/recorder.ts';
import type {
  HavocBattleEventPayload,
  ParticipantState,
  TeamRuntime,
} from './battle-runtime-types.ts';

import { zeroRollup } from './battle-mutation-ledger.ts';
interface ParticipantOptions {
  tripContext(): TripContext;
  evidenceOf(player: SimulationPlayer): HavocEvidence | undefined;
  reboundWeightScale(player: SimulationPlayer): number;
  reboundMeanReach(player: SimulationPlayer): number;
  pushEvent(event: HavocBattleEventPayload): number;
}
export class HavocParticipants {
  readonly teams: [TeamRuntime, TeamRuntime];
  private readonly playerInstance = new Map<SimulationPlayer, ParticipantState>();
  private readonly profile: HavocBattleInput['profile'];
  private readonly recorder: GameRecorder;
  private readonly options: ParticipantOptions;
  constructor(input: HavocBattleInput, recorder: GameRecorder, options: ParticipantOptions) {
    this.profile = input.profile;
    this.recorder = recorder;
    this.options = options;
    this.teams = [this.buildTeam(input.home, 0), this.buildTeam(input.away, 1)];
  }
  get(player: SimulationPlayer): ParticipantState | undefined {
    return this.playerInstance.get(player);
  }
  reindex(): void {
    this.playerInstance.clear();
    for (const team of this.teams)
      for (const participant of team.participants)
        this.playerInstance.set(participant.simPlayer, participant);
  }
  processExits(): boolean {
    let changed = false;
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (!participant.active) continue;
        if (participant.chargedFouls < HAVOC_PERSONAL_FOUL_LIMIT) continue;
        if (participant.kind === 'starter' && !participant.replaced) {
          const replacement = team.participants.find(
            (candidate) =>
              candidate.kind === 'replacement' &&
              candidate.ownerInstanceId === participant.instanceId,
          );
          participant.active = false;
          participant.replaced = true;
          if (replacement !== undefined) {
            replacement.active = true;
            replacement.started = true;
          }
          this.options.pushEvent({
            kind: 'substitution',
            outInstanceId: participant.instanceId,
            inInstanceId: replacement?.instanceId ?? participant.instanceId,
            reason: 'foul-out',
          });
          this.endPowersFor(participant);
          this.removeClone(team, participant.instanceId, 'owner-exited');
          changed = true;
        } else if (participant.kind === 'clone') {
          this.removeClone(team, participant.ownerInstanceId ?? '', 'fouled-out');
          changed = true;
        }
      }
    }

    return changed;
  }
  buildTeam(input: HavocBattleTeamInput, sideIndex: SideIndex): TeamRuntime {
    const participants: ParticipantState[] = [];
    const byId = new Map<string, ParticipantState>();
    const add = (participant: HavocParticipant): void => {
      const mutations = new Set(participant.mutationPackage.map((entry) => entry.mutationId));
      const state: ParticipantState = {
        instanceId: participant.instanceId,
        kind: participant.kind,
        slot: participant.slot,
        slotIndex: Math.max(0, POSITIONS.indexOf(participant.slot)),
        ownerInstanceId: participant.ownerInstanceId,
        source: participant.source,
        effective: participant.effective,
        mutations,
        sideIndex,
        rosterIndex: participants.length,
        active: false,
        started: false,
        replaced: false,
        cloneExited: false,
        committedFouls: 0,
        chargedFouls: 0,
        swapWith: null,
        swappedBy: null,
        fgStreak: 0,
        heatArmed: false,
        heatArmedAt: null,
        fgaCount: 0,
        assistCount: 0,
        shootingFoulsDrawn: 0,
        refundUsed: [],
        reboundLoopCount: 0,
        putbackArmedAt: null,
        bountyArmed: false,
        bountyArmedAt: null,
        activeSeconds: 0,
        darwinismDecayPoints: 0,
        fusionDonorInstanceId: null,
        fusionOwnerInstanceId: null,
        coldBloodStreak: 0,
        tripleThreatPeriod: 0,
        tripleThreatZones: [],
        tripleThreatArmed: false,
        takeoverFromInstanceId: null,
        takeoverToInstanceId: null,
        takeoverWith: null,
        takeoverBy: null,
        simPlayer: undefined as unknown as SimulationPlayer,
        evidence: undefined,
        rollup: new Map(),
      };
      for (const mutation of mutations) state.rollup.set(mutation, zeroRollup());
      participants.push(state);
      byId.set(state.instanceId, state);
    };
    for (const starter of input.starters) add(starter);
    for (const replacement of input.replacements) add(replacement);
    for (const clone of input.clones) add(clone);
    const team: TeamRuntime = {
      sideIndex,
      side: input.side,
      input,
      participants,
      active: [],
      byId,
      extraQueue: [],
      centersOwner: null,
    };
    for (const participant of participants) {
      if (participant.kind === 'starter') {
        participant.active = true;
        participant.started = true;
      }
    }
    return team;
  }
  participantOf(player: SimulationPlayer | null): ParticipantState | null {
    if (player === null) return null;
    return this.playerInstance.get(player) ?? null;
  }
  requireParticipant(player: SimulationPlayer): ParticipantState {
    const participant = this.playerInstance.get(player);
    if (participant === undefined) {
      throw new Error(`havoc: unknown runtime participant ${player.playerId}`);
    }
    return participant;
  }
  globalById(instanceId: string): ParticipantState | null {
    return this.teams[0].byId.get(instanceId) ?? this.teams[1].byId.get(instanceId) ?? null;
  }
  activeOwners(side: SideIndex, mutationId: HavocMutationId): ParticipantState[] {
    return this.teams[side].active.filter((participant) => participant.mutations.has(mutationId));
  }
  endPowersFor(participant: ParticipantState): void {
    participant.heatArmed = false;
    participant.heatArmedAt = null;
    participant.fgStreak = 0;
    participant.bountyArmed = false;
    participant.bountyArmedAt = null;
    participant.putbackArmedAt = null;
    participant.coldBloodStreak = 0;
    participant.tripleThreatZones = [];
    const ownTeam = this.teams[participant.sideIndex];
    if (ownTeam.centersOwner === participant.instanceId) ownTeam.centersOwner = null;
    if (participant.fusionDonorInstanceId !== null) {
      const donorId = participant.fusionDonorInstanceId;
      const donor = this.globalById(donorId);
      participant.fusionDonorInstanceId = null;
      if (donor !== null) donor.fusionOwnerInstanceId = null;
      this.options.pushEvent({
        kind: 'fusion-dance',
        outcome: 'ended',
        ownerInstanceId: participant.instanceId,
        donorInstanceId: donorId,
        side: this.teams[participant.sideIndex].side,
      });
    }
    if (participant.swapWith !== null) {
      const target = this.globalById(participant.swapWith);
      const targetId = participant.swapWith;
      participant.swapWith = null;
      if (target !== null) target.swappedBy = null;
      this.options.pushEvent({
        kind: 'body-snatcher',
        outcome: 'ended',
        ownerInstanceId: participant.instanceId,
        targetInstanceId: targetId,
        side: this.teams[participant.sideIndex].side,
      });
    }
  }
  removeClone(
    team: TeamRuntime,
    ownerInstanceId: string,
    reason: 'owner-exited' | 'fouled-out',
  ): void {
    const clone = team.participants.find(
      (candidate) =>
        candidate.kind === 'clone' &&
        candidate.ownerInstanceId === ownerInstanceId &&
        candidate.active,
    );
    if (clone === undefined) return;
    clone.active = false;
    clone.cloneExited = true;
    this.options.pushEvent({
      kind: 'clone',
      outcome: 'exited',
      ownerInstanceId,
      cloneInstanceId: clone.instanceId,
      side: team.side,
      reason,
    });
  }
  rebuildActiveTeams(): void {
    for (const team of this.teams) {
      const bySlot: ParticipantState[] = [];
      for (let slot = 0; slot < 5; slot += 1) {
        const participant = team.participants.find(
          (candidate) =>
            candidate.active && candidate.kind !== 'clone' && candidate.slotIndex === slot,
        );
        if (participant !== undefined) bySlot.push(participant);
      }
      const clones = team.participants.filter(
        (candidate) => candidate.active && candidate.kind === 'clone',
      );
      team.active = [...bySlot, ...clones];
      const simTeam: SimulationTeam = {
        teamId: team.input.teamId,
        displayName: team.input.displayName,
        players: team.active.map((participant) => participant.simPlayer),
      };
      const tripContext = this.options.tripContext();
      tripContext.teams[team.sideIndex] = simTeam;
      tripContext.preps[team.sideIndex] = prepareTeam(simTeam, this.profile, {
        keyOf: (player) => this.playerInstance.get(player)?.instanceId ?? 'missing',
        responsibilitySlotOf: (player) => this.playerInstance.get(player)?.slotIndex ?? 0,
        evidenceOf: (player) => this.options.evidenceOf(player),
        aggregateDivisor: 5,
        rebounderWeightScale: (player) => this.options.reboundWeightScale(player),
        reboundMeanReach: (player) => this.options.reboundMeanReach(player),
      });
      this.recorder.setActiveUnits(
        team.sideIndex,
        team.active.map((participant) => participant.rosterIndex),
      );
    }
  }
}
