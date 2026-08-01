<script lang="ts">
  import { resolve } from '$app/paths';
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';

  let { children } = $props();

  const homeHref = resolve('/');
</script>

<svelte:head>
  <meta name="color-scheme" content="dark light" />
  <title>Hoop Rush — can they go 82-0?</title>
</svelte:head>

<ModeWatcher />

<header class="border-b border-border/70">
  <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
    <a href={homeHref} class="font-display text-2xl font-extrabold tracking-tight text-foreground">
      Hoop <span class="text-primary">Rush</span>
    </a>
    <span class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
      Sandbox · 82-0
    </span>
  </div>
</header>

<main>
  {@render children()}
</main>

<Toaster richColors closeButton theme="system" />
