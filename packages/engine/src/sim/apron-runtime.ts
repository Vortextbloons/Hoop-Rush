import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import type { SideIndex } from './recorder.ts';

export interface ApronRuntimeHooks {
  completeBattle?(): void;
  beginPossession(offense: SideIndex): void;
  endPossession(): void;
  forcedActor(team: SimulationTeam): SimulationPlayer | null;
  struckDefender(team: SimulationTeam): SimulationPlayer | null;
  passInterceptionChance?(offense: SideIndex): number;
  onPassIntercepted?(passer: SimulationPlayer, defender: SimulationPlayer): void;
  /** Rust-owned apron states the integrated battle kernel can attach directly. */
  battleApronStates?(): readonly {
    readonly side: SideIndex;
    readonly payroll: 1 | 2;
    readonly handle: number;
    readonly targetInstanceId: string;
  }[];
}

export function apronPlayerKeyOf(player: SimulationPlayer): string {
  return `${player.playerId}\u0000${player.playerVersionId ?? ''}`;
}
