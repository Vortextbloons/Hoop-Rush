import tseslint from 'typescript-eslint';
import { sharedEslintBase } from '../../eslint.base.config.js';
export default tseslint.config(...sharedEslintBase(import.meta.dirname), {
    files: ['**/*.ts'],
    rules: {
        '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
});
