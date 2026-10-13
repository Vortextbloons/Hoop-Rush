<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  let {
    open,
    onOpenChange,
    header,
    children,
    size = 'md',
    layout = 'sheet',
    grabHandle = false,
    showClose = true,
    closeLabel = 'Close',
    closeTestId = null,
    contentTestId = null,
    closeClass = '',
    contentClass = '',
    overlayClass = '',
    headerClass = '',
    onOpenAutoFocus,
    escapeKeydownBehavior = 'close',
    interactOutsideBehavior = 'close',
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    header: Snippet;
    children: Snippet;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    layout?: 'sheet' | 'center';
    grabHandle?: boolean;
    showClose?: boolean;
    closeLabel?: string;
    closeTestId?: string | null;
    contentTestId?: string | null;
    closeClass?: string;
    contentClass?: string;
    overlayClass?: string;
    headerClass?: string;
    onOpenAutoFocus?: (event: Event) => void;
    escapeKeydownBehavior?: 'close' | 'ignore';
    interactOutsideBehavior?: 'close' | 'ignore';
  } = $props();
  const sizeClass = $derived(
    layout === 'center'
      ? {
          sm: 'max-w-md',
          md: 'max-w-lg',
          lg: 'max-w-2xl',
          xl: 'max-w-4xl',
        }[size]
      : {
          sm: 'sm:max-w-md',
          md: 'sm:max-w-lg',
          lg: 'sm:max-w-2xl',
          xl: 'sm:max-w-4xl',
        }[size],
  );
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class={['fixed inset-0 z-50 bg-black/60 backdrop-blur-sm', overlayClass]} />
    <Dialog.Content
      data-testid={contentTestId ?? undefined}
      class={[
        layout === 'center' ? 'ui-dialog-center' : 'ui-dialog-sheet',
        sizeClass,
        contentClass,
      ]}
      {onOpenAutoFocus}
      {escapeKeydownBehavior}
      {interactOutsideBehavior}
    >
      {#if grabHandle}
        <div
          class="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden"
          aria-hidden="true"
        ></div>
      {/if}
      <div class={['flex items-start justify-between gap-3', headerClass]}>
        <div class="min-w-0 flex-1">
          {@render header()}
        </div>
        {#if showClose}
          <Dialog.Close
            aria-label={closeLabel}
            data-testid={closeTestId ?? undefined}
            class={['ui-icon-btn', closeClass]}
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        {/if}
      </div>
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
