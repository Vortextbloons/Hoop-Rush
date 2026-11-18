import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import Harness from './ui-primitives.test-harness.svelte';

const { body } = render(Harness, {});

describe('UI primitives', () => {
  test('PageShell renders a labelled shell with width and padding variants', () => {
    expect(body).toContain('class="ui-shell"');
    expect(body).toContain('<section');
    expect(body).toContain('data-width="md"');
    expect(body).toContain('data-padding="lg"');
    expect(body).toContain('aria-label="Primitive shell"');
  });

  test('SectionHeading renders the heading level, eyebrow, and action slot', () => {
    expect(body).toContain('ui-section-head');
    expect(body).toContain('class="ui-label"');
    expect(body).toContain('Test eyebrow');
    expect(body).toContain('<h3 class="ui-section-title" data-size="sm">');
    expect(body).toContain('Test description');
    expect(body).toContain('Heading action');
  });

  test('StatGrid renders a description list with column variants', () => {
    expect(body).toContain('<dl');
    expect(body).toContain('ui-stat-grid');
    expect(body).toContain('data-columns="4"');
    expect(body).toContain('data-mobile="3"');
    expect(body).toContain('data-gap="md"');
  });

  test('StatTile renders label, value, tone, size, surface, and note', () => {
    expect(body).toContain('data-surface="tile"');
    expect(body).toContain('<dt class="ui-micro">Points</dt>');
    expect(body).toContain('data-size="xl"');
    expect(body).toContain('data-tone="primary"');
    expect(body).toContain('data-tone="negative"');
    expect(body).toContain('ui-stat-note');
    expect(body).toContain('Per game');
  });

  test('Alert maps tone to role and renders title and copy', () => {
    expect(body).toContain('role="alert"');
    expect(body).toContain('role="status"');
    expect(body).toContain('data-tone="danger"');
    expect(body).toContain('data-tone="success"');
    expect(body).toContain('Danger title');
    expect(body).toContain('Danger copy');
  });

  test('EmptyState renders title, message, and surface variant', () => {
    expect(body).toContain('ui-empty');
    expect(body).toContain('data-surface="none"');
    expect(body).toContain('Nothing here');
    expect(body).toContain('Empty copy');
  });
});
