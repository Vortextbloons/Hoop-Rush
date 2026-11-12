import { expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GAME_WASM_BYTES, GAME_WASM_SOURCE_HASH } from './sim/wasm/game-wasm.gen.ts';

it('ships a valid game module matching its Rust source', () => {
  const source = readFileSync(new URL('./sim/wasm/game.rs', import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(GAME_WASM_SOURCE_HASH);
  expect(WebAssembly.validate(GAME_WASM_BYTES)).toBe(true);
});

import {
  POSSESSION_WASM_BYTES,
  POSSESSION_WASM_SOURCE_HASH,
} from './sim/wasm/possession-wasm.gen.ts';
it('ships a valid battle and possession module matching its Rust source', () => {
  const source = readFileSync(new URL('./sim/wasm/possession.rs', import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(POSSESSION_WASM_SOURCE_HASH);
  expect(WebAssembly.validate(POSSESSION_WASM_BYTES)).toBe(true);
});
