<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  /** Old Roster tab URL: the roster merged into the Team tab (M2.3.5). */
  if (!import.meta.env.SSR) {
    void goto(resolve('/season/run/team'));
  }
</script>

<p class="p-6 font-mono text-sm text-muted-foreground">
  The roster now lives beside the rotation editor.
  <a class="text-primary underline" href={resolve('/season/run/team')}>Open the Team tab</a>
</p>
