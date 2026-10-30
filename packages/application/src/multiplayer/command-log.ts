export interface CommandLogMerge<TCommand> {
  commands: TCommand[];
  complete: boolean;
}

export function mergeCommandLog<TCommand>(input: {
  local: readonly TCommand[];
  fetched: readonly TCommand[];
  expectedCount: number;
  ordinalOf?: (command: TCommand) => number;
}): CommandLogMerge<TCommand> {
  const commands =
    input.fetched.length === 0 ? [...input.local] : [...input.local, ...input.fetched];
  const ordered =
    input.ordinalOf === undefined
      ? true
      : commands.every((command, index) => input.ordinalOf?.(command) === index);
  return { commands, complete: commands.length === input.expectedCount && ordered };
}
