<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { HoopRushManifest, SeasonPostseasonSummary } from '@hoop-rush/data-contracts';
  import LiveSimModal from './LiveSimModal.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import { franchiseColor } from '$lib/season/franchise-colors';
  import { arenaBuzzer, arenaConfirm } from '$lib/arena-sound';

  let {
    open,
    homeFranchiseId,
    awayFranchiseId,
    gameLabel,
    result,
    manifest,
    franchiseName,
    franchiseAbbrev,
    onContinue,
  }: {
    open: boolean;
    homeFranchiseId: string;
    awayFranchiseId: string;
    gameLabel: string;
    result: SeasonPostseasonSummary | null;
    manifest: HoopRushManifest | null;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    onContinue: () => void;
  } = $props();

  const identityOf = (franchiseId: string) =>
    manifest === null ? null : franchiseIdentityOf(manifest, franchiseId);

  let gamecastSoundFor: string | null = $state(null);
  $effect(() => {
    if (result === null) return;
    const key = `${homeFranchiseId}:${awayFranchiseId}:${result.homeScore}:${result.awayScore}`;
    if (gamecastSoundFor === key) return;
    gamecastSoundFor = key;
    try {
      arenaBuzzer();
    } catch {}
  });

  function handleContinue() {
    try {
      arenaConfirm();
    } catch {}
    onContinue();
  }

  const glowStyle = $derived(
    `--sr-accent-a: ${franchiseColor(awayFranchiseId)}; --sr-accent-b: ${franchiseColor(homeFranchiseId)};`,
  );
</script>

<LiveSimModal {open} broadcast onOpenChange={() => undefined}>
  <div class="gamecast" style={glowStyle}>
    <header class="gamecast-header">
      <div>
        <p class="sr-eyebrow">Hoop Rush SimCast</p>
        <Dialog.Title class="font-display text-xl font-extrabold uppercase tracking-tight text-foreground"
          >{gameLabel}</Dialog.Title
        >
      </div>
      <span class="sr-badge" data-tone={result === null ? 'live' : 'win'} data-final={result !== null}>
        {#if result === null}
          <span
            class="sr-live-dot inline-block h-1.5 w-1.5 rounded-full bg-current"
            aria-hidden="true"></span>
        {/if}
        {result === null ? 'Simulating' : 'Final'}
      </span>
    </header>

    <div class="scoreboard" aria-live="polite">
      {#each [awayFranchiseId, homeFranchiseId] as franchiseId (franchiseId)}
        {@const identity = identityOf(franchiseId)}
        <div
          class="team"
          data-winner={result?.winnerFranchiseId === franchiseId}
          style:--team-color={franchiseColor(franchiseId)}
        >
          {#if manifest !== null && identity !== null}
            <SeasonTeamLogo
              {manifest}
              {franchiseId}
              teamExternalId={identity.teamExternalId}
              size="lg"
              eager
            />
          {/if}
          <span class="font-display text-2xl font-black">{franchiseAbbrev(franchiseId)}</span>
          <span class="truncate text-xs text-muted-foreground">{franchiseName(franchiseId)}</span>
          <strong class="score sr-scoreline"
            >{result === null
              ? '—'
              : result.homeFranchiseId === franchiseId
                ? result.homeScore
                : result.awayScore}</strong
          >
        </div>
      {/each}
    </div>

    <div class="court-track" aria-hidden="true"><span></span></div>

    {#if result === null}
      <p class="gamecast-note" role="status">Resolving the game possession by possession…</p>
    {:else}
      <p class="gamecast-note" role="status">
        {franchiseName(result.winnerFranchiseId)} wins {result.awayScore}–{result.homeScore}.
      </p>
      <button type="button" class="sr-btn continue-button" onclick={handleContinue}
        >Continue bracket</button
      >
    {/if}
  </div>
</LiveSimModal>

<style>
  .gamecast {
    position: relative;
    overflow: hidden;
    border-radius: inherit;
    padding: 1.25rem;
    background:
      radial-gradient(
        ellipse 55% 45% at 12% 0%,
        color-mix(in srgb, var(--sr-accent-a) 26%, transparent),
        transparent 72%
      ),
      radial-gradient(
        ellipse 55% 45% at 88% 0%,
        color-mix(in srgb, var(--sr-accent-b) 26%, transparent),
        transparent 72%
      ),
      #10151b;
  }
  .gamecast::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    background: linear-gradient(90deg, var(--sr-accent-a), #e2a85b 50%, var(--sr-accent-b));
  }
  .gamecast-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .scoreboard {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    margin-top: 1.25rem;
    overflow: hidden;
    border: 1px solid var(--sr-line);
    border-radius: 1rem;
    background: var(--sr-line);
  }
  .team {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
    padding: 1rem;
    background: #131920;
  }
  .team:first-child {
    border-top: 3px solid var(--team-color);
  }
  .team:last-child {
    border-top: 3px solid var(--team-color);
  }
  .team[data-winner='true'] {
    background: color-mix(in srgb, var(--team-color) 16%, #131920);
  }
  .team > span:nth-of-type(2) {
    grid-column: 1 / 3;
  }
  .score {
    grid-column: 3;
    grid-row: 1 / 3;
    font-size: 3.25rem;
    line-height: 1;
    color: var(--sr-paper);
  }
  .team[data-winner='false'] .score {
    color: var(--sr-muted);
  }
  .court-track {
    height: 0.3rem;
    margin-top: 1.25rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--sr-raised);
  }
  .court-track span {
    display: block;
    width: 38%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--sr-accent-a), var(--sr-accent-b));
    animation: drive 1.35s ease-in-out infinite alternate;
  }
  .gamecast-note {
    margin-top: 1rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--sr-muted);
  }
  .continue-button {
    width: 100%;
    margin-top: 1rem;
  }
  @keyframes drive {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(164%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .court-track span {
      animation: none;
    }
  }
  @media (max-width: 520px) {
    .scoreboard {
      grid-template-columns: 1fr;
    }
  }
</style>
