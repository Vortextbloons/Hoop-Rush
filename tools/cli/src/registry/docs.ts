import { pickU } from './core.ts';
import { combineDocs } from '../commands/docs-combine.ts';

import type { CommandSpec } from './core.ts';

export const docsCommands: CommandSpec[] = [
  {
    name: 'combine docs',
    options: { input: 'string', output: 'string', exceptions: 'string' },
    help: `  combine docs           Combine every markdown file under the docs directory
                         into one file in the docs root (outside subfolders).
                         --input <dir>        Docs directory (default Docs/)
                         --output <path>      Combined file (default <dir>/combined.md)
                         --exceptions <path>  Exclusion list, one relative path per
                                              line, # comments allowed (default
                                              <dir>/combine-exceptions.txt)`,
    run: (args) => combineDocs(pickU(args, ['input', 'output', 'exceptions'])),
  },
];
