import {
  LINEUP_STRUCTURE,
  type Position,
  type SeasonGameSideTeamInputMember,
} from '@hoop-rush/data-contracts';
import { canPlay, enumerateLegalFives } from '@hoop-rush/engine';
import {
  createSeasonBlockRunner,
  runnerPipelineInput,
  runnerBlockCommand,
  type SeasonBlockRunnerState,
} from './src/commands/season-block.ts';

const state: SeasonBlockRunnerState = createSeasonBlockRunner({
  runPath: 'src/fixtures/season-run.json',
});
const blockIndex = 0;
const command = runnerBlockCommand(state, blockIndex);
const input = runnerPipelineInput(state, command);

const positions = new Map<string, readonly Position[]>();
for (const player of input.expanded.values()) {
  positions.set(player.playerVersionId, player.positions);
}
const rotationByFranchise = new Map(
  input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
);

for (const roster of input.run.rosters) {
  const rotation = rotationByFranchise.get(roster.franchiseId);
  const rotationIds = rotation === undefined ? [] : [...rotation.starters, ...rotation.benchOrder];
  const members = roster.players.map((player) => ({
    playerVersionId: player.playerVersionId,
    playerId: player.playerId,
    playable: positions.get(player.playerVersionId) ?? [],
  }));
  const rotationMembers = members.filter((member) => rotationIds.includes(member.playerVersionId));
  const byPosition = new Map<string, number>();
  for (const member of rotationMembers) {
    for (const pos of member.playable) {
      byPosition.set(pos, (byPosition.get(pos) ?? 0) + 1);
    }
  }
  const legalFives = enumerateLegalFives(
    rotationMembers,
    new Set(rotationMembers.map((member) => member.playerVersionId)),
  );
  const startersLegal =
    rotation !== undefined &&
    rotation.starters.length === LINEUP_STRUCTURE.length &&
    rotation.starters.every((id, slot) => {
      const member = rotationMembers.find((m) => m.playerVersionId === id);
      const requirement = LINEUP_STRUCTURE[slot];
      return (
        member !== undefined && requirement !== undefined && canPlay(member.playable, requirement)
      );
    });
  const flag =
    legalFives.length === 0
      ? ' *** NO LEGAL FIVE ***'
      : startersLegal
        ? ''
        : ' (starters illegal, contingency exists)';
  console.log(
    `${roster.franchiseId}: roster=${String(roster.players.length)} rotation=${String(rotationIds.length)} legalFives=${String(legalFives.length)} startersLegal=${String(startersLegal)} posCounts={${[...byPosition.entries()].map(([k, v]) => `${k}:${String(v)}`).join(',')}}${flag}`,
  );
  if (legalFives.length === 0) {
    for (const member of rotationMembers) {
      console.log(`    ${member.playerId}: playable=[${member.playable.join(',')}]`);
    }
  }
}
