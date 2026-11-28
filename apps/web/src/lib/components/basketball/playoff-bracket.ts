/** Shared shape for the conference bracket rendered by Cap Rush and Full Court. */
export interface BracketSeries {
  readonly seriesId: string;
  readonly round: number;
  readonly seriesSlot: number;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly games: readonly { readonly winnerTeamId: string }[];
}

export interface BracketTeamIdentity {
  readonly franchiseId: string;
  readonly teamExternalId: string;
  readonly abbreviation: string;
}
