import type { CapRushCommand, CapRushCommandResult } from './cap-rush-commands.ts';
import type { CapRushDraftState } from './cap-rush-draft.ts';
import type { CapRushLeagueGame } from './cap-rush-league.ts';
import type { CapRushStoredPlayoffGame } from './cap-rush-postseason.ts';
import type { CapRushReport, CapRushStoredGame } from './cap-rush-season.ts';
import type { HavocCommand, HavocCommandResult } from './havoc-commands.ts';
import type { HavocComparison, HavocReport } from './havoc-comparison.ts';
import type { HavocGameResult, HavocGameTape } from './havoc-game.ts';
import type { HavocRunState } from './havoc-run.ts';

export interface CommandOutcome<TState, TReceipt> {
  readonly state: TState;
  readonly result: TReceipt;
}

export interface CommandCommit<TState, TReceipt> {
  readonly expectedRevision: number;
  readonly outcome: CommandOutcome<TState, TReceipt>;
}

export interface CapRushApplyOutcomeInput extends CommandCommit<
  CapRushDraftState,
  CapRushCommandResult
> {
  readonly command: CapRushCommand;
  readonly game?: CapRushStoredGame;
  readonly playoffGame?: CapRushStoredPlayoffGame;
  /**
   * Full league games committed alongside the command. The command receipt
   * names their ids; these rows carry the box scores the game table stores.
   */
  readonly leagueGames?: readonly CapRushLeagueGame[];
  readonly report?: CapRushReport;
}

export type HavocCommandOutcome = CommandOutcome<HavocRunState, HavocCommandResult>;

export interface HavocApplyOutcomeInput extends CommandCommit<HavocRunState, HavocCommandResult> {
  readonly command?: HavocCommand;
  readonly game?: { result: HavocGameResult; inputDigest: string; resultDigest: string };
  readonly tape?: { tape: HavocGameTape; tapeDigest: string; selectedRank?: number };
  readonly comparison?: HavocComparison;
  readonly report?: HavocReport;
}

export function prepareCommandCommit<T extends { outcome: { result: { revisionBefore: number } } }>(
  input: T,
): T & { expectedRevision: number } {
  return { ...input, expectedRevision: input.outcome.result.revisionBefore };
}
