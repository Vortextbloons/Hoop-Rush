import {
  CAP_RUSH_CONFERENCE_SIZE,
  fullCourtSeasonScoreSchema,
  type CapRushConference,
  type CapRushDivision,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  capRushValidateLeagueField,
  type CapRushLeagueField,
} from '../cap-rush/league-schedule.ts';
import {
  conferenceStandingOf,
  createTeamTotals,
  rankConferenceTeams,
  recordHeadToHead,
  recordPlayed,
  type TeamTotals,
} from '../conference-standings.ts';

export interface FullCourtStandingsRow {
  readonly teamId: string;
  readonly displayName: string;
  readonly conference: CapRushConference;
  readonly division: CapRushDivision;
  readonly wins: number;
  readonly losses: number;
  readonly conferenceWins: number;
  readonly conferenceLosses: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifferential: number;
  readonly seed: number;
  readonly qualified: boolean;
}

export interface FullCourtStandings {
  readonly west: readonly FullCourtStandingsRow[];
  readonly east: readonly FullCourtStandingsRow[];
  readonly qualifiedTeamIds: readonly string[];
}

export interface FullCourtPlayoffSeeds {
  readonly west: readonly string[];
  readonly east: readonly string[];
}

function recordForfeit(
  home: TeamTotals,
  away: TeamTotals,
  losingSides: readonly ('home' | 'away')[],
): void {
  const homeLost = losingSides.includes('home');
  const awayLost = losingSides.includes('away');
  if (homeLost && awayLost) {
    home.losses += 1;
    away.losses += 1;
    if (home.conference === away.conference) {
      home.conferenceLosses += 1;
      away.conferenceLosses += 1;
    }
    return;
  }
  if (homeLost) {
    recordHeadToHead(away, home);
    return;
  }
  recordHeadToHead(home, away);
}

export function fullCourtStandings(
  field: readonly CapRushLeagueField[],
  scores: readonly FullCourtSeasonScore[],
): FullCourtStandings {
  capRushValidateLeagueField(field);
  const totals = new Map(field.map((team) => [team.teamId, createTeamTotals(team)]));
  const seen = new Set<string>();
  for (const raw of scores) {
    const score = fullCourtSeasonScoreSchema.parse(raw);
    if (seen.has(score.gameId)) {
      throw new Error(`Full Court standings: duplicate game ${score.gameId}`);
    }
    seen.add(score.gameId);
    const home = totals.get(score.homeTeamId);
    const away = totals.get(score.awayTeamId);
    if (home === undefined || away === undefined) {
      throw new Error(`Full Court standings: ${score.gameId} references an unknown team`);
    }
    if (score.outcome.kind === 'played') {
      recordPlayed(home, away, score.outcome.homePoints, score.outcome.awayPoints);
    } else {
      recordForfeit(home, away, score.outcome.losingSides);
    }
  }
  const west = buildConferenceRows('west', totals);
  const east = buildConferenceRows('east', totals);
  return {
    west,
    east,
    qualifiedTeamIds: [...west, ...east].filter((row) => row.qualified).map((row) => row.teamId),
  };
}

function buildConferenceRows(
  conference: CapRushConference,
  totals: ReadonlyMap<string, TeamTotals>,
): FullCourtStandingsRow[] {
  const teams = [...totals.values()].filter((team) => team.conference === conference);
  if (teams.length !== CAP_RUSH_CONFERENCE_SIZE) {
    throw new Error(`Full Court standings: ${conference} holds ${String(teams.length)} teams`);
  }
  return rankConferenceTeams(teams, 'tied-group').map((team, index) =>
    conferenceStandingOf(team, index + 1),
  );
}

export function fullCourtPlayoffSeeds(standings: FullCourtStandings): FullCourtPlayoffSeeds {
  return {
    west: standings.west.filter((row) => row.qualified).map((row) => row.teamId),
    east: standings.east.filter((row) => row.qualified).map((row) => row.teamId),
  };
}
