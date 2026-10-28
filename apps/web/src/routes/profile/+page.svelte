<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlayerProfile } from '@hoop-rush/data-contracts';
  import { randomUUID } from '#lib/ids.js';
  import {
    achievements,
    profileRepository,
    selectedProfile,
  } from '#lib/features/profile/profile.js';

  let profile = $state<PlayerProfile | null>(null);
  let profiles = $state<PlayerProfile[]>([]);
  let name = $state('');
  let avatar = $state<PlayerProfile['avatar']>('initials');
  let border = $state<PlayerProfile['border']>('classic');
  let nameColor = $state<PlayerProfile['nameColor']>('white');
  let title = $state<PlayerProfile['title']>('none');
  let featured = $state<PlayerProfile['featuredAchievement']>(null);
  let newName = $state('');
  let error = $state('');
  let busy = $state(false);

  function show(value: PlayerProfile) {
    profile = value;
    name = value.name;
    avatar = value.avatar;
    border = value.border;
    nameColor = value.nameColor;
    title = value.title;
    featured = value.featuredAchievement;
  }
  async function refresh(value: PlayerProfile) {
    show(value);
    profiles = await profileRepository().list();
  }
  async function action(run: () => Promise<PlayerProfile>) {
    busy = true;
    error = '';
    try {
      await refresh(await run());
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save profile.';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    void action(selectedProfile);
  });
</script>

<svelte:head><title>Profile | Hoop Rush</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10 pb-28 sm:px-6">
  <p class="text-sm font-bold uppercase tracking-widest text-primary">Your basketball career</p>
  <h1 class="mt-2 font-display text-4xl font-extrabold">Player profiles</h1>
  <p class="mt-2 text-muted-foreground">Keep your identity and achievements on this device.</p>
  {#if error}<p role="alert" class="mt-4 text-red-400">{error}</p>{/if}
  {#if profile}
    <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section class="rounded-3xl border border-border bg-card p-6">
        <label class="text-sm font-semibold" for="profile-select">Active profile</label>
        <select
          id="profile-select"
          class="mt-2 w-full rounded-lg border border-border bg-background p-3"
          value={profile.id}
          disabled={busy}
          onchange={(event) =>
            void action(() =>
              profileRepository().dispatch({ kind: 'select', id: event.currentTarget.value }),
            )}
        >
          {#each profiles as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
        </select>
        <div
          class="mt-6 rounded-2xl border-2 p-6"
          class:border-yellow-400={profile.border === 'gold'}
          class:border-border={profile.border === 'classic'}
        >
          <div class="flex items-center gap-4">
            <div
              class="grid h-16 w-16 place-items-center rounded-full bg-primary text-2xl font-black text-primary-foreground"
            >
              {profile.avatar === 'ball'
                ? '🏀'
                : profile.avatar === 'crown'
                  ? '👑'
                  : profile.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2
                class="font-display text-2xl font-bold"
                class:text-blue-400={profile.nameColor === 'blue'}
                class:text-orange-400={profile.nameColor === 'orange'}
              >
                {profile.name}
              </h2>
              <p class="text-muted-foreground">
                {profile.title === 'defensive-wall'
                  ? 'Defensive Wall'
                  : profile.title === 'floor-general'
                    ? 'Floor General'
                    : 'Player'}
              </p>
            </div>
          </div>
          <div class="mt-6 grid grid-cols-3 gap-3 text-center">
            <div>
              <strong class="text-2xl">{profile.wins}</strong>
              <p class="text-sm text-muted-foreground">Wins</p>
            </div>
            <div>
              <strong class="text-2xl">{profile.games}</strong>
              <p class="text-sm text-muted-foreground">Games</p>
            </div>
            <div>
              <strong class="text-2xl">{profile.bestStreak}</strong>
              <p class="text-sm text-muted-foreground">Best streak</p>
            </div>
          </div>
          {#if profile.featuredAchievement}<p class="mt-6 text-sm">
              Featured: <strong>{achievements[profile.featuredAchievement].name}</strong>
            </p>{/if}
        </div>
        <form
          class="mt-6 flex gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            void action(() =>
              profileRepository().dispatch({ kind: 'create', id: randomUUID(), name: newName }),
            ).then(() => {
              newName = '';
            });
          }}
        >
          <input
            class="min-w-0 flex-1 rounded-lg border border-border bg-background p-3"
            aria-label="New profile name"
            placeholder="New profile name"
            minlength="3"
            maxlength="16"
            bind:value={newName}
            required
          />
          <button
            class="rounded-lg bg-primary px-4 font-bold text-primary-foreground"
            disabled={busy}>Create</button
          >
        </form>
      </section>
      <section class="rounded-3xl border border-border bg-card p-6">
        <h2 class="font-display text-2xl font-bold">Customize</h2>
        <form
          class="mt-5 grid gap-4 sm:grid-cols-2"
          onsubmit={(event) => {
            event.preventDefault();
            if (profile)
              void action(() =>
                profileRepository().dispatch({
                  kind: 'customize',
                  id: profile!.id,
                  name,
                  avatar,
                  border,
                  nameColor,
                  title,
                  featuredAchievement: featured,
                }),
              );
          }}
        >
          <label class="grid gap-1 text-sm font-semibold"
            >Display name<input
              class="rounded-lg border border-border bg-background p-3"
              minlength="3"
              maxlength="16"
              bind:value={name}
              required
            /></label
          >
          <label class="grid gap-1 text-sm font-semibold"
            >Avatar<select
              class="rounded-lg border border-border bg-background p-3"
              bind:value={avatar}
              ><option value="initials">Initials</option><option value="ball">Basketball</option
              ><option value="crown" disabled={!profile.achievements.includes('built-different')}
                >Crown</option
              ></select
            ></label
          >
          <label class="grid gap-1 text-sm font-semibold"
            >Border<select
              class="rounded-lg border border-border bg-background p-3"
              bind:value={border}
              ><option value="classic">Classic</option><option
                value="gold"
                disabled={!profile.achievements.includes('built-different')}>Gold</option
              ></select
            ></label
          >
          <label class="grid gap-1 text-sm font-semibold"
            >Name color<select
              class="rounded-lg border border-border bg-background p-3"
              bind:value={nameColor}
              ><option value="white">White</option><option value="orange">Orange</option><option
                value="blue"
                disabled={!profile.achievements.includes('hands-off')}>Blue</option
              ></select
            ></label
          >
          <label class="grid gap-1 text-sm font-semibold"
            >Title<select
              class="rounded-lg border border-border bg-background p-3"
              bind:value={title}
              ><option value="none">None</option><option
                value="defensive-wall"
                disabled={!profile.achievements.includes('no-easy-buckets')}>Defensive Wall</option
              ><option
                value="floor-general"
                disabled={!profile.achievements.includes('silent-carry')}>Floor General</option
              ></select
            ></label
          >
          <label class="grid gap-1 text-sm font-semibold"
            >Featured achievement<select
              class="rounded-lg border border-border bg-background p-3"
              bind:value={featured}
              ><option value={null}>None</option>{#each profile.achievements as id (id)}<option
                  value={id}>{achievements[id].name}</option
                >{/each}</select
            ></label
          >
          <button
            class="rounded-lg bg-primary px-4 py-3 font-bold text-primary-foreground sm:col-span-2"
            disabled={busy}>Save changes</button
          >
        </form>
      </section>
    </div>
    <section class="mt-10">
      <div class="flex items-end justify-between gap-4">
        <div>
          <h2 class="font-display text-3xl font-bold">My achievements</h2>
          <p class="mt-1 text-muted-foreground">Collect badges and earn profile rewards.</p>
        </div>
        <strong>{profile.achievements.length}/{Object.keys(achievements).length}</strong>
      </div>
      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each Object.entries(achievements) as [id, achievement] (id)}<article
            class="rounded-2xl border border-border bg-card p-5"
          >
            <p class="text-xs font-bold uppercase tracking-wider text-primary">
              {profile.achievements.includes(id as any) ? 'Unlocked' : 'Locked'}
            </p>
            <h3 class="mt-2 text-lg font-bold">{achievement.name}</h3>
            <p class="mt-1 text-sm text-muted-foreground">{achievement.description}</p>
            <p class="mt-3 text-sm">{achievement.reward}</p>
            {#if id === 'built-different' && !profile.achievements.includes('built-different')}<p
                class="mt-2 text-sm font-bold"
              >
                {profile.multiplayerStreak}/5 wins
              </p>{/if}
          </article>{/each}
      </div>
    </section>
  {/if}
</div>
