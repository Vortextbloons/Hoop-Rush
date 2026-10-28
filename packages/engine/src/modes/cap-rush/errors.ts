import type { Position } from '@hoop-rush/data-contracts';

export class CapRushCatalogCoverageError extends Error {
  readonly code = 'catalog-coverage';
  readonly slot: Position | null;

  constructor(slot: Position | null, message: string) {
    super(
      slot === null
        ? `cap rush catalog coverage failed: ${message}`
        : `cap rush catalog coverage failed for ${slot}: ${message}`,
    );
    this.name = 'CapRushCatalogCoverageError';
    this.slot = slot;
  }
}

export class CapRushGenerationError extends Error {
  readonly code = 'generation-failed';
  readonly round: number;
  readonly slot: Position;

  constructor(round: number, slot: Position, message: string) {
    super(`cap rush offer generation failed for round ${String(round)} ${slot}: ${message}`);
    this.name = 'CapRushGenerationError';
    this.round = round;
    this.slot = slot;
  }
}
