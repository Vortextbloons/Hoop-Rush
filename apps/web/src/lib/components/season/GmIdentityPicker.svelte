<script lang="ts">
  import type { SeasonCampaignFocus, SeasonCampaignGmIdentity } from '@hoop-rush/data-contracts';
  let {
    busy = false,
    commandError = null,
    onSelect,
  }: {
    busy?: boolean;
    commandError?: string | null;
    onSelect: (input: {
      identity: SeasonCampaignGmIdentity;
      focus: SeasonCampaignFocus | null;
    }) => void;
  } = $props();
  let selectedIdentity: SeasonCampaignGmIdentity | null = $state(null);
  let selectedFocus: SeasonCampaignFocus | null = $state(null);
  const identities: Array<{
    id: SeasonCampaignGmIdentity;
    label: string;
    blurb: string;
    accent: string;
  }> = [
    {
      id: 'win-now',
      label: 'Win now',
      blurb:
        'Chase wins, marquee matchups, and playoff security. The room hunts block wins and statement victories.',
      accent: 'border-primary',
    },
    {
      id: 'player-development',
      label: 'Player development',
      blurb:
        'Give your rotation players real roles and steady minutes. The board tracks workload, availability, and growth.',
      accent: 'border-sky-500',
    },
    {
      id: 'team-identity',
      label: 'Team identity',
      blurb:
        'Declare a style and live it. Pick a focus — the front office will surface opportunities that match.',
      accent: 'border-amber-500',
    },
  ];
  const focuses: Array<{
    id: SeasonCampaignFocus;
    label: string;
    note: string;
  }> = [
    { id: 'defense', label: 'Defense', note: 'Defensive efficiency & stops' },
    { id: 'shooting', label: 'Shooting', note: 'Three-point volume & spacing' },
    { id: 'ball-movement', label: 'Ball movement', note: 'Assists & turnover control' },
    { id: 'depth', label: 'Depth', note: 'Bench & coverage' },
  ];
  const canSubmit = $derived(
    selectedIdentity !== null &&
      (selectedIdentity !== 'team-identity' || selectedFocus !== null) &&
      !busy,
  );
  function submit(): void {
    if (!canSubmit || selectedIdentity === null) return;
    const focus = selectedIdentity === 'team-identity' ? selectedFocus : null;
    onSelect({ identity: selectedIdentity, focus });
  }
  function onIdentityKeydown(event: KeyboardEvent, id: SeasonCampaignGmIdentity): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectedIdentity = id;
      if (id !== 'team-identity') selectedFocus = null;
    }
  }
</script>

<section
  aria-labelledby="gm-identity-heading"
  class="relative overflow-hidden rounded-2xl border border-line-strong bg-surface-1"
  data-testid="gm-identity-picker"
>
  <div class="pointer-events-none absolute inset-0 opacity-[0.04]">
    <div
      class="h-full w-full"
      style="background-image: repeating-linear-gradient( -8deg, transparent 0 14px, currentColor 14px 15px );"
    ></div>
  </div>

  <div class="relative">
    <div
      class="border-b border-border bg-gradient-to-r from-surface-2 to-surface-1 px-4 py-3 sm:px-5"
    >
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
        Front Office Memo — Confidential
      </p>
      <h2
        id="gm-identity-heading"
        class="font-display mt-1 text-xl font-extrabold uppercase tracking-tight sm:text-2xl"
      >
        Choose your GM identity
      </h2>
      <p class="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        This shapes which campaign opportunities the front office surfaces — scouting priorities and
        branch reasoning. It <strong class="font-semibold text-foreground">never</strong> changes ratings,
        shooting odds, health, officiating, or schedule.
      </p>
    </div>

    {#if commandError !== null}
      <p
        role="alert"
        class="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm sm:mx-5"
      >
        {commandError}
      </p>
    {/if}

    <div class="grid gap-3 p-4 sm:p-5 lg:grid-cols-3">
      {#each identities as identity (identity.id)}
        <button
          type="button"
          role="radio"
          aria-checked={selectedIdentity === identity.id}
          aria-label={`${identity.label} — ${identity.blurb}`}
          tabindex={selectedIdentity === identity.id
            ? 0
            : selectedIdentity === null && identity.id === 'win-now'
              ? 0
              : -1}
          onclick={() => {
            selectedIdentity = identity.id;
            if (identity.id !== 'team-identity') selectedFocus = null;
          }}
          onkeydown={(e) => onIdentityKeydown(e, identity.id)}
          class="group relative flex min-h-[148px] flex-col gap-2 rounded-xl border bg-card p-4 text-left outline-none transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring {selectedIdentity ===
          identity.id
            ? `${identity.accent} ring-1 ring-current bg-primary/5`
            : 'border-border hover:border-line-strong'}"
        >
          <span
            class="absolute right-3 top-3 h-2 w-2 rounded-full {selectedIdentity === identity.id
              ? 'bg-primary animate-pulse'
              : 'bg-muted-foreground/30'}"
          ></span>
          <span class="font-display text-base font-extrabold uppercase tracking-tight"
            >{identity.label}</span
          >
          <span class="text-sm leading-snug text-muted-foreground">{identity.blurb}</span>
          <span
            class="mt-auto font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            {#if identity.id === 'win-now'}Families: results · marquee{/if}
            {#if identity.id === 'player-development'}Families: player role · roster response{/if}
            {#if identity.id === 'team-identity'}Families: style · roster response{/if}
          </span>
        </button>
      {/each}
    </div>

    {#if selectedIdentity === 'team-identity'}
      <div class="border-t border-border bg-surface-2/60 px-4 py-4 sm:px-5">
        <fieldset class="flex flex-col gap-2">
          <legend
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Pick a style focus — required for Team Identity
          </legend>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {#each focuses as focus (focus.id)}
              <label
                class="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 outline-none transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring {selectedFocus ===
                focus.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40'}"
              >
                <input
                  type="radio"
                  name="gm-focus"
                  value={focus.id}
                  checked={selectedFocus === focus.id}
                  onchange={() => (selectedFocus = focus.id)}
                  class="h-4 w-4 shrink-0 accent-primary"
                  aria-label={focus.label}
                />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold">{focus.label}</span>
                  <span class="block font-mono text-[10px] text-muted-foreground">{focus.note}</span
                  >
                </span>
              </label>
            {/each}
          </div>
        </fieldset>
      </div>
    {/if}

    <div
      class="flex flex-col gap-2 border-t border-border bg-surface-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <p class="font-mono text-[10px] leading-relaxed text-muted-foreground sm:max-w-[420px]">
        Locked identity enters the run digest and command log. You keep it for the whole season
        except the one controlled evolution after block 4.
      </p>
      <button
        type="button"
        onclick={submit}
        disabled={!canSubmit}
        data-testid="gm-identity-submit"
        aria-label="Lock GM identity"
        class="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Locking…' : 'Lock identity'}
      </button>
    </div>
  </div>

  <p class="sr-only" role="status" aria-live="polite">
    {#if selectedIdentity === null}No identity selected{/if}
    {#if selectedIdentity !== null}Selected {selectedIdentity}{selectedFocus
        ? ` with ${selectedFocus}`
        : ''}{/if}
  </p>
</section>

<style>
  @media (prefers-reduced-motion: reduce) {
    .group {
      transition: none !important;
    }
    .animate-pulse {
      animation: none !important;
    }
  }
</style>
