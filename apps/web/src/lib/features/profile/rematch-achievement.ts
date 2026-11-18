import { ROOM_PROTOCOL_VERSION } from '@hoop-rush/data-contracts';
import { getMultiplayerClient } from '#lib/supabase-runtime.js';
import { profileRepository } from './profile.js';

type Seat = 'p1' | 'p2';
type Membership = { roomId: string; participantId: Seat };
type SeriesRecap = { roomId: string; champion: Seat };

export function rematchAchievementHooks<Recap extends SeriesRecap>({
  mode,
  bindingPrefix,
  loadMembership,
  loadCompleted,
  complete,
}: {
  mode: 'draft-duel' | 'havoc';
  bindingPrefix: string;
  loadMembership: (roomId: string) => Membership | null;
  loadCompleted: (roomId: string) => Promise<Recap | null>;
  complete: (recap: Recap) => Promise<void>;
}) {
  const bindingId = (roomId: string) => `${bindingPrefix}:${roomId}`;

  async function award(recap: Recap): Promise<void> {
    if (loadMembership(recap.roomId)?.participantId !== recap.champion) return;
    const repository = profileRepository();
    const binding = bindingId(recap.roomId);
    const previousRoomId = await repository.rematchAfterLoss(binding);
    if (!previousRoomId) return;
    const profile = await repository.loadBound(binding);
    if (!profile || profile.achievements.includes('the-revenge-tour')) return;
    const client = await getMultiplayerClient();
    const response = await client.rpc('multiplayer_verify_rematch', {
      p_kind: mode,
      p_previous_room_id: previousRoomId,
      p_room_id: recap.roomId,
      p_protocol_version: ROOM_PROTOCOL_VERSION,
    });
    const verified: unknown = response.data;
    if (response.error || verified !== true) return;
    await repository.awardAchievements(binding, 'rematch', [
      { id: 'the-revenge-tour', evidence: 'Won the rematch after dropping the first series' },
    ]);
  }

  return {
    rememberRematch: async (previousRoomId: string, membership: Membership): Promise<void> => {
      const previousMembership = loadMembership(previousRoomId);
      if (!previousMembership) return;
      const recap = await loadCompleted(previousRoomId);
      if (!recap || recap.champion === previousMembership.participantId) return;
      await profileRepository().rememberRematchAfterLoss(
        bindingId(previousRoomId),
        bindingId(membership.roomId),
        previousRoomId,
        membership.participantId,
      );
    },
    complete: async (recap: Recap): Promise<void> => {
      await complete(recap);
      void award(recap).catch(() => {});
    },
    loadCompleted: async (roomId: string): Promise<Recap | null> => {
      const recap = await loadCompleted(roomId);
      if (recap) void award(recap).catch(() => {});
      return recap;
    },
  };
}
