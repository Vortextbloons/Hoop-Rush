<script lang="ts">
  import { resolve } from '$app/paths';
  import type { ComponentProps } from 'svelte';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  let {
    playerName,
    summaryLine,
    blurb = 'Target one canonical player. Every eligible version shares the same within-rarity boost, and rarity odds never change.',
    busy = false,
    player = null,
    manifest = null,
    onChange,
    onClear,
  }: {
    playerName: string;
    summaryLine: string;
    blurb?: string;
    busy?: boolean;
    player?: ComponentProps<typeof PlayerFace>['player'] | null;
    manifest?: HoopRushManifest | null;
    onChange?: () => void;
    onClear: () => void;
  } = $props();

  const initials = $derived(
    playerName
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase(),
  );
</script>

<section aria-label="Active target player" aria-busy={busy} class="ur-active-target">
  {#if player && manifest}
    <div class="ur-target-photo" aria-hidden="true">
      <PlayerFace {player} {manifest} size="md" eager fallbackInitials={initials} />
    </div>
  {:else}
    <div class="ur-target-avatar" aria-hidden="true">{initials}</div>
  {/if}
  <div class="ur-target-copy">
    <p class="ultimate-eyebrow">Active target</p>
    <p class="ur-target-name">{playerName}</p>
    <p class="ur-target-summary">{summaryLine}</p>
    <p class="ur-target-blurb">{blurb}</p>
  </div>
  <div class="ur-target-actions">
    {#if onChange}
      <button type="button" onclick={onChange} disabled={busy}>
        <span aria-hidden="true">◉</span> Change target
      </button>
    {:else}
      <a href={resolve('/ultimate/run/collection' as any)}>
        <span aria-hidden="true">◉</span> Change target
      </a>
    {/if}
    <button type="button" onclick={onClear} disabled={busy}>
      <span aria-hidden="true">✕</span> Clear target
    </button>
  </div>
</section>

<style>
  .ur-active-target {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;
    padding: 0.85rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--ur-eclipse) 60%, var(--ur-line-strong));
    border-radius: 0.9rem;
    background:
      radial-gradient(24rem 10rem at 12% 0%, rgb(139 92 246 / 26%), transparent 60%),
      linear-gradient(180deg, #171226 0%, #0d0a16 100%);
    box-shadow:
      0 0.8rem 2rem rgb(0 0 0 / 45%),
      0 0 2rem rgb(139 92 246 / 18%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-target-avatar {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    border: 1px solid rgb(196 132 255 / 70%);
    border-radius: 0.8rem;
    background:
      radial-gradient(circle at 30% 25%, #8b5cf6, #3b2068 70%),
      #1c1332;
    color: #efe6ff;
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    text-shadow: 0 0 0.8rem rgb(139 92 246 / 80%);
  }

  .ur-target-photo {
    flex: none;
  }

  .ur-target-photo :global(.relative) {
    width: 3.5rem;
    height: 3.5rem;
    border: 1px solid rgb(196 132 255 / 70%);
    border-radius: 0.8rem;
    box-shadow: 0 0 1rem rgb(139 92 246 / 45%);
  }

  .ur-target-copy {
    min-width: min(100%, 16rem);
    flex: 1 1 16rem;
  }

  .ur-target-copy .ultimate-eyebrow {
    color: #c4a4ff;
  }

  .ur-target-name {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 800;
    line-height: 1.15;
  }

  .ur-target-summary,
  .ur-target-blurb {
    color: var(--ur-muted);
    font-size: 0.72rem;
    line-height: 1.45;
  }

  .ur-target-blurb {
    margin-top: 0.15rem;
    color: color-mix(in srgb, var(--ur-muted) 85%, transparent);
  }

  .ur-target-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }

  .ur-target-actions button,
  .ur-target-actions a {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-paper) 28%, transparent);
    border-radius: 0.6rem;
    background: rgb(10 8 18 / 70%);
    color: var(--ur-paper);
    font-size: 0.8rem;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }

  .ur-target-actions button:hover:not(:disabled),
  .ur-target-actions a:hover {
    border-color: #c4a4ff;
    background: rgb(40 26 76 / 80%);
  }

  .ur-target-actions button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .ur-target-actions {
      width: 100%;
      margin-left: 0;
    }

    .ur-target-actions button,
    .ur-target-actions a {
      flex: 1 1 10rem;
      justify-content: center;
    }
  }
</style>
