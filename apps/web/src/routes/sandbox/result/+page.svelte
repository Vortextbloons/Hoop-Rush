<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { ChallengeRun, PeakPlayerSeason } from '@hoop-rush/data-contracts';
  import type { SandboxHref } from '$lib/sandbox-url';
  import { lineupPlayersFromRun } from '$lib/sandbox-lineup';
  import { startSandboxRun } from '$lib/sandbox-run';
  import { buildSandboxHref, generateSeed } from '$lib/sandbox-url';
  import ResultPage from '$lib/components/ResultPage.svelte';
  async function runAgain() {
    void goto(resolve('/sandbox'));
  }
  async function retrySameTeam(
    currentRun: ChallengeRun,
    playersById: Map<string, PeakPlayerSeason>,
  ) {
    const players = lineupPlayersFromRun(currentRun, playersById);
    if (!players) {
      throw new Error('Could not restore the lineup for another run.');
    }
    await startSandboxRun(players, generateSeed());
  }
  function editTeamHrefFor(current: ChallengeRun): SandboxHref | null {
    return current.mode === 'sandbox' && current.selections
      ? buildSandboxHref(current.selections)
      : null;
  }
</script>

<svelte:head>
  <title>Challenge result — Sandbox — Hoop Rush</title>
</svelte:head>

<ResultPage
  mode="sandbox"
  eyebrow="Sandbox · Result"
  modeLabelFor={() => 'Sandbox · Result'}
  onRunAgain={runAgain}
  onRetrySameTeam={retrySameTeam}
  {editTeamHrefFor}
/>
