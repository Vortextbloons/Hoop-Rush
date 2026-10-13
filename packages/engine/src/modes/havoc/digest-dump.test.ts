import { it } from 'vitest';
import {
  buildHavocGameInput as buildFixtureGameInput,
  buildHavocLockedInputs,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateHavocGame } from './game.ts';
import { havocGameResultDigest, havocGameTapeDigest } from './digests.ts';
import { buildHavocGameInput } from './input.ts';

it('dumps havoc digests', () => {
  const context = createEngineContext();
  const fixture = simulateHavocGame(buildFixtureGameInput(), context);
  console.log('fixture', havocGameResultDigest(fixture.result), havocGameTapeDigest(fixture.tape));
  const locked = buildHavocLockedInputs();
  const havoc = simulateHavocGame(
    buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' }),
    context,
  );
  const normal = simulateHavocGame(
    buildHavocGameInput({ locked, gameNumber: 1, variant: 'normal' }),
    context,
  );
  console.log('locked-havoc', havocGameResultDigest(havoc.result), havocGameTapeDigest(havoc.tape));
  console.log(
    'locked-normal',
    havocGameResultDigest(normal.result),
    havocGameTapeDigest(normal.tape),
  );
});
