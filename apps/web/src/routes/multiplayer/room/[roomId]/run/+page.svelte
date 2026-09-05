<script lang="ts">
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  let roomId = $derived($page.params.roomId as string);
  onMount(() => {
    void goto(resolve('/multiplayer/room/[roomId]', { roomId }));
  });
</script>

<p class="p-6 text-sm text-muted-foreground" role="status">
  Redirecting to <a class="underline" href={resolve('/multiplayer/room/[roomId]', { roomId })}
    >the room</a
  >…
</p>
