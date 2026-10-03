<script lang="ts">
  import DifficultyPicker from '$lib/collection/DifficultyPicker.svelte';
  import ObjectivePicker from '$lib/collection/ObjectivePicker.svelte';
  import {
    difficultyOptionViews,
    objectiveOptionViews,
    rewardPreview,
  } from '$lib/collection/collection-setup';
  import type {
    CollectionGameRules,
    CollectionDifficultyId,
    CollectionObjectiveId,
  } from '@hoop-rush/data-contracts';
  import rulesJson from '../../../static/data/collection/game-rules.json';
  import '$lib/collection/ultimate-theme.css';
  const rules = rulesJson as CollectionGameRules;
  let difficultyId = $state<CollectionDifficultyId>('street');
  let selectedObjectiveId = $state<CollectionObjectiveId | null>(null);
  const effectiveObjectiveId = $derived(selectedObjectiveId);
  const difficultyOptions = difficultyOptionViews(rules, ['street', 'pro']);
  const objectiveOptions = $derived(
    objectiveOptionViews({
      rules,
      difficultyId,
      offers: [
        {
          objectiveId: 'obj-own-glass-v1',
          title: 'Own the glass',
          condition: { kind: 'player-rebound-margin-at-least', threshold: 10 },
        },
        {
          objectiveId: 'obj-bench-spark-v1',
          title: 'Bench spark',
          condition: { kind: 'player-bench-points-at-least', threshold: 25 },
        },
        {
          objectiveId: 'obj-three-barrage-v1',
          title: 'Three barrage',
          condition: { kind: 'player-team-three-pointers-made', threshold: 12 },
        },
      ] as Parameters<typeof objectiveOptionViews>[0]['offers'],
    }),
  );
  const preview = $derived(
    rewardPreview({
      rules,
      difficultyId,
      selectedObjectiveId,
      clearedDifficultyIds: ['street', 'pro'],
    }),
  );
  const setupLocked = false;
  const busy = 'idle';
  const prepare = () => {};
  const difficultyNameOf = (id: CollectionDifficultyId) =>
    difficultyOptions.find((o) => o.difficultyId === id)?.displayName;
  const previewIconOf = (kind: string) =>
    kind === 'outcome-win' ? '◉' : kind === 'outcome-loss' ? '×' : kind === 'margin' ? '−' : '★';
</script>

<div class="ultimate-root" style="min-height:100vh;padding:24px;--font-display:'Anton',sans-serif">
  <div class="ur-play-page" style="max-width:1280px;margin:auto">
    <section aria-label="Game setup" class="ur-scout-panel">
      <div class="ur-arcade-banner">
        <div>
          <span class="ur-arcade-eyebrow">Your lineup. Your arena.</span>
          <h2>Choose your matchup</h2>
        </div>
        <svg class="ur-court-stamp" viewBox="0 0 180 90" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="178" height="88" rx="3" />
          <path d="M90 1v88M1 23h28v44H1m178-44h-28v44h28" />
          <circle cx="90" cy="45" r="17" /><path
            d="M29 30a15 15 0 0 1 0 30m122-30a15 15 0 0 0 0 30M1 10a43 43 0 0 1 0 70m178-70a43 43 0 0 0 0 70"
          />
        </svg>
      </div>
      <div class="ur-scout-grid">
        <div class="ur-scout-main">
          <div class="ur-step-head">
            <span class="ur-step-num" aria-hidden="true">01</span>
            <div>
              <h2 class="ur-step-title">Pick your difficulty</h2>
              <p class="ur-step-sub">Raise the stakes. Raise the payout.</p>
            </div>
          </div>
          <DifficultyPicker
            options={difficultyOptions}
            value={difficultyId}
            disabled={setupLocked}
            legend="Difficulty"
            onChange={(id) => {
              if (id !== difficultyId) selectedObjectiveId = null;
              difficultyId = id;
            }}
          />
          <div class="ur-step-head ur-step-head--two">
            <span class="ur-step-num" aria-hidden="true">02</span>
            <div>
              <h2 class="ur-step-title">Add a bonus objective</h2>
            </div>
          </div>
          <ObjectivePicker
            options={objectiveOptions}
            value={effectiveObjectiveId}
            disabled={setupLocked}
            legend="Objective"
            onChange={(id) => {
              selectedObjectiveId = id;
            }}
          />
        </div>
        {#if preview}
          <section aria-label="Reward preview" class="ur-reward-preview">
            <div class="ur-payout-heading">
              <h3 class="ur-reward-title">Coin payout</h3>
              <span>{preview.multiplierLabel}</span>
            </div>
            <div class="ur-reward-max">
              <span>Max possible reward</span>
              <strong class="ur-number">+{preview.maxTotalCoins}</strong>
              <small>COINS</small>
            </div>
            <p class="ur-reward-sub">
              {difficultyNameOf(difficultyId)} · {objectiveOptions.find(
                (option) => option.objectiveId === effectiveObjectiveId,
              )?.title ?? 'No objective'}
            </p>
            <ul class="ur-reward-rows">
              {#each preview.rows as row (row.kind)}
                <li>
                  <span class="ur-reward-icon" aria-hidden="true">{previewIconOf(row.kind)}</span>
                  <span class="ur-reward-copy">
                    <span class="ur-reward-label"
                      >{row.kind === 'first-clear' && preview.firstClearClaimed
                        ? 'First clear claimed'
                        : row.label}</span
                    >
                  </span>
                  <span class="ur-reward-coins" data-zero={row.coins === 0}>
                    {row.coins === 0 ? '—' : `+${row.coins}`}
                  </span>
                </li>
              {/each}
            </ul>
            <details class="ur-payout-details">
              <summary>How rewards work</summary>
              {#each preview.rows as row (row.kind)}<p>
                  <strong>{row.label}:</strong>
                  {row.detail}
                </p>{/each}
              <p>
                Repeat game maximum: {preview.maxRepeatCoins} coins. Win and loss rewards are alternatives.
              </p>
            </details>
            <button
              type="button"
              onclick={prepare}
              disabled={setupLocked}
              class="ur-btn-gold ur-prepare-btn"
            >
              {busy === 'preparing' ? 'Preparing…' : 'Prepare matchup →'}
            </button>
            <p class="ur-reward-lock" aria-live="polite">
              Setup locks on prepare. Abandoning uses a new matchup.
            </p>
          </section>
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .result-navigation {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.75rem;
  }
  .result-navigation button {
    min-height: 2.75rem;
    padding: 0.55rem 1.1rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 0.4rem;
    color: var(--ur-muted);
    background: var(--ur-bg);
    font-weight: 800;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .result-navigation button[aria-pressed='true'] {
    color: #101a23;
    background: var(--ur-apex);
    border-color: var(--ur-apex);
  }
  .result-navigation button:focus-visible {
    outline: 2px solid var(--ur-focus);
    outline-offset: 3px;
  }
  .replay-player {
    max-width: 24rem;
    margin-top: 1rem;
  }
  .replay-clock {
    margin-top: 0.7rem;
    color: var(--ur-apex);
    font:
      800 1.2rem ui-monospace,
      monospace;
  }
  .replay-disclaimer {
    margin: 1rem 0;
    color: var(--ur-muted);
    font-size: 0.8rem;
  }
  .replay-scrubber {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1rem;
    color: var(--ur-muted);
    font-size: 0.75rem;
  }
  .replay-scrubber input {
    flex: 1;
    min-width: 8rem;
    accent-color: var(--ur-apex);
    height: 2rem;
    cursor: pointer;
  }
  .scorer-spotlight {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  .scorer-spotlight p {
    color: var(--ur-muted);
    font-size: 0.7rem;
    margin-bottom: 0.5rem;
  }
  .box-player {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 9rem;
    padding: 0.4rem 0;
  }
  .box-player small {
    display: block;
    color: var(--ur-muted);
    font-size: 0.6rem;
    font-weight: 500;
  }
  .box-card-symbol > img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .box-card-symbol :global(> div) {
    width: 100%;
    height: 100%;
    background: transparent;
  }
  .box-card-symbol {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 2.25rem;
    border: 1px solid var(--ur-apex);
    border-radius: 0.25rem;
    color: var(--ur-apex);
    background: #ffcd5910;
    overflow: hidden;
    font-size: 0.65rem;
  }
  @media (max-width: 520px) {
    .scorer-spotlight {
      grid-template-columns: 1fr;
    }
  }

  .ur-mode-switch {
    margin-top: 1rem;
  }
  .ur-mode-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .mode-pill {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    padding: 0.55rem 1.15rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line-strong));
    border-radius: 0.55rem;
    background: linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 40%), var(--ur-surface);
    color: var(--ur-muted);
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%);
  }
  .mode-pill.mode-active,
  input:checked + .mode-pill {
    border-color: #ff7a2f;
    background:
      linear-gradient(180deg, rgb(255 218 115 / 22%), rgb(255 197 61 / 10%)), var(--ur-raised);
    color: #ffb37a;
    box-shadow:
      0 0 1rem rgb(255 110 30 / 20%),
      inset 0 1px 0 rgb(255 255 255 / 8%);
  }
  input:focus-visible + .mode-pill {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }
  input:disabled + .mode-pill {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .ur-page-description {
    max-width: 58ch;
    margin-top: 0.45rem;
    color: var(--ur-muted);
    font-size: 0.9rem;
  }

  .ur-pregame-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 1.5rem;
    margin-bottom: 1.1rem;
    padding: clamp(1.1rem, 3vw, 1.8rem);
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line));
    border-radius: 0.9rem;
    background:
      radial-gradient(ellipse 55% 80% at 50% 0%, rgb(255 196 64 / 22%), transparent 62%),
      radial-gradient(ellipse 40% 60% at 88% 30%, rgb(255 122 26 / 16%), transparent 60%),
      linear-gradient(180deg, #181f25, #0b0f13 70%);
    box-shadow:
      0 1.2rem 2.6rem rgb(0 0 0 / 45%),
      inset 0 1px 0 rgb(255 255 255 / 8%);
  }
  .ur-pregame-kicker {
    margin: 0;
    color: var(--ur-apex);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  .ur-pregame-title {
    margin: 0.3rem 0 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 5.5vw, 3.4rem);
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 0.95;
    text-shadow: 0 2px 18px rgb(0 0 0 / 60%);
  }
  .ur-pregame-hero .ur-page-description {
    max-width: 52ch;
    margin-top: 0.55rem;
  }
  .ur-pregame-status {
    display: grid;
    gap: 0.3rem;
    min-width: min(16rem, 100%);
    padding: 0.8rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 35%, var(--ur-line));
    border-radius: 0.7rem;
    background: rgb(6 9 12 / 68%);
  }
  .ur-pregame-status strong {
    color: #fff;
    font-size: 1rem;
  }
  .ur-pregame-status small {
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-clear-dots {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.3rem;
  }
  .ur-clear-dots i {
    width: 1.6rem;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--ur-line-strong);
  }
  .ur-clear-dots i[data-done='true'] {
    background: linear-gradient(90deg, #e9a91f, var(--ur-apex));
    box-shadow: 0 0 8px rgb(255 197 61 / 50%);
  }

  .ur-gamecast {
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
    padding: clamp(0.75rem, 2vw, 1.25rem);
  }

  .ur-broadcast-mast {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    padding: 0.8rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 24%, var(--ur-line));
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
    background: linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 40%), var(--ur-surface);
  }

  .ur-broadcast-note {
    margin: 0;
    color: var(--ur-muted);
    font-size: 0.82rem;
  }

  .ur-scoreboard {
    overflow: hidden;
    padding: clamp(1rem, 3vw, 1.8rem);
    border: 1px solid color-mix(in srgb, var(--ur-apex) 32%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 7%), transparent 26%),
      linear-gradient(
        90deg,
        transparent 49.8%,
        color-mix(in srgb, var(--ur-paper) 8%, transparent) 50%,
        transparent 50.2%
      ),
      repeating-linear-gradient(
        0deg,
        transparent 0 31px,
        color-mix(in srgb, var(--ur-paper) 4%, transparent) 32px
      ),
      radial-gradient(
        ellipse at 50% 0%,
        color-mix(in srgb, var(--ur-apex) 14%, transparent),
        transparent 62%
      ),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 2rem rgb(255 197 61 / 8%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-play-again {
    min-height: 2.75rem;
    padding: 0.6rem 1rem;
    border: 1px solid var(--ur-apex);
    border-radius: 0.55rem;
    background: linear-gradient(180deg, #ffda73, var(--ur-apex));
    color: #241a02;
    font-size: 0.86rem;
    font-weight: 900;
    box-shadow:
      0 0.4rem 1.2rem rgb(245 184 31 / 35%),
      inset 0 1px 0 rgb(255 255 255 / 55%);
  }

  .ur-play-again:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .ur-scoreline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(0.65rem, 5vw, 3rem);
    padding-block: clamp(1.3rem, 5vw, 3rem);
    border-block: 1px solid var(--ur-line-strong);
    margin-block: 1rem;
  }

  .ur-scoreline > div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
  }

  .ur-scoreline > div > span {
    color: var(--ur-muted);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .ur-scoreline strong {
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(3.7rem, 13vw, 7rem);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    line-height: 0.95;
    text-shadow: 0 2px 24px rgb(0 0 0 / 65%);
  }

  .ur-score-divider {
    color: var(--ur-line-strong);
    font-family: var(--font-display);
    font-size: clamp(2rem, 8vw, 4rem);
  }

  .ur-gamecast-controls {
    display: flex;
    justify-content: flex-start;
    margin-top: 1rem;
    padding-block: 0.75rem;
    border-block: 1px solid var(--ur-line);
  }

  .ur-recorded-events li {
    border: 1px solid var(--ur-line);
    border-inline-start: 2px solid var(--ur-apex);
    border-radius: 0.6rem;
    background: var(--ur-surface);
    padding: 0.6rem 0.75rem;
  }

  .ur-gamecast .rounded-xl.bg-surface-2 {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 22%, var(--ur-line));
    border-radius: 0.75rem;
    background: var(--ur-surface);
  }

  .ur-play-page section[aria-label='Game setup'],
  .ur-play-page section[aria-label='Challenge browser'] {
    padding: clamp(1rem, 2.5vw, 1.5rem);
  }

  .ur-reward-preview {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 34%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(105deg, color-mix(in srgb, var(--ur-apex) 14%, transparent), transparent 62%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 2rem rgb(255 197 61 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-reward-title {
    font-size: 1.1rem;
  }

  .ur-reward-preview li,
  .ur-selected-challenge li {
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
  }

  .ur-selected-challenge {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-selected-challenge:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  .ur-challenge-grid > :global(*) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%) !important;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%) !important;
  }

  .ur-play-page :global(fieldset .card) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 35%), var(--ur-raised) !important;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%) !important;
  }

  .ur-play-page :global(fieldset input:checked + .card) {
    border-color: var(--ur-apex) !important;
    background:
      linear-gradient(180deg, rgb(255 218 115 / 16%), rgb(255 197 61 / 7%)), var(--ur-raised) !important;
    box-shadow:
      0 0 1.2rem rgb(255 197 61 / 18%),
      inset 0 1px 0 rgb(255 255 255 / 8%) !important;
  }

  .ur-play-page :global(fieldset input:focus-visible + .card) {
    outline: 3px solid var(--ur-focus) !important;
    outline-offset: 2px !important;
  }

  .ur-play-page :global(.ur-matchup-report) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
  }

  .ur-play-page :global(.ur-reward-receipt) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
    background:
      linear-gradient(105deg, color-mix(in srgb, var(--ur-apex) 14%, transparent), transparent 62%),
      linear-gradient(165deg, #141c21, #0b1114 75%) !important;
    box-shadow:
      0 0 2rem rgb(255 197 61 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 6%) !important;
  }

  .ur-play-page :global(.ur-reward-receipt .ur-receipt-total) {
    border: 1px solid var(--ur-apex) !important;
    border-radius: 0.75rem !important;
    background: linear-gradient(180deg, #ffda73, var(--ur-apex)) !important;
    color: #241a02 !important;
  }

  .ur-play-page :global(.ur-reward-receipt .ur-receipt-total span) {
    color: #241a02 !important;
  }

  .ur-play-page .rounded-xl.bg-surface-2 {
    border-radius: 0.75rem;
  }

  .ur-play-page table {
    border-collapse: collapse;
  }

  .ur-play-page tbody tr {
    border-top: 1px solid var(--ur-line);
  }

  .ur-play-page th,
  .ur-play-page td {
    padding-block: 0.4rem;
  }

  .ur-scout-panel {
    margin-top: 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line-strong));
    border-radius: 0.9rem;
    background: radial-gradient(ellipse at 0 0, rgb(105 216 238 / 6%), transparent 60%), #0c121a;
    box-shadow:
      0 1.2rem 2.5rem rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
    padding: clamp(1rem, 2.6vw, 1.6rem);
  }
  .ur-scout-grid {
    display: grid;
    gap: 1.4rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 18rem);
    align-items: start;
  }
  .ur-scout-main {
    display: grid;
    gap: 1.2rem;
    min-width: 0;
  }
  .ur-step-head {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .ur-step-head--two {
    margin-top: 0.2rem;
    padding-top: 1.1rem;
    border-top: 1px solid var(--ur-line);
  }
  .ur-step-num {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex: none;
    border: 1px solid var(--ur-line);
    border-radius: 0.35rem;
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 1rem;
  }
  .ur-step-title {
    margin: 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 850;
    text-transform: uppercase;
  }
  .ur-step-sub {
    margin: 0.15rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .ur-reward-preview {
    position: sticky;
    top: 1rem;
    padding: 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 38%, var(--ur-line-strong));
    border-radius: 0.8rem;
    background:
      linear-gradient(165deg, #171310, #0e0c0a 75%), linear-gradient(165deg, #141c21, #0b1114);
    box-shadow:
      0 0 2rem rgb(255 150 40 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }
  .ur-reward-title {
    margin: 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.02rem;
    font-weight: 850;
  }
  .ur-reward-sub {
    margin: 0.25rem 0 0;
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-reward-rows {
    display: grid;
    gap: 0.45rem;
    margin: 0.8rem 0 0;
    padding: 0;
    list-style: none;
  }
  .ur-reward-rows li {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
    background: rgb(6 9 12 / 55%);
  }
  .ur-reward-icon {
    display: grid;
    width: 1.7rem;
    height: 1.7rem;
    flex: none;
    place-items: center;
    border-radius: 999px;
    background: rgb(255 197 61 / 12%);
    color: var(--ur-apex);
    font-size: 0.8rem;
    font-weight: 900;
  }
  .ur-reward-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }
  .ur-reward-label {
    color: var(--ur-paper);
    font-size: 0.8rem;
    font-weight: 800;
  }

  .ur-reward-coins {
    flex: none;
    color: var(--ur-apex);
    font-size: 0.84rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .ur-reward-coins[data-zero='true'] {
    color: var(--ur-muted);
  }

  .ur-prepare-btn {
    width: 100%;
    margin-top: 0.8rem;
  }
  .ur-reward-lock {
    margin: 0.55rem 0 0;
    color: var(--ur-muted);
    font-size: 0.68rem;
    text-align: center;
  }
  .ur-arcade-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding-bottom: 1.3rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--ur-line);
  }
  .ur-arcade-eyebrow {
    color: #69d8ee;
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }
  .ur-arcade-banner h2 {
    margin-top: 0.3rem;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 3vw, 2.6rem);
    text-transform: uppercase;
    line-height: 1.1;
  }
  .ur-court-stamp {
    width: 9rem;
    flex: none;
    stroke: #69d8ee;
    opacity: 0.35;
    stroke-width: 1.5;
    transform: rotate(-6deg);
  }
  .ur-payout-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .ur-payout-heading > span {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--ur-gold-line);
    border-radius: 0.3rem;
    color: var(--ur-apex);
    font-size: 0.75rem;
    font-weight: 800;
  }
  .ur-reward-max {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    margin: 1rem 0;
    padding: 1.1rem 0.5rem;
    border: 1px solid var(--ur-gold-line);
    border-radius: 0.4rem;
    background:
      repeating-linear-gradient(
        0deg,
        transparent,
        transparent 3px,
        rgb(255 197 61 / 3%) 3px,
        rgb(255 197 61 / 3%) 4px
      ),
      #080b0e;
  }
  .ur-reward-max > span {
    color: var(--ur-muted);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .ur-reward-max strong {
    color: #ffd65a;
    font-family: var(--font-display);
    font-size: 4rem;
    line-height: 1.2;
    text-shadow: 0 0 24px rgb(255 197 61 / 20%);
  }
  .ur-reward-max small {
    color: var(--ur-apex);
    font-size: 0.6rem;
    letter-spacing: 0.25em;
  }
  .ur-payout-details {
    margin-top: 0.85rem;
    color: var(--ur-muted);
    font-size: 0.68rem;
  }
  .ur-payout-details summary {
    cursor: pointer;
    padding: 0.2rem 0;
  }
  .ur-payout-details p {
    margin-top: 0.5rem;
    line-height: 1.5;
  }
  .ur-payout-details summary:focus-visible {
    outline: 2px solid var(--ur-focus);
    outline-offset: 3px;
  }
  @media (max-width: 560px) {
    .ur-court-stamp {
      width: 5rem;
    }
    .ur-arcade-banner {
      gap: 0.5rem;
    }
  }
  .ur-pending-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line));
    border-radius: 0.8rem;
    background: #10171c;
  }
  .ur-start-sim {
    min-width: 12rem;
  }
  .ur-pending-note {
    color: var(--ur-muted);
    font-size: 0.72rem;
  }
  .ur-final-board {
    text-align: center;
  }
  .ur-final-kicker {
    margin: 0;
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .ur-final-kicker span:last-child {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 900;
    letter-spacing: -0.02em;
  }
  .ur-final-coins {
    margin: 0.2rem 0 0;
    color: var(--ur-success);
    font-size: 0.9rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .ur-quarter-strip {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    margin: 0.9rem 0 0;
    padding: 0;
    list-style: none;
  }
  .ur-quarter-strip li {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.45rem;
    background: rgb(6 9 12 / 55%);
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-quarter-strip strong {
    color: var(--ur-paper);
  }
  .ur-final-meta {
    margin: 0.6rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .ur-control-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }
  .ur-speed-pills {
    display: flex;
    gap: 0.4rem;
  }
  .ur-speed-pill {
    min-height: 2.5rem;
    padding: 0.45rem 0.95rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line));
    border-radius: 0.55rem;
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .ur-speed-pill[data-active='true'] {
    border-color: var(--ur-apex);
    background: linear-gradient(180deg, #ffda73, var(--ur-apex));
    color: #241a02;
  }
  .ur-replay-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .ur-replay-primary {
    min-height: 2.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--ur-apex);
    border-radius: 0.55rem;
    background: linear-gradient(180deg, #ffda73, var(--ur-apex));
    color: #241a02;
    font-size: 0.8rem;
    font-weight: 900;
  }
  .ur-replay-btn {
    min-height: 2.5rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line));
    border-radius: 0.55rem;
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .ur-replay-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .ur-event-meta {
    margin: 0.6rem 0 0;
    color: var(--ur-muted);
    font-size: 0.74rem;
  }
  .ur-recorded-events {
    display: grid;
    gap: 0.3rem;
    max-height: 18rem;
    margin: 0.6rem 0 0;
    padding: 0 0.15rem 0.15rem 0;
    overflow-y: auto;
    list-style: none;
  }
  .ur-recorded-events li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-size: 0.78rem;
  }
  .ur-event-q {
    flex: none;
    min-width: 1.8rem;
    color: var(--ur-apex);
    font-size: 0.68rem;
    font-weight: 900;
  }
  .ur-facts-grid {
    display: grid;
    gap: 0.8rem;
    margin-top: 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ur-facts-panel {
    padding: 0.9rem 1rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.7rem;
    background: #10171c;
    font-size: 0.8rem;
  }
  .ur-facts-panel h3 {
    margin: 0 0 0.45rem;
    color: #fff;
    font-size: 0.84rem;
    font-weight: 850;
  }
  .ur-facts-panel ul {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--ur-muted);
  }
  .ur-facts-panel p {
    margin: 0;
    color: var(--ur-muted);
  }
  .ur-play-again--mast {
    min-height: 2.5rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-play-page :global(*) {
      animation: none !important;
      transition: none !important;
    }

    .mode-pill {
      transition: none;
    }
  }

  @media (max-width: 1080px) {
    .ur-scout-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .ur-reward-preview {
      position: static;
    }
  }

  @media (max-width: 520px) {
    .ur-pregame-hero {
      flex-direction: column;
      align-items: flex-start;
    }

    .ur-pregame-status {
      width: 100%;
    }

    .ur-control-bar {
      flex-direction: column;
      align-items: stretch;
    }

    .ur-facts-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .ur-gamecast-controls {
      justify-content: flex-start;
    }
  }
</style>
