import {
  PROFILE_SAVE_SCHEMA_VERSION,
  playerProfileSchema,
  profileBindingSchema,
  profileGameSchema,
  profileSelectionSchema,
  type PlayerProfile,
} from '@hoop-rush/data-contracts';
import { applyProfileGame, type ProfileGameFacts } from '@hoop-rush/engine';
import type { HoopRushDatabase } from './dexie.ts';

export type ProfileCommand =
  | { kind: 'create'; id: string; name: string }
  | { kind: 'select'; id: string }
  | {
      kind: 'customize';
      id: string;
      name: string;
      avatar: PlayerProfile['avatar'];
      border: PlayerProfile['border'];
      nameColor: PlayerProfile['nameColor'];
      title: PlayerProfile['title'];
      featuredAchievement: PlayerProfile['featuredAchievement'];
    };

export class DexieProfileRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async initialize(defaultId: string): Promise<PlayerProfile> {
    return this.db.transaction('rw', this.db.profiles, this.db.profileSelection, async () => {
      const selected = await this.db.profileSelection.get('selected');
      if (selected) {
        const selection = profileSelectionSchema.parse(selected);
        const profile = await this.db.profiles.get(selection.profileId);
        if (!profile) throw new Error('Selected profile is missing');
        return playerProfileSchema.parse(profile);
      }
      const profile = this.newProfile(defaultId, 'Player');
      await this.db.profiles.add(profile);
      await this.db.profileSelection.add(
        profileSelectionSchema.parse({
          saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
          id: 'selected',
          profileId: profile.id,
        }),
      );
      return profile;
    });
  }

  async list(): Promise<PlayerProfile[]> {
    return (await this.db.profiles.toArray()).map((row) => playerProfileSchema.parse(row));
  }

  async listUnlocks(bindingId: string) {
    const rows = await this.db.profileGames.where('id').startsWith(`${bindingId}:`).toArray();
    return rows.flatMap((row) => profileGameSchema.parse(row).unlocked);
  }

  async dispatch(command: ProfileCommand): Promise<PlayerProfile> {
    return this.db.transaction('rw', this.db.profiles, this.db.profileSelection, async () => {
      if (command.kind === 'create') {
        const profile = this.newProfile(command.id, command.name);
        await this.db.profiles.add(profile);
        await this.db.profileSelection.put(
          profileSelectionSchema.parse({
            saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
            id: 'selected',
            profileId: profile.id,
          }),
        );
        return profile;
      }
      const row = await this.db.profiles.get(command.id);
      if (!row) throw new Error('Profile not found');
      const profile = playerProfileSchema.parse(row);
      if (command.kind === 'select') {
        await this.db.profileSelection.put(
          profileSelectionSchema.parse({
            saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
            id: 'selected',
            profileId: profile.id,
          }),
        );
        return profile;
      }
      if (
        command.featuredAchievement &&
        !profile.achievements.includes(command.featuredAchievement)
      )
        throw new Error('Achievement is locked');
      if (
        (command.avatar === 'crown' || command.border === 'gold') &&
        !profile.achievements.includes('built-different')
      )
        throw new Error('Cosmetic is locked');
      if (command.nameColor === 'blue' && !profile.achievements.includes('hands-off'))
        throw new Error('Cosmetic is locked');
      if (command.title === 'defensive-wall' && !profile.achievements.includes('no-easy-buckets'))
        throw new Error('Title is locked');
      if (command.title === 'floor-general' && !profile.achievements.includes('silent-carry'))
        throw new Error('Title is locked');
      const updated = playerProfileSchema.parse({
        ...profile,
        name: command.name,
        avatar: command.avatar,
        border: command.border,
        nameColor: command.nameColor,
        title: command.title,
        featuredAchievement: command.featuredAchievement,
      });
      await this.db.profiles.put(updated);
      return updated;
    });
  }

  async bind(id: string, participantId?: 'p1' | 'p2'): Promise<string> {
    return this.db.transaction(
      'rw',
      this.db.profileBindings,
      this.db.profileSelection,
      async () => {
        const existing = await this.db.profileBindings.get(id);
        if (existing) return profileBindingSchema.parse(existing).profileId;
        const selection = profileSelectionSchema.parse(
          await this.db.profileSelection.get('selected'),
        );
        await this.db.profileBindings.add(
          profileBindingSchema.parse({
            saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
            id,
            profileId: selection.profileId,
            ...(participantId ? { participantId } : {}),
          }),
        );
        return selection.profileId;
      },
    );
  }

  async recordGame(bindingId: string, gameId: string, facts: ProfileGameFacts) {
    return this.db.transaction(
      'rw',
      this.db.profileBindings,
      this.db.profileGames,
      this.db.profiles,
      async () => {
        const binding = profileBindingSchema.parse(await this.db.profileBindings.get(bindingId));
        const id = `${bindingId}:${gameId}`;
        const prior = await this.db.profileGames.get(id);
        if (prior) return profileGameSchema.parse(prior).unlocked;
        const profile = playerProfileSchema.parse(await this.db.profiles.get(binding.profileId));
        const result = applyProfileGame(profile, facts);
        await this.db.profiles.put(playerProfileSchema.parse(result.profile));
        await this.db.profileGames.add(
          profileGameSchema.parse({
            saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
            id,
            profileId: profile.id,
            unlocked: result.unlocked,
          }),
        );
        return result.unlocked;
      },
    );
  }

  async recordMatch(bindingId: string, won: boolean) {
    return this.db.transaction(
      'rw',
      this.db.profileBindings,
      this.db.profileGames,
      this.db.profiles,
      async () => {
        const binding = profileBindingSchema.parse(await this.db.profileBindings.get(bindingId));
        const id = `${bindingId}:match`;
        const prior = await this.db.profileGames.get(id);
        if (prior) return profileGameSchema.parse(prior).unlocked;
        const profile = playerProfileSchema.parse(await this.db.profiles.get(binding.profileId));
        const multiplayerStreak = won ? profile.multiplayerStreak + 1 : 0;
        const unlocked =
          multiplayerStreak >= 5 && !profile.achievements.includes('built-different')
            ? ['built-different' as const]
            : [];
        await this.db.profiles.put(
          playerProfileSchema.parse({
            ...profile,
            multiplayerStreak,
            achievements: [...profile.achievements, ...unlocked],
          }),
        );
        await this.db.profileGames.add(
          profileGameSchema.parse({
            saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
            id,
            profileId: profile.id,
            unlocked,
          }),
        );
        return unlocked;
      },
    );
  }

  private newProfile(id: string, name: string): PlayerProfile {
    return playerProfileSchema.parse({
      saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
      id,
      name,
      avatar: 'initials',
      border: 'classic',
      nameColor: 'white',
      title: 'none',
      featuredAchievement: null,
      achievements: [],
      games: 0,
      wins: 0,
      streak: 0,
      bestStreak: 0,
      multiplayerStreak: 0,
    });
  }
}
