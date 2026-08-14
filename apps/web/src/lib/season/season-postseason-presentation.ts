import {
  SEASON_POSTSEASON_RISKY_REHAB_COST,
  rankSeasonPostseason,
  seasonPostseasonGameTeamsOf,
  seasonPostseasonHumanEliminated,
  seasonPostseasonHumanPlaysGame,
  seasonPostseasonNextGame,
  type SeasonPostseasonRankings,
} from '@hoop-rush/engine';
import {
  type ConferenceId,
  type PlayInMatchupId,
  type PlayoffRound,
  type PlayoffSeries,
  type SeasonAwards,
  type SeasonInjurySeverity,
  type SeasonPostseasonRotationPayload,
  type SeasonPostseasonState,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonRunCommandRejection,
  type SeasonStandings,
  type SeasonStandingsRow,
  type SeasonTiebreakResolution,
} from '@hoop-rush/data-contracts';
import { describeCommandRejection, type SeasonPostseasonProgress } from './season-hub-state';

/**
 * M2.6 postseason presentation (spec/2.0/02 Playoffs, m26-handoff). Pure
 * formatting and view-model derivation over engine exports and recorded
 * data-contracts facts; every basketball rule (ranking, eligibility,
 * legality, simulation) stays in the engine. The frozen Track A/B
 * cross-track contract types live with the hub (`SeasonPostseasonProgress`,
 * postseason methods); this module re-exports the shapes the shell binds
 * against and adds the presentation helpers.
 */

// ---------------------------------------------------------------------------
// Frozen cross-track contract (m26-handoff): hub postseason progress mirror.
// ---------------------------------------------------------------------------

export type HubPostseasonPhase = SeasonPostseasonProgress['phase'];
export type HubPostseasonProgress = SeasonPostseasonProgress;

export function idlePostseasonProgress(): HubPostseasonProgress {
  return {
    phase: 'idle',
    gamesCompleted: 0,
    gamesTotal: 0,
    latestGameId: null,
    latestResult: null,
    error: null,
  };
}

/**
 * The frozen hub postseason method surface (m26-handoff "Cross-track API
 * contract"). Track A implements these on `SeasonHubState`; the shell binds
 * through `hasPostseasonHubMethods`.
 */
export interface SeasonPostseasonHubMethods {
  startPostseason(): Promise<void>;
  advancePostseason(input?: { targetGameId?: string }): Promise<void>;
  submitPostseasonRotation(input: {
    targetGameId: string;
    rotation: SeasonPostseasonRotationPayload;
  }): Promise<void>;
  spectatePostseasonGame(input: { targetGameId: string }): Promise<void>;
  fastForwardPostseason(input?: { targetGameId?: string }): Promise<void>;
  cancelPostseason(): void;
  postseason: HubPostseasonProgress;
}

/** True when the hub implements the frozen postseason surface (Track A). */
export function hasPostseasonHubMethods(hub: {
  startPostseason?: unknown;
  postseason?: unknown;
}): hub is SeasonPostseasonHubMethods {
  return typeof hub.startPostseason === 'function' && hub.postseason !== undefined;
}

/** Copy shown when the postseason orchestration is not available in this build. */
export const POSTSEASON_ORCHESTRATION_UNAVAILABLE =
  'Postseason simulation is not available in this build yet. Save your run — it is safe — and update the app to continue.';

// ---------------------------------------------------------------------------
// Stage and ranking facts.
// ---------------------------------------------------------------------------

export function postseasonStageLabel(stage: SeasonRun['stage']): string {
  switch (stage) {
    case 'regular-season':
      return 'Regular season';
    case 'play-in':
      return 'Play-In Tournament';
    case 'playoffs':
      return 'Playoffs';
    case 'completed':
      return 'Championship';
  }
}

/** Authoritative engine tiebreak ranking of the run's current standings. */
export function postseasonRankingsOf(run: SeasonRun): SeasonPostseasonRankings {
  return rankSeasonPostseason(run.league, run.standings, run.rootSeed);
}

/** Standings-table entry shape ordered by the authoritative ranking. */
export function rankedEntriesOf(
  rankings: SeasonPostseasonRankings,
  standings: SeasonStandings,
): Array<{ row: SeasonStandingsRow; rank: number; conference: 'east' | 'west' }> {
  const byId = new Map(standings.rows.map((row) => [row.franchiseId, row]));
  const entries: Array<{ row: SeasonStandingsRow; rank: number; conference: 'east' | 'west' }> = [];
  for (const conference of ['east', 'west'] as const) {
    const ranking = rankings[conference];
    for (let index = 0; index < ranking.ranked.length; index += 1) {
      const franchiseId = ranking.ranked[index];
      const row = byId.get(franchiseId ?? '');
      if (franchiseId !== undefined && row !== undefined) {
        entries.push({ row, rank: index + 1, conference });
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Next-game facts for the hub decision panel.
// ---------------------------------------------------------------------------

export type NextPostseasonGame =
  | { kind: 'game'; gameId: string }
  | { kind: 'complete' }
  | { kind: 'integrity-failure'; reason: string };

export function nextPostseasonGameOf(run: SeasonRun): NextPostseasonGame {
  return seasonPostseasonNextGame(run.postseason);
}

export function humanEliminated(run: SeasonRun, humanFranchiseId: string): boolean {
  return seasonPostseasonHumanEliminated(run.postseason, humanFranchiseId);
}

export function humanPlaysNextGame(run: SeasonRun, humanFranchiseId: string): boolean {
  const next = seasonPostseasonNextGame(run.postseason);
  if (next.kind !== 'game') return false;
  return seasonPostseasonHumanPlaysGame(run.postseason, next.gameId, humanFranchiseId);
}

/** The next game's teams, or null when the state cannot pair it. */
export function nextGameTeamsOf(
  run: SeasonRun,
  gameId: string,
): { home: string; away: string } | null {
  return seasonPostseasonGameTeamsOf(run.postseason, gameId);
}

// ---------------------------------------------------------------------------
// Tiebreak copy (league tab).
// ---------------------------------------------------------------------------

export function tiebreakRuleLabel(rule: SeasonTiebreakResolution['rule']): string {
  switch (rule) {
    case 'head-to-head':
      return 'Head-to-head record';
    case 'division-champion':
      return 'Division champion';
    case 'division-record':
      return 'Division record';
    case 'conference-record':
      return 'Conference record';
    case 'playoff-teams-conference-record':
      return 'Record vs playoff teams (conference)';
    case 'playoff-teams-other-conference-record':
      return 'Record vs playoff teams (other conference)';
    case 'points-differential':
      return 'Point differential';
    case 'points-for':
      return 'Points scored';
    case 'overall-record':
      return 'Overall record';
    case 'random-draw':
      return 'Random draw';
  }
}

export function tiebreakKindLabel(kind: SeasonTiebreakResolution['kind']): string {
  switch (kind) {
    case 'qualification':
      return 'Qualification';
    case 'seeding':
      return 'Seeding';
    case 'finals-home-court':
      return 'Finals home court';
  }
}

export function tiebreakSlotsLabel(slots: readonly number[]): string {
  return slots.length === 1
    ? `slot ${String(slots[0])}`
    : `slots ${slots.map((slot) => String(slot)).join('–')}`;
}

/** One scannable tiebreak resolution row (collapsed summary + evidence). */
export interface TiebreakResolutionViewModel {
  resolution: SeasonTiebreakResolution;
  ruleLabel: string;
  kindLabel: string;
  slotsLabel: string;
  teamLabels: string[];
  summary: string;
}

export function tiebreakResolutionViewModel(
  resolution: SeasonTiebreakResolution,
  franchiseName: (franchiseId: string) => string,
): TiebreakResolutionViewModel {
  const ruleLabel = tiebreakRuleLabel(resolution.rule);
  const kindLabel = tiebreakKindLabel(resolution.kind);
  const slotsLabel = tiebreakSlotsLabel(resolution.slots);
  const teamLabels = resolution.teams.map(franchiseName);
  return {
    resolution,
    ruleLabel,
    kindLabel,
    slotsLabel,
    teamLabels,
    summary: `${ruleLabel} · ${kindLabel} · ${slotsLabel}`,
  };
}

// ---------------------------------------------------------------------------
// Series and bracket view models (bracket route + hub matchup card).
// ---------------------------------------------------------------------------

export interface SeriesGameResultViewModel {
  gameNumber: number;
  homeFranchiseId: string;
  awayFranchiseId: string;
  homeScore: number;
  awayScore: number;
}

export interface SeriesCardViewModel {
  seriesId: string;
  round: PlayoffRound;
  conference: ConferenceId | null;
  label: string;
  /** The 2-2-1-1-1 home-court side (higher seed; Finals home-court team). */
  homeFranchiseId: string | null;
  awayFranchiseId: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
  homeWins: number;
  awayWins: number;
  winnerFranchiseId: string | null;
  /** The next scheduled game (null when the series is complete). */
  nextGame: { gameNumber: number; homeFranchiseId: string } | null;
  lastResult: SeriesGameResultViewModel | null;
  status: 'upcoming' | 'in-progress' | 'complete';
  humanSeries: boolean;
}

export function roundLabel(round: PlayoffRound): string {
  switch (round) {
    case 'first-round':
      return 'First Round';
    case 'conference-semifinal':
      return 'Conference Semis';
    case 'conference-final':
      return 'Conference Finals';
    case 'finals':
      return 'Finals';
  }
}

const HOME_GAME_NUMBERS = new Set([1, 2, 5, 7]);

export function seriesCardViewModel(
  series: PlayoffSeries,
  humanFranchiseId: string | null,
): SeriesCardViewModel {
  const games = series.games;
  const nextGameNumber = games.length + 1;
  const completed = series.winnerFranchiseId !== null;
  const lastGame = games[games.length - 1];
  return {
    seriesId: series.seriesId,
    round: series.round,
    conference: series.conference,
    label: roundLabel(series.round),
    homeFranchiseId: series.homeCourtFranchiseId,
    awayFranchiseId: series.challengerFranchiseId,
    homeSeed: series.round === 'finals' ? null : series.higherSeed,
    awaySeed: series.round === 'finals' ? null : series.lowerSeed,
    homeWins: series.homeCourtWins,
    awayWins: series.challengerWins,
    winnerFranchiseId: series.winnerFranchiseId,
    nextGame:
      completed || series.homeCourtFranchiseId === null || nextGameNumber > 7
        ? null
        : {
            gameNumber: nextGameNumber,
            homeFranchiseId: HOME_GAME_NUMBERS.has(nextGameNumber)
              ? series.homeCourtFranchiseId
              : (series.challengerFranchiseId ?? ''),
          },
    lastResult:
      lastGame === undefined
        ? null
        : {
            gameNumber: lastGame.gameNumber,
            homeFranchiseId: lastGame.homeFranchiseId,
            awayFranchiseId: lastGame.awayFranchiseId,
            homeScore: lastGame.homeScore ?? 0,
            awayScore: lastGame.awayScore ?? 0,
          },
    status: completed ? 'complete' : games.length === 0 ? 'upcoming' : 'in-progress',
    humanSeries:
      humanFranchiseId !== null &&
      (series.homeCourtFranchiseId === humanFranchiseId ||
        series.challengerFranchiseId === humanFranchiseId),
  };
}

/** The playoff series a franchise is currently part of (null when none). */
export function humanSeriesOf(
  run: SeasonRun,
  humanFranchiseId: string,
): SeriesCardViewModel | null {
  const bracket = run.postseason.bracket;
  if (bracket === null) return null;
  const allSeries: PlayoffSeries[] = [
    ...bracket.east.firstRound,
    ...bracket.east.semifinals,
    bracket.east.conferenceFinal,
    ...bracket.west.firstRound,
    ...bracket.west.semifinals,
    bracket.west.conferenceFinal,
    bracket.finals,
  ];
  for (const series of allSeries) {
    if (
      series.homeCourtFranchiseId === humanFranchiseId ||
      series.challengerFranchiseId === humanFranchiseId
    ) {
      return seriesCardViewModel(series, humanFranchiseId);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Play-In view models.
// ---------------------------------------------------------------------------

export interface PlayInGameCardViewModel {
  gameId: string;
  matchup: PlayInMatchupId;
  matchupLabel: string;
  conference: ConferenceId;
  homeFranchiseId: string | null;
  awayFranchiseId: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
  status: 'scheduled' | 'final' | 'forfeit';
  homeScore: number | null;
  awayScore: number | null;
  winnerFranchiseId: string | null;
  loserFranchiseId: string | null;
  consequence: string;
  humanGame: boolean;
  started: boolean;
}

export function playInMatchupLabel(matchup: PlayInMatchupId): string {
  switch (matchup) {
    case 'seven-eight':
      return '7 vs 8';
    case 'nine-ten':
      return '9 vs 10';
    case 'final':
      return 'Final';
  }
}

export function playInGameCardViewModel(
  state: SeasonPostseasonState,
  conference: ConferenceId,
  matchup: PlayInMatchupId,
  humanFranchiseId: string | null,
): PlayInGameCardViewModel {
  const playIn = state.playIn[conference];
  const gameKey: 'sevenEight' | 'nineTen' | 'final' =
    matchup === 'seven-eight' ? 'sevenEight' : matchup === 'nine-ten' ? 'nineTen' : 'final';
  const game = playIn.games[gameKey];
  const ranking = playIn.ranking;
  // The engine derives the scheduled pairing from the ranking; mirror it so
  // scheduled cards show the seeded matchup instead of TBD.
  const engineTeams = seasonPostseasonGameTeamsOf(state, game.gameId);
  const homeFranchiseId = game.homeFranchiseId ?? engineTeams?.home ?? null;
  const awayFranchiseId = game.awayFranchiseId ?? engineTeams?.away ?? null;
  const seedOf = (franchiseId: string | null): number | null => {
    if (franchiseId === null || ranking === null) return null;
    const position = ranking.indexOf(franchiseId);
    return position === -1 ? null : position + 1;
  };
  const consequence =
    matchup === 'seven-eight'
      ? 'Winner takes seed 7 · loser hosts the final'
      : matchup === 'nine-ten'
        ? 'Loser eliminated · winner travels to the final'
        : 'Winner takes seed 8 · loser eliminated';
  return {
    gameId: game.gameId,
    matchup,
    matchupLabel: playInMatchupLabel(matchup),
    conference,
    homeFranchiseId,
    awayFranchiseId,
    homeSeed: seedOf(homeFranchiseId),
    awaySeed: seedOf(awayFranchiseId),
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winnerFranchiseId: game.winnerFranchiseId,
    loserFranchiseId: game.loserFranchiseId,
    consequence,
    humanGame:
      humanFranchiseId !== null &&
      (homeFranchiseId === humanFranchiseId || awayFranchiseId === humanFranchiseId),
    started: game.status !== 'scheduled',
  };
}

export interface PlayInColumnViewModel {
  conference: ConferenceId;
  seeds: Array<{ franchiseId: string; seed: number }>;
  games: PlayInGameCardViewModel[];
}

export function playInColumnViewModel(
  state: SeasonPostseasonState,
  conference: ConferenceId,
  humanFranchiseId: string | null,
): PlayInColumnViewModel {
  const playIn = state.playIn[conference];
  const seeds = (playIn.ranking ?? []).slice(6, 10).map((franchiseId, index) => ({
    franchiseId,
    seed: index + 7,
  }));
  return {
    conference,
    seeds,
    games: (['seven-eight', 'nine-ten', 'final'] as const).map((matchup) =>
      playInGameCardViewModel(state, conference, matchup, humanFranchiseId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Bracket columns (desktop round columns; mobile ordered series cards).
// ---------------------------------------------------------------------------

export interface BracketColumnViewModel {
  key: 'play-in' | PlayoffRound;
  title: string;
  subtitle: string;
  playIn: PlayInColumnViewModel[] | null;
  series: SeriesCardViewModel[];
}

export function bracketColumnsOf(
  state: SeasonPostseasonState,
  humanFranchiseId: string | null,
): BracketColumnViewModel[] {
  const playInColumn: BracketColumnViewModel = {
    key: 'play-in',
    title: 'Play-In',
    subtitle: 'Seeds 7–10 · win or go home',
    playIn: (['east', 'west'] as const).map((conference) =>
      playInColumnViewModel(state, conference, humanFranchiseId),
    ),
    series: [],
  };
  const columns: BracketColumnViewModel[] = [playInColumn];
  const bracket = state.bracket;
  if (bracket === null) {
    return columns;
  }
  columns.push({
    key: 'first-round',
    title: 'First Round',
    subtitle: 'Best of seven',
    playIn: null,
    series: [
      ...bracket.east.firstRound.map((series) => seriesCardViewModel(series, humanFranchiseId)),
      ...bracket.west.firstRound.map((series) => seriesCardViewModel(series, humanFranchiseId)),
    ],
  });
  columns.push({
    key: 'conference-semifinal',
    title: 'Conference Semis',
    subtitle: 'Best of seven',
    playIn: null,
    series: [
      ...bracket.east.semifinals.map((series) => seriesCardViewModel(series, humanFranchiseId)),
      ...bracket.west.semifinals.map((series) => seriesCardViewModel(series, humanFranchiseId)),
    ],
  });
  columns.push({
    key: 'conference-final',
    title: 'Conference Finals',
    subtitle: 'Best of seven',
    playIn: null,
    series: [
      seriesCardViewModel(bracket.east.conferenceFinal, humanFranchiseId),
      seriesCardViewModel(bracket.west.conferenceFinal, humanFranchiseId),
    ],
  });
  columns.push({
    key: 'finals',
    title: 'Finals',
    subtitle: 'Champion takes the draw',
    playIn: null,
    series: [seriesCardViewModel(bracket.finals, humanFranchiseId)],
  });
  return columns;
}

/** Ordered cards for mobile (Play-In sections + every bracket series). */
export function mobileBracketCardsOf(
  state: SeasonPostseasonState,
  humanFranchiseId: string | null,
): Array<
  | { kind: 'play-in'; column: PlayInColumnViewModel }
  | { kind: 'series'; columnKey: BracketColumnViewModel['key']; card: SeriesCardViewModel }
> {
  const columns = bracketColumnsOf(state, humanFranchiseId);
  const cards: Array<
    | { kind: 'play-in'; column: PlayInColumnViewModel }
    | { kind: 'series'; columnKey: BracketColumnViewModel['key']; card: SeriesCardViewModel }
  > = [];
  for (const column of columns) {
    if (column.playIn !== null) {
      for (const playIn of column.playIn) {
        cards.push({ kind: 'play-in', column: playIn });
      }
    }
    for (const card of column.series) {
      cards.push({ kind: 'series', columnKey: column.key, card });
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Postseason summary presentation (schedule tab + history).
// ---------------------------------------------------------------------------

export interface PostseasonSummaryRow {
  summary: SeasonPostseasonSummary;
  phaseLabel: string;
  roundLabel: string;
  scoreLabel: string;
  humanWon: boolean | null;
  humanGame: boolean;
}

export function postseasonSummaryRow(
  summary: SeasonPostseasonSummary,
  humanFranchiseId: string,
): PostseasonSummaryRow {
  const humanGame =
    summary.homeFranchiseId === humanFranchiseId || summary.awayFranchiseId === humanFranchiseId;
  const humanWon = humanGame ? summary.winnerFranchiseId === humanFranchiseId : null;
  const roundLabelText =
    summary.phase === 'play-in'
      ? playInMatchupLabel(summary.round as PlayInMatchupId)
      : roundLabel(summary.round as PlayoffRound);
  return {
    summary,
    phaseLabel: summary.phase === 'play-in' ? 'Play-In' : 'Playoffs',
    roundLabel: roundLabelText,
    scoreLabel:
      summary.status === 'forfeit'
        ? '2–0 · forfeit'
        : `${String(summary.homeScore)}–${String(summary.awayScore)}`,
    humanWon,
    humanGame,
  };
}

// ---------------------------------------------------------------------------
// Awards presentation (leaders tab + history).
// ---------------------------------------------------------------------------

export interface AwardViewModel {
  key: 'mvp' | 'dpoy' | 'sixth-man';
  title: string;
  playerVersionId: string;
  franchiseId: string;
  playerName: string;
  franchiseLabel: string;
  explanation: string;
}

export const AWARD_EXPLANATIONS = {
  mvp: 'Highest MVP composite: game score plus efficiency, defense, and playmaking bonuses and the game-result share, availability-adjusted over the regular season.',
  dpoy: 'Highest defensive composite: steals, blocks, and defensive rebounds plus the team defensive-rating advantage, availability-adjusted.',
  'sixth-man': 'MVP composite among bench-qualified players — more bench games than starts.',
  firstTeam: 'The five highest eligible players by the MVP composite, positionless.',
} as const;

export function awardsViewModel(
  awards: SeasonAwards,
  playerName: (playerVersionId: string) => string,
  franchiseName: (franchiseId: string) => string,
): {
  awards: AwardViewModel[];
  firstTeam: AwardViewModel[];
} {
  const titleOf = (key: AwardViewModel['key']): string =>
    key === 'mvp'
      ? 'Most Valuable Player'
      : key === 'dpoy'
        ? 'Defensive Player of the Year'
        : 'Sixth Man of the Year';
  const of = (key: AwardViewModel['key'], recipient: SeasonAwards['mvp']): AwardViewModel => ({
    key,
    title: titleOf(key),
    playerVersionId: recipient.playerVersionId,
    franchiseId: recipient.franchiseId,
    playerName: playerName(recipient.playerVersionId),
    franchiseLabel: franchiseName(recipient.franchiseId),
    explanation: AWARD_EXPLANATIONS[key],
  });
  return {
    awards: [
      of('mvp', awards.mvp),
      of('dpoy', awards.defensivePlayerOfYear),
      of('sixth-man', awards.sixthManOfYear),
    ],
    firstTeam: awards.allLeagueFirstTeam.map((recipient) => ({
      ...of('mvp', recipient),
      title: 'All-League First Team',
      explanation: AWARD_EXPLANATIONS.firstTeam,
    })),
  };
}

// ---------------------------------------------------------------------------
// Risky rehab options (postseason rotation decision, 2 Influence).
// ---------------------------------------------------------------------------

export interface RiskyRehabOption {
  injuryId: string;
  playerVersionId: string;
  displayName: string;
  severity: SeasonInjurySeverity;
  missedGamesRemaining: number;
  cost: number;
  balance: number;
  available: boolean;
  alreadyRehabbed: boolean;
}

export const SEASON_POSTSEASON_REHAB_COST = SEASON_POSTSEASON_RISKY_REHAB_COST;

/** Active human-team injuries that qualify for a postseason risky-rehab roll. */
export function riskyRehabOptionsOf(
  run: SeasonRun,
  humanFranchiseId: string,
  playerName: (playerVersionId: string) => string,
): RiskyRehabOption[] {
  const balance = run.influence.balances[humanFranchiseId] ?? 0;
  const rehabs = run.influence.rehabs;
  return run.health.injuries
    .filter((record) => record.franchiseId === humanFranchiseId && record.missedGamesRemaining > 0)
    .map((record) => ({
      injuryId: record.injuryId,
      playerVersionId: record.playerVersionId,
      displayName: playerName(record.playerVersionId),
      severity: record.severity,
      missedGamesRemaining: record.missedGamesRemaining,
      cost: SEASON_POSTSEASON_RISKY_REHAB_COST,
      balance,
      available: balance >= SEASON_POSTSEASON_RISKY_REHAB_COST,
      alreadyRehabbed: rehabs[record.injuryId] !== undefined,
    }))
    .sort((a, b) => a.playerVersionId.localeCompare(b.playerVersionId));
}

// ---------------------------------------------------------------------------
// Typed rejection copy for the postseason commands.
// ---------------------------------------------------------------------------

/** Human-readable copy for the M2.6 postseason rejection codes. */
export function describePostseasonRejection(
  command: SeasonRunCommand['command'],
  rejection: SeasonRunCommandRejection,
): string {
  switch (rejection.code) {
    case 'invalid-stage':
      return `That action requires the ${rejection.requiredStage} stage; this run is in ${rejection.currentStage}.`;
    case 'wrong-game':
      return 'That game is not the next scheduled postseason game. Refresh to see the current matchup.';
    case 'invalid-rotation':
      return `The lineup is not legal: ${rejection.reasons.join('; ')}`;
    case 'unavailable-player':
      return rejection.reason === 'injured'
        ? 'A player in the lineup is injured and cannot play this game — move them out or spend Influence on a risky rehab roll.'
        : 'A player in the lineup is no longer on the roster.';
    case 'insufficient-rehab-resources':
      return `Risky rehab needs ${String(rejection.required)} Influence; your balance is ${String(
        rejection.balance,
      )}.`;
    case 'invalid-series-state':
      return `That series cannot advance right now (${rejection.reason}).`;
    case 'integrity-failure':
      return `The postseason state failed an integrity check: ${rejection.reason}`;
    default:
      return describeCommandRejection(command, rejection);
  }
}
