import { expect, test } from 'bun:test';
import { render } from 'svelte/server';
import GamecastPlaybackControls from './GamecastPlaybackControls.svelte';

test('shares pause, skip, and replay behavior across broadcasts', () => {
  const live = render(GamecastPlaybackControls, {
    props: { paused: false, complete: false, ontoggle: () => {}, onskip: () => {} },
  }).body;
  expect(live).toContain('Pause');
  expect(live).toContain('Skip to final');
  expect(live).not.toContain('Replay');

  const paused = render(GamecastPlaybackControls, {
    props: { paused: true, complete: false, ontoggle: () => {}, onskip: () => {} },
  }).body;
  expect(paused).toContain('Resume');

  const complete = render(GamecastPlaybackControls, {
    props: {
      paused: false,
      complete: true,
      ontoggle: () => {},
      onskip: () => {},
      onreplay: () => {},
    },
  }).body;
  expect(complete).toContain('Replay');
  expect(complete).not.toContain('Skip to final');
});
