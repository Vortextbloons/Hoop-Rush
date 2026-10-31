import type {
  CapRushMultiplayerCheckpoint,
  CapRushMultiplayerCommand,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerCommand,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
  type CapRushMultiplayerEnvironment,
} from './state.ts';
import { capRushMultiplayerAcceptedThrough } from './league.ts';

export function replayCapRushMultiplayerLog(input: {
  readonly rootSeed: string;
  readonly commands: readonly CapRushMultiplayerCommand[];
  readonly environment: CapRushMultiplayerEnvironment;
}): { readonly state: CapRushMultiplayerState; readonly stateDigest: string } {
  const ordered = [...input.commands].sort((left, right) => left.ordinal - right.ordinal);
  let state = createCapRushMultiplayerState(input.rootSeed);
  for (let index = 0; index < ordered.length; index += 1) {
    const command = ordered[index];
    if (command === undefined) continue;
    if (command.ordinal !== index) {
      throw new Error(
        `cap rush multiplayer replay: command ${command.commandId} has ordinal ${String(command.ordinal)}, expected ${String(index)}`,
      );
    }
    const outcome = applyCapRushMultiplayerCommand(state, command, input.environment);
    if (!outcome.ok) {
      throw new Error(
        `cap rush multiplayer replay: ${command.commandId} rejected (${outcome.code}): ${outcome.message}`,
      );
    }
    state = outcome.state;
  }
  return { state, stateDigest: capRushMultiplayerStateDigest(state) };
}

function digestOf(value: unknown): string {
  return seasonDigestHex(canonicalJson(value));
}

export function capRushMultiplayerCheckpointOf(input: {
  readonly state: CapRushMultiplayerState;
  readonly revision: number;
  readonly commandCount: number;
}): CapRushMultiplayerCheckpoint {
  const games = input.state.season?.games ?? [];
  return {
    revision: input.revision,
    commandCount: input.commandCount,
    stateDigest: capRushMultiplayerStateDigest(input.state),
    acceptedThroughSlot: capRushMultiplayerAcceptedThrough(games),
    gamesDigest: digestOf(
      games.map((game) => ({
        gameId: game.gameId,
        inputDigest: game.inputDigest,
        resultDigest: game.resultDigest,
      })),
    ),
    standingsDigest:
      input.state.postseason?.standings === null || input.state.postseason === null
        ? null
        : digestOf(input.state.postseason.standings),
  };
}
