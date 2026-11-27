<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    achievementTitleFor,
    collectionAchievementIdSchema,
    legacyAchievementIdSchema,
    profileTitles,
    type PlayerProfile,
  } from '@hoop-rush/data-contracts';
  import { Trophy } from '@lucide/svelte';
  import { achievementCatalog } from '#lib/features/profile/achievement-catalog.js';
  import {
    achievements,
    profileRepository,
    selectedProfile,
  } from '#lib/features/profile/profile.js';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';

  let profile = $state<PlayerProfile | null>(null);
  let name = $state('');
  let avatar = $state<PlayerProfile['avatar']>('initials');
  let border = $state<PlayerProfile['border']>('classic');
  let nameColor = $state<PlayerProfile['nameColor']>('white');
  let title = $state<PlayerProfile['title']>('none');
  let featured = $state<PlayerProfile['featuredAchievement']>(null);
  let error = $state('');
  let busy = $state(false);
  const achievementGroups = [
    { category: 'classic', name: 'Classic' },
    { category: 'player', name: 'Player and Sandbox' },
    { category: 'cap-rush', name: 'Cap Rush' },
    { category: 'havoc', name: 'Hoop Havoc' },
    { category: 'multiplayer', name: 'Multiplayer' },
  ].map(({ category, name }) => ({
    name,
    ids: collectionAchievementIdSchema.options.filter(
      (id) => achievementCatalog[id].category === category,
    ),
  }));
  const titleOptions = Object.keys(profileTitles)
    .map((key) => key as PlayerProfile['title'])
    .map((value) => ({ value, ...profileTitles[value] }))
    .toSorted((left, right) => Number(right.value === 'none') - Number(left.value === 'none'));
  let earned = $derived(new Set(profile?.achievements));
  let evidence = $derived(
    new Map(profile?.achievementMoments?.map((moment) => [moment.id, moment.evidence])),
  );

  function show(value: PlayerProfile) {
    profile = value;
    name = value.name;
    avatar = value.avatar;
    border = value.border;
    nameColor = value.nameColor;
    title = value.title;
    featured = value.featuredAchievement;
  }
  async function action(run: () => Promise<PlayerProfile>) {
    busy = true;
    error = '';
    try {
      show(await run());
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
  <h1 class="mt-2 font-display text-4xl font-extrabold">Player profile</h1>
  <p class="mt-2 text-muted-foreground">Keep your identity and achievements on this device.</p>
  <div class="mt-4 flex flex-wrap gap-2">
    <ActionLink href={resolve('/full-court/history')} tone="secondary" size="sm">
      Full Court history
    </ActionLink>
  </div>
  {#if error}<Alert class="mt-4" tone="danger">{error}</Alert>{/if}
  {#if profile}
    <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section class="rounded-3xl border border-border bg-card p-6">
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
                {profile.title === 'none' ? 'Player' : profileTitles[profile.title].name}
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
          {#if profile.featuredAchievement}
            {@const badge = achievements[profile.featuredAchievement]}
            {@const Icon = badge.icon ?? Trophy}
            <p class="mt-6 flex items-center gap-2 text-sm">
              <Icon class="size-4 text-primary" aria-hidden="true" />
              <span>Featured badge <strong>{badge.name}</strong></span>
            </p>
          {/if}
        </div>
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
              >{#each titleOptions as option (option.value)}
                <option
                  value={option.value}
                  disabled={option.achievementId !== null &&
                    !profile.achievements.includes(option.achievementId)}
                >
                  {option.name}
                </option>
              {/each}</select
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
        </div>
        <strong>
          {collectionAchievementIdSchema.options.filter((id) => earned.has(id))
            .length}/{collectionAchievementIdSchema.options.length}
        </strong>
      </div>
      {#each achievementGroups as { name: groupName, ids } (groupName)}
        <h3
          class="mt-8 mb-3 flex items-baseline justify-between gap-2 font-display text-xl font-bold"
        >
          {groupName}
          <span class="text-sm font-normal tabular-nums text-muted-foreground">
            {ids.filter((id) => earned.has(id)).length}/{ids.length}
          </span>
        </h3>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each ids as id (id)}
            {@const badge = achievementCatalog[id]}
            {@const Icon = badge.icon}
            {@const rewardTitle = achievementTitleFor(id)}
            <Panel as="li" padding="none" class="flex gap-3 p-4">
              <div
                class={[
                  'flex size-10 shrink-0 items-center justify-center rounded-lg border',
                  earned.has(id)
                    ? 'border-primary/35 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                ]}
              >
                <Icon class="size-5" aria-hidden="true" />
              </div>
              <div>
                <p class="text-xs capitalize text-muted-foreground">
                  {#if 'rarity' in badge}{badge.rarity} ·
                  {/if}{earned.has(id) ? 'Unlocked' : 'Locked'}
                </p>
                <h4 class="font-display text-base font-bold">{badge.name}</h4>
                <p class="mt-1 text-sm text-muted-foreground">{badge.description}</p>
                {#if rewardTitle}
                  <p class="mt-2 flex items-center gap-1.5 text-sm">
                    <Trophy class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      {earned.has(id) ? 'Title unlocked' : 'Title reward'}:
                      <strong>{profileTitles[rewardTitle].name}</strong>
                    </span>
                  </p>
                {/if}
                {#if evidence.has(id)}
                  <p class="mt-2 text-sm text-primary">{evidence.get(id)}</p>
                {/if}
              </div>
            </Panel>
          {/each}
        </ul>
      {/each}
      {#if legacyAchievementIdSchema.options.some((id) => earned.has(id))}
        <details class="ui-panel mt-8 p-4" data-padding="none">
          <summary class="cursor-pointer font-semibold">Earlier badges</summary>
          <ul class="mt-3 flex flex-wrap gap-3">
            {#each legacyAchievementIdSchema.options.filter((id) => earned.has(id)) as id (id)}
              <li class="flex items-center gap-2 text-sm">
                <Trophy class="size-4 text-primary" aria-hidden="true" />
                {achievements[id].name}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </section>
  {/if}
</div>
