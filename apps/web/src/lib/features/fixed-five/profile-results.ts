import {
  canonicalJson,
  type AchievementUnlock,
  type FixedFiveCompetitionResult,
  type FixedFiveCompetitionRun,
  type FixedFiveDuelResult,
  type FixedFiveWorkerResultEntry,
} from '@hoop-rush/data-contracts';
import {
  evaluateSeriesAchievements,
  evaluateSharedSeasonAchievements,
  type SeriesAchievementFacts,
} from '@hoop-rush/engine';
import { fixedFiveRepository } from './fixed-five-repo.js';

export function fixedFiveCareerFacts(
  participant: 'p1' | 'p2',
  result: FixedFiveCompetitionResult,
  entries: readonly FixedFiveWorkerResultEntry[],
) {
  const relevant = entries
    .filter((entry) => entry.tag === 'h2h' || entry.tag === 'duel' || entry.tag === participant)
    .sort((a, b) => a.game.gameNumber - b.game.gameNumber);
  const expected = result.competition === 'duel' ? result.games.length : 82;
  if (
    relevant.length !== expected ||
    new Set(relevant.map((entry) => entry.game.gameNumber)).size !== expected
  )
    return null;
  const facts = relevant.map(({ game }) => {
    const side =
      game.home.teamId === participant ? 'home' : game.away.teamId === participant ? 'away' : null;
    if (side === null) throw new Error('The match result does not contain your team.');
    return { gameNumber: game.gameNumber, won: game.winner === side, players: game[side].players };
  });
  return facts;
}

function averageOriginalOverall(players: readonly { overall?: number }[]): number {
  if (players.length !== 5) return Number.NaN;
  let total = 0;
  for (const player of players) {
    if (player.overall === undefined || !Number.isFinite(player.overall)) return Number.NaN;
    total += player.overall;
  }
  return total / 5;
}

function participantOfTeam(teamId: string): 'p1' | 'p2' | null {
  return teamId === 'p1' || teamId === 'p2' ? teamId : null;
}

function fixedFiveSeriesFacts(
  participant: 'p1' | 'p2',
  result: FixedFiveDuelResult,
  entries: readonly FixedFiveWorkerResultEntry[],
  run: FixedFiveCompetitionRun | null,
): SeriesAchievementFacts {
  const byGame = new Map<number, FixedFiveWorkerResultEntry>();
  for (const entry of entries) {
    if (entry.tag === 'duel') byGame.set(entry.game.gameNumber, entry);
  }
  const games: SeriesAchievementFacts['games'][number][] = result.games.map((game) => {
    const entry = byGame.get(game.gameNumber);
    if (!entry) {
      return {
        gameNumber: game.gameNumber,
        winner: game.winner,
        homeScore: Number.NaN,
        awayScore: Number.NaN,
      };
    }
    const home = participantOfTeam(entry.game.home.teamId);
    const away = participantOfTeam(entry.game.away.teamId);
    const entryWinner = entry.game.winner === 'home' ? home : away;
    const scoresAgree =
      home !== null && away !== null && home !== away && entryWinner === game.winner;
    return {
      gameNumber: game.gameNumber,
      winner: game.winner,
      homeScore: scoresAgree ? entry.game.home.box.points : Number.NaN,
      awayScore: scoresAgree ? entry.game.away.box.points : Number.NaN,
    };
  });
  return {
    seriesId: 'Fixed Five',
    participantId: participant,
    games,
    averageOriginalOverall: {
      p1: run ? averageOriginalOverall(run.lineups.p1.players) : Number.NaN,
      p2: run ? averageOriginalOverall(run.lineups.p2.players) : Number.NaN,
    },
  };
}

export function fixedFiveAchievementCandidates(
  participant: 'p1' | 'p2',
  result: FixedFiveCompetitionResult,
  entries: readonly FixedFiveWorkerResultEntry[],
  run: FixedFiveCompetitionRun | null,
): AchievementUnlock[] {
  if (!fixedFiveCareerFacts(participant, result, entries)) return [];
  if (result.competition === 'shared-82') {
    const summary = result.participants.find((entry) => entry.participantId === participant);
    if (!summary) return [];
    // The shared-82 result models both participants' seasons, so two distinct
    // summaries are the evidence that another human shared the season.
    const sharedWithHuman =
      new Set(result.participants.map((entry) => entry.participantId)).size === 2;
    return evaluateSharedSeasonAchievements({
      wins: summary.wins,
      losses: summary.losses,
      sharedWithHuman,
    });
  }
  return evaluateSeriesAchievements(fixedFiveSeriesFacts(participant, result, entries, run));
}

export async function recordFixedFiveCareer(
  roomId: string,
  participant: 'p1' | 'p2',
  result: FixedFiveCompetitionResult,
  entries: readonly FixedFiveWorkerResultEntry[],
): Promise<void> {
  const facts = fixedFiveCareerFacts(participant, result, entries);
  if (!facts) return;
  const bindingId = `fixed-five:${roomId}`;
  const pending = await fixedFiveRepository.loadPendingResult(roomId);
  const run =
    pending && canonicalJson(pending.run.result) === canonicalJson(result) ? pending.run : null;
  const candidates = fixedFiveAchievementCandidates(participant, result, entries, run);
  const winner = result.competition === 'duel' ? result.winner : result.ranking[0];
  if (winner)
    await fixedFiveRepository.recordCareer(
      bindingId,
      facts.map((game) => ({
        gameId: String(game.gameNumber),
        facts: { won: game.won, multiplayer: true, players: game.players },
      })),
      winner === participant,
      'career',
      candidates,
    );
}
