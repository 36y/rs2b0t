import { describe, expect, test } from 'bun:test';
import { findDeadExports } from '../../tools/audit-exports.js';

describe('findDeadExports', () => {
    test('flags an export no other file references', () => {
        const sources = new Map([
            ['src/bot/a.ts', 'export const Unused = 1;\nexport const Used = 2;'],
            ['src/bot/b.ts', "import { Used } from './a.js';\nconsole.log(Used);"]
        ]);
        expect(findDeadExports(sources, 'src/bot', '')).toEqual(['src/bot/a.ts\tUnused']);
    });

    test('does not flag a symbol named in the published .d.ts', () => {
        const sources = new Map([['src/bot/a.ts', 'export const Published = 1;']]);
        expect(findDeadExports(sources, 'src/bot', 'export declare const Published: number;')).toEqual([]);
    });

    test('ignores a self-reference within the declaring file', () => {
        const sources = new Map([['src/bot/a.ts', 'export const Solo = 1;\nconst x = Solo + 1;\nexport { x };']]);
        expect(findDeadExports(sources, 'src/bot', '')).toEqual(['src/bot/a.ts\tSolo']);
    });

    test('only scans files under the scan prefix', () => {
        const sources = new Map([['src/client/z.ts', 'export const Frozen = 1;']]);
        expect(findDeadExports(sources, 'src/bot', '')).toEqual([]);
    });

    test('treats a $ in an identifier as a literal, not a regex metacharacter', () => {
        const sources = new Map([
            ['src/bot/a.ts', 'export const $cache = 1;\nexport const use$Me = 2;'],
            ['src/bot/b.ts', "import { use$Me } from './a.js';\nconsole.log(use$Me);"]
        ]);
        expect(findDeadExports(sources, 'src/bot', '')).toEqual(['src/bot/a.ts\t$cache']);
    });

    test('matches every exported declaration kind', () => {
        const sources = new Map([
            [
                'src/bot/a.ts',
                'export interface I {}\nexport type T = 1;\nexport function f() {}\nexport class C {}\nexport enum E { A }\nexport const c = 1;'
            ]
        ]);
        expect(findDeadExports(sources, 'src/bot', '')).toEqual([
            'src/bot/a.ts\tC',
            'src/bot/a.ts\tE',
            'src/bot/a.ts\tI',
            'src/bot/a.ts\tT',
            'src/bot/a.ts\tc',
            'src/bot/a.ts\tf'
        ]);
    });
});
