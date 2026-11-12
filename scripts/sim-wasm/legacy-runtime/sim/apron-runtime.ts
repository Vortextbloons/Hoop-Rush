import type {
  SimulationPlayer,
  SimulationTeam,
} from '../../../../packages/data-contracts/src/index.ts';
import type { SideIndex } from './recorder.ts';

export interface ApronRuntimeHooks {
  beginPossession(offense: SideIndex): void;
  endPossession(): void;
  forcedActor(team: SimulationTeam): SimulationPlayer | null;
  struckDefender(team: SimulationTeam): SimulationPlayer | null;
  passInterceptionChance?(offense: SideIndex): number;
  onPassIntercepted?(passer: SimulationPlayer, defender: SimulationPlayer): void;
}

export function apronPlayerKeyOf(player: SimulationPlayer): string {
  return `${player.playerId}\u0000${player.playerVersionId ?? ''}`;
}
