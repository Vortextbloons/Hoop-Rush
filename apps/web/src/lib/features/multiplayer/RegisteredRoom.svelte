<script lang="ts">
  import type { MultiplayerGameKind } from '@hoop-rush/data-contracts';
  import { multiplayerMode } from '#lib/modes/catalog.js';
  let { gameKind, roomId }: { gameKind: MultiplayerGameKind; roomId: string } = $props();
  const implementation = $derived(
    multiplayerMode(gameKind)
      .load()
      .then((adapter) => adapter.loadRoom()),
  );
</script>

{#await implementation}
  <p class="mx-auto max-w-6xl p-6 text-sm text-muted-foreground" role="status">
    Opening your room…
  </p>
{:then Room}
  <Room {roomId} />
{:catch error}
  <p class="mx-auto max-w-6xl p-6 text-sm text-destructive" role="alert">
    {error instanceof Error ? error.message : 'Could not open this room. Refresh to try again.'}
  </p>
{/await}
