import type { CapRushCommand, CapRushDraftState } from '@hoop-rush/data-contracts';
import {
  applyAbandon,
  rejectCapRushCommand,
  type CapRushCommandEnvironment,
  type CapRushCommandOutcome,
} from './command-outcome.ts';
import { applyCapRushDraftCommand } from './draft-reducer.ts';
import { applyCapRushPostseasonCommand } from './postseason-reducer.ts';
import { applyCapRushSeasonCommand } from './season-reducer.ts';
export type { CapRushCommandEnvironment, CapRushCommandOutcome } from './command-outcome.ts';
export { createCapRushDraftState } from './draft-reducer.ts';
export function applyCapRushCommand(
  state: CapRushDraftState,
  command: CapRushCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  switch (command.command) {
    case 'create-cap-rush-draft':
      return rejectCapRushCommand(
        state,
        command,
        'phase-mismatch',
        'a cap rush draft already exists for this run',
      );
    case 'choose-cap-rush-position':
    case 'reroll-cap-rush-offer':
    case 'sign-cap-rush-card':
    case 'purchase-cap-rush-spin':
    case 'skip-cap-rush-spin':
    case 'lock-cap-rush-lineup':
      return applyCapRushDraftCommand(state, command, environment);
    case 'accept-cap-rush-game':
    case 'accept-cap-rush-league-games':
    case 'finalize-cap-rush-season':
      return applyCapRushSeasonCommand(state, command, environment);
    case 'accept-cap-rush-standings':
    case 'accept-cap-rush-playoff-game':
    case 'finalize-cap-rush-postseason':
      return applyCapRushPostseasonCommand(state, command, environment);
    case 'abandon-cap-rush-run':
      return applyAbandon(state, command, environment);
  }
}
