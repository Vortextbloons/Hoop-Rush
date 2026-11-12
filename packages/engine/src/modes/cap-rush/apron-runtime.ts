import type {
  CapRushApronFact,
  CapRushApronRules,
  CapRushIsolationReason,
  CapRushPayrollStatus,
  Position,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { CAP_RUSH_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import type { SideIndex } from '../../sim/recorder.ts';
import { apronPlayerKeyOf } from '../../sim/apron-runtime.ts';
import {
  APRON_FACT_PASS_INTERCEPTION,
  APRON_FACT_STRIKE,
  apronPayrollCode,
  createApronState,
  trackApronState,
  untrackApronState,
} from './apron-wasm-runtime.ts';
import type { BattleKernel } from '../havoc/core/battle-wasm.ts';

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

interface InterceptionPayload {
  readonly passerPlayerId: SimulationPlayer['playerId'];
  readonly defenderPlayerId: SimulationPlayer['playerId'];
}

function sideLabel(side: SideIndex): 'home' | 'away' {
  return side === 0 ? 'home' : 'away';
}

export class CapRushApronRuntime {
  private readonly spec: CapRushApronSpec;
  private readonly kernel: BattleKernel;
  private readonly handle: number;
  private readonly interceptions: InterceptionPayload[] = [];
  private current: CapRushPossessionState | null = null;
  private targetPlayer: SimulationPlayer | null = null;
  private targetPlayerKey: string | null = null;
  private readonly facts: CapRushApronFact[] = [];
  private decodedInterceptions = 0;
  private disposed = false;

  constructor(spec: CapRushApronSpec) {
    this.spec = spec;
    const state = createApronState(spec.side, spec.rules);
    this.kernel = state.kernel;
    this.handle = state.handle;
    trackApronState(this, state);
  }

  battleApronState(): {
    side: SideIndex;
    payroll: 1 | 2;
    handle: number;
    targetInstanceId: string;
  } {
    return {
      side: this.spec.side,
      payroll: apronPayrollCode(this.spec.rules),
      handle: this.handle,
      targetInstanceId: this.spec.targetInstanceId,
    };
  }

  battleApronStates() {
    return [this.battleApronState()];
  }

  completeBattle(): void {
    this.recordedFacts();
    this.current = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.recordedFacts();
    this.disposed = true;
    untrackApronState(this);
    this.kernel.apron_destroy(this.handle);
  }

  bindTarget(player: SimulationPlayer): void {
    this.targetPlayer = player;
    this.targetPlayerKey = apronPlayerKeyOf(player);
  }

  bindTargetId(playerId: string, playerVersionId: string | null): void {
    this.targetPlayerKey = `${playerId}\u0000${playerVersionId ?? ''}`;
  }

  beginPossession(offense: SideIndex): CapRushPossessionState {
    if (this.kernel.apron_begin(this.handle, offense) !== 0) {
      throw new Error(`cap rush apron: invalid offense side ${String(offense)}`);
    }
    this.current = {
      offenseOrdinal: this.kernel.apron_offense_ordinal(this.handle),
      defenseOrdinal: this.kernel.apron_defense_ordinal(this.handle),
      isolation: this.isolationState(),
      strike: this.kernel.apron_strike(this.handle) !== 0,
    };
    this.recordedFacts();
    return this.current;
  }

  endPossession(): void {
    this.kernel.apron_end(this.handle);
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

  passInterceptionChance(offense: SideIndex): number {
    return this.kernel.apron_interception_chance(this.handle, offense);
  }

  onPassIntercepted(passer: SimulationPlayer, defender: SimulationPlayer): void {
    if (this.kernel.apron_record_interception(this.handle) !== 0) return;
    this.interceptions.push({
      passerPlayerId: passer.playerId,
      defenderPlayerId: defender.playerId,
    });
    this.recordedFacts();
  }

  private isolationState(): CapRushIsolationReason | null {
    if (this.kernel.apron_isolation(this.handle) !== 0) {
      throw new Error('cap rush apron: unsupported isolation state from Rust kernel');
    }
    return null;
  }

  private resolveTarget(team: SimulationTeam): SimulationPlayer | null {
    if (this.targetPlayer !== null && team.players.includes(this.targetPlayer)) {
      return this.targetPlayer;
    }
    if (this.targetPlayerKey === null) return null;
    return team.players.find((player) => apronPlayerKeyOf(player) === this.targetPlayerKey) ?? null;
  }

  recordedFacts(): readonly CapRushApronFact[] {
    if (this.disposed) return this.facts;
    const count = this.kernel.apron_fact_count(this.handle);
    const facts = this.facts;
    for (let index = facts.length; index < count; index += 1) {
      const kind = this.kernel.apron_fact_kind(this.handle, index);
      const possessionOrdinal = this.kernel.apron_fact_ordinal(this.handle, index);
      if (kind === APRON_FACT_STRIKE) {
        facts.push({
          schemaVersion: CAP_RUSH_SCHEMA_VERSION,
          kind: 'strike',
          side: sideLabel(this.spec.side),
          possessionOrdinal,
          targetInstanceId: this.spec.targetInstanceId,
          targetSlot: this.spec.targetSlot,
        });
      } else if (kind === APRON_FACT_PASS_INTERCEPTION) {
        const readPlayer = (defender: number) =>
          new TextDecoder().decode(
            new Uint8Array(
              this.kernel.memory.buffer,
              this.kernel.apron_fact_player_ptr(this.handle, index, defender),
              this.kernel.apron_fact_player_len(this.handle, index, defender),
            ),
          );
        const integratedPasser = readPlayer(0);
        const payload =
          integratedPasser.length > 0
            ? { passerPlayerId: integratedPasser, defenderPlayerId: readPlayer(1) }
            : this.interceptions[this.decodedInterceptions++];
        if (payload === undefined) {
          throw new Error('cap rush apron: missing pass interception payload');
        }
        facts.push({
          schemaVersion: CAP_RUSH_SCHEMA_VERSION,
          kind: 'pass-interception',
          side: sideLabel(this.spec.side),
          possessionOrdinal,
          passerPlayerId: payload.passerPlayerId as SimulationPlayer['playerId'],
          defenderPlayerId: payload.defenderPlayerId as SimulationPlayer['playerId'],
        });
      } else {
        throw new Error(`cap rush apron: unsupported fact kind ${String(kind)} from Rust kernel`);
      }
    }
    return facts;
  }
}

export function capRushApronRuntimeFor(
  locked: {
    readonly versionSet: { readonly rulesVersion: string };
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
