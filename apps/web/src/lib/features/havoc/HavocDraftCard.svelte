<script lang="ts">
  import type { HavocDraftCard } from '@hoop-rush/data-contracts';
  import { REQUIRED_RATING_KEYS, HAVOC_TENDENCY_FIELDS } from '@hoop-rush/data-contracts';
  import PlayerArt from '#lib/components/PlayerArt.svelte';
  import HavocMutationList from './HavocMutationList.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import {
    mutationNameOf,
    mutationDescriptionOf,
    mutationDownsideOf,
    havocFieldLabel,
    HAVOC_TIER_COLORS,
  } from './havoc-presentation';
  let {
    card,
    mode,
    busy,
    franchiseName = (id: string) => id,
    onPick,
    unavailable = false,
  }: {
    card: HavocDraftCard;
    mode: 'effective' | 'original';
    busy: boolean;
    franchiseName?: (id: string) => string;
    onPick: (id: string) => void;
    unavailable?: boolean;
  } = $props();
  const physical = $derived(card.effective.physical);
  const affectedRatings = $derived(
    REQUIRED_RATING_KEYS.filter(
      (key) => card.source.profile.ratings[key] !== card.effective.ratings[key],
    ),
  );
  const affectedTendencies = $derived(
    HAVOC_TENDENCY_FIELDS.filter(
      (key) => card.source.profile.tendencies[key] !== card.effective.tendencies[key],
    ),
  );
</script>

<article
  class="h-card"
  style:--card-color={HAVOC_TIER_COLORS[card.tier]}
  data-havoc-card={card.cardId}
  data-havoc-tier={card.tier}
>
  <header class="h-card-top">
    <span class="h-eyebrow">{card.slot} · {card.source.originalOverall} OVR</span><HavocTierBadge
      tier={card.tier}
    />
  </header>
  <div class="h-card-art">
    <PlayerArt
      playerId={card.source.playerId}
      playerVersionId={card.source.playerVersionId}
      displayName={card.source.displayName}
      franchiseId={card.source.franchiseId}
      seasonKey={card.source.seasonKey}
      large
    />
  </div>
  <div class="h-card-body">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable player details need keyboard access.) -->
    <div
      class="h-card-scroll"
      role="region"
      aria-label="{card.source.displayName} ratings and powers"
      tabindex="0"
    >
      <div>
        <h3 class="h-card-name">{card.source.displayName}</h3>
        <p class="h-nickname">{card.nickname}</p>
        <p class="h-copy text-xs">
          {card.source.seasonKey ?? ''} · {franchiseName(card.source.franchiseId ?? '')}
        </p>
      </div>
      <HavocMutationList mutations={card.mutations} readable />
      <section aria-label="Affected attributes" data-havoc-affected-attributes>
        <h4 class="h-eyebrow">What changes</h4>
        <p class="h-copy text-xs mb-2">Original → Havoc</p>
        <dl class="h-affected-grid">
          {#each affectedRatings as key (key)}
            <div data-havoc-changed="true" data-havoc-rating={key}>
              <dt>{havocFieldLabel(key)}</dt>
              <dd>
                <span>{card.source.profile.ratings[key]}</span><span aria-hidden="true">→</span
                ><strong
                  class:reduced={card.effective.ratings[key] < card.source.profile.ratings[key]}
                  >{card.effective.ratings[key]}</strong
                >
              </dd>
            </div>
          {/each}
          {#if physical.heightInches !== physical.baselineHeightInches}<div>
              <dt>Height{physical.baselineHeightSource === 'estimated' ? ' (est. base)' : ''}</dt>
              <dd>
                <span>{physical.baselineHeightInches}″</span><span aria-hidden="true">→</span
                ><strong>{physical.heightInches}″</strong>
              </dd>
            </div>{/if}
          {#if physical.wingspanDeltaInches !== 0}<div>
              <dt>Wingspan</dt>
              <dd><strong>+{physical.wingspanDeltaInches}″</strong></dd>
            </div>{/if}
        </dl>
        {#if affectedTendencies.length > 0}<h4 class="h-eyebrow mt-3">Play style changes</h4>
          <dl class="h-affected-grid mt-2">
            {#each affectedTendencies as key (key)}<div>
                <dt>{havocFieldLabel(key)}</dt>
                <dd>
                  <span>{card.source.profile.tendencies[key]}</span><span aria-hidden="true">→</span
                  ><strong>{card.effective.tendencies[key]}</strong>
                </dd>
              </div>{/each}
          </dl>{/if}
        {#if affectedRatings.length === 0 && affectedTendencies.length === 0 && physical.heightInches === physical.baselineHeightInches && physical.wingspanDeltaInches === 0}<p
            class="h-copy text-xs"
          >
            Base attributes stay the same. These powers change the game rules above.
          </p>{/if}
      </section>
      <details>
        <summary>Full player & power details</summary>
        <p class="mb-3" data-havoc-effective-height>
          Height: {physical.heightInches} in · Baseline: {physical.baselineHeightInches} in {#if physical.baselineHeightSource === 'estimated'}<span
              data-havoc-estimated>(estimated)</span
            >{/if} · Wingspan: +{physical.wingspanDeltaInches} in
        </p>
        <dl class="h-rating-grid">
          {#each REQUIRED_RATING_KEYS as key (key)}<div
              data-havoc-rating={key}
              data-havoc-changed={card.source.profile.ratings[key] !== card.effective.ratings[key]
                ? 'true'
                : 'false'}
            >
              <dt>{havocFieldLabel(key)}</dt>
              <dd>
                {#if card.source.profile.ratings[key] !== card.effective.ratings[key]}{card.source
                    .profile.ratings[key]} →
                {/if}{mode === 'effective'
                  ? card.effective.ratings[key]
                  : card.source.profile.ratings[key]}
              </dd>
            </div>{/each}
        </dl>
        {#each card.mutations as entry (entry.mutationId)}
          <p class="mt-3 text-xs">
            {mutationNameOf(entry.mutationId)}: {mutationDescriptionOf(entry.mutationId)}
          </p>
          {#if mutationDownsideOf(entry.mutationId) !== ''}<p class="mt-1 text-xs text-destructive">
              Downside: {mutationDownsideOf(entry.mutationId)}
            </p>{/if}
        {/each}
      </details>
    </div>
    {#if unavailable}<p class="h-copy text-xs mt-2" data-havoc-exclusive-taken>
        One per roster — this power is already on your team.
      </p>{/if}
    <button
      class="h-button"
      disabled={busy || unavailable}
      onclick={() => onPick(card.cardId)}
      aria-label="Draft {card.source.displayName} — {card.nickname}"
      >{unavailable
        ? 'Power already drafted'
        : `Draft ${card.source.displayName.split(' ').at(-1)}`}</button
    >
  </div>
</article>
cle>
