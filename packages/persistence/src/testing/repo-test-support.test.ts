import { afterEach, describe, expect, it } from 'vitest';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';

interface ProbeRow {
  recordId: string;
  payload: string;
}

afterEach(restoreIndexedDb);

describe('test database harness', () => {
  it('shares one database name across two connections', async () => {
    resetIndexedDb();
    const { name, first, second } = openTestDatabasePair('two-connections');
    await first.table<ProbeRow>('completed').put({ recordId: 'probe', payload: 'one' });

    const seenBySecond = await second.table<ProbeRow>('completed').get('probe');
    expect(seenBySecond?.payload).toBe('one');

    await second.table<ProbeRow>('completed').delete('probe');
    expect(await first.table<ProbeRow>('completed').get('probe')).toBeUndefined();
    expect(first.name).toBe(name);
    expect(second.name).toBe(name);
  });
});
