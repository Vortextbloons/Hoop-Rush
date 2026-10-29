import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import type { SideIndex } from './recorder.ts';

export interface ApronRuntimeHooks {
  beginPossession(offense: SideIndex): void;
  endPossession(): void;
  forcedActor(team: SimulationTeam): SimulationPlayer | null;
  struckDefender(team: SimulationTeam): SimulationPlayer | null;
}

export function apronPlayerKeyOf(player: SimulationPlayer): string {
  return `${player.playerId}\u0000${player.playerVersionId ?? ''}`;
}
