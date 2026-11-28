import type { ChallengeRun } from '@hoop-rush/data-contracts';
import {
  evaluateIndividualSeasonAchievements,
  type IndividualAchievementId,
} from './individual.ts';

/**
 * Classic and Sandbox achievement evaluation.
 *
 * Inputs are aggregate season facts. `seasonAchievementFactsFromRun` converts a
 * completed `ChallengeRun` into those facts; callers that already hold the same
 * aggregates can build the facts directly.
 */

export const CLASSIC_ACHIEVEMENT_IDS = [
  'better-than-73-9',
  'one-game-short',
  'the-popovich-way',
  'ball-dont-lie',
  'goin-to-work',
  '30-for-30',
  'we-believe',
] as const;

export const PLAYER_ACHIEVEMENT_IDS = [
  'brodie-mode',
  'welcome-to-the-50-40-90-club',
  'the-harden-system',
  'the-beautiful-game',
  'magic-vision',
  'leeverything',
] as const;

export const SANDBOX_ACHIEVEMENT_IDS = [
  'the-dream-team',
  'laker-legacy',
  'old-school-legends',
] as const;

export type ClassicAchievementId = (typeof CLASSIC_ACHIEVEMENT_IDS)[number];
export type PlayerAchievementId = (typeof PLAYER_ACHIEVEMENT_IDS)[number];
export type SandboxAchievementId = (typeof SANDBOX_ACHIEVEMENT_IDS)[number];
export type SeasonAchievementId = ClassicAchievementId | PlayerAchievementId | SandboxAchievementId;

export interface AchievementEvidence<Id extends string = SeasonAchievementId> {
  id: Id;
  evidence: string;
}

const SHOOTING_CLUB_MINIMUM_ATTEMPTS = {
  fieldGoals: 600,
  threes: 205,
  freeThrows: 140,
} as const;

export interface SeasonGameFacts {
  /** The opponent's franchise; challenge runs always play the user at home. */
  opponentFranchiseId: string;
  won: boolean;
  margin: number;
}

export interface SeasonPlayerFacts {
  playerId: string;
  displayName: string;
  /** Original (pre-run) overall from the drafted player snapshot. */
  originalOverall: number | null;
  gamesPlayed: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoals: { made: number; attempted: number };
  threes: { made: number; attempted: number };
  freeThrows: { made: number; attempted: number };
  /** Draft provenance. Null when the completed run predates provenance saves. */
  sourceFranchiseId: string | null;
  /** Season decade id from the draft selection, for example `1990s`. */
  eraId: string | null;
  seasonStartYear?: number;
}

export interface SeasonAchievementFacts {
  mode: ChallengeRun['mode'];
  status: ChallengeRun['status'];
  wins: number;
  losses: number;
  gamesPlayed: number;
  variant: 'ratings' | 'ball-knowledge' | null;
  teamPoints: number;
  games: readonly SeasonGameFacts[];
  players: readonly SeasonPlayerFacts[];
  /** Reroll history from the classic draft. Null when it was not captured. */
  rerollsUsed: { franchise: boolean; era: boolean } | null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function perGame(total: number, games: number): number {
  return ratio(total, games);
}

function decimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function percentage(value: number): string {
  return decimal(value * 100);
}

function isEligibleFullSeason(facts: SeasonAchievementFacts): boolean {
  return (
    facts.status === 'finished' && facts.gamesPlayed === 82 && facts.wins + facts.losses === 82
  );
}

function originalOveralls(facts: SeasonAchievementFacts): number[] | null {
  if (facts.players.length !== 5) return null;
  const overalls = facts.players.map((player) => player.originalOverall);
  if (overalls.some((overall) => overall === null)) return null;
  return overalls as number[];
}

function decadeStartYear(player: SeasonPlayerFacts): number | null {
  if (player.seasonStartYear !== undefined) return Math.floor(player.seasonStartYear / 10) * 10;
  if (player.eraId === null) return null;
  const match = /^(\d{4})s$/.exec(player.eraId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function seasonShootingLine(player: SeasonPlayerFacts): {
  fieldGoalPct: number;
  threePointPct: number;
  freeThrowPct: number;
} | null {
  if (
    player.fieldGoals.attempted < SHOOTING_CLUB_MINIMUM_ATTEMPTS.fieldGoals ||
    player.threes.attempted < SHOOTING_CLUB_MINIMUM_ATTEMPTS.threes ||
    player.freeThrows.attempted < SHOOTING_CLUB_MINIMUM_ATTEMPTS.freeThrows
  ) {
    return null;
  }
  const fieldGoalPct = ratio(player.fieldGoals.made, player.fieldGoals.attempted);
  const threePointPct = ratio(player.threes.made, player.threes.attempted);
  const freeThrowPct = ratio(player.freeThrows.made, player.freeThrows.attempted);
  if (fieldGoalPct < 0.5 || threePointPct < 0.4 || freeThrowPct < 0.9) return null;
  return { fieldGoalPct, threePointPct, freeThrowPct };
}

export function seasonAchievementFactsFromRun(run: ChallengeRun): SeasonAchievementFacts {
  const playerById = new Map(run.players.map((player) => [player.playerId, player]));
  const rerolls = run.classicDraft?.rerolls;
  const selectionById = new Map(
    (run.selections ?? []).map((selection) => [selection.playerId, selection]),
  );
  return {
    mode: run.mode,
    status: run.status,
    wins: run.aggregates.team.wins,
    losses: run.aggregates.team.losses,
    gamesPlayed: run.games.length,
    variant: run.variant ?? null,
    teamPoints: run.aggregates.team.points,
    rerollsUsed: rerolls ? { franchise: rerolls.franchiseSpent, era: rerolls.eraSpent } : null,
    games: run.games.map((game) => ({
      opponentFranchiseId: game.away.teamId,
      won: game.winner === 'home',
      margin: game.home.box.points - game.away.box.points,
    })),
    players: run.aggregates.players.map((aggregate) => {
      const player = playerById.get(aggregate.playerId);
      const selection = selectionById.get(aggregate.playerId);
      return {
        playerId: aggregate.playerId,
        displayName: player?.displayName ?? aggregate.playerId,
        originalOverall: player?.overall ?? null,
        gamesPlayed: aggregate.gamesPlayed,
        points: aggregate.points,
        rebounds: aggregate.rebounds.total,
        assists: aggregate.assists,
        steals: aggregate.steals,
        blocks: aggregate.blocks,
        turnovers: aggregate.turnovers,
        fieldGoals: aggregate.fieldGoals,
        threes: aggregate.threes,
        freeThrows: aggregate.freeThrows,
        sourceFranchiseId: selection?.franchiseId ?? null,
        eraId: selection?.eraId ?? null,
        ...(selection?.seasonKey
          ? { seasonStartYear: Number(selection.seasonKey.slice(0, 4)) }
          : {}),
      };
    }),
  };
}

export function evaluateClassicAchievements(
  facts: SeasonAchievementFacts,
): AchievementEvidence<ClassicAchievementId>[] {
  if (facts.mode !== 'classic' || !isEligibleFullSeason(facts)) return [];
  const unlocks: AchievementEvidence<ClassicAchievementId>[] = [];

  if (facts.wins === 82 && facts.losses === 0) {
    unlocks.push({ id: 'better-than-73-9', evidence: '82-0 season' });
  }

  if (facts.wins === 81 && facts.losses === 1) {
    unlocks.push({ id: 'one-game-short', evidence: '81-1 season' });
  }

  if (
    facts.wins >= 70 &&
    facts.rerollsUsed !== null &&
    !facts.rerollsUsed.franchise &&
    !facts.rerollsUsed.era
  ) {
    unlocks.push({
      id: 'the-popovich-way',
      evidence: `${String(facts.wins)} wins without using a franchise or era reroll`,
    });
  }

  if (facts.wins >= 75 && facts.variant === 'ball-knowledge') {
    unlocks.push({
      id: 'ball-dont-lie',
      evidence: `${String(facts.wins)} wins with Ball Knowledge`,
    });
  }

  const overalls = originalOveralls(facts);
  if (facts.wins >= 65 && overalls !== null && overalls.every((overall) => overall < 90)) {
    unlocks.push({
      id: 'goin-to-work',
      evidence: `${String(facts.wins)} wins with no 90+ original OVR player (highest ${String(Math.max(...overalls))})`,
    });
  }

  const beatenFranchises = new Set<string>();
  for (const game of facts.games) {
    if (game.won && game.margin >= 15) beatenFranchises.add(game.opponentFranchiseId);
  }
  if (beatenFranchises.size >= 30) {
    unlocks.push({
      id: '30-for-30',
      evidence: `Beat ${String(beatenFranchises.size)} opponent franchises by 15+`,
    });
  }

  if (facts.wins >= 70 && overalls !== null) {
    const average = overalls.reduce((total, overall) => total + overall, 0) / overalls.length;
    if (average < 85) {
      unlocks.push({
        id: 'we-believe',
        evidence: `${String(facts.wins)} wins with a starting-five average of ${decimal(average)} original OVR`,
      });
    }
  }

  return unlocks;
}

export function evaluatePlayerAchievements(
  facts: SeasonAchievementFacts,
): AchievementEvidence<PlayerAchievementId>[] {
  if (!isEligibleFullSeason(facts)) return [];
  const unlocks: AchievementEvidence<PlayerAchievementId>[] = [];

  for (const player of facts.players) {
    const pointsPerGame = perGame(player.points, facts.gamesPlayed);
    const reboundsPerGame = perGame(player.rebounds, facts.gamesPlayed);
    const assistsPerGame = perGame(player.assists, facts.gamesPlayed);
    if (pointsPerGame >= 10 && reboundsPerGame >= 10 && assistsPerGame >= 10) {
      unlocks.push({
        id: 'brodie-mode',
        evidence: `${player.displayName}: ${decimal(pointsPerGame)} PPG / ${decimal(reboundsPerGame)} RPG / ${decimal(assistsPerGame)} APG`,
      });
      break;
    }
  }

  for (const player of facts.players) {
    const shooting = seasonShootingLine(player);
    if (shooting === null) continue;
    unlocks.push({
      id: 'welcome-to-the-50-40-90-club',
      evidence: `${player.displayName}: ${percentage(shooting.fieldGoalPct)}% FG / ${percentage(shooting.threePointPct)}% 3P / ${percentage(shooting.freeThrowPct)}% FT`,
    });
    break;
  }

  if (facts.wins >= 70 && facts.teamPoints > 0) {
    const scorer = facts.players.find((player) => player.points / facts.teamPoints >= 0.35);
    if (scorer) {
      unlocks.push({
        id: 'the-harden-system',
        evidence: `${scorer.displayName}: ${percentage(scorer.points / facts.teamPoints)}% of team points with ${String(facts.wins)} wins`,
      });
    }
  }

  if (
    facts.wins >= 65 &&
    facts.players.length === 5 &&
    facts.players.every((player) => perGame(player.points, facts.gamesPlayed) >= 15)
  ) {
    unlocks.push({
      id: 'the-beautiful-game',
      evidence: `All five starters at 15+ PPG with ${String(facts.wins)} wins`,
    });
  }

  for (const player of facts.players) {
    const assistsPerGame = perGame(player.assists, facts.gamesPlayed);
    if (assistsPerGame < 10) continue;
    if (player.turnovers > 0 && player.assists / player.turnovers < 5) continue;
    unlocks.push({
      id: 'magic-vision',
      evidence:
        player.turnovers === 0
          ? `${player.displayName}: ${decimal(assistsPerGame)} APG with zero turnovers`
          : `${player.displayName}: ${decimal(assistsPerGame)} APG at ${decimal(player.assists / player.turnovers)} AST/TOV`,
    });
    break;
  }

  if (facts.players.length > 0) {
    const totals = {
      points: Math.max(...facts.players.map((player) => player.points)),
      rebounds: Math.max(...facts.players.map((player) => player.rebounds)),
      assists: Math.max(...facts.players.map((player) => player.assists)),
      steals: Math.max(...facts.players.map((player) => player.steals)),
      blocks: Math.max(...facts.players.map((player) => player.blocks)),
    };
    const leader = facts.players.find(
      (player) =>
        player.points === totals.points &&
        player.rebounds === totals.rebounds &&
        player.assists === totals.assists &&
        player.steals === totals.steals &&
        player.blocks === totals.blocks,
    );
    if (leader) {
      unlocks.push({
        id: 'leeverything',
        evidence: `${leader.displayName} leads the team in points, rebounds, assists, steals, and blocks`,
      });
    }
  }

  return unlocks;
}

/**
 * `the-dream-team` is Sandbox-only. `laker-legacy` and `old-school-legends`
 * are evaluated for any eligible full season because only the Dream Team
 * achievement is documented as Sandbox-restricted.
 */
export function evaluateSandboxAchievements(
  facts: SeasonAchievementFacts,
): AchievementEvidence<SandboxAchievementId>[] {
  if (!isEligibleFullSeason(facts)) return [];
  const unlocks: AchievementEvidence<SandboxAchievementId>[] = [];

  if (facts.mode === 'sandbox' && facts.wins >= 70 && facts.players.length === 5) {
    const decades = facts.players.map(decadeStartYear);
    if (decades.every((year) => year !== null) && new Set(decades).size === 5) {
      unlocks.push({
        id: 'the-dream-team',
        evidence: `${String(facts.wins)} wins with players from five different decades`,
      });
    }
  }

  if (facts.wins >= 70 && facts.players.length === 5) {
    const franchises = facts.players.map((player) => player.sourceFranchiseId);
    const decades = new Set(
      facts.players.map(decadeStartYear).filter((year): year is number => year !== null),
    );
    if (
      franchises.every((franchiseId): franchiseId is string => franchiseId !== null) &&
      new Set(franchises).size === 1 &&
      decades.size >= 3
    ) {
      const franchiseId = franchises[0];
      if (franchiseId !== undefined) {
        unlocks.push({
          id: 'laker-legacy',
          evidence: `${franchiseId} players across ${String(decades.size)} decades with ${String(facts.wins)} wins`,
        });
      }
    }

    const pre1980Seasons = facts.players.filter((player) => {
      const startYear = decadeStartYear(player);
      return startYear !== null && startYear < 1980;
    }).length;
    if (pre1980Seasons >= 3) {
      unlocks.push({
        id: 'old-school-legends',
        evidence: `${String(pre1980Seasons)} pre-1980 player seasons with ${String(facts.wins)} wins`,
      });
    }
  }

  return unlocks;
}

export function evaluateAchievements(
  facts: SeasonAchievementFacts,
): AchievementEvidence<SeasonAchievementId | IndividualAchievementId>[] {
  return [
    ...evaluateClassicAchievements(facts),
    ...evaluatePlayerAchievements(facts),
    ...evaluateSandboxAchievements(facts),
    ...(isEligibleFullSeason(facts)
      ? evaluateIndividualSeasonAchievements({
          mode: facts.mode,
          players: facts.players,
        })
      : []),
  ];
}

export function evaluateRunAchievements(
  run: ChallengeRun,
): AchievementEvidence<SeasonAchievementId | IndividualAchievementId>[] {
  return evaluateAchievements(seasonAchievementFactsFromRun(run));
}
