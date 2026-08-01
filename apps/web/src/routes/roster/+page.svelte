<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Users } from '@lucide/svelte';

  const draftHref = resolve('/sandbox');
</script>

<svelte:head>
  <title>Roster — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div>
    <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Roster</p>
    <h1
      class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
    >
      Your five
    </h1>
  </div>

  <div
    class="mt-10 grid place-items-center rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center"
  >
    <Users class="h-10 w-10 text-muted-foreground" aria-hidden="true" />
    <h2 class="font-display mt-4 text-2xl font-extrabold tracking-tight uppercase">
      Your roster is empty
    </h2>
    <p class="mt-2 max-w-sm text-sm text-muted-foreground">
      Pick a franchise and decade, then draft five peak player-seasons.
    </p>
    <a
      href={draftHref}
      class="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Build your first lineup
      <ArrowRight class="h-4 w-4" />
    </a>
  </div>
</section>
