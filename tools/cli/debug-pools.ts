import { pools } from '@hoop-rush/importer';

try {
  pools.run([['warriors', '2000s']], false);
  console.log('DONE');
} catch (error) {
  const e = error as NodeJS.ErrnoException;
  console.log('CODE', JSON.stringify(e.code), 'ERRNO', JSON.stringify(e.errno), 'SYS', e.syscall);
  console.log('MSG', e.message);
  console.log('STACK', (e.stack ?? '').split('\n').slice(0, 8).join('\n'));
}
