import type { SeasonSubmitBlockRejection } from '@hoop-rush/data-contracts';

export class SeasonBlockValidationError extends Error {
  readonly rejection: SeasonSubmitBlockRejection;
  constructor(rejection: SeasonSubmitBlockRejection) {
    super(`season block rejected (${rejection.code})`);
    this.name = 'SeasonBlockValidationError';
    this.rejection = rejection;
  }
}
export class SeasonBlockInvariantError extends Error {
  readonly diagnostics: {
    seed?: string;
    gameId?: string;
    blockIndex?: number;
  };
  constructor(
    message: string,
    diagnostics: {
      seed?: string;
      gameId?: string;
      blockIndex?: number;
    } = {},
  ) {
    super(message);
    this.name = 'SeasonBlockInvariantError';
    this.diagnostics = diagnostics;
  }
}
export class SeasonBlockCancelledError extends Error {
  readonly blockIndex: number;
  readonly gamesCompleted: number;
  constructor(blockIndex: number, gamesCompleted: number) {
    super(`season block ${String(blockIndex)} cancelled after ${String(gamesCompleted)} games`);
    this.name = 'SeasonBlockCancelledError';
    this.blockIndex = blockIndex;
    this.gamesCompleted = gamesCompleted;
  }
}
