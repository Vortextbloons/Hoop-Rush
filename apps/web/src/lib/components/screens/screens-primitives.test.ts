import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import Harness from './screens-primitives.test-harness.svelte';

const { body } = render(Harness, {});

describe('Screen primitives', () => {
  test('EmptyState error kind exposes alert semantics and retry action', () => {
    expect(body).toContain('data-kind="error"');
    expect(body).toContain('role="alert"');
    expect(body).toContain('aria-live="assertive"');
    expect(body).toContain('tabindex="-1"');
    expect(body).toContain('Retry now');
  });

  test('ScheduleGrid maps every cell state and only selects interactive cells', () => {
    expect(body).toContain('data-test-schedule="grid"');
    expect(body).toContain('data-state="win"');
    expect(body).toContain('data-state="loss"');
    expect(body).toContain('data-state="upcoming"');
    expect(body).toContain('data-state="neutral"');
    expect(body).toContain('aria-pressed="true"');
    expect(body).toContain('data-static="true"');
    expect(body).toContain('BOS 102–99');
  });

  test('ComparisonTable renders headers, rows, notes, and highlight flags', () => {
    expect(body).toContain('data-test-comparison="table"');
    expect(body).toContain('>Us</th>');
    expect(body).toContain('>Them</th>');
    expect(body).toContain('Points per game');
    expect(body).toContain('112.4');
    expect(body).toContain('108.1');
    expect(body).toContain('Per game');
    expect(body).toContain('data-highlight="true"');
  });
});
