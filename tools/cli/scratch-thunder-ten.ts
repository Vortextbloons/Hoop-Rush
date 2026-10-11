import { type Position } from '@hoop-rush/data-contracts';
import { enumerateLegalFives, legalFiveAfterAnyRemoval } from '@hoop-rush/engine';
import {
  createSeasonBlockRunner,
  runnerBlockCommand,
  runnerPipelineInput,
} from './src/commands/season-block.ts';

const state = createSeasonBlockRunner({ runPath: 'src/fixtures/season-run.json' });
const command = runnerBlockCommand(state, 0);
const input = runnerPipelineInput(state, command);

const expandedPositions = new Map<string, readonly Position[]>();
for (const player of input.expanded.values()) {
  expandedPositions.set(player.playerVersionId, player.positions);
}
const catalogPlayable = new Map<string, readonly Position[]>();
for (const player of input.catalog.candidates ?? []) {
  catalogPlayable.set(player.playerVersionId, player.positions.playable);
}
const roster = input.run.rosters.find((entry) => entry.franchiseId === 'thunder');
const rotation = input.run.rotations.find((entry) => entry.franchiseId === 'thunder');
if (roster === undefined || rotation === undefined) throw new Error('thunder missing');
const rotationIds = new Set([...rotation.starters, ...rotation.benchOrder]);
const members = roster.players
  .filter((player) => rotationIds.has(player.playerVersionId))
  .map((player) => ({
    playerVersionId: player.playerVersionId,
    playable: expandedPositions.get(player.playerVersionId) ?? [],
  }));

console.log('rotation starters:', rotation.starters.join(','));
console.log('bench order:', rotation.benchOrder.join(','));
for (const member of members) {
  const catalog = catalogPlayable.get(member.playerVersionId);
  console.log(
    `${member.playerVersionId} expanded=[${member.playable.join(',')}] catalog=[${(catalog ?? []).join(',')}]`,
  );
}
console.log('legalFiveExists(members):', String(legalFiveAfterAnyRemoval(members)));
for (let remove = 0; remove < members.length; remove += 1) {
  const remaining = members.filter((_, index) => index !== remove);
  const fives = enumerateLegalFives(remaining, new Set(remaining.map((m) => m.playerVersionId)));
  if (fives.length === 0) {
    console.log(`REMOVAL ${String(remove)} (${members[remove]?.playerVersionId}) breaks legality`);
  }
}
