<script lang="ts">
  import type {
    DraftDuelCard,
    DraftDuelGameOutput,
    DraftDuelParticipantId,
    DraftDuelTapeStatLine,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { DRAFT_DUEL_TAPE_STAT_FIELDS } from '@hoop-rush/data-contracts';
  import type {
    DraftDuelPlaybackSpeed,
    DraftDuelVisibleState,
  } from '$lib/features/draft-duel/draft-duel-playback';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import { SLOT_LABELS } from '$lib/player-positions';
  import { draftDuelPeriodLabel, type DraftDuelFeedLine } from './draft-duel-broadcast-view';

  let {
    output,
    visible,
    progress,
    localParticipantId,
    feed,
    cards = {},
    manifest = null,
    speed,
    onspeedchange,
  }: {
    output: DraftDuelGameOutput;
    visible: DraftDuelVisibleState;
    progress: number;
    localParticipantId: DraftDuelParticipantId;
    feed: DraftDuelFeedLine[];
    cards?: Record<string, DraftDuelCard>;
    manifest?: HoopRushManifest | null;
    speed: DraftDuelPlaybackSpeed;
    onspeedchange: (speed: DraftDuelPlaybackSpeed) => void;
  } = $props();

  const speeds: DraftDuelPlaybackSpeed[] = [1, 2];

  const POINTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('points');
  const FIELD_GOAL_MAKES = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('fieldGoalMakes');
  const FIELD_GOAL_ATTEMPTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('fieldGoalAttempts');
  const THREE_MAKES = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('threeMakes');
  const THREE_ATTEMPTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('threeAttempts');
  const OFFENSIVE_REBOUNDS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('offensiveRebounds');
  const DEFENSIVE_REBOUNDS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('defensiveRebounds');
  const ASSISTS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('assists');
  const TURNOVERS = DRAFT_DUEL_TAPE_STAT_FIELDS.indexOf('turnovers');

  interface PlayerRow {
    key: string;
    name: string;
    position: string;
    playerId: string | null;
    card: DraftDuelCard | null;
    points: number;
    rebounds: number;
    assists: number;
    turnovers: number;
    fieldGoals: string;
    threes: string;
    hot: boolean;
  }

  interface SideView {
    key: 'home' | 'away';
    label: string;
    score: number;
    rows: PlayerRow[];
  }

  function formatClock(clockSeconds: number): string {
    const total = Math.max(0, Math.floor(clockSeconds));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }

  function cardOf(playerId: string | undefined): DraftDuelCard | null {
    return playerId ? (cards[playerId] ?? null) : null;
  }

  function nameOf(playerId: string | undefined, slot: number): string {
    const card = cardOf(playerId);
    if (card) return card.displayName;
    if (playerId) return playerId.replace(/^p-/, '#').slice(0, 7);
    return `Slot ${String(slot + 1)}`;
  }

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  const playerIds = $derived(Object.keys(cards));

  function displaySummary(summary: string): string {
    let text = summary;
    for (const playerId of playerIds) {
      const card = cards[playerId];
      if (card && text.includes(playerId)) text = text.split(playerId).join(card.displayName);
    }
    return text;
  }

  function playerRowsOf(
    lines: readonly DraftDuelTapeStatLine[],
    ids: readonly string[],
  ): PlayerRow[] {
    const rows = lines.map((line, slot) => {
      const playerId = ids[slot] ?? null;
      const card = cardOf(playerId ?? undefined);
      return {
        key: playerId ?? `slot-${String(slot + 1)}`,
        name: nameOf(playerId ?? undefined, slot),
        position: SLOT_LABELS[slot] ?? '',
        playerId,
        card,
        points: line[POINTS] ?? 0,
        rebounds: (line[OFFENSIVE_REBOUNDS] ?? 0) + (line[DEFENSIVE_REBOUNDS] ?? 0),
        assists: line[ASSISTS] ?? 0,
        turnovers: line[TURNOVERS] ?? 0,
        fieldGoals: `${String(line[FIELD_GOAL_MAKES] ?? 0)}-${String(line[FIELD_GOAL_ATTEMPTS] ?? 0)}`,
        threes: `${String(line[THREE_MAKES] ?? 0)}-${String(line[THREE_ATTEMPTS] ?? 0)}`,
        hot: false,
      };
    });
    const best = rows.reduce((top, row) => (row.points > top ? row.points : top), 0);
    for (const row of rows) row.hot = best > 0 && row.points === best;
    return rows;
  }

  const localSide = $derived(output.homeParticipantId === localParticipantId ? 'home' : 'away');
  const localScore = $derived(localSide === 'home' ? visible.homeScore : visible.awayScore);
  const opponentScore = $derived(localSide === 'home' ? visible.awayScore : visible.homeScore);
  const lastTrip = $derived(feed.length > 0 ? (feed[feed.length - 1] ?? null) : null);
  const periodLabel = $derived(
    draftDuelPeriodLabel(lastTrip?.period ?? visible.periods.at(-1)?.period ?? 1),
  );
  const clockLabel = $derived(lastTrip === null ? '—' : formatClock(lastTrip.clockSeconds));
  const progressPct = $derived(
    Math.round(Math.min(1, Math.max(0, Number.isNaN(progress) ? 0 : progress)) * 100),
  );
  const complete = $derived(progress >= 1);
  const recentFeed = $derived([...feed].slice(-10).reverse());
  const possession = $derived(
    lastTrip === null
      ? null
      : lastTrip.offense === localParticipantId
        ? 'Your ball'
        : 'Opponent ball',
  );

  const sides = $derived.by((): SideView[] => {
    const order: readonly ('home' | 'away')[] =
      localSide === 'home' ? ['home', 'away'] : ['away', 'home'];
    return order.map((key) => {
      const lines = key === 'home' ? visible.homePlayerLines : visible.awayPlayerLines;
      const ids = (key === 'home' ? output.result.home : output.result.away).players.map(
        (player) => player.playerId,
      );
      return {
        key,
        label: key === localSide ? 'You' : 'Opponent',
        score: key === 'home' ? visible.homeScore : visible.awayScore,
        rows: playerRowsOf(lines, ids),
      };
    });
  });

  function feedTag(line: DraftDuelFeedLine): string {
    if (line.points >= 3) return '3PT';
    if (line.points === 2) return 'BUCKET';
    if (line.points === 1) return 'FT';
    if (line.summary.includes('Turnover')) return 'TO';
    if (line.summary.includes('Rebound')) return 'REB';
    return '—';
  }

  function teamLogoSlot(card: DraftDuelCard | null) {
    if (!card || !manifest) return null;
    return (
      manifest.modernFranchiseSlots.find((slot) => slot.franchiseId === card.franchiseId) ?? null
    );
  }
</script>

<section class="broadcast" aria-label={`Game ${String(output.gameNumber)} broadcast`}>
  <header class="bc-board">
    <div class="bc-team you">
      <span class="bc-team-label">You</span>
      {#key localScore}
        <span class="bc-score" data-score="local">{localScore}</span>
      {/key}
    </div>
    <div class="bc-center">
      <span class="bc-live" data-tone={complete ? 'final' : 'live'}>
        <span class="bc-live-dot" aria-hidden="true"></span>
        {complete ? 'Final' : 'Live'}
      </span>
      <span class="bc-clock" aria-live="polite">{periodLabel} · {clockLabel}</span>
      {#if !complete}
        <span class="bc-possession">{possession ?? 'Tip-off soon'}</span>
      {/if}
      <span class="bc-quarters" aria-hidden="true">
        {#each [1, 2, 3, 4] as quarter (quarter)}
          <span
            class="bc-quarter"
            class:done={quarter < (lastTrip?.period ?? 1)}
            class:now={quarter === (lastTrip?.period ?? 1)}
          ></span>
        {/each}
      </span>
      <div class="bc-speed" role="group" aria-label="Playback speed">
        {#each speeds as option (option)}
          <button
            type="button"
            class="bc-speed-btn"
            aria-pressed={speed === option}
            onclick={() => onspeedchange(option)}
          >
            {option}×
          </button>
        {/each}
      </div>
    </div>
    <div class="bc-team opp">
      <span class="bc-team-label">Opponent</span>
      {#key opponentScore}
        <span class="bc-score" data-score="opponent">{opponentScore}</span>
      {/key}
    </div>
  </header>

  <div class="bc-progress" aria-hidden="true">
    <div
      class="bc-progress-fill"
      data-active={complete ? undefined : 'true'}
      style:width={`${progressPct}%`}
    ></div>
  </div>

  <div class="bc-panels">
    {#each sides as side (side.key)}
      <section class="bc-panel" data-side={side.key} aria-label={`${side.label} player stats`}>
        <header class="bc-panel-head">
          <span class="bc-panel-team" data-side={side.key}>{side.label}</span>
          <strong class="bc-panel-score">{side.score}</strong>
        </header>
        <div class="bc-panel-cols" aria-hidden="true">
          <span>Player</span>
          <span>PTS</span>
          <span>REB</span>
          <span>AST</span>
          <span>TO</span>
          <span>FG</span>
          <span>3P</span>
        </div>
        <ul class="bc-rows">
          {#each side.rows as row (row.key)}
            <li class="bc-row" class:hot={row.hot} data-role="player-row">
              <span class="bc-ident">
                {#if manifest && row.card?.playerExternalId}
                  <PlayerFace
                    player={{
                      playerId: row.card.playerId,
                      playerExternalId: row.card.playerExternalId,
                      altIds: null,
                    }}
                    {manifest}
                    size="sm"
                    fallbackInitials={initialsOf(row.name)}
                  />
                {:else}
                  <span class="bc-face">{initialsOf(row.name)}</span>
                {/if}
                <span class="bc-ident-text">
                  <span class="bc-name">{row.name}</span>
                  <span class="bc-sub">
                    {#if manifest && row.card && teamLogoSlot(row.card)}
                      <TeamLogo
                        {manifest}
                        franchiseId={row.card.franchiseId}
                        teamExternalId={teamLogoSlot(row.card)?.teamExternalId ?? ''}
                        logoCandidates={[]}
                        className="h-3 w-3"
                      />
                    {/if}
                    {row.position}
                    {#if row.hot}<span class="bc-hot">Leading</span>{/if}
                  </span>
                </span>
              </span>
              <span class="bc-stat big" data-stat="pts">{row.points}</span>
              <span class="bc-stat" data-stat="reb">{row.rebounds}</span>
              <span class="bc-stat" data-stat="ast">{row.assists}</span>
              <span class="bc-stat" data-stat="tov">{row.turnovers}</span>
              <span class="bc-stat" data-stat="fg">{row.fieldGoals}</span>
              <span class="bc-stat" data-stat="tp">{row.threes}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  <section class="bc-feed" aria-label="Play-by-play feed">
    <header class="bc-feed-head">
      <h3>Live feed</h3>
      <span class="bc-feed-count">
        {feed.length}
        {feed.length === 1 ? 'possession' : 'possessions'}
      </span>
    </header>
    {#if recentFeed.length > 0}
      <ul class="bc-feed-list" aria-live="polite">
        {#each recentFeed as line, index (line.key)}
          <li
            class="bc-feed-line"
            class:latest={index === 0}
            data-offense={line.offense === localParticipantId ? 'local' : 'opponent'}
          >
            <span class="bc-feed-clock">
              {draftDuelPeriodLabel(line.period)}
              {formatClock(line.clockSeconds)}
            </span>
            <span
              class="bc-feed-team"
              data-side={line.offense === localParticipantId ? 'local' : 'opponent'}
            >
              {line.offense === localParticipantId ? 'You' : 'Opp'}
            </span>
            <span class="bc-feed-tag" data-points={line.points > 0 ? 'yes' : 'no'}>
              {feedTag(line)}
            </span>
            <span class="bc-feed-summary">{displaySummary(line.summary)}</span>
            {#if line.points > 0}
              <span class="bc-feed-pts">+{line.points}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="bc-feed-empty">Waiting for the first possession…</p>
    {/if}
  </section>
</section>

<style>
  .broadcast {
    --dd-opp: hsl(212 90% 62%);
    display: grid;
    gap: 12px;
  }

  .bc-board {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    padding: 18px 22px;
    border: 1px solid var(--color-line-soft);
    border-radius: 16px;
    background:
      radial-gradient(
        120% 150% at 0% 0%,
        color-mix(in srgb, var(--color-primary) 18%, transparent),
        transparent 55%
      ),
      radial-gradient(
        120% 150% at 100% 0%,
        color-mix(in srgb, var(--dd-opp) 16%, transparent),
        transparent 55%
      ),
      var(--color-card);
  }

  .bc-team {
    display: grid;
    gap: 2px;
  }

  .bc-team.you {
    justify-items: start;
  }

  .bc-team.opp {
    justify-items: end;
    text-align: right;
  }

  .bc-team-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .bc-team.you .bc-team-label {
    color: var(--color-primary);
  }

  .bc-team.opp .bc-team-label {
    color: var(--dd-opp);
  }

  .bc-score {
    font-family: var(--font-display);
    font-size: clamp(52px, 8vw, 84px);
    font-weight: 900;
    line-height: 0.95;
    font-variant-numeric: tabular-nums;
    animation: bc-score-pop 340ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .bc-team.you .bc-score {
    color: var(--color-primary);
    text-shadow: 0 0 32px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }

  .bc-team.opp .bc-score {
    color: #f5f3ef;
  }

  .bc-center {
    display: grid;
    justify-items: center;
    gap: 6px;
  }

  .bc-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    border: 1px solid color-mix(in srgb, var(--color-primary) 60%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .bc-live[data-tone='final'] {
    border-color: var(--color-line-strong);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
  }

  .bc-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    animation: bc-pulse 1.4s ease-in-out infinite;
  }

  .bc-live[data-tone='final'] .bc-live-dot {
    animation: none;
  }

  .bc-clock {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--color-foreground);
  }

  .bc-possession {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .bc-quarters {
    display: flex;
    gap: 5px;
    margin-top: 2px;
  }

  .bc-quarter {
    width: 20px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-surface-3);
  }

  .bc-quarter.done {
    background: color-mix(in srgb, var(--color-primary) 45%, transparent);
  }

  .bc-quarter.now {
    background: var(--color-primary);
  }

  .bc-speed {
    display: inline-flex;
    gap: 4px;
    margin-top: 2px;
  }

  .bc-speed-btn {
    padding: 3px 10px;
    border: 1px solid var(--color-line-strong);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    cursor: pointer;
  }

  .bc-speed-btn:hover {
    color: var(--color-foreground);
  }

  .bc-speed-btn[aria-pressed='true'] {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
  }

  .bc-speed-btn:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .bc-progress {
    height: 4px;
    border-radius: 999px;
    background: var(--color-surface-3);
    overflow: hidden;
  }

  .bc-progress-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--color-primary),
      color-mix(in srgb, var(--color-primary) 55%, white)
    );
  }

  .bc-progress-fill[data-active='true'] {
    box-shadow: 0 0 14px color-mix(in srgb, var(--color-primary) 60%, transparent);
  }

  .bc-panels {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
  }

  @media (min-width: 900px) {
    .bc-panels {
      grid-template-columns: 1fr 1fr;
      align-items: start;
    }
  }

  .bc-panel {
    border: 1px solid var(--color-line-soft);
    border-radius: 14px;
    background: var(--color-surface-1);
    overflow: hidden;
  }

  .bc-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-card) 92%, white 8%),
      var(--color-card)
    );
    border-bottom: 1px solid var(--color-line-soft);
  }

  .bc-panel-team {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .bc-panel-team[data-side='home'],
  .bc-panel-team[data-side='away'] {
    color: var(--color-foreground);
  }

  .bc-panel-score {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }

  .bc-panel-cols {
    display: grid;
    grid-template-columns: minmax(0, 2.4fr) repeat(6, minmax(1.6rem, auto));
    gap: 8px;
    padding: 8px 14px 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .bc-panel-cols span:not(:first-child) {
    text-align: center;
  }

  .bc-rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .bc-row {
    display: grid;
    grid-template-columns: minmax(0, 2.4fr) repeat(6, minmax(1.6rem, auto));
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-top: 1px solid var(--color-line-soft);
  }

  .bc-row.hot {
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  }

  .bc-ident {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .bc-face {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    border-radius: 9px;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
  }

  .bc-ident-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  .bc-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bc-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .bc-hot {
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    color: var(--color-primary);
  }

  .bc-stat {
    justify-self: center;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--color-muted-foreground);
  }

  .bc-stat.big {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 900;
    color: var(--color-foreground);
  }

  .bc-row.hot .bc-stat.big {
    color: var(--color-primary);
  }

  .bc-feed {
    border: 1px solid var(--color-line-soft);
    border-radius: 14px;
    background: var(--color-surface-1);
    padding: 14px;
  }

  .bc-feed-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .bc-feed-head h3 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .bc-feed-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .bc-feed-list {
    display: grid;
    gap: 6px;
    max-height: 236px;
    margin: 0;
    padding: 0 4px 0 0;
    list-style: none;
    overflow: auto;
  }

  .bc-feed-line {
    display: grid;
    grid-template-columns: auto auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 9px;
    border-left: 3px solid var(--dd-opp);
    background: var(--color-surface-2);
  }

  .bc-feed-line[data-offense='local'] {
    border-left-color: var(--color-primary);
  }

  .bc-feed-line.latest {
    background: color-mix(in srgb, var(--color-surface-2) 80%, white 6%);
  }

  .bc-feed-clock {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }

  .bc-feed-team {
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dd-opp) 16%, transparent);
    color: var(--dd-opp);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .bc-feed-team[data-side='local'] {
    background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    color: var(--color-primary);
  }

  .bc-feed-tag {
    min-width: 3.4rem;
    text-align: center;
    padding: 2px 6px;
    border: 1px solid var(--color-line-strong);
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: var(--color-muted-foreground);
  }

  .bc-feed-tag[data-points='yes'] {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    color: var(--color-primary);
  }

  .bc-feed-summary {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bc-feed-pts {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 900;
    color: var(--color-positive);
  }

  .bc-feed-empty {
    color: var(--color-muted-foreground);
    font-size: 12px;
  }

  @keyframes bc-score-pop {
    0% {
      transform: scale(1);
      filter: brightness(1);
    }
    35% {
      transform: scale(1.07);
      filter: brightness(1.25);
    }
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
  }

  @keyframes bc-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.8);
    }
  }

  @media (max-width: 600px) {
    .bc-board {
      padding: 14px;
      gap: 10px;
    }

    .bc-panel-cols,
    .bc-row {
      grid-template-columns: minmax(0, 1.8fr) repeat(4, minmax(1.4rem, auto));
    }

    .bc-panel-cols span:nth-child(6),
    .bc-panel-cols span:nth-child(7),
    .bc-stat[data-stat='fg'],
    .bc-stat[data-stat='tp'] {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bc-score,
    .bc-live-dot {
      animation: none;
    }
  }
</style>
