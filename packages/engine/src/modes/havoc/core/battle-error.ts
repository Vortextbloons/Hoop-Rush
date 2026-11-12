export class HavocSimulationExhaustedError extends Error {
  readonly code = 'havoc-overtime-exhausted';
  constructor(periods: number, homeScore: number, awayScore: number, context: string) {
    super(
      `havoc: exceeded hard cap ${String(periods)} periods without a winner (${String(homeScore)}-${String(awayScore)}) for ${context}`,
    );
    this.name = 'HavocSimulationExhaustedError';
  }
}
