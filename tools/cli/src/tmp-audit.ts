import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canPlay, LINEUP_STRUCTURE, opponentBracketSchema } from '@hoop-rush/data-contracts';
import { REPO_ROOT } from './commands/data-loader.ts';
import { validateBracketContent } from '../../../packages/engine/src/challenge/commands.ts';

const bracket = opponentBracketSchema.parse(
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
  ) as unknown,
);

console.log('bracketVersion', bracket.bracketVersion);
const failures = validateBracketContent(bracket);
console.log('content failures', failures);

let arrayOrderLegal = 0;
for (const o of bracket.opponents) {
  const bySlot = new Map(o.lineup.assignments.map((a) => [a.slotIndex, a.playerId]));
  const arrayMatchesSlot = o.players.every(
    (p, i) => bySlot.get(i as 0 | 1 | 2 | 3 | 4) === p.playerId,
  );
  const legalByArray = o.players.every((p, i) => {
    const slot = LINEUP_STRUCTURE[i];
    return slot !== undefined && canPlay(p.positions, slot);
  });
  if (legalByArray) arrayOrderLegal += 1;
  const line = o.players
    .map((p, i) => {
      const slot = LINEUP_STRUCTURE[i];
      const ok = slot !== undefined && canPlay(p.positions, slot);
      return `${slot}:${p.displayName.split(' ').slice(-1)[0]}(${p.positions.join('/')})${ok ? '' : '!!'}`;
    })
    .join(' ');
  console.log(
    `${o.displayName.padEnd(26)} arr==slot:${String(arrayMatchesSlot).padEnd(5)} legalArr:${String(legalByArray).padEnd(5)} ${line}`,
  );
}
console.log(`\nteams whose players array is legal in slot order: ${arrayOrderLegal}/30`);
