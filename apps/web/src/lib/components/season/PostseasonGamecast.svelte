<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { HoopRushManifest, SeasonPostseasonSummary } from '@hoop-rush/data-contracts';
  import LiveSimModal from './LiveSimModal.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import { franchiseColor } from '$lib/season/franchise-colors';

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
</script>

<LiveSimModal {open} onOpenChange={() => undefined}>
  <div class="gamecast" style:--home-color={franchiseColor(homeFranchiseId)} style:--away-color={franchiseColor(awayFranchiseId)}>
    <header class="gamecast-header">
      <div>
        <p class="gamecast-kicker">Hoop Rush SimCast</p>
        <Dialog.Title class="font-display text-xl font-extrabold uppercase tracking-tight">{gameLabel}</Dialog.Title>
      </div>
      <span class="gamecast-status" data-final={result !== null}>
        {result === null ? 'Simulating' : 'Final'}
      </span>
    </header>

    <div class="scoreboard" aria-live="polite">
      {#each [awayFranchiseId, homeFranchiseId] as franchiseId (franchiseId)}
        {@const identity = identityOf(franchiseId)}
        <div class="team" data-winner={result?.winnerFranchiseId === franchiseId}>
          {#if manifest !== null && identity !== null}
            <SeasonTeamLogo {manifest} {franchiseId} teamExternalId={identity.teamExternalId} size="lg" eager />
          {/if}
          <span class="font-display text-2xl font-black">{franchiseAbbrev(franchiseId)}</span>
          <span class="truncate text-xs text-muted-foreground">{franchiseName(franchiseId)}</span>
          <strong class="score">{result === null ? '—' : result.homeFranchiseId === franchiseId ? result.homeScore : result.awayScore}</strong>
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
      <button type="button" class="continue-button" onclick={onContinue}>Continue bracket</button>
    {/if}
  </div>
</LiveSimModal>

<style>
  .gamecast { padding: 1.25rem; background: radial-gradient(circle at 50% -20%, color-mix(in srgb, var(--home-color) 26%, transparent), transparent 48%), var(--color-surface-1); }
  .gamecast-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
  .gamecast-kicker { color:var(--color-primary); font-family:var(--font-mono); font-size:.625rem; font-weight:800; letter-spacing:.18em; text-transform:uppercase; }
  .gamecast-status { border:1px solid color-mix(in srgb, var(--away-color) 65%, transparent); border-radius:999px; padding:.35rem .65rem; font-family:var(--font-mono); font-size:.625rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
  .gamecast-status:not([data-final='true']) { animation:pulse 1.2s ease-in-out infinite; }
  .scoreboard { display:grid; grid-template-columns:1fr 1fr; gap:1px; margin-top:1.25rem; overflow:hidden; border:1px solid var(--color-border); border-radius:1rem; background:var(--color-border); }
  .team { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:.65rem; min-width:0; padding:1rem; background:color-mix(in srgb, var(--color-surface-2) 92%, transparent); }
  .team:first-child { border-top:3px solid var(--away-color); }
  .team:last-child { border-top:3px solid var(--home-color); }
  .team[data-winner='true'] { background:color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2)); }
  .team > span:nth-of-type(2) { grid-column:1 / 3; }
  .score { grid-column:3; grid-row:1 / 3; font-family:var(--font-display); font-size:2.5rem; font-weight:900; font-variant-numeric:tabular-nums; }
  .court-track { height:.3rem; margin-top:1.25rem; overflow:hidden; border-radius:999px; background:var(--color-surface-3); }
  .court-track span { display:block; width:38%; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--away-color),var(--home-color)); animation:drive 1.35s ease-in-out infinite alternate; }
  .gamecast-note { margin-top:1rem; text-align:center; font-size:.8rem; color:var(--color-muted-foreground); }
  .continue-button { display:flex; min-height:44px; width:100%; align-items:center; justify-content:center; margin-top:1rem; border-radius:.65rem; background:var(--color-primary); padding:.7rem 1rem; font-weight:700; color:var(--color-primary-foreground); outline:none; }
  .continue-button:focus-visible { box-shadow:0 0 0 2px var(--color-ring); }
  @keyframes drive { from { transform:translateX(0); } to { transform:translateX(164%); } }
  @keyframes pulse { 50% { opacity:.48; } }
  @media (prefers-reduced-motion:reduce) { .court-track span,.gamecast-status { animation:none; } }
  @media (max-width:520px) { .scoreboard { grid-template-columns:1fr; } .team:last-child { border-top-color:var(--home-color); } }
</style>
