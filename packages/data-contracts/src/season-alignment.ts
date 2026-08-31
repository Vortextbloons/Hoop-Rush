import type { ConferenceId, DivisionId, SeasonControl } from './season-league.ts';
export interface SeasonAlignmentEntry {
  franchiseId: string;
  conference: ConferenceId;
  division: DivisionId;
}
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
export function humanTeamOf<
  T extends {
    franchiseId: string;
    control: SeasonControl;
  },
>(league: { teams: readonly T[] }): T | null {
  return league.teams.find((team) => team.control === 'human') ?? null;
}
export function humanFranchiseIdOf(league: {
  teams: readonly {
    franchiseId: string;
    control: SeasonControl;
  }[];
}): string | null {
  return humanTeamOf(league)?.franchiseId ?? null;
}
export function participantTeamsOf<
  T extends {
    franchiseId: string;
    control: SeasonControl;
  },
>(league: { teams: readonly T[] }): T[] {
  return league.teams.filter((team) => team.control === 'human');
}
export function participantFranchiseIdsOf(league: {
  teams: readonly { franchiseId: string; control: SeasonControl }[];
}): string[] {
  return participantTeamsOf(league).map((t) => t.franchiseId);
}
export function franchiseForParticipant(
  league: { teams: readonly { franchiseId: string; control: SeasonControl }[] },
  participantId: 'p1' | 'p2',
): string | null {
  const ids = participantFranchiseIdsOf(league);
  if (participantId === 'p1') return ids[0] ?? null;
  return ids[1] ?? null;
}
export function authorityForFranchise(
  league: { teams: readonly { franchiseId: string; control: SeasonControl }[] },
  franchiseId: string,
): 'p1' | 'p2' | null {
  const ids = participantFranchiseIdsOf(league);
  if (ids[0] === franchiseId) return 'p1';
  if (ids[1] === franchiseId) return 'p2';
  return null;
}
