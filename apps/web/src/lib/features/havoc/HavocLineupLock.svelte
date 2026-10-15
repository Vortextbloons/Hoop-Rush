<script lang="ts">
  import type { HavocLineupSlotView } from '@hoop-rush/application/havoc';
  import HavocPlayerArt from './HavocPlayerArt.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import HavocMutationList from './HavocMutationList.svelte';
  let {
    slots,
    title = 'Your starting five',
    compact = false,
  }: { slots: readonly HavocLineupSlotView[]; title?: string; compact?: boolean } = $props();
</script>

<section class={['h-panel', 'lineup-panel', { compact }]} aria-label={title} data-havoc-lineup>
  <header class="lineup-heading">
    <h2 class="h-subtitle">{title}</h2>
    <span class="lineup-count">{slots.length}/5</span>
  </header>
  <ul class="lineup-list">
    {#each slots as slot (slot.slot)}
      <li class="lineup-card">
        <div class="lineup-portrait">
          <HavocPlayerArt
            compact
            playerId={slot.playerId}
            franchiseId={slot.franchiseId}
            seasonKey={slot.seasonKey}
            playerVersionId={slot.playerVersionId}
            displayName={slot.displayName}
          />
        </div>
        <div class="lineup-identity">
          <div class="lineup-meta">
            <span class="lineup-position">{slot.slot}</span>
            <HavocTierBadge tier={slot.tier} size="sm" />
          </div>
          <h3 class="lineup-name">{slot.displayName}</h3>
          <p class="lineup-nickname">{slot.nickname}</p>
        </div>
        <details class="lineup-abilities">
          <summary>Abilities <span>{slot.mutations.length}</span></summary>
          <div class="lineup-powers" data-havoc-lineup-package>
            <HavocMutationList mutations={slot.mutations} readable />
          </div>
        </details>
      </li>
    {/each}
  </ul>
  <details class="lineup-rules">
    <summary>What happens if a player fouls out?</summary>
    <p class="h-copy text-xs">
      At six personal fouls, an unmutated copy of the same player-season takes over. The replacement
      has no powers and stays in the game through further fouls.
    </p>
  </details>
</section>

<style>
  .lineup-panel {
    min-width: 0;
  }
  .lineup-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .lineup-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #aab9db;
  }
  .lineup-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
    align-items: start;
    gap: 10px;
    margin: 16px 0;
    padding: 0;
    list-style: none;
  }
  .compact .lineup-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .lineup-card {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: center;
    gap: 10px 12px;
    min-width: 0;
    padding: 14px;
    border: 1px solid #3e4a6c;
    border-radius: 12px;
    background: #141b39;
  }
  .lineup-portrait {
    width: 56px;
    height: 64px;
    overflow: hidden;
    border-radius: 8px;
    background: #20294c;
  }
  .lineup-portrait :global(.h-player-art) {
    width: 100%;
    height: 100%;
  }
  .lineup-identity {
    min-width: 0;
  }
  .lineup-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 6px;
  }
  .lineup-position {
    color: #679dff;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
  }
  .lineup-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  .lineup-nickname {
    margin-top: 5px;
    color: #aab9db;
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .lineup-abilities {
    grid-column: 1 / -1;
    padding-top: 10px;
    border-top: 1px solid #3e4a6c;
    font-size: 12px;
  }
  .lineup-abilities summary {
    color: #c1cae4;
    cursor: pointer;
  }
  .lineup-abilities summary span {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 5px;
    background: #303c63;
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .lineup-powers {
    margin-top: 12px;
  }
  .lineup-rules {
    font-size: 12px;
  }
  .lineup-rules summary {
    cursor: pointer;
    color: #c1cae4;
  }
  .lineup-rules p {
    margin-top: 8px;
  }
  summary:focus-visible {
    outline: 2px solid #ffd782;
    outline-offset: 4px;
    border-radius: 3px;
  }
</style>
