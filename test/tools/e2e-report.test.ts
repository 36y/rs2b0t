import { describe, expect, test } from 'bun:test';

import { errorTail } from '../../tools/lib/e2e-report.js';

describe('errorTail', () => {
    test('prefers the error line over the stack footer that follows it', () => {
        const out = errorTail([
            '  boot: loading --no-deploy/bot.html',
            'error: goto: Protocol error (Page.navigate): Cannot navigate to invalid URL',
            '      at bootAndLogin (/repo/tools/tutorial/harness.ts:108:16)',
            'Bun v1.3.14 (macOS arm64)'
        ]);
        expect(out).toContain('Cannot navigate to invalid URL');
        expect(out.startsWith('at bootAndLogin')).toBe(false);
    });

    test('a FAIL: assertion counts as the error', () => {
        const out = errorTail([
            'final: truck=110 xp=+5550',
            'FAIL: junk still held after banking: Coins, Bones',
            'closing browser'
        ]);
        expect(out).toContain('FAIL: junk still held after banking');
    });

    test('falls back to the last lines when nothing looks like an error', () => {
        expect(errorTail(['a', 'b', 'c', 'd'])).toBe('b | c | d');
    });

    test('blank lines never reach the output', () => {
        expect(errorTail(['a', '   ', '', 'b'])).toBe('a | b');
    });

    test('caps at 240 characters', () => {
        expect(errorTail([`error: ${'x'.repeat(500)}`]).length).toBe(240);
    });

    test('empty input is an empty string, not a crash', () => {
        expect(errorTail([])).toBe('');
    });
});
