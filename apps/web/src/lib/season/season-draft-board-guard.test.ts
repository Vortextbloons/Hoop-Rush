import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('season draft board overall blackout', () => {
  it('never renders overall ratings during the draft', () => {
    const boardPath = resolve(here, '../components/season/SeasonDraftBoard.svelte');
    const source = readFileSync(boardPath, 'utf8');
    expect(source).not.toContain('overallRating');
    expect(source).not.toContain('summaryRatings');
  });

  it('keeps the hopper deal reduced-motion safe', () => {
    const cssPath = resolve(here, '../../app.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('.draft-card-enter');
    expect(css).toContain('.draft-hopper-slot');
    expect(css).toContain('.draft-arena::before');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).not.toContain('draft-btn-breathe');
    expect(css).not.toContain('draft-sheen');
    expect(css).not.toContain('draft-spotlight-sweep');
  });
});
