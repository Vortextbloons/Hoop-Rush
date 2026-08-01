<script lang="ts">
  const steps = [
    {
      title: 'Draft five',
      body: 'Pick a real NBA franchise and decade, then choose exactly five players from their best eligible seasons.',
    },
    {
      title: 'Face all 30',
      body: 'A fixed 82-game schedule against every franchise. No substitutions, no fatigue — five players, full games.',
    },
    {
      title: 'Chase 82-0',
      body: 'One loss ends the default run. Retry with the same seed, or rebuild the lineup and try again.',
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
    <p class="max-w-xl text-lg text-muted-foreground">
      Hoop Rush is a basketball sandbox: build a five-player lineup from a real NBA franchise and
      decade, then simulate a deterministic 82-game season against every team in the league.
    </p>
    <div class="flex flex-wrap items-center gap-4">
      <button
        type="button"
        disabled
        aria-disabled="true"
        class="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start a sandbox challenge
      </button>
      <span class="font-mono text-xs text-muted-foreground">
        Franchise pools arrive with the first playable decade
      </span>
    </div>
  </div>

  <ol class="grid gap-4 md:grid-cols-3">
    {#each steps as step, i (step.title)}
      <li class="rounded-xl border border-border bg-card p-6">
        <span class="font-display text-sm font-extrabold text-accent">0{i + 1}</span>
        <h2 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">
          {step.title}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
      </li>
    {/each}
  </ol>
</section>
