<script lang="ts">
  import { page } from '$app/state';
  import HavocMultiplayerRoom from '#lib/features/havoc-multiplayer/HavocMultiplayerRoom.svelte';
  const roomId = $derived(page.params.roomId ?? '');
</script>

{#key roomId}
  <HavocMultiplayerRoom {roomId} />
{/key}
