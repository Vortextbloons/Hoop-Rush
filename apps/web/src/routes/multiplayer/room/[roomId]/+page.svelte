<script lang="ts">
  import { page } from '$app/state';
  import RegisteredRoom from '#lib/features/multiplayer/RegisteredRoom.svelte';
  const roomId = $derived(page.params.roomId ?? '');
</script>

<RegisteredRoom gameKind="fixed-five" {roomId} />
