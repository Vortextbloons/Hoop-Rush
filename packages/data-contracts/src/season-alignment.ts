import type { ConferenceId, DivisionId, SeasonControl } from './season-league.ts';

/**
 * Canonical Season Run league alignment (league-v1): the accepted 30-franchise
 * conference/division mapping and the frozen league team order. This module
 * is the single source of the league fact; the data-contracts fixture league,
 * the test-fixture alignment, and the persistence fixture alignment all
 * derive from `SEASON_ALIGNMENT`, so the versioned league fact cannot drift
 * between packages.
 *
 * The array order is the frozen league-v1 team order (conference-major):
 * deriving `CONFERENCE_TEAMS` by filtering preserves the exact historical
 * team order every golden fixture depends on.
 */

export interface SeasonAlignmentEntry {
  franchiseId: string;
  conference: ConferenceId;
  division: DivisionId;
}

/** Accepted 30-franchise alignment; conference/division follow league-v1. */
export const SEASON_ALIGNMENT: readonly SeasonAlignmentEntry[] = [
  { franchiseId: 'hawks', conference: 'east', division: 'southeast' },
  { franchiseId: 'celtics', conference: 'east', division: 'atlantic' },
  { franchiseId: 'nets', conference: 'east', division: 'atlantic' },
  { franchiseId: 'hornets', conference: 'east', division: 'southeast' },
  { franchiseId: 'bulls', conference: 'east', division: 'central' },
  { franchiseId: 'cavaliers', conference: 'east', division: 'central' },
  { franchiseId: 'mavericks', conference: 'west', division: 'southwest' },
  { franchiseId: 'nuggets', conference: 'west', division: 'northwest' },
  { franchiseId: 'pistons', conference: 'east', division: 'central' },
  { franchiseId: 'warriors', conference: 'west', division: 'pacific' },
  { franchiseId: 'rockets', conference: 'west', division: 'southwest' },
  { franchiseId: 'pacers', conference: 'east', division: 'central' },
  { franchiseId: 'clippers', conference: 'west', division: 'pacific' },
  { franchiseId: 'lakers', conference: 'west', division: 'pacific' },
  { franchiseId: 'grizzlies', conference: 'west', division: 'southwest' },
  { franchiseId: 'heat', conference: 'east', division: 'southeast' },
  { franchiseId: 'bucks', conference: 'east', division: 'central' },
  { franchiseId: 'timberwolves', conference: 'west', division: 'northwest' },
  { franchiseId: 'pelicans', conference: 'west', division: 'southwest' },
  { franchiseId: 'knicks', conference: 'east', division: 'atlantic' },
  { franchiseId: 'thunder', conference: 'west', division: 'northwest' },
  { franchiseId: 'magic', conference: 'east', division: 'southeast' },
  { franchiseId: 'sixers', conference: 'east', division: 'atlantic' },
  { franchiseId: 'suns', conference: 'west', division: 'pacific' },
  { franchiseId: 'blazers', conference: 'west', division: 'northwest' },
  { franchiseId: 'kings', conference: 'west', division: 'pacific' },
  { franchiseId: 'spurs', conference: 'west', division: 'southwest' },
  { franchiseId: 'raptors', conference: 'east', division: 'atlantic' },
  { franchiseId: 'jazz', conference: 'west', division: 'northwest' },
  { franchiseId: 'wizards', conference: 'east', division: 'southeast' },
];

/** The league's human-controlled team, or null when none exists. Accepts any
 * league-shaped team list (the full `SeasonLeague` or the narrow cursor
 * league of the persistence commit path). */
export function humanTeamOf<T extends { franchiseId: string; control: SeasonControl }>(league: {
  teams: readonly T[];
}): T | null {
  return league.teams.find((team) => team.control === 'human') ?? null;
}

/** The league's human franchise id, or null when none exists. */
export function humanFranchiseIdOf(league: {
  teams: readonly { franchiseId: string; control: SeasonControl }[];
}): string | null {
  return humanTeamOf(league)?.franchiseId ?? null;
}
