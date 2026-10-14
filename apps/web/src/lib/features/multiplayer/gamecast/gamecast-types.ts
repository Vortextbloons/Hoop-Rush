import type {
  GameResult,
  GameTapeEvent,
  PlayerExternalId,
  PlayerId,
  PlayersIndexAltIds,
} from '@hoop-rush/data-contracts';

export type GamecastParticipantId = 'p1' | 'p2';

export interface GamecastPlayer {
  playerId: PlayerId;
  displayName: string;
  seasonKey?: string;
  franchiseId?: string;
  playerExternalId?: PlayerExternalId;
  altIds?: PlayersIndexAltIds;
}

export interface GamecastRecordedGame {
  gameNumber: number;
  homeParticipantId: GamecastParticipantId;
  awayParticipantId: GamecastParticipantId;
  result: GameResult;
  tape: readonly GameTapeEvent[];
}

export interface GamecastSeriesGame {
  gameNumber: number;
  homeParticipantId: GamecastParticipantId;
  awayParticipantId: GamecastParticipantId;
  winner: GamecastParticipantId;
}

export interface GamecastSeries {
  games: readonly GamecastSeriesGame[];
  p1Wins: number;
  p2Wins: number;
  currentGameNumber: number | null;
  champion: GamecastParticipantId | null;
  homeWinner?: GamecastParticipantId | null;
}

export type GamecastHomeFormat = 'best-of-2-2-1-1-1' | 'alternating';

export type GamecastVerification = 'pending' | 'verified' | 'mismatch';

export function gamecastOtherParticipant(
  participantId: GamecastParticipantId,
): GamecastParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}
