<script lang="ts">
  import Alert from '#lib/components/ui/Alert.svelte';
  import Button from '#lib/components/ui/Button.svelte';

  let { busy = false, onAbandon }: { busy?: boolean; onAbandon: () => void } = $props();

  let confirm = $state(false);
</script>

{#if confirm}
  <Alert tone="warning" title="Abandon this run?">
    This clears the active Full Court save and returns you to draft setup. Completed seasons stay in
    history.
    {#snippet actions()}
      <Button tone="secondary" disabled={busy} onclick={() => (confirm = false)}>Keep run</Button>
      <Button
        tone="danger"
        loading={busy}
        onclick={() => {
          confirm = false;
          onAbandon();
        }}>Abandon run</Button
      >
    {/snippet}
  </Alert>
{:else}
  <div class="flex justify-end">
    <Button tone="ghost" size="sm" disabled={busy} onclick={() => (confirm = true)}>
      Abandon run
    </Button>
  </div>
{/if}
