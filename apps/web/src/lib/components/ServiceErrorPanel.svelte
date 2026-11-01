<script lang="ts">
  import { resolve } from '$app/paths';

  let {
    title,
    message,
    tone = 'negative',
    homeLink = false,
  }: {
    title: string;
    message: string;
    tone?: 'negative' | 'destructive';
    homeLink?: boolean;
  } = $props();
</script>

<div
  role="alert"
  class="rounded-xl border p-6 {tone === 'destructive'
    ? 'border-destructive/40 bg-destructive/10'
    : 'border-negative/40 bg-negative/10'}"
>
  <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
    {title}
  </h1>
  <p class="mt-2 text-sm text-muted-foreground">{message}</p>
  {#if homeLink}
    <a
      href={resolve('/')}
      class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Back to home
    </a>
  {/if}
</div>
