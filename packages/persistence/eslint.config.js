import tseslint from 'typescript-eslint';
import { sharedEslintBase } from '../../eslint.base.config.js';

export default tseslint.config(...sharedEslintBase(import.meta.dirname), {
  files: ['**/*.ts'],
  rules: {
    // The storage layer intentionally omits fields via rest destructuring
    // (`const { omit, ...rest } = record`); the omitted keys are the point
    // of the idiom and should not be reported as unused.
    '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
  },
});
