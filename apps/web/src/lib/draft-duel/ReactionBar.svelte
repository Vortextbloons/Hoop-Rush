<script lang="ts">
  import { Volume2, VolumeX } from '@lucide/svelte';

  type DraftDuelReaction = 'hype' | 'clap' | 'cold' | 'wow';

  const REACTIONS: ReadonlyArray<{ id: DraftDuelReaction; label: string; glyph: string }> = [
    { id: 'hype', label: 'Hype', glyph: '🔥' },
    { id: 'clap', label: 'Clap', glyph: '👏' },
    { id: 'cold', label: 'Cold', glyph: '🥶' },
    { id: 'wow', label: 'Wow', glyph: '😮' },
  ];

  let {
    disabled = false,
    muted = false,
    onreact,
    onmute,
  }: {
    disabled?: boolean;
    muted?: boolean;
    onreact?: (reaction: DraftDuelReaction) => void;
    onmute?: (muted: boolean) => void;
  } = $props();

  let localMuted = $derived(muted);

  function react(reaction: DraftDuelReaction): void {
    if (disabled) return;
    onreact?.(reaction);
  }

  function toggleMute(): void {
    localMuted = !localMuted;
    onmute?.(localMuted);
  }
</script>

<div class="dd-reactions" role="group" aria-label="Reactions">
  {#each REACTIONS as reaction (reaction.id)}
    <button
      type="button"
      class="dd-react"
      {disabled}
      onclick={() => react(reaction.id)}
      aria-label={`React ${reaction.label}`}
    >
      <span class="dd-react-glyph" aria-hidden="true">{reaction.glyph}</span>
      <span class="dd-react-label">{reaction.label}</span>
    </button>
  {/each}
  <button
    type="button"
    class="dd-react dd-react-mute"
    aria-pressed={localMuted}
    onclick={toggleMute}
    title={localMuted ? 'Unmute reactions' : 'Mute reactions'}
  >
    {#if localMuted}
      <VolumeX size={15} aria-hidden="true" />
    {:else}
      <Volume2 size={15} aria-hidden="true" />
    {/if}
    <span class="dd-react-label">{localMuted ? 'Muted' : 'Mute'}</span>
  </button>
</div>

<style>
  .dd-reactions {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 0.4rem;
  }

  .dd-react {
    display: inline-flex;
    min-height: 2.75rem;
    min-width: 2.75rem;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-foreground);
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      transform 120ms ease;
  }

  .dd-react:hover:not(:disabled) {
    border-color: var(--color-line-strong);
    background: var(--color-surface-3);
    transform: translateY(-1px);
  }

  .dd-react:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-ring);
  }

  .dd-react:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .dd-react-glyph {
    font-size: 1rem;
    line-height: 1;
  }

  .dd-react-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .dd-react-mute[aria-pressed='true'] {
    border-color: color-mix(in srgb, var(--color-destructive) 45%, transparent);
    color: var(--color-muted-foreground);
  }

  @media (prefers-reduced-motion: reduce) {
    .dd-react,
    .dd-react:hover:not(:disabled) {
      transition: none;
      transform: none;
    }
  }
</style>
