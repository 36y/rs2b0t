import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// ESLint flat config REPLACES rule options; it does not merge them. Any later
// block that declares `no-restricted-imports` for a path silently repeals every
// earlier one covering it, so every fence below must carry this pattern too.
// See docs/reference/import-fences.md#a-later-block-repeals-an-earlier-one.
const CLIENT_INTERNALS = {
    group: ['\\#/client/*/*', '!\\#/client/io/ServerProt.js', '!\\#/client/io/ClientProt.js', '!\\#/client/dash3d/CollisionFlag.js', '!\\#/client/shell/MiniMenuAction.js', '!\\#/client/mapview/worldmapKeyNames.js'],
    message: 'Only src/bot/adapter/ may touch client internals.'
};

/** main.ts pulls in ui/ and the whole runtime — a leaf layer reaching it is a cycle. */
const APP_ENTRYPOINT = {
    group: ['**/main.js'],
    message: 'main.ts is the app entrypoint — a leaf layer must not import it.'
};

export default defineConfig([
    globalIgnores(['src/client/3rdparty/', 'out/', 'desktop/', 'packages/', 'templates/', 'public-bot/', '.claude/', 'identifier.js']),
    { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], plugins: { js }, extends: ['js/recommended'], languageOptions: { globals: globals.browser } },
    tseslint.configs.recommended,
    {
        rules: {
            indent: ['error', 4, { SwitchCase: 1 }],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],

            'no-constant-condition': ['error', { checkLoops: false }],
            'no-case-declarations': 'error',
            '@typescript-eslint/no-namespace': 'error',
            '@typescript-eslint/no-explicit-any': 'warn',

            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_'
                }
            ]
        }
    },

    // The ported 2004 client swallows exceptions in dozens of places, faithfully to the
    // original. It is a frozen port, so an empty catch there is intent rather than an
    // oversight. Everything we write ourselves keeps the rule and comments the intent.
    {
        files: ['src/client/**/*.ts', 'src/dash3d/**/*.ts', 'src/graphics/**/*.ts', 'src/mapview/**/*.ts', 'src/config/**/*.ts', 'src/io/**/*.{ts,js}', 'src/sound/**/*.ts', 'src/datastruct/**/*.ts', 'src/wordfilter/**/*.ts'],
        rules: {
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },

    // ---- rs2b0t fences ----
    // Only adapter/ may name client internals; everything else in src/bot/
    // imports the adapter. Protocol const-enums are exempt (inlined, no
    // runtime coupling).
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/adapter/**', 'src/bot/runtime/BotClient.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [CLIENT_INTERNALS]
                }
            ]
        }
    },
    // Only ui/ and the entrypoints may touch the DOM (keeps headless viable).
    // The MultiBox manager is a second DOM entrypoint: main.ts (its bundle
    // entry) and its DOM view layers DomSlotOps.ts and ProfileChooser.ts
    // (analogous to ui/) are exempted the same way; the rest of
    // src/bot/multibox/ stays fenced.
    {
        files: ['src/bot/**/*.ts'],
        ignores: ['src/bot/ui/**', 'src/bot/main.ts', 'src/bot/multibox/DomSlotOps.ts', 'src/bot/multibox/ProfileChooser.ts', 'src/bot/multibox/TabBar.ts', 'src/bot/multibox/VaultPrompt.ts', 'src/bot/multibox/main.ts', 'src/bot/runtime/WorkerClock.ts'],
        rules: {
            'no-restricted-globals': ['error', { name: 'document', message: 'DOM only in src/bot/ui/, main.ts, src/bot/multibox/{DomSlotOps,ProfileChooser,TabBar,VaultPrompt,main}.ts and runtime/WorkerClock.ts.' }, { name: 'window', message: 'DOM only in src/bot/ui/, main.ts, src/bot/multibox/{DomSlotOps,ProfileChooser,TabBar,VaultPrompt,main}.ts and runtime/WorkerClock.ts.' }]
        }
    },

    // api/ sits above adapter/, nav/ and data/, and on the host substrate
    // (Settings, BotHost, Scheduler) that Execution/Game/loadouts genuinely need.
    // It must not reach up into script lifecycle or the layers that consume it.
    {
        files: ['src/bot/api/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: [
                                '**/scripts/**',
                                '**/quests/**',
                                '**/clues/**',
                                '**/ui/**',
                                '**/multibox/**',
                                '**/runtime/**',
                                '!**/runtime/Settings.js',
                                '!**/runtime/BotHost.js',
                                '!**/runtime/Scheduler.js'
                            ],
                            message: 'api/ may stand on runtime/{Settings,BotHost,Scheduler} only — never on script lifecycle or the layers that consume it.'
                        }
                    ]
                }
            ]
        }
    },
    // data/ holds inert catalogs: tables plus pure resolvers over them, no live
    // game reads. geometry/ is a top-level leaf, so no re-inclusion is needed —
    // gitignore semantics cannot re-admit a path under an excluded parent, which
    // is why geometry does not live under api/.
    {
        files: ['src/bot/data/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: ['**/api/**', '**/nav/**', '**/scripts/**', '**/quests/**', '**/clues/**', '**/ui/**', '**/runtime/**', '**/multibox/**', '**/adapter/**'],
                            allowTypeImports: true,
                            message: 'data/ is inert — value imports only from geometry/. Type-only imports are fine.'
                        }
                    ]
                }
            ]
        }
    },
    // The published surface is decidable. abi.ts lives inside runtime/, so its
    // siblings are named './X.js' with no 'runtime' in the specifier — a
    // '**/runtime/**' pattern can never match them. Deny the whole sibling
    // directory and re-admit the two it needs.
    {
        files: ['src/bot/runtime/abi.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: ['./*', '!./Settings.js', '!./defineBot.js', '!./buildInfo.js'],
                            message: 'abi.ts may name only runtime/{Settings,defineBot,buildInfo} — never script lifecycle.'
                        },
                        {
                            group: ['**/scripts/**', '**/clues/**', '**/ui/**', '**/multibox/**', '**/quests/**'],
                            message: 'abi.ts publishes from api/, data/, geometry/, nav/ and the adapter only.'
                        }
                    ]
                }
            ]
        }
    },
    // geometry/ is the one value source data/ may name, so it must stay a leaf —
    // otherwise it launders anything into the "inert" layer.
    {
        files: ['src/bot/geometry/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        CLIENT_INTERNALS,
                        APP_ENTRYPOINT,
                        {
                            group: ['**/api/**', '**/nav/**', '**/data/**', '**/scripts/**', '**/quests/**', '**/clues/**', '**/ui/**', '**/runtime/**', '**/multibox/**', '**/adapter/**'],
                            allowTypeImports: true,
                            message: 'geometry/ is a leaf — no value imports outside it. Type-only imports are fine.'
                        }
                    ]
                }
            ]
        }
    }
]);
