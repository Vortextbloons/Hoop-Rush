# Shared UI primitives

Reusable building blocks live in `src/lib/components/ui/`. Shared basketball
presentation that is not a general primitive lives in
`src/lib/components/basketball/`. Mode components compose these instead of
repeating button, panel, badge, and segmented-control markup.

## Components

| Component                 | Renders                              | Notes                                                                                                                          |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `Button.svelte`           | native `<button>`                    | Defaults to `type="button"`. `loading` disables the control and sets `aria-busy`. Accepts native button attributes and events. |
| `ActionLink.svelte`       | native `<a>`                         | Use for navigation. There is deliberately no disabled state; render different content instead of a dead link.                  |
| `IconButton.svelte`       | native `<button>`                    | Requires `label`, which becomes the accessible name. Use for icon-only actions.                                                |
| `Panel.svelte`            | `div`, `section`, `article`, or `li` | Surface only. Choose padding with `padding="none                                                                               | sm  | md  | lg"`. |
| `Badge.svelte`            | `<span>`                             | Semantic tones: `neutral`, `primary`, `accent`, `positive`, `negative`.                                                        |
| `SegmentedControl.svelte` | `role="group"` of pressed buttons    | For immediate option groups such as "Per game / Totals". Not a tab list; it does not change panels.                            |
| `PageHeader.svelte`       | page header                          | Eyebrow, title, description, and an optional `actions` snippet.                                                                |

`types.ts` exports the shared `ButtonTone`, `ButtonSize`, and `BadgeTone`
unions. Prefer the typed variants over passing one-off color classes.

## Usage

```svelte
<Button tone="primary" loading={controller.busy} onclick={() => controller.startDraft()}>
  Start draft
</Button>

<ActionLink href={resolve('havoc/')}>Start a Havoc run</ActionLink>

<Panel as="section" padding="md" aria-label="Payroll and apron status">...</Panel>

<Badge tone="positive">Under cap</Badge>

<SegmentedControl
  label="Stat values"
  value={statsTotals ? 'totals' : 'game'}
  onchange={(next) => (statsTotals = next === 'totals')}
  options={[
    { value: 'game', label: 'Per game' },
    { value: 'totals', label: 'Totals' },
  ]}
/>
```

History screens share `#lib/components/basketball/HistoryEntryCard.svelte`.
The mode supplies its own record, badges, and metadata through snippets, so
Cap Rush keeps cap/postseason badges while Havoc keeps its completion state.

## Theming

`lib/styles/foundations.css` owns the defaults. Mode wrappers override scoped
CSS variables rather than branching inside a primitive:

```css
.havoc-world {
  --ui-control-bg: var(--h-gold);
  --ui-control-fg: var(--h-ink);
  --ui-control-hover-transform: translateY(-2px);
  --ui-panel-bg: #20294c;
  --ui-panel-line: #465273;
  --ui-panel-radius: 22px;
}

.room-page {
  --ui-control-bg: var(--color-primary);
  --ui-control-transform: none;
  --ui-control-radius: 7px;
  --ui-secondary-border: var(--color-line-strong);
}
```

Add a new token to `foundations.css` when a mode needs a different shape or
color. Do not add mode-name conditions to the primitives. When a mode has a
genuinely different interaction model, keep a mode component and compose the
primitives inside it.
