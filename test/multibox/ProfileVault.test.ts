import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileVault } from '#/bot/multibox/ProfileVault.js';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
};
beforeEach(clearAll);
afterEach(clearAll);

describe('ProfileVault', () => {
    test('empty → setup unlocks with an empty list and writes an encrypted blob', async () => {
        const v = new ProfileVault();
        expect(v.status()).toBe('empty');
        await v.setup('pw');
        expect(v.status()).toBe('unlocked');
        expect(v.list()).toEqual([]);
        const blob = JSON.parse(localStorage.getItem(KEY)!) as { v: number; kdf: string; iter: number };
        expect(blob.v).toBe(1);
        expect(blob.kdf).toBe('PBKDF2-SHA256');
        expect(blob.iter).toBe(310000);
    });

    test('round-trip: upsert/remove survive a real lock/unlock cycle', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'hunter2' });
        await v.upsert({ username: 'bob', password: 'b' });
        await v.remove('bob');
        const v2 = new ProfileVault();
        expect(v2.status()).toBe('locked');
        expect(await v2.unlock('pw')).toBe(true);
        expect(v2.list()).toEqual([{ username: 'alice', password: 'hunter2' }]);
    });

    test('stored blob never contains plaintext', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'hunter2' });
        const raw = localStorage.getItem(KEY)!;
        expect(raw).not.toContain('alice');
        expect(raw).not.toContain('hunter2');
    });

    test('wrong passphrase fails to unlock and stays locked', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        const v2 = new ProfileVault();
        expect(await v2.unlock('nope')).toBe(false);
        expect(v2.status()).toBe('locked');
        expect(() => v2.list()).toThrow();
    });

    test('legacy plaintext array under the profiles key is adopted by setup', async () => {
        localStorage.setItem(KEY, JSON.stringify([{ username: 'old', password: 'p' }]));
        const v = new ProfileVault();
        expect(v.status()).toBe('plaintext-legacy');
        await v.setup('pw');
        expect(v.list()).toEqual([{ username: 'old', password: 'p' }]);
        expect(localStorage.getItem(KEY)!).not.toContain('old');
    });

    test('pre-#30 roster key is adopted too, then deleted', async () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ username: 'old', password: 'p' }]));
        const v = new ProfileVault();
        expect(v.status()).toBe('plaintext-legacy');
        await v.setup('pw');
        expect(v.list()).toEqual([{ username: 'old', password: 'p' }]);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    test('reset wipes to empty', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'alice', password: 'a' });
        v.reset();
        expect(v.status()).toBe('empty');
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(() => v.list()).toThrow();
    });

    test('setup while locked throws', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        const v2 = new ProfileVault();
        await expect(v2.setup('other')).rejects.toThrow();
    });

    test('every persist uses a fresh IV', async () => {
        const v = new ProfileVault();
        await v.setup('pw');
        await v.upsert({ username: 'a', password: '1' });
        const iv1 = (JSON.parse(localStorage.getItem(KEY)!) as { iv: string }).iv;
        await v.upsert({ username: 'b', password: '2' });
        const iv2 = (JSON.parse(localStorage.getItem(KEY)!) as { iv: string }).iv;
        expect(iv1).not.toBe(iv2);
    });
});
