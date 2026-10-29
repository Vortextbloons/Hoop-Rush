import { n } from './core.ts';
import { UsageError } from '../args.ts';
import { capRushCoverage, capRushSeason } from '../commands/cap-rush.ts';

import type { CommandSpec } from './core.ts';

function required(args: Parameters<typeof n>[0], name: string): string {
  const value = n(args, name);
  if (value === null) throw new UsageError(`cap rush requires --${name}`);
  return value;
}

export const capRushCommands: CommandSpec[] = [
  {
    name: 'cap-rush season',
    options: { locked: 'string', out: 'string' },
    run: (args) =>
      capRushSeason({
        locked: required(args, 'locked'),
        out: n(args, 'out'),
      }),
  },
  {
    name: 'cap-rush coverage',
    options: { catalog: 'string' },
    run: (args) =>
      capRushCoverage({
        catalog: required(args, 'catalog'),
      }),
  },
];
