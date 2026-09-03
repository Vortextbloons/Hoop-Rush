<script lang="ts">import { packageConsequenceFacts, chemistryFootnote } from '$lib/season/season-presentation';
interface PlayerLite {
    playerVersionId: string;
    displayName: string;
    playable: readonly string[];
    available: boolean;
}
let { yourPlayers, theirPlayers, yourRosterSize, theirRosterSize, yourBalance, theirBalance, humanFranchiseId, targetFranchiseId, targetFranchiseName, inquiryAllowance, inquiriesUsed, allowanceLabel, busy = false, commandError = null, onSubmit, }: {
    yourPlayers: PlayerLite[];
    theirPlayers: PlayerLite[];
    yourRosterSize: number;
    theirRosterSize: number;
    yourBalance: number;
    theirBalance: number;
    humanFranchiseId: string;
    targetFranchiseId: string;
    targetFranchiseName: string;
    inquiryAllowance: number;
    inquiriesUsed: number;
    allowanceLabel: string;
    busy?: boolean;
    commandError?: string | null;
    onSubmit: (payload: {
        outgoing: string[];
        incoming: string[];
        influenceAmount: number;
        influenceFromSender: string | null;
    }) => void;
} = $props();
let outgoing: string[] = $state([]);
let incoming: string[] = $state([]);
let influenceAmount: number = $state(0);
let influenceFrom: string | null = $state(null);
const outgoingSet = $derived(new Set(outgoing));
const incomingSet = $derived(new Set(incoming));
const influenceOptions: Array<{
    amount: number;
    from: string | null;
    label: string;
    disabledReason: string | null;
}> = $derived.by(() => {
    const opts: typeof influenceOptions = [];
    opts.push({ amount: 0, from: null, label: 'No Influence', disabledReason: null });
    for (const from of [humanFranchiseId, targetFranchiseId]) {
        for (const amount of [1, 2]) {
            const balance = from === humanFranchiseId ? yourBalance : theirBalance;
            const disabled = balance - amount < 0
                ? `Balance ${String(balance)} cannot cover ${String(amount)} (floor 0)`
                : null;
            const who = from === humanFranchiseId ? 'You send' : `${targetFranchiseName} sends`;
            opts.push({ amount, from, label: `${who} ${String(amount)}`, disabledReason: disabled });
        }
    }
    return opts;
});
const selectedInfluence = $derived(influenceOptions.find((o) => o.amount === influenceAmount && o.from === influenceFrom) ?? null);
const canSubmit = $derived(outgoing.length >= 1 &&
    outgoing.length <= 2 &&
    incoming.length >= 1 &&
    incoming.length <= 2 &&
    (influenceAmount === 0 ||
        (influenceAmount >= 1 && influenceAmount <= 2 && influenceFrom !== null)) &&
    !(outgoing.length === 0 && incoming.length === 0) &&
    !busy);
const consequence = $derived(packageConsequenceFacts({
    fromRosterSize: yourRosterSize,
    toRosterSize: theirRosterSize,
    outgoingIds: outgoing,
    incomingIds: incoming,
    outgoingAvailable: outgoing.map((id) => yourPlayers.find((p) => p.playerVersionId === id)?.available ?? true),
    incomingAvailable: incoming.map((id) => theirPlayers.find((p) => p.playerVersionId === id)?.available ?? true),
    influenceAmount,
    influenceFromSender: influenceFrom,
    humanFranchiseId,
    toFranchiseId: targetFranchiseId,
}));
const inquiriesRemaining = $derived(Math.max(0, inquiryAllowance - inquiriesUsed));
const willConsumeInquiry = $derived(inquiriesUsed < inquiryAllowance);
function toggle(set: 'outgoing' | 'incoming', id: string): void {
    if (set === 'outgoing') {
        if (outgoingSet.has(id))
            outgoing = outgoing.filter((x) => x !== id);
        else if (outgoing.length < 2)
            outgoing = [...outgoing, id];
    }
    else {
        if (incomingSet.has(id))
            incoming = incoming.filter((x) => x !== id);
        else if (incoming.length < 2)
            incoming = [...incoming, id];
    }
}
function handleInfluenceChange(amount: number, from: string | null): void {
    influenceAmount = amount;
    influenceFrom = from;
}
function submit(): void {
    if (!canSubmit)
        return;
    onSubmit({
        outgoing: [...outgoing],
        incoming: [...incoming],
        influenceAmount,
        influenceFromSender: influenceFrom,
    });
}
</script>

<div
  class="flex flex-col gap-4 rounded-xl border border-border bg-card"
  data-testid="package-builder"
>
  <div class="border-b border-border bg-surface-2 px-4 py-3">
    <h3 class="font-display text-sm font-extrabold uppercase tracking-tight">Build package</h3>
    <p class="mt-1 font-mono text-[10px] text-muted-foreground">
      Pick 1–2 from each side. Optionally add 1–2 Influence from one side — never both, never alone.
      Rosters must stay 10–15 and keep a legal ten.
    </p>
    <p class="mt-2 rounded-lg bg-primary/10 px-2.5 py-1.5 font-mono text-[10px] text-primary">
      Inquiry: {allowanceLabel} · {inquiriesRemaining} remaining · {willConsumeInquiry
        ? 'this proposal will consume 1 inquiry'
        : 'at cap — purchase or earned credit needed'} · browsing is free
    </p>
  </div>

  {#if commandError !== null}
    <p
      role="alert"
      class="mx-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
    >
      {commandError}
    </p>
  {/if}

  <div class="grid gap-4 p-4 lg:grid-cols-2">
    <fieldset class="rounded-xl border border-line-strong bg-surface-1 p-3">
      <legend
        class="px-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >You give — {humanFranchiseId} ({yourRosterSize} → {consequence.fromAfter})</legend
      >
      <ul
        class="mt-2 flex flex-col gap-1.5"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Your players to send"
      >
        {#each yourPlayers as player (player.playerVersionId)}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={outgoingSet.has(player.playerVersionId)}
              onclick={() => toggle('outgoing', player.playerVersionId)}
              disabled={busy || (!outgoingSet.has(player.playerVersionId) && outgoing.length >= 2)}
              class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {outgoingSet.has(
                player.playerVersionId,
              )
                ? 'border-primary bg-primary/10'
                : 'border-border bg-card hover:border-primary/30'}"
            >
              <span
                class="grid h-4 w-4 place-items-center rounded border {outgoingSet.has(
                  player.playerVersionId,
                )
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-muted-foreground/30 bg-transparent'}"
              >
                {#if outgoingSet.has(player.playerVersionId)}✓{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{player.displayName}</span>
                <span class="block truncate font-mono text-[10px] text-muted-foreground"
                  >{player.playable.join('·') || '—'}
                  {player.available ? '' : '· OUT — availability risk'}</span
                >
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="mt-2 font-mono text-[10px] text-muted-foreground">Selected {outgoing.length}/2</p>
    </fieldset>

    <fieldset class="rounded-xl border border-line-strong bg-surface-1 p-3">
      <legend
        class="px-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >You get — {targetFranchiseName} ({theirRosterSize} → {consequence.toAfter})</legend
      >
      <ul
        class="mt-2 flex flex-col gap-1.5"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Their players to receive"
      >
        {#each theirPlayers as player (player.playerVersionId)}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={incomingSet.has(player.playerVersionId)}
              onclick={() => toggle('incoming', player.playerVersionId)}
              disabled={busy || (!incomingSet.has(player.playerVersionId) && incoming.length >= 2)}
              class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {incomingSet.has(
                player.playerVersionId,
              )
                ? 'border-primary bg-primary/10'
                : 'border-border bg-card hover:border-primary/30'}"
            >
              <span
                class="grid h-4 w-4 place-items-center rounded border {incomingSet.has(
                  player.playerVersionId,
                )
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-muted-foreground/30 bg-transparent'}"
              >
                {#if incomingSet.has(player.playerVersionId)}✓{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{player.displayName}</span>
                <span class="block truncate font-mono text-[10px] text-muted-foreground"
                  >{player.playable.join('·') || '—'} {player.available ? '' : '· OUT'}</span
                >
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="mt-2 font-mono text-[10px] text-muted-foreground">Selected {incoming.length}/2</p>
    </fieldset>
  </div>

  <fieldset class="mx-4 rounded-xl border border-border bg-surface-1 p-3">
    <legend
      class="px-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >Influence as cash consideration — optional</legend
    >
    <p class="font-mono text-[10px] text-muted-foreground">
      Cash may close an already plausible deal (5% per point, 10% max) — never makes an unreasonable
      package acceptable, never bypasses protected/illegal gates, never alone. Floor 0 — spends
      reject instead of clamping.
    </p>
    <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each influenceOptions as opt (`${String(opt.amount)}-${opt.from ?? 'none'}`)}
        <label
          class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 outline-none transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring {selectedInfluence?.amount ===
            opt.amount && selectedInfluence?.from === opt.from
            ? 'border-primary bg-primary/10'
            : 'border-border bg-card hover:border-primary/30'} {opt.disabledReason
            ? 'opacity-50'
            : ''}"
        >
          <input
            type="radio"
            name="influence"
            checked={selectedInfluence?.amount === opt.amount &&
              selectedInfluence?.from === opt.from}
            onchange={() => handleInfluenceChange(opt.amount, opt.from)}
            disabled={opt.disabledReason !== null || busy}
            class="h-4 w-4 accent-primary"
            aria-label={opt.label}
          />
          <span class="text-sm font-medium">{opt.label}</span>
          {#if opt.disabledReason}
            <span class="ml-auto font-mono text-[10px] text-destructive">{opt.disabledReason}</span>
          {/if}
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="mx-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3" aria-live="polite">
    <p
      class="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300"
    >
      Before submission — deterministic facts
    </p>
    <ul class="mt-2 flex flex-col gap-1 text-sm">
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">Roster:</span>
        <span class={consequence.legal ? 'text-foreground' : 'text-destructive font-semibold'}
          >You {yourRosterSize} → {consequence.fromAfter} · {targetFranchiseName}
          {theirRosterSize} → {consequence.toAfter}
          {consequence.legal ? '· legal 10–15' : '· ILLEGAL — must stay 10–15'}</span
        >
      </li>
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">Rotation:</span><span
          >Will rebuild around incoming minutes · starters/bench/closing five repaired
          deterministically</span
        >
      </li>
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">Availability:</span><span
          >{consequence.roleCoverage}</span
        >
      </li>
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">Chemistry:</span><span
          >{chemistryFootnote(consequence.chemistryRemoved, consequence.chemistryNew)}</span
        >
      </li>
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">Influence:</span><span
          >{consequence.influenceNote} · balances you {yourBalance} · them {theirBalance}</span
        >
      </li>
    </ul>
    <p class="mt-2 font-mono text-[10px] text-muted-foreground">
      Never shows Overall, exact value ratio, threshold, or seeded RNG. Values are board facts only.
    </p>
  </div>

  <div
    class="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between border-t border-border bg-surface-2/40"
  >
    <p class="font-mono text-[10px] text-muted-foreground">
      Browsing the board is free. Submitting consumes one inquiry. Duplicate fingerprints are
      rejected without consuming another exchange.
    </p>
    <button
      type="button"
      onclick={submit}
      disabled={!canSubmit}
      data-testid="package-submit"
      aria-label="Submit proposal"
      class="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? 'Submitting…' : 'Submit proposal'}
    </button>
  </div>
</div>
