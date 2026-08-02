import { pools } from './packages/importer/src/index.js';

try {
  pools.run([['nets', '2020s']], false);
  console.log('DONE');
} catch (error) {
  const e = error as NodeJS.ErrnoException;
  console.log('CODE', e.code, 'ERRNO', e.errno, 'SYS', e.syscall, 'PATH', e.path);
  console.log('MSG', e.message);
  console.log('STACK', e.stack?.split('\n').slice(0, 6).join('\n'));
}
