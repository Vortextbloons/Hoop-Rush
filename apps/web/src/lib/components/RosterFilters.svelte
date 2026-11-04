<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { Select } from 'bits-ui';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import TeamLogo from './TeamLogo.svelte';

  let {
    manifest,
    franchiseId,
    eraId,
    idPrefix,
    franchiseLabel = 'Franchise',
    franchisePlaceholder = 'Any franchise…',
    anyFranchiseLabel = 'Any franchise',
    compact = false,
    onSelectFranchise,
    onSelectEra,
  }: {
    manifest: HoopRushManifest;
    franchiseId: string;
    eraId: string;
    idPrefix: string;
    franchiseLabel?: string;
    franchisePlaceholder?: string;
    anyFranchiseLabel?: string;
    compact?: boolean;
    onSelectFranchise: (id: string) => void;
    onSelectEra: (id: string) => void;
  } = $props();

  const franchise = $derived(
    manifest.modernFranchiseSlots.find((entry) => entry.franchiseId === franchiseId) ?? null,
  );
  const era = $derived(manifest.eras.find((entry) => entry.eraId === eraId) ?? null);
  const eraIdentity = $derived(
    franchise && era ? resolveEraTeamIdentity(manifest, franchise.franchiseId, era.eraId) : null,
  );
  const franchiseItems = $derived([
    { value: '', label: anyFranchiseLabel },
    ...manifest.modernFranchiseSlots.map((entry) => ({
      value: entry.franchiseId,
      label: entry.displayName,
    })),
  ]);
  const eraItems = $derived([
    { value: '', label: 'Any decade' },
    ...manifest.eras.map((entry) => ({ value: entry.eraId, label: entry.label })),
  ]);
  const triggerClass = $derived(
    `flex w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring ${compact ? 'mt-2 h-11' : 'mt-3 h-12'}`,
  );
</script>

<div class="grid {compact ? 'gap-4' : 'gap-6'} sm:grid-cols-2">
  <div>
    <h2
      id="{idPrefix}-franchise-label"
      class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
    >
      {franchiseLabel}
    </h2>
    <Select.Root
      type="single"
      value={franchiseId}
      onValueChange={onSelectFranchise}
      items={franchiseItems}
    >
      <Select.Trigger aria-labelledby="{idPrefix}-franchise-label" class={triggerClass}>
        <Select.Value placeholder={franchisePlaceholder}>
          {#snippet children(props)}
            {#if franchise}
              <span class="flex min-w-0 items-center gap-2.5">
                <TeamLogo
                  {manifest}
                  franchiseId={franchise.franchiseId}
                  teamExternalId={franchise.teamExternalId}
                  logoCandidates={eraIdentity?.logoCandidates ?? []}
                />
                <span class="truncate" title={eraIdentity?.displayLabel ?? franchise.displayName}>
                  {eraIdentity?.abbreviationLabel ?? franchiseAbbreviation(franchise.franchiseId)}
                </span>
              </span>
            {:else}
              <span class="font-normal text-muted-foreground">{props.placeholder}</span>
            {/if}
          {/snippet}
        </Select.Value>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          side="bottom"
          sideOffset={6}
          align="start"
          collisionPadding={12}
          class="z-50 min-w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/30"
        >
          <Select.Viewport class="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-0.5">
            <Select.Item
              value=""
              label={anyFranchiseLabel}
              aria-label={anyFranchiseLabel}
              class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
            >
              {#snippet children({ selected })}
                <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                  <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                    {anyFranchiseLabel}
                  </span>
                  {#if selected}
                    <Check class="h-4 w-4 shrink-0 text-primary" />
                  {/if}
                </span>
              {/snippet}
            </Select.Item>
            {#each manifest.modernFranchiseSlots as entry (entry.franchiseId)}
              <Select.Item
                value={entry.franchiseId}
                label={entry.displayName}
                aria-label={`${franchiseAbbreviation(entry.franchiseId)} — ${entry.displayName}`}
                class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
              >
                {#snippet children({ selected })}
                  <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                    <TeamLogo
                      {manifest}
                      franchiseId={entry.franchiseId}
                      teamExternalId={entry.teamExternalId}
                    />
                    <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                      {franchiseAbbreviation(entry.franchiseId)}
                    </span>
                    {#if selected}
                      <Check class="h-4 w-4 shrink-0 text-primary" />
                    {/if}
                  </span>
                {/snippet}
              </Select.Item>
            {/each}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  </div>

  <div>
    <h2
      id="{idPrefix}-decade-label"
      class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
    >
      Decade
    </h2>
    <Select.Root type="single" value={eraId} onValueChange={onSelectEra} items={eraItems}>
      <Select.Trigger aria-labelledby="{idPrefix}-decade-label" class={triggerClass}>
        <Select.Value placeholder="Any decade…">
          {#snippet children(props)}
            {#if era}
              <span class="truncate font-mono">{era.label}</span>
            {:else}
              <span class="font-normal text-muted-foreground">{props.placeholder}</span>
            {/if}
          {/snippet}
        </Select.Value>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          side="bottom"
          sideOffset={6}
          align="start"
          collisionPadding={12}
          class="z-50 min-w-48 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/30"
        >
          <Select.Viewport class="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-0.5">
            <Select.Item
              value=""
              label="Any decade"
              aria-label="Any decade"
              class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
            >
              {#snippet children({ selected })}
                <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                  <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                    Any decade
                  </span>
                  {#if selected}
                    <Check class="h-4 w-4 shrink-0 text-primary" />
                  {/if}
                </span>
              {/snippet}
            </Select.Item>
            {#each manifest.eras as entry (entry.eraId)}
              <Select.Item
                value={entry.eraId}
                label={entry.label}
                class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
              >
                {#snippet children({ selected })}
                  <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                    <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                      {entry.label}
                    </span>
                    {#if selected}
                      <Check class="h-4 w-4 shrink-0 text-primary" />
                    {/if}
                  </span>
                {/snippet}
              </Select.Item>
            {/each}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  </div>
</div>
