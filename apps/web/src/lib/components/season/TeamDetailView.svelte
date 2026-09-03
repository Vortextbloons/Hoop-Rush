<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { eraIdentityOf, franchiseIdentityOf } from '$lib/season/season-branding';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import { formatPositions } from '$lib/player-positions';
  import { oneDecimal } from '$lib/format';
  import type {
    SeasonTeamDetail,
    SeasonTeamPlayerRow,
    SeasonTeamPlayerStats,
  } from '$lib/season/season-team-detail-view';
  let {
    detail,
    manifest,
    shell,
    isHuman = false,
  }: {
    detail: SeasonTeamDetail;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    isHuman?: boolean;
  } = $props();
  const modernIdentity = $derived(franchiseIdentityOf(manifest, detail.franchiseId));
  const teamExternalId = $derived(modernIdentity?.teamExternalId ?? '');
  const statCells: ReadonlyArray<{
    key: keyof Omit<SeasonTeamPlayerStats, 'gamesPlayed'>;
    label: string;
  }> = [
    { key: 'minutesPerGame', label: 'MPG' },
    { key: 'pointsPerGame', label: 'PPG' },
    { key: 'reboundsPerGame', label: 'RPG' },
    { key: 'assistsPerGame', label: 'APG' },
    { key: 'stealsPerGame', label: 'SPG' },
    { key: 'blocksPerGame', label: 'BPG' },
    { key: 'turnoversPerGame', label: 'TOPG' },
  ];
  function faceOf(playerVersionId: string) {
    return shell.facesByVersion.get(playerVersionId) ?? null;
  }
  function eraLabelOf(playerVersionId: string, franchiseId: string, eraId: string) {
    return eraIdentityOf(manifest, franchiseId, eraId).displayLabel;
  }
  function statValue(
    row: SeasonTeamPlayerRow,
    key: keyof Omit<SeasonTeamPlayerStats, 'gamesPlayed'>,
  ): string {
    const stats = row.stats;
    if (stats === null) return '—';
    const value = stats[key];
    if (typeof value !== 'number') return '—';
    return oneDecimal(value);
  }
</script>

<section aria-labelledby="team-detail-heading" class="min-w-0" data-season-team-detail>
  <div class="flex items-center gap-3">
    <SeasonTeamLogo
      {manifest}
      franchiseId={detail.franchiseId}
      {teamExternalId}
      alt={`${shell.franchiseName(detail.franchiseId)} logo`}
      size="lg"
      eager
    />
    <div class="min-w-0">
      <h1
        id="team-detail-heading"
        class="font-display truncate text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
      >
        {shell.franchiseName(detail.franchiseId)}
        {#if isHuman}
          <span class="text-primary" aria-label="your team">*</span>
        {/if}
      </h1>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        {detail.conference === 'east' ? 'East' : 'West'} · {detail.wins}–{detail.losses} ·
        {detail.diff > 0 ? '+' : ''}{detail.diff} diff
      </p>
    </div>
  </div>

  {#if detail.projection !== null}
    <dl
      class="mt-4 grid grid-cols-3 gap-2"
      data-season-team-projection
      aria-label="Team ratings from the locked rotation's player ratings"
    >
      <div class="rounded-xl bg-surface-1 px-3 py-3 text-center">
        <dt
          class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >
          Overall
        </dt>
        <dd class="font-display mt-1 text-2xl leading-none font-extrabold tracking-tight">
          {detail.projection.overall}
        </dd>
      </div>
      <div class="rounded-xl bg-surface-1 px-3 py-3 text-center">
        <dt
          class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >
          Offense
        </dt>
        <dd class="font-display mt-1 text-2xl leading-none font-extrabold tracking-tight">
          {detail.projection.offense}
        </dd>
      </div>
      <div class="rounded-xl bg-surface-1 px-3 py-3 text-center">
        <dt
          class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >
          Defense
        </dt>
        <dd class="font-display mt-1 text-2xl leading-none font-extrabold tracking-tight">
          {detail.projection.defense}
        </dd>
      </div>
    </dl>
    <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">
      1–100 vs the league · star-heavy minute weighting
    </p>
  {/if}

  <div class="mt-6 rounded-xl bg-surface-1 p-4">
    <p class="text-label uppercase text-muted-foreground">Locked rotation</p>
    <div class="mt-3 grid gap-4 sm:grid-cols-2">
      <div>
        <p class="font-mono text-[10px] text-muted-foreground">Starters · PG-SG-SF-PF-C</p>
        <ol class="mt-1 space-y-1">
          {#each detail.starters as row (row.playerVersionId)}
            <li class="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span class="min-w-0 truncate">
                {row.displayName}
                {#if row.closing}
                  <span class="text-primary" aria-label="closing five">◈</span>
                {/if}
              </span>
              <span class="shrink-0 text-muted-foreground">{row.minutes} min</span>
            </li>
          {/each}
        </ol>
      </div>
      <div>
        <p class="font-mono text-[10px] text-muted-foreground">Bench order</p>
        <ol class="mt-1 space-y-1">
          {#each detail.bench as row (row.playerVersionId)}
            <li class="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span class="min-w-0 truncate">
                {row.displayName}
                {#if row.closing}
                  <span class="text-primary" aria-label="closing five">◈</span>
                {/if}
              </span>
              <span class="shrink-0 text-muted-foreground">{row.minutes} min</span>
            </li>
          {/each}
        </ol>
      </div>
    </div>
    <p class="mt-3 font-mono text-[9px] text-muted-foreground/70">
      Target minutes total {detail.minutesTotal} · ◈ marks the closing five
    </p>
  </div>

  <div class="mt-6">
    <p class="font-mono text-[10px] text-muted-foreground">
      Roster · ten player-season versions · role and minutes from the locked rotation
    </p>
    <ul class="mt-2 flex flex-col gap-0 sm:gap-2">
      {#each [...detail.starters, ...detail.bench] as row (row.playerVersionId)}
        {@const face = faceOf(row.playerVersionId)}
        {@const eraLabel = eraLabelOf(row.playerVersionId, row.franchiseId, row.eraId)}
        <li class="overflow-hidden bg-surface-1 p-3 sm:rounded-xl">
          <div class="flex min-w-0 items-start gap-3">
            {#if face !== null}
              <SeasonPlayerFace {face} {manifest} size="sm" />
            {:else}
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
                aria-hidden="true"
              >
                ?
              </span>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <p class="min-w-0 truncate text-sm font-semibold">{row.displayName}</p>
                {#if row.overallRating !== null}
                  <span
                    class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                  >
                    OVR {row.overallRating}
                  </span>
                {/if}
                {#if row.closing}
                  <span
                    class="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold text-primary"
                  >
                    Closing five
                  </span>
                {/if}
              </div>
              <p class="truncate font-mono text-[10px] text-muted-foreground">
                {row.seasonKey}
                {#if row.positions.length > 0}
                  · {formatPositions(row.positions)}
                {/if}
              </p>
              {#if eraLabel}
                <p
                  class="mt-1 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70"
                >
                  {eraLabel}
                </p>
              {/if}
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              <span class="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                {row.role} · {row.minutes} min
              </span>
              {#if row.stats !== null}
                <span class="whitespace-nowrap font-mono text-[10px] font-bold">
                  {oneDecimal(row.stats.pointsPerGame)} ppg
                </span>
              {/if}
            </div>
          </div>
          {#if detail.hasStats}
            <dl class="mt-2 grid grid-cols-4 gap-x-4 gap-y-1 sm:grid-cols-7">
              {#each statCells as cell (cell.key)}
                <div class="flex items-center justify-between gap-2">
                  <dt class="font-mono text-[10px] text-muted-foreground">{cell.label}</dt>
                  <dd class="font-mono text-[10px] font-bold">{statValue(row, cell.key)}</dd>
                </div>
              {/each}
            </dl>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="mt-2 font-mono text-[10px] text-muted-foreground">
      {detail.hasStats
        ? 'Player rates folded from accepted game summaries.'
        : 'Accept a block to fold per-player season stats.'}
    </p>
  </div>
</section>
