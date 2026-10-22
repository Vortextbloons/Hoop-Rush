<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';
  import { Zap } from '@lucide/svelte';
  import { mutationNameOf, mutationTierOf, formatSignedPoints } from './havoc-presentation';
  let { comparison }: { comparison: HavocComparison } = $props();
</script>

<section class="mt-8" aria-labelledby="havoc-ability-heading" data-havoc-ability-report>
  <p class="h-eyebrow">The powers behind the season</p>
  <h2 id="havoc-ability-heading" class="h-subtitle mt-2">Abilities in action</h2>
  <p class="h-copy mt-2">
    Recorded effects across all 82 games. Direct power points are score adjustments, not every
    basket helped by an ability.
  </p>
  {#if comparison.mutations.length === 0}<p class="h-copy mt-4">
      No ability activity was recorded for this season.
    </p>
  {:else}
    <ul class="h-ability-list mt-4">
      {#each comparison.mutations as power (power.mutationId)}
        <li class="h-panel" data-havoc-ability={power.mutationId}>
          <div class="flex items-center gap-3">
            <Zap size={18} color="#ffd782" />
            <h3 class="h-subtitle">{mutationNameOf(power.mutationId)}</h3>
            <span class="h-copy text-xs ml-auto"
              >{power.ownerCount} {power.ownerCount === 1 ? 'player' : 'players'}</span
            >
          </div>
          {#if mutationTierOf(power.mutationId) === 1}
            <p class="h-copy text-xs mt-3">
              Attribute ability · works through the player's changed ratings or physical dimensions.
            </p>
          {:else}
            <dl class="h-ability-effects mt-4">
              <div>
                <dt>Activations</dt>
                <dd>{power.triggers}</dd>
              </div>
              <div>
                <dt>Direct power points</dt>
                <dd class:negative={power.pointsDelta < 0}>
                  {formatSignedPoints(power.pointsDelta)}
                </dd>
              </div>
              {#if power.freeThrowsGranted > 0}<div>
                  <dt>Free throws granted</dt>
                  <dd>{power.freeThrowsGranted}</dd>
                </div>{/if}
              {#if power.turnoversCancelled > 0}<div>
                  <dt>Turnovers saved</dt>
                  <dd>{power.turnoversCancelled}</dd>
                </div>{/if}
              {#if power.extraPossessionsEarned > 0}<div>
                  <dt>Extra possessions earned</dt>
                  <dd>{power.extraPossessionsEarned}</dd>
                </div>
                <div>
                  <dt>Extra possessions used</dt>
                  <dd>{power.extraPossessionsUsed}</dd>
                </div>{/if}
              {#if power.extraPossessionsExpired > 0}<div>
                  <dt>Extra possessions expired</dt>
                  <dd>{power.extraPossessionsExpired}</dd>
                </div>{/if}
              {#if power.swapPoints !== 0}<div>
                  <dt>Points in stolen body</dt>
                  <dd class:negative={power.swapPoints < 0}>
                    {formatSignedPoints(power.swapPoints)}
                  </dd>
                </div>{/if}
              {#if power.swapSeconds > 0}<div>
                  <dt>Ratings swapped</dt>
                  <dd>{power.swapSeconds}s</dd>
                </div>{/if}
              {#if power.capSeconds > 0}<div>
                  <dt>Ratings capped</dt>
                  <dd>{power.capSeconds}s</dd>
                </div>{/if}
              {#if power.ratingChanges > 0}<div>
                  <dt>Rating changes</dt>
                  <dd>{power.ratingChanges}</dd>
                </div>{/if}
            </dl>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .h-ability-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .h-ability-list h3 {
    font-size: 1.5rem;
  }
  .h-ability-effects {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .h-ability-effects dt {
    color: #c1cae4;
    font-size: 11px;
  }
  .h-ability-effects dd {
    font-family: var(--font-display);
    font-size: 1.8rem;
    color: #ffd782;
    font-weight: 800;
  }
  .h-ability-effects .negative {
    color: #f290c5;
  }
  @media (max-width: 760px) {
    .h-ability-list {
      grid-template-columns: 1fr;
    }
  }
</style>
