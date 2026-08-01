<script lang="ts">
  import { resolve } from '$app/paths';

  const sandboxHref = resolve('/sandbox');

  const steps = [
    {
      title: 'Draft five',
    },
    {
      title: 'Face all 30',
    },
    {
      title: 'Chase 82-0',
    },
  ] as const;
</script>

<section class="mx-auto w-full max-w-6xl px-6 pb-20">
  <div class="flex flex-col items-start gap-8 py-16 md:py-24">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
        Draft your starting five
      </p>
      <h1
        class="font-display mt-3 text-6xl leading-[0.92] font-extrabold tracking-tight uppercase md:text-8xl"
      >
        Can they go
        <span class="text-primary">82-0?</span>
      </h1>
    </div>
    <div class="flex flex-wrap items-center gap-4">
      <a
        href={sandboxHref}
        class="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground"
      >
        Start a sandbox challenge
      </a>
      <span class="font-mono text-xs text-muted-foreground"> First pool: LAL · 1990s </span>
    </div>
  </div>

  <ol class="grid gap-4 md:grid-cols-3">
    {#each steps as step, i (step.title)}
      <li class="rounded-xl border border-border bg-card p-6">
        <span class="font-display text-sm font-extrabold text-accent">0{i + 1}</span>
        <h2 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">
          {step.title}
        </h2>
      </li>
    {/each}
  </ol>
</section>
