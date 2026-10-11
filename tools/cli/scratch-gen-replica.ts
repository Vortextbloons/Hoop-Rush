import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEASON_COMMITTED_DRAFT_SEED,
  seasonDraftCatalogSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seedSchema,
  type SeasonDraftCommand,
  type SeasonDraftState,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  generateAiLeague,
  legalFiveAfterAnyRemoval,
} from '@hoop-rush/engine';
import { pickBestSelectable } from './src/commands/season-data.ts';

const SEASON_DIR = resolve('..', '..', 'apps', 'web', 'static', 'data', 'season');
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
const league = seasonLeagueSchema.parse(readJson(resolve(SEASON_DIR, 'league.json')));
const catalog = seasonDraftCatalogSchema.parse(readJson(resolve(SEASON_DIR, 'draft-catalog.json')));
const targets = seasonRosterTargetsSchema.parse(
  readJson(resolve(SEASON_DIR, 'roster-targets.json')),
);

const commands: SeasonDraftCommand[] = [];
let state: SeasonDraftState | null = null;
const apply = (command: SeasonDraftCommand): SeasonDraftState => {
  const result = applySeasonDraftCommand(state, catalog, command, {
    generate: (input) => generateAiLeague({ ...input, targets }),
  });
  if (result.record.status !== 'accepted' || result.state === null) {
    throw new Error(`command ${command.commandId} rejected: ${String(result.record.message)}`);
  }
  commands.push(command);
  state = result.state;
  return result.state;
};
state = apply({
  commandId: 'scratch-create',
  expectedRevision: 0,
  payload: {
    kind: 'create-season-draft',
    runId: 'scratch-replica',
    rootSeed: seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
    league,
    humanParticipantIds: ['fixture-human'],
    catalogVersion: 'season-draft-v4',
  },
});
let sequence = 0;
while (state.status === 'drafting' && state.currentTurnParticipantId !== null) {
  const pid = state.currentTurnParticipantId;
  state = apply({
    commandId: `scratch-draw-${String(sequence)}`,
    expectedRevision: state.revision,
    payload: { kind: 'draw-season-offer', participantId: pid },
  });
  const best = pickBestSelectable(state, catalog);
  state = apply({
    commandId: `scratch-pick-${String(sequence)}`,
    expectedRevision: state.revision,
    payload: {
      kind: 'select-draft-player',
      participantId: pid,
      playerVersionId: best.playerVersionId,
    },
  });
  sequence += 1;
}
const finalState = state;
state = apply({
  commandId: 'scratch-finalize',
  expectedRevision: finalState.revision,
  payload: { kind: 'finalize-human-rosters' },
});
const humanRosters = finalState.participants.map((participant) => ({
  franchiseId: participant.franchiseId,
  playerVersionIds: finalState.picks
    .filter((pick) => pick.participantId === participant.participantId)
    .map((pick) => pick.playerVersionId),
}));
const generation = generateAiLeague({
  seed: seedSchema.parse(SEASON_COMMITTED_DRAFT_SEED),
  catalog,
  league,
  humanFranchiseIds: humanRosters.map((roster) => roster.franchiseId),
  humanRosters,
  targets,
});
const playableById = new Map<string, readonly string[]>();
for (const candidate of catalog.candidates) {
  playableById.set(candidate.playerVersionId, candidate.positions.playable);
}
let fragileTeams = 0;
for (const roster of generation.rosters) {
  const members = roster.players.map((player) => ({
    playerVersionId: player.playerVersionId,
    playable: playableById.get(player.playerVersionId) ?? [],
  }));
  const robust = legalFiveAfterAnyRemoval(members as never);
  if (!robust) {
    fragileTeams += 1;
    console.log(`FRAGILE ${roster.franchiseId}`);
    for (const member of members) {
      console.log(`  ${member.playerVersionId}: [${member.playable.join(',')}]`);
    }
  }
}
console.log(`fragile teams: ${String(fragileTeams)} of ${String(generation.rosters.length)}`);
