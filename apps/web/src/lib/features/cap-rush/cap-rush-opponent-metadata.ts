import type {
  CapRushRosterMetadata,
  HavocSourcePlayer,
  OpponentBracket,
} from '@hoop-rush/data-contracts';
import { canonicalJson } from '@hoop-rush/data-contracts';

type OpponentSource = Pick<HavocSourcePlayer, 'playerId' | 'franchiseId' | 'seasonKey' | 'profile'>;

export function capRushOpponentMetadataOf(source: OpponentSource, metadata: CapRushRosterMetadata) {
  const matches = metadata.players.filter(
    (player) =>
      player.playerId === source.playerId &&
      player.teamId === source.franchiseId &&
      (source.seasonKey === null || player.seasonKey === source.seasonKey) &&
      canonicalJson(player.ratings) === canonicalJson(source.profile.ratings) &&
      canonicalJson(player.tendencies) === canonicalJson(source.profile.tendencies),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function capRushBracketWithRosterMetadata(
  bracket: OpponentBracket,
  metadata: CapRushRosterMetadata,
  fieldHash: string,
): OpponentBracket {
  if (metadata.fieldHash !== fieldHash)
    throw new Error('The Cap Rush roster metadata belongs to a different opponent field.');
  return {
    ...bracket,
    opponents: bracket.opponents.map((opponent) => ({
      ...opponent,
      players: opponent.players.map((player) => {
        const row = capRushOpponentMetadataOf(
          {
            playerId: player.playerId,
            franchiseId: opponent.teamId,
            seasonKey: opponent.seasonKey,
            profile: { ratings: player.ratings, tendencies: player.tendencies },
          },
          metadata,
        );
        if (row === null)
          throw new Error(
            `The exact opponent roster metadata is unavailable for ${player.displayName}.`,
          );
        return { ...player, overall: row.overall };
      }),
    })),
  };
}
