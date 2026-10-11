import {
  createSeasonBlockRunner,
  runnerBlockCommand,
  runnerPipelineInput,
} from './src/commands/season-block.ts';

const state = createSeasonBlockRunner({ runPath: 'src/fixtures/season-run.json' });
const command = runnerBlockCommand(state, 0);
const input = runnerPipelineInput(state, command);
const p = input.profile.parameters as Record<string, number>;
const interesting = Object.entries(p).filter(([key]) => key.toLowerCase().includes('foul'));
console.log('profileVersion:', input.profile.profileVersion);
for (const [key, value] of interesting) {
  console.log(`${key} = ${String(value)}`);
}
console.log('leagueFtaPerFga =', String((p as Record<string, unknown>).leagueFtaPerFga));
console.log('all parameters:', JSON.stringify(p, null, 2));
