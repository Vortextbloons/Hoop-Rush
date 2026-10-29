import type {
  CapRushApronFact,
  CapRushApronRules,
  CapRushIsolationReason,
  CapRushPayrollStatus,
  Position,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SCHEMA_VERSION,
  capRushIsolationDue,
  capRushIsolationReason,
  capRushStrikeDue,
} from '@hoop-rush/data-contracts';
import type { SideIndex } from '../../sim/recorder.ts';
import { apronPlayerKeyOf } from '../../sim/apron-runtime.ts';

export interface CapRushApronSpec {
  readonly side: SideIndex;
  readonly rules: CapRushApronRules;
  readonly targetInstanceId: string;
  readonly targetSlot: Position;
}

export interface CapRushPossessionState {
  readonly offenseOrdinal: number;
  readonly defenseOrdinal: number;
  readonly isolation: CapRushIsolationReason | null;
  readonly strike: boolean;
}

function sideLabel(side: SideIndex): 'home' | 'away' {
  return side === 0 ? 'home' : 'away';
}

export class CapRushApronRuntime {
  private readonly spec: CapRushApronSpec;
  private readonly ordinals: [number, number] = [0, 0];
  private readonly facts: CapRushApronFact[] = [];
  private current: CapRushPossessionState | null = null;
  private targetPlayer: SimulationPlayer | null = null;
  private targetPlayerKey: string | null = null;

  constructor(spec: CapRushApronSpec) {
    this.spec = spec;
  }

  bindTarget(player: SimulationPlayer): void {
    this.targetPlayer = player;
    this.targetPlayerKey = apronPlayerKeyOf(player);
  }

  bindTargetId(playerId: string, playerVersionId: string | null): void {
    this.targetPlayerKey = `${playerId}\u0000${playerVersionId ?? ''}`;
  }

  beginPossession(offense: SideIndex): CapRushPossessionState {
    const ordinal = (this.ordinals[offense] += 1);
    const defendOrdinal = this.ordinals[offense === 0 ? 1 : 0];
    const isolation =
      offense === this.spec.side && capRushIsolationDue(this.spec.rules, ordinal)
        ? capRushIsolationReason(this.spec.rules)
        : null;
    const strike = offense !== this.spec.side && capRushStrikeDue(this.spec.rules, ordinal);
    this.current = {
      offenseOrdinal: ordinal,
      defenseOrdinal: defendOrdinal,
      isolation,
      strike,
    };
    if (isolation !== null) {
      this.facts.push({
        schemaVersion: CAP_RUSH_SCHEMA_VERSION,
        kind: 'isolation',
        side: sideLabel(this.spec.side),
        possessionOrdinal: ordinal,
        reason: isolation,
        targetInstanceId: this.spec.targetInstanceId,
        targetSlot: this.spec.targetSlot,
        payrollStatus: this.spec.rules.payrollStatus,
      });
    }
    if (strike) {
      this.facts.push({
        schemaVersion: CAP_RUSH_SCHEMA_VERSION,
        kind: 'strike',
        side: sideLabel(this.spec.side),
        possessionOrdinal: ordinal,
        targetInstanceId: this.spec.targetInstanceId,
        targetSlot: this.spec.targetSlot,
      });
    }
    return this.current;
  }

  endPossession(): void {
    this.current = null;
  }

  state(): CapRushPossessionState | null {
    return this.current;
  }

  isolationActive(): boolean {
    return this.current !== null && this.current.isolation !== null;
  }

  strikeActive(): boolean {
    return this.current !== null && this.current.strike;
  }

  forcedActor(team: SimulationTeam): SimulationPlayer | null {
    if (!this.isolationActive()) return null;
    return this.resolveTarget(team);
  }

  struckDefender(team: SimulationTeam): SimulationPlayer | null {
    if (!this.strikeActive()) return null;
    return this.resolveTarget(team);
  }

  private resolveTarget(team: SimulationTeam): SimulationPlayer | null {
    if (this.targetPlayer !== null && team.players.includes(this.targetPlayer)) {
      return this.targetPlayer;
    }
    if (this.targetPlayerKey === null) return null;
    return team.players.find((player) => apronPlayerKeyOf(player) === this.targetPlayerKey) ?? null;
  }

  recordedFacts(): readonly CapRushApronFact[] {
    return this.facts;
  }
}

export function capRushApronRuntimeFor(
  locked: {
    readonly payrollStatus: CapRushPayrollStatus;
    readonly target: { readonly instanceId: string; readonly slot: Position };
    readonly human: {
      readonly starters: readonly {
        readonly instanceId: string;
        readonly source: { readonly playerId: string; readonly playerVersionId: string | null };
      }[];
    };
  },
  humanSide: 'home' | 'away',
): CapRushApronRuntime | undefined {
  if (locked.payrollStatus !== 'first-apron' && locked.payrollStatus !== 'second-apron') {
    return undefined;
  }
  const apron = new CapRushApronRuntime({
    side: humanSide === 'home' ? 0 : 1,
    rules: { payrollStatus: locked.payrollStatus },
    targetInstanceId: locked.target.instanceId,
    targetSlot: locked.target.slot,
  });
  const starter = locked.human.starters.find(
    (candidate) => candidate.instanceId === locked.target.instanceId,
  );
  if (starter !== undefined) {
    apron.bindTargetId(starter.source.playerId, starter.source.playerVersionId);
  }
  return apron;
}
