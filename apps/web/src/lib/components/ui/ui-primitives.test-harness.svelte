<script lang="ts">
  import Alert from './Alert.svelte';
  import EmptyState from './EmptyState.svelte';
  import PageShell from './PageShell.svelte';
  import SectionHeading from './SectionHeading.svelte';
  import StatGrid from './StatGrid.svelte';
  import StatTile from './StatTile.svelte';
</script>

<PageShell as="section" width="md" padding="lg" aria-label="Primitive shell">
  <SectionHeading
    eyebrow="Test eyebrow"
    title="Test section"
    description="Test description"
    level={3}
    size="sm"
  >
    {#snippet actions()}<span>Heading action</span>{/snippet}
  </SectionHeading>

  <StatGrid columns={4} mobile={3} gap="md" aria-label="Test stats">
    <StatTile label="Points" value="24" size="xl" tone="primary" surface="tile" />
    <StatTile label="Margin" value="-3" tone="negative" note="Per game" />
    <StatTile label="Record" value="82" note="Games">
      <span>82</span>
    </StatTile>
  </StatGrid>

  <Alert tone="danger" title="Danger title">Danger copy</Alert>
  <Alert tone="success" title="Success title" />

  <EmptyState title="Nothing here" message="Empty copy" surface="none" />
</PageShell>
