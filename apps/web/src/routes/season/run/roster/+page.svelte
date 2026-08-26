<script lang="ts">import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
if (!import.meta.env.SSR) {
    void goto(resolve('/season/run/team'));
}
</script>

<p class="p-6 font-mono text-sm text-muted-foreground">
  The roster now lives beside the rotation editor.
  <a class="text-primary underline" href={resolve('/season/run/team')}>Open the Team tab</a>
</p>
