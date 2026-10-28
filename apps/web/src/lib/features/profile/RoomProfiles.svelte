<script lang="ts">
  import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
  import { publicProfileSchema, type PublicProfile } from '@hoop-rush/data-contracts';
  import { getMultiplayerClient } from '#lib/supabase-runtime.js';
  import { achievements, profileRepository, selectedProfile } from './profile.js';
  let {
    topic,
    bindingId,
    participantId,
    onProfilesChange,
  }: {
    topic: string;
    bindingId: string | null;
    participantId: string | null;
    onProfilesChange?: (players: PublicProfile[]) => void;
  } = $props();
  let players = $state<PublicProfile[]>([]);
  $effect(() => {
    if (participantId !== 'p1' && participantId !== 'p2') return;
    const seat = participantId;
    let channel: RealtimeChannel | null = null;
    let client: SupabaseClient | null = null;
    let cancelled = false;
    void (async () => {
      let profile = await selectedProfile();
      if (bindingId) {
        await profileRepository().bind(bindingId, seat);
        profile = (await profileRepository().loadBound(bindingId)) ?? profile;
      }
      const payload = publicProfileSchema.parse({ ...profile, participantId: seat });
      client = await getMultiplayerClient();
      await client.realtime.setAuth();
      if (cancelled) return;
      channel = client.channel(topic, { config: { private: true, presence: { key: seat } } });
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel?.presenceState() ?? {};
          players = Object.values(state).flatMap((entries) =>
            entries.flatMap((entry) => {
              const parsed = publicProfileSchema.safeParse(entry);
              return parsed.success ? [parsed.data] : [];
            }),
          );
          onProfilesChange?.(players);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void channel?.track(payload);
        });
    })().catch(() => {
      if (!cancelled) players = [];
    });
    return () => {
      cancelled = true;
      if (channel && client) void client.removeChannel(channel);
      onProfilesChange?.([]);
    };
  });
</script>

{#if players.length}
  <div class="profiles" aria-label="Player profiles">
    {#each ['p1', 'p2'] as seat (seat)}
      {@const player = players.find((item) => item.participantId === seat)}
      {#if player}
        <details class="profile" class:gold={player.border === 'gold'}>
          <summary
            ><span aria-hidden="true"
              >{player.avatar === 'ball'
                ? '🏀'
                : player.avatar === 'crown'
                  ? '👑'
                  : player.name.slice(0, 2).toUpperCase()}</span
            ><strong
              class:blue={player.nameColor === 'blue'}
              class:orange={player.nameColor === 'orange'}>{player.name}</strong
            ><small>{seat === 'p1' ? 'Host' : 'Guest'} · {seat.toUpperCase()}</small></summary
          >
          <p>
            {player.title === 'defensive-wall'
              ? 'Defensive Wall'
              : player.title === 'floor-general'
                ? 'Floor General'
                : 'Player'}
          </p>
          <p>{player.wins} wins · {player.games} games · {player.bestStreak} best streak</p>
          {#if player.featuredAchievement}<p>
              Featured: {achievements[player.featuredAchievement].name}
            </p>{/if}
        </details>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .profiles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .profile {
    border: 1px solid var(--color-border);
    border-radius: 0.75rem;
    padding: 0.65rem 0.9rem;
    background: var(--color-surface-2);
  }
  .profile.gold {
    border-color: #e5b44d;
  }
  summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  small {
    color: var(--color-muted-foreground);
  }
  p {
    margin-top: 0.5rem;
    font-size: 0.8rem;
  }
  .blue {
    color: #60a5fa;
  }
  .orange {
    color: #fb923c;
  }
</style>
