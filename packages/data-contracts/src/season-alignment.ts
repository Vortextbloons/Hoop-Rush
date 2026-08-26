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
export function humanTeamOf<T extends {
    franchiseId: string;
    control: SeasonControl;
}>(league: {
    teams: readonly T[];
}): T | null {
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
