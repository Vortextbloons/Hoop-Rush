<script lang="ts">
  import { resolve } from '$app/paths';
  import type { MultiplayerGameKind } from '@hoop-rush/data-contracts';
  import { multiplayerMode } from '#lib/modes/catalog.js';
  import Button from '#lib/components/ui/Button.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';

  let { gameKind, roomId }: { gameKind: MultiplayerGameKind; roomId: string } = $props();
  let attempt = $state.raw(0);
  const implementation = $derived.by(() => {
    // A new attempt re-runs the lazy mode + room loader so a failed chunk or
    // asset load can be retried without a full page reload.
    void attempt;
    return multiplayerMode(gameKind)
      .load()
      .then((adapter) => adapter.loadRoom());
  });
</script>

{#key attempt}
  {#await implementation}
    <p class="mx-auto max-w-6xl p-6 text-sm text-muted-foreground" role="status">
      Opening your room…
    </p>
  {:then Room}
    <Room {roomId} />
  {:catch error}
    <div class="mx-auto flex max-w-6xl flex-col items-start gap-3 p-6">
      <p class="text-sm text-destructive" role="alert">
        {error instanceof Error ? error.message : 'Could not open this room.'}
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <Button tone="secondary" onclick={() => (attempt += 1)}>Try again</Button>
        <ActionLink href={resolve('/multiplayer')}>Back to the lobby</ActionLink>
      </div>
    </div>
  {/await}
{/key}
