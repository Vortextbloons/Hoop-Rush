import { expect, test } from 'bun:test';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtTeamDetail from './FullCourtTeamDetail.svelte';
import { fullCourtTestSeasonLock } from './full-court-test-support.ts';

function draftFixture(): {
  draft: ReturnType<typeof createFullCourtDraftState>;
  index: FullCourtCatalogIndex;
} {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-team-detail'),
      runId: idSchema.parse('run-team-detail'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'standard',
      catalog: source,
    }),
    index,
  );
  return { draft, index };
}

test('the team menu opens a scouting popup for the user roster when the draft is available', () => {
  const team = fullCourtTestSeasonLock().season.teams[0];
  if (team === undefined) throw new Error('Missing test team');
  const { draft, index } = draftFixture();

  const body = render(FullCourtTeamDetail, {
    props: {
      team,
      standing: null,
      scores: [],
      isUserTeam: true,
      draft,
      index,
    },
  }).body;

  expect(body).toContain('aria-haspopup="dialog"');
  expect(body).toContain(`aria-label="View ${team.roster[0]?.displayName ?? ''} scouting report"`);
});

test('opponent rosters stay read-only without the user draft', () => {
  const team = fullCourtTestSeasonLock().season.teams[0];
  if (team === undefined) throw new Error('Missing test team');

  const body = render(FullCourtTeamDetail, {
    props: { team, standing: null, scores: [], isUserTeam: false },
  }).body;

  expect(body).not.toContain('aria-haspopup="dialog"');
});
