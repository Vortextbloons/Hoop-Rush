<script lang="ts">
  import { resolve } from '$app/paths';
  import type { FullCourtStandingsRow } from '@hoop-rush/engine';
  import type { FranchiseIdentity } from '#lib/branding.js';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import type { BadgeTone } from '#lib/components/ui/types.js';
  import { formatAverage } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtHistoryEntryView } from './full-court-history-presentation.ts';

  let {
    entry,
    userRow,
    art = null,
    identity = null,
    busy = false,
    onStartNewGame,
  }: {
    entry: FullCourtHistoryEntryView;
    userRow: FullCourtStandingsRow | null;
    art?: FullCourtArt | null;
    identity?: FranchiseIdentity | null;
    busy?: boolean;
    onStartNewGame: () => void;
  } = $props();

  const champion = $derived(entry.playoffStatus === 'champion');
  const games = $derived(userRow === null ? 0 : userRow.wins + userRow.losses);

  function capTone(status: FullCourtHistoryEntryView['capStatus']): BadgeTone {
    switch (status) {
      case 'under-cap':
        return 'positive';
      case 'first-apron':
        return 'accent';
      case 'second-apron':
        return 'primary';
      case 'illegal':
        return 'negative';
    }
  }
</script>

<ResultScreen
  eyebrow={`${entry.variantLabel} · Season complete`}
  title={champion ? 'Championship report' : 'Season report'}
>
  {#snippet badges()}
    <Badge tone={entry.playoffTone}>{entry.playoffLabel}</Badge>
    <Badge tone={capTone(entry.capStatus)}>{entry.capStatusLabel}</Badge>
    {#if userRow !== null}
      <Badge tone="neutral">
        #{userRow.seed}
        {userRow.conference === 'east' ? 'East' : 'West'}
      </Badge>
    {/if}
  {/snippet}

  {#snippet hero()}
    <ResultHero
      score={entry.regularRecordLabel}
      scoreLabel={`${entry.regularRecordLabel} regular-season record`}
      caption={entry.teamName}
      meta={champion
        ? 'Four rounds. The championship is yours.'
        : `${entry.pointDiffLabel} point differential · ${entry.playoffLabel}`}
      tone={champion ? 'champion' : 'default'}
    >
      {#snippet logo()}
        {#if art !== null && identity !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={identity.franchiseId}
            teamExternalId={identity.teamExternalId}
            alt=""
            className="h-full w-full"
            eager
          />
        {/if}
      {/snippet}
    </ResultHero>
    <StatGrid class="mt-4" columns={3} mobile={3} gap="md">
      {#if userRow !== null && games > 0}
        <StatTile label="Points / game" size="lg" value={formatAverage(userRow.pointsFor, games)} />
        <StatTile
          label="Allowed / game"
          size="lg"
          value={formatAverage(userRow.pointsAgainst, games)}
        />
        <StatTile
          label="Margin / game"
          size="lg"
          value={formatAverage(userRow.pointsFor - userRow.pointsAgainst, games)}
        />
      {:else}
        <StatTile label="Point differential" size="lg" value={entry.pointDiffLabel} />
        <StatTile label="Series won" size="lg" value={String(entry.seriesWon)} />
        <StatTile label="Playoff finish" size="lg" value={entry.playoffLabel} />
      {/if}
    </StatGrid>
  {/snippet}

  {#snippet actions()}
    <ActionLink href={resolve('/full-court/report/[runId]', { runId: entry.runId })}>
      Open final report
    </ActionLink>
    <Button tone="secondary" loading={busy} onclick={onStartNewGame}>Start new game</Button>
    <ActionLink href={resolve('/full-court/history')} tone="ghost" size="sm">
      Run history
    </ActionLink>
  {/snippet}
</ResultScreen>
