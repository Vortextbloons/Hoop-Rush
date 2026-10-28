import type {
  FixedFiveCompetitionResult,
  FixedFiveWorkerResultEntry,
} from '@hoop-rush/data-contracts';
import { profileRepository } from '#lib/features/profile/profile.js';

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

export async function recordFixedFiveCareer(
  roomId: string,
  participant: 'p1' | 'p2',
  result: FixedFiveCompetitionResult,
  entries: readonly FixedFiveWorkerResultEntry[],
): Promise<void> {
  const facts = fixedFiveCareerFacts(participant, result, entries);
  if (!facts) return;
  const bindingId = `fixed-five:${roomId}`;
  const repository = profileRepository();
  const winner = result.competition === 'duel' ? result.winner : result.ranking[0];
  if (winner)
    await repository.recordCompletedMatch(
      bindingId,
      facts.map((game) => ({
        gameId: String(game.gameNumber),
        facts: { won: game.won, multiplayer: true, players: game.players },
      })),
      winner === participant,
    );
}
