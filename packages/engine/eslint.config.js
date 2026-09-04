import tseslint from 'typescript-eslint';
import { sharedEslintBase } from '../../eslint.base.config.js';
export default tseslint.config(...sharedEslintBase(import.meta.dirname), {
    files: ['src/**'],
    rules: {
        'no-restricted-properties': [
            'error',
            {
                object: 'Math',
                property: 'random',
                message: 'engine simulation must use injected seeded RNG (createRng)',
            },
            {
                object: 'Date',
                property: 'now',
                message: 'engine code must not read the wall clock; inject clocks',
            },
        ],
        'no-restricted-globals': [
            'error',
            { name: 'performance', message: 'engine code must not read the wall clock; inject clocks' },
        ],
    },
}, {
    files: ['src/**/*.test.ts'],
    rules: {
        'no-restricted-properties': [
            'error',
            {
                object: 'Math',
                property: 'random',
                message: 'engine tests must use injected seeded RNG (createRng)',
            },
            {
                object: 'Date',
                property: 'now',
                message: 'engine tests must not seed from the wall clock',
            },
        ],
    },
}, {
    files: [
        'src/season/**',
        'src/sim/**',
        'src/domain/**',
        'src/projection/**',
        'src/modes/**',
        'src/bracket/**',
        'src/challenge/**',
    ],
    rules: {
        'no-restricted-imports': [
            'error',
            {
                patterns: [
                    { group: ['*svelte*'], message: 'Engine domain must not import Svelte' },
                    { group: ['*dexie*'], message: 'Engine domain must not import persistence' },
                    { group: ['node:*'], message: 'Engine domain must not import Node APIs' },
                    { group: ['*worker*'], message: 'Engine domain must not import workers' },
                    {
                        group: ['*supabase*'],
                        message: 'Engine domain must not import network services',
                    },
                    {
                        group: ['*fetch*', '*browser*'],
                        message: 'Engine domain must not import network/browser APIs',
                    },
                ],
            },
        ],
    },
});
