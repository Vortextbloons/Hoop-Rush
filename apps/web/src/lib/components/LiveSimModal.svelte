<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  let {
    open,
    onOpenChange,
    children,
    fitContent = false,
    onOpenAutoFocus,
    broadcast = false,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: Snippet;
    fitContent?: boolean;
    onOpenAutoFocus?: (event: Event) => void;
    broadcast?: boolean;
  } = $props();
  const overlayClass = $derived(
    broadcast
      ? 'sr-dialog-overlay sim-modal-overlay'
      : 'sim-modal-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm',
  );
  const contentClass = $derived(
    broadcast
      ? `sr-dialog sim-modal-content ${fitContent ? '' : 'sim-live-modal-content'} w-[min(36rem,calc(100vw_-_1.5rem))] overflow-y-auto overflow-x-hidden outline-none`
      : `sim-modal-content ${fitContent ? '' : 'sim-live-modal-content'} fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-surface-1 shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border`,
  );
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class={overlayClass} />
    <Dialog.Content
      escapeKeydownBehavior="ignore"
      interactOutsideBehavior="ignore"
      {onOpenAutoFocus}
      class={contentClass}
    >
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
