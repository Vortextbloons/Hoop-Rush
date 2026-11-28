<script lang="ts">
  import type { SimulationPlayer } from '@hoop-rush/data-contracts';
  import { Compass, Crown, Target } from '@lucide/svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtOffensiveHierarchyDraft } from './full-court-coaching-presenter.ts';
  import FullCourtRoleCards from './FullCourtRoleCards.svelte';

  const ROLES = [
    {
      key: 'primaryPlayerId',
      label: 'Primary option',
      hint: 'Gets the strongest boost to scoring opportunities.',
      icon: Crown,
    },
    {
      key: 'secondaryPlayerId',
      label: 'Second option',
      hint: 'Takes a moderate share behind the primary option.',
      icon: Target,
    },
    {
      key: 'floorGeneralPlayerId',
      label: 'Floor general',
      hint: 'Starts more possessions and looks to pass. Can also be a scoring option.',
      icon: Compass,
    },
  ] as const satisfies readonly {
    key: keyof FullCourtOffensiveHierarchyDraft;
    label: string;
    hint: string;
    icon: typeof Crown;
  }[];

  let {
    hierarchy,
    roster,
    art = null,
    locked = false,
    onChange,
  }: {
    hierarchy: FullCourtOffensiveHierarchyDraft;
    roster: readonly SimulationPlayer[];
    art?: FullCourtArt | null;
    locked?: boolean;
    onChange: (role: keyof FullCourtOffensiveHierarchyDraft, playerId: string | null) => void;
  } = $props();

  function excludedFor(role: keyof FullCourtOffensiveHierarchyDraft): readonly string[] {
    if (role === 'primaryPlayerId') {
      return hierarchy.secondaryPlayerId === null ? [] : [hierarchy.secondaryPlayerId];
    }
    if (role === 'secondaryPlayerId') {
      return hierarchy.primaryPlayerId === null ? [] : [hierarchy.primaryPlayerId];
    }
    return [];
  }
</script>

<FullCourtRoleCards
  roles={ROLES}
  values={hierarchy}
  {roster}
  {art}
  {locked}
  excludedIds={excludedFor}
  {onChange}
/>
