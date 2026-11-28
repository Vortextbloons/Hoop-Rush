export interface LeagueFieldTeam {
  readonly teamId: string;
  readonly displayName: string;
}

export interface LeagueAlignment<
  Conference extends string = string,
  Division extends string = string,
> {
  readonly conference: Conference;
  readonly division: Division;
}

export interface LeagueFranchiseAssignment<
  Conference extends string = string,
  Division extends string = string,
> {
  readonly franchiseId: string;
  readonly displayName: string;
  readonly conference: Conference;
  readonly division: Division;
}
