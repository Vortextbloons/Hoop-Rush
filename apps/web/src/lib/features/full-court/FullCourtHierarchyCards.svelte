<script lang="ts">
  import type { SimulationPlayer } from '@hoop-rush/data-contracts';
  import { Compass, Crown, Target } from '@lucide/svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import Button from '#lib/components/ui/Button.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtOffensiveHierarchyDraft } from './full-court-coaching-presenter.ts';
  import FullCourtPlayerPicker from './FullCourtPlayerPicker.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  const ROLES = [
    {
      key: 'primaryPlayerId',
      label: 'Primary option',
      hint: 'Gets the strongest boost to scoring opportunities.',
    },
    {
      key: 'secondaryPlayerId',
      label: 'Second option',
      hint: 'Takes a moderate share behind the primary option.',
    },
    {
      key: 'floorGeneralPlayerId',
      label: 'Floor general',
      hint: 'Starts more possessions and looks to pass. Can also be a scoring option.',
    },
  ] as const satisfies readonly {
    key: keyof FullCourtOffensiveHierarchyDraft;
    label: string;
    hint: string;
  }[];

  let {
    hierarchy,
    roster,
    art = null,
    locked = false,
    onChange,
  }: {
    hierarchy: FullCourtOffensiveHierarchyDraft;
    roster: readonly SimulationPlayer[];
    art?: FullCourtArt | null;
    locked?: boolean;
    onChange: (role: keyof FullCourtOffensiveHierarchyDraft, playerId: string | null) => void;
  } = $props();

  const playerById = $derived(
    new Map<string, SimulationPlayer>(roster.map((player) => [player.playerId, player])),
  );
  let activeRole = $state<keyof FullCourtOffensiveHierarchyDraft | null>(null);

  const activeRoleMeta = $derived(
    activeRole === null ? null : (ROLES.find((role) => role.key === activeRole) ?? null),
  );

  function excludedFor(role: keyof FullCourtOffensiveHierarchyDraft): readonly string[] {
    if (role === 'primaryPlayerId') {
      return hierarchy.secondaryPlayerId === null ? [] : [hierarchy.secondaryPlayerId];
    }
    if (role === 'secondaryPlayerId') {
      return hierarchy.primaryPlayerId === null ? [] : [hierarchy.primaryPlayerId];
    }
    return [];
  }
</script>

<div class="hierarchy-grid">
  {#each ROLES as role (role.key)}
    {@const player = playerById.get(hierarchy[role.key] ?? '') ?? null}
    <section
      class="role-card"
      aria-label={role.label}
      data-filled={player !== null}
      data-active={activeRole === role.key}
    >
      <header class="role-head">
        <span class="role-icon" aria-hidden="true">
          {#if role.key === 'primaryPlayerId'}
            <Crown size={16} strokeWidth={1.9} />
          {:else if role.key === 'secondaryPlayerId'}
            <Target size={16} strokeWidth={1.9} />
          {:else}
            <Compass size={16} strokeWidth={1.9} />
          {/if}
        </span>
        <div class="min-w-0">
          <p class="ui-label">{role.label}</p>
          <p class="role-hint">{role.hint}</p>
        </div>
      </header>

      {#if player !== null}
        <button
          type="button"
          class="role-player"
          disabled={locked}
          aria-label={`Change ${role.label.toLowerCase()}`}
          onclick={() => (activeRole = role.key)}
        >
          <FullCourtPortrait {player} {art} size="md" />
          <span class="role-player-copy">
            <span class="role-player-name">{player.displayName}</span>
            <span class="role-player-meta">
              {formatPositions(player.positions)}
              {#if player.overall !== undefined}
                · {player.overall} OVR
              {/if}
            </span>
          </span>
        </button>
      {:else}
        <button
          type="button"
          class="role-empty"
          disabled={locked}
          aria-label={`Choose ${role.label.toLowerCase()}`}
          onclick={() => (activeRole = role.key)}
        >
          <span class="role-empty-mark" aria-hidden="true">+</span>
          Choose a player
        </button>
      {/if}

      <div class="role-actions">
        <Button
          tone="secondary"
          size="sm"
          type="button"
          disabled={locked}
          onclick={() => (activeRole = role.key)}
        >
          {player === null ? 'Choose' : 'Change'}
        </Button>
        {#if player !== null}
          <Button
            tone="ghost"
            size="sm"
            type="button"
            disabled={locked}
            onclick={() => onChange(role.key, null)}
          >
            Clear
          </Button>
        {/if}
      </div>
    </section>
  {/each}
</div>

{#if activeRole !== null && activeRoleMeta !== null}
  <FullCourtPlayerPicker
    players={roster}
    {art}
    {locked}
    label={`Choose ${activeRoleMeta.label.toLowerCase()}`}
    selectedId={hierarchy[activeRole]}
    excludedIds={excludedFor(activeRole)}
    onSelect={(playerId) => {
      if (activeRole === null) return;
      onChange(activeRole, playerId);
      activeRole = null;
    }}
    onClose={() => (activeRole = null)}
  />
{/if}

<style>
  .hierarchy-grid {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.75rem;
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 768px) {
    .hierarchy-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .role-card {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem 0.75rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.8rem;
    background: var(--color-surface-1);
  }

  .role-card[data-active='true'] {
    border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-line-soft));
  }

  .role-card[data-filled='true'] {
    background:
      radial-gradient(
        110% 90% at 0% 0%,
        color-mix(in srgb, var(--color-primary) 10%, transparent),
        transparent 62%
      ),
      var(--color-surface-1);
  }

  .role-head {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .role-icon {
    display: grid;
    width: 1.9rem;
    height: 1.9rem;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }

  .role-hint {
    margin: 0.2rem 0 0;
    color: var(--color-muted-foreground);
    font-size: 0.625rem;
    line-height: 1.4;
  }

  .role-player,
  .role-empty {
    display: flex;
    min-height: 3.5rem;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.65rem;
    background: var(--color-surface-2);
    text-align: left;
    cursor: pointer;
  }

  .role-player:hover:not(:disabled),
  .role-empty:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-line-soft));
  }

  .role-player-copy {
    display: grid;
    min-width: 0;
    gap: 0.15rem;
  }

  .role-player-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .role-player-meta {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .role-empty {
    justify-content: center;
    border-style: dashed;
    color: var(--color-muted-foreground);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .role-empty-mark {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-weight: 800;
  }

  .role-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: auto;
  }
</style>
