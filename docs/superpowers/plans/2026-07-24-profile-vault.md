# Profile Vault (Passphrase Encryption) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the multibox profile store at rest with a master passphrase (AES-256-GCM, PBKDF2-derived key held in memory only), gated by a lazy unlock modal.

**Architecture:** A `ProfileVault` class owns the store: unlock decrypts once into an in-memory cache, all reads stay synchronous against the cache, every write re-encrypts with a fresh IV. A `VaultPrompt` modal is the single unlock funnel (`ensureUnlocked()`), shown lazily on first profile touch. Bot iframes never hold the key — the panel's creds write-back becomes a `postMessage` to the wall. `runtime/Profiles.ts` is deleted; the `Profile` type moves into the vault.

**Tech Stack:** WebCrypto (native in Bun and Chromium — no deps), TypeScript ESM, bun test + happy-dom, Electron smoke via `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-07-24-profile-vault-design.md`
**Branch:** continue on `multibox-profiles` (PR #35).

## Global Constraints

- Comments: terse (user law); only constraint-stating comments.
- Storage key unchanged: `rs2b0t:multibox:profiles`; blob format `{ v: 1, kdf: 'PBKDF2-SHA256', iter: 310000, salt, iv, ct }` (base64; 16-byte salt, 12-byte IV, fresh IV per write). Legacy pre-#30 key `rs2b0t:multibox:accounts` adopted at setup then deleted.
- Passphrase never persisted; derived key in a JS field only. No prompt at wall boot — lazy gate.
- Tests: `bun test`; clear both storages in beforeEach/afterEach. Electron smoke via `npx tsx`, never bun.
- Commit only files you touched; check `git log` first (user commits concurrently).
- `multibox.add/focus/slots` stay sync and unchanged; `importProfiles` becomes async (returns `Promise<number>`).

---

### Task 1: ProfileVault

**Files:**
- Create: `src/bot/multibox/ProfileVault.ts`
- Test: `test/multibox/ProfileVault.test.ts`

**Interfaces:**
- Consumes: nothing project-internal (WebCrypto + localStorage).
- Produces (Tasks 2–4 rely on): `interface Profile { username: string; password: string }`; `type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked'`; `class ProfileVault { status(): VaultStatus; setup(pass: string): Promise<void>; unlock(pass: string): Promise<boolean>; reset(): void; list(): Profile[]; upsert(p: Profile): Promise<void>; remove(username: string): Promise<void> }`; singleton `export const vault: ProfileVault`. `list/upsert/remove` throw unless unlocked; `setup` throws from `locked`.

- [ ] **Step 1: Write the failing test**

`test/multibox/ProfileVault.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/multibox/ProfileVault.test.ts`
Expected: FAIL — cannot resolve `#/bot/multibox/ProfileVault.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/multibox/ProfileVault.ts`:

```ts
export interface Profile {
    username: string;
    password: string;
}

export type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';
const ITER = 310000;

const hasLocal = typeof localStorage !== 'undefined';

interface StoredBlob {
    v: number;
    kdf: string;
    iter: number;
    salt: string;
    iv: string;
    ct: string;
}

function b64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) {
        s += String.fromCharCode(b);
    }
    return btoa(s);
}

function unb64(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

function parseBlob(raw: string | null): StoredBlob | null {
    if (!raw) {
        return null;
    }
    try {
        const v = JSON.parse(raw) as StoredBlob;
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
            return null;
        }
        return v.v === 1 && typeof v.salt === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string' && typeof v.iter === 'number' ? v : null;
    } catch {
        return null;
    }
}

function parseLegacy(raw: string | null): Profile[] | null {
    if (!raw) {
        return null;
    }
    try {
        const v = JSON.parse(raw) as Profile[];
        if (!Array.isArray(v)) {
            return null;
        }
        return v
            .filter(p => typeof p?.username === 'string' && p.username.length > 0 && typeof p?.password === 'string')
            .map(p => ({ username: p.username, password: p.password }));
    } catch {
        return null;
    }
}

async function deriveKey(pass: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export class ProfileVault {
    private cache: Profile[] | null = null;
    private key: CryptoKey | null = null;
    private salt: Uint8Array | null = null;

    status(): VaultStatus {
        if (this.cache) {
            return 'unlocked';
        }
        const raw = hasLocal ? localStorage.getItem(KEY) : null;
        if (parseBlob(raw)) {
            return 'locked';
        }
        if (parseLegacy(raw)) {
            return 'plaintext-legacy';
        }
        if (hasLocal && parseLegacy(localStorage.getItem(LEGACY_KEY))) {
            return 'plaintext-legacy';
        }
        return 'empty';
    }

    async setup(pass: string): Promise<void> {
        if (this.status() === 'locked') {
            throw new Error('vault is locked — unlock or reset first');
        }
        const raw = hasLocal ? localStorage.getItem(KEY) : null;
        const legacy = parseLegacy(raw) ?? (hasLocal ? parseLegacy(localStorage.getItem(LEGACY_KEY)) : null) ?? [];
        this.salt = crypto.getRandomValues(new Uint8Array(16));
        this.key = await deriveKey(pass, this.salt, ITER);
        this.cache = legacy;
        if (hasLocal) {
            localStorage.removeItem(LEGACY_KEY);
        }
        await this.persist();
    }

    async unlock(pass: string): Promise<boolean> {
        const blob = parseBlob(hasLocal ? localStorage.getItem(KEY) : null);
        if (!blob) {
            return false;
        }
        const salt = unb64(blob.salt);
        const key = await deriveKey(pass, salt, blob.iter);
        try {
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
            this.cache = parseLegacy(new TextDecoder().decode(pt)) ?? [];
            this.key = key;
            this.salt = salt;
            return true;
        } catch {
            return false;
        }
    }

    reset(): void {
        if (hasLocal) {
            localStorage.removeItem(KEY);
            localStorage.removeItem(LEGACY_KEY);
        }
        this.cache = null;
        this.key = null;
        this.salt = null;
    }

    list(): Profile[] {
        return this.assertUnlocked().map(p => ({ ...p }));
    }

    async upsert(p: Profile): Promise<void> {
        if (p.username.length === 0) {
            return;
        }
        const all = this.assertUnlocked();
        const i = all.findIndex(x => x.username === p.username);
        const entry = { username: p.username, password: p.password };
        if (i >= 0) {
            all[i] = entry;
        } else {
            all.push(entry);
        }
        await this.persist();
    }

    async remove(username: string): Promise<void> {
        this.cache = this.assertUnlocked().filter(x => x.username !== username);
        await this.persist();
    }

    private assertUnlocked(): Profile[] {
        if (!this.cache) {
            throw new Error('vault is not unlocked');
        }
        return this.cache;
    }

    private async persist(): Promise<void> {
        if (!hasLocal || !this.key || !this.salt || !this.cache) {
            return;
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(this.cache)));
        const blob: StoredBlob = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(this.salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
        localStorage.setItem(KEY, JSON.stringify(blob));
    }
}

export const vault = new ProfileVault();
```

Note: `parseLegacy` doubles as the decrypted-payload parser (both are `Profile[]` JSON).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/multibox/ProfileVault.test.ts`
Expected: 9 pass (PBKDF2 makes this take ~1–2s).

- [ ] **Step 5: Commit**

```bash
git add src/bot/multibox/ProfileVault.ts test/multibox/ProfileVault.test.ts
git commit -m "feat(multibox): ProfileVault — AES-GCM profile store with PBKDF2 passphrase"
```

---

### Task 2: VaultPrompt modal

**Files:**
- Create: `src/bot/multibox/VaultPrompt.ts`
- Modify: `eslint.config.ts` (DOM allowlist)
- Modify: `public-bot/multibox.html` (CSS)
- Test: `test/multibox/VaultPrompt.test.ts`

**Interfaces:**
- Consumes: `ProfileVault` (Task 1) — `status/setup/unlock/reset`.
- Produces (Tasks 3–4 rely on): `class VaultPrompt { constructor(vault: ProfileVault); readonly el: HTMLDivElement; ensureUnlocked(): Promise<boolean> }`. DOM hooks: overlay `#mbx-vault` (class `mbx-chooser-overlay`, `hidden` when closed), `#mbx-vault-pass`, `#mbx-vault-confirm` (set face only), `#mbx-vault-go`, `.mbx-vault-error`, `#mbx-vault-reset` (unlock face; two-step confirm).

- [ ] **Step 1: Write the failing test**

`test/multibox/VaultPrompt.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileVault } from '#/bot/multibox/ProfileVault.js';
import { VaultPrompt } from '#/bot/multibox/VaultPrompt.js';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '';
};
beforeEach(clearAll);
afterEach(clearAll);

function make(): { vault: ProfileVault; prompt: VaultPrompt } {
    const vault = new ProfileVault();
    const prompt = new VaultPrompt(vault);
    document.body.appendChild(prompt.el);
    return { vault, prompt };
}

const q = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const submit = () => q<HTMLFormElement>('#mbx-vault form').dispatchEvent(new Event('submit', { cancelable: true }));

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) {
            throw new Error('condition timeout');
        }
        await new Promise(r => setTimeout(r, 10));
    }
}

describe('VaultPrompt', () => {
    test('already unlocked resolves true without showing', async () => {
        const { vault, prompt } = make();
        await vault.setup('pw');
        expect(await prompt.ensureUnlocked()).toBe(true);
        expect(prompt.el.hidden).toBe(true);
    });

    test('set face: mismatch errors, match encrypts and resolves true', async () => {
        const { vault, prompt } = make();
        const p = prompt.ensureUnlocked();
        expect(prompt.el.hidden).toBe(false);
        expect(q('#mbx-vault-confirm')).not.toBeNull();
        q<HTMLInputElement>('#mbx-vault-pass').value = 'pw';
        q<HTMLInputElement>('#mbx-vault-confirm').value = 'other';
        submit();
        expect(q('.mbx-vault-error').textContent).toBe('passphrases do not match');
        q<HTMLInputElement>('#mbx-vault-confirm').value = 'pw';
        submit();
        expect(await p).toBe(true);
        expect(vault.status()).toBe('unlocked');
        expect(prompt.el.hidden).toBe(true);
    });

    test('unlock face: wrong passphrase errors, right one resolves true', async () => {
        const seed = new ProfileVault();
        await seed.setup('pw');
        await seed.upsert({ username: 'alice', password: 'a' });
        const { vault, prompt } = make();
        const p = prompt.ensureUnlocked();
        expect(q('#mbx-vault-confirm')).toBeNull();
        q<HTMLInputElement>('#mbx-vault-pass').value = 'nope';
        submit();
        await until(() => q('.mbx-vault-error').textContent === 'wrong passphrase');
        q<HTMLInputElement>('#mbx-vault-pass').value = 'pw';
        submit();
        expect(await p).toBe(true);
        expect(vault.list()).toEqual([{ username: 'alice', password: 'a' }]);
    });

    test('dismissing the overlay resolves false', async () => {
        const { prompt } = make();
        const p = prompt.ensureUnlocked();
        prompt.el.click();
        expect(await p).toBe(false);
        expect(prompt.el.hidden).toBe(true);
    });

    test('concurrent calls share one prompt', () => {
        const { prompt } = make();
        const a = prompt.ensureUnlocked();
        const b = prompt.ensureUnlocked();
        expect(a).toBe(b);
        prompt.el.click();
    });

    test('start over is two-step, wipes, and lands on the set face', async () => {
        const seed = new ProfileVault();
        await seed.setup('pw');
        const { vault, prompt } = make();
        const p = prompt.ensureUnlocked();
        q('#mbx-vault-reset').click();
        expect(vault.status()).toBe('locked');
        q('#mbx-vault-reset').click();
        expect(vault.status()).toBe('empty');
        expect(q('#mbx-vault-confirm')).not.toBeNull();
        prompt.el.click();
        await p;
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/multibox/VaultPrompt.test.ts`
Expected: FAIL — cannot resolve `#/bot/multibox/VaultPrompt.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/multibox/VaultPrompt.ts`:

```ts
import type { ProfileVault } from './ProfileVault.js';

function div(className: string, text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = className;
    d.textContent = text;
    return d;
}

function passInput(id: string, placeholder: string): HTMLInputElement {
    const i = document.createElement('input');
    i.id = id;
    i.type = 'password';
    i.placeholder = placeholder;
    return i;
}

export class VaultPrompt {
    readonly el: HTMLDivElement;

    private box: HTMLDivElement;
    private resolvePending: ((ok: boolean) => void) | null = null;
    private pendingPromise: Promise<boolean> | null = null;

    constructor(private vault: ProfileVault) {
        this.el = document.createElement('div');
        this.el.id = 'mbx-vault';
        this.el.className = 'mbx-chooser-overlay';
        this.el.hidden = true;
        this.el.addEventListener('click', ev => {
            if (ev.target === this.el) {
                this.finish(false);
            }
        });
        this.box = document.createElement('div');
        this.box.className = 'mbx-chooser';
        this.el.appendChild(this.box);
    }

    ensureUnlocked(): Promise<boolean> {
        if (this.vault.status() === 'unlocked') {
            return Promise.resolve(true);
        }
        if (this.pendingPromise) {
            return this.pendingPromise;
        }
        this.pendingPromise = new Promise<boolean>(resolve => {
            this.resolvePending = resolve;
        });
        this.render();
        this.el.hidden = false;
        return this.pendingPromise;
    }

    private finish(ok: boolean): void {
        this.el.hidden = true;
        const resolve = this.resolvePending;
        this.resolvePending = null;
        this.pendingPromise = null;
        resolve?.(ok);
    }

    private render(): void {
        this.box.textContent = '';
        if (this.vault.status() === 'locked') {
            this.renderUnlock();
        } else {
            this.renderSet();
        }
    }

    private renderSet(): void {
        const legacy = this.vault.status() === 'plaintext-legacy';
        const title = div('mbx-chooser-title', legacy ? 'set a passphrase to encrypt your saved profiles' : 'set a profiles passphrase');
        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        const pass = passInput('mbx-vault-pass', 'passphrase');
        const confirm = passInput('mbx-vault-confirm', 'confirm passphrase');
        const go = document.createElement('button');
        go.id = 'mbx-vault-go';
        go.type = 'submit';
        go.textContent = 'encrypt';
        form.append(pass, confirm, go);
        const err = div('mbx-vault-error', '');
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            if (pass.value.length === 0) {
                err.textContent = 'passphrase required';
                return;
            }
            if (pass.value !== confirm.value) {
                err.textContent = 'passphrases do not match';
                return;
            }
            void this.vault.setup(pass.value).then(() => this.finish(true));
        });
        this.box.append(title, form, err);
        pass.focus();
    }

    private renderUnlock(): void {
        const title = div('mbx-chooser-title', 'unlock saved profiles');
        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        const pass = passInput('mbx-vault-pass', 'passphrase');
        const go = document.createElement('button');
        go.id = 'mbx-vault-go';
        go.type = 'submit';
        go.textContent = 'unlock';
        form.append(pass, go);
        const err = div('mbx-vault-error', '');
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            void this.vault.unlock(pass.value).then(ok => {
                if (ok) {
                    this.finish(true);
                } else {
                    err.textContent = 'wrong passphrase';
                    pass.value = '';
                    pass.focus();
                }
            });
        });
        const reset = div('mbx-vault-reset', 'forgot? start over');
        reset.id = 'mbx-vault-reset';
        let armed = false;
        reset.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                reset.textContent = 'really wipe all saved profiles?';
                return;
            }
            this.vault.reset();
            this.render();
        });
        this.box.append(title, form, err, reset);
        pass.focus();
    }
}
```

- [ ] **Step 4: Add CSS + eslint allowlist**

`public-bot/multibox.html`, after the `#mbx-load-all` rule:

```css
        .mbx-vault-error { color: #e05b5b; min-height: 14px; }
        .mbx-vault-reset { color: #666; cursor: pointer; text-decoration: underline; }
        .mbx-vault-reset:hover { color: #e05b5b; }
```

`eslint.config.ts`: in the DOM-fence block, add `'src/bot/multibox/VaultPrompt.ts'` to `ignores` (after `ProfileChooser.ts`) and update both rule messages to `{DomSlotOps,ProfileChooser,VaultPrompt,main}.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/multibox/VaultPrompt.test.ts`
Expected: 6 pass.

- [ ] **Step 6: Commit**

```bash
git add src/bot/multibox/VaultPrompt.ts test/multibox/VaultPrompt.test.ts public-bot/multibox.html eslint.config.ts
git commit -m "feat(multibox): vault unlock/set-passphrase modal"
```

---

### Task 3: Rewire the wall through the vault

**Files:**
- Modify: `src/bot/multibox/ProfileChooser.ts` (imports + data calls)
- Modify: `src/bot/multibox/main.ts` (prompt gate, message listener, async importProfiles, `profiles()` helper)
- Modify: `src/bot/ui/BotPanel.ts` (postMessage write-back)
- Modify: `test/multibox/ProfileChooser.test.ts` (vault-backed setup)
- Delete: `src/bot/runtime/Profiles.ts`, `test/runtime/profiles.test.ts`

**Interfaces:**
- Consumes: `vault`, `Profile` from `./ProfileVault.js` (Task 1); `VaultPrompt` (Task 2); existing `boxId()` from `runtime/box.js`.
- Produces (Task 4 relies on): `multibox.importProfiles(json): Promise<number>` (0 when unlock dismissed); `multibox.profiles(): string[]` (usernames, throws if locked); write-back message shape `{ type: 'rs2b0t:profile-save', username, password }` posted to `window.parent` with `location.origin` as target origin.

- [ ] **Step 1: ProfileChooser reads the vault**

In `src/bot/multibox/ProfileChooser.ts` replace the import:

```ts
import { vault, type Profile } from './ProfileVault.js';
```

Replace the three data calls: in the submit handler `upsertProfile(p)` → `void vault.upsert(p)`; in `render()` `const profiles = listProfiles();` → `const profiles = vault.list();`; in the delete handler `removeProfile(p.username)` → `void vault.remove(p.username)`; in the load-all handler `for (const p of listProfiles())` → `for (const p of vault.list())`.

- [ ] **Step 2: Update the chooser tests to a vault-backed world**

In `test/multibox/ProfileChooser.test.ts` replace the Profiles import with:

```ts
import { vault, type Profile } from '#/bot/multibox/ProfileVault.js';
```

Replace the hooks (the chooser uses the singleton, so reset + setup it):

```ts
const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '';
};
beforeEach(async () => {
    clearAll();
    vault.reset();
    await vault.setup('pw');
});
afterEach(() => {
    vault.reset();
    clearAll();
});
```

Then replace every `upsertProfile(x)` with `await vault.upsert(x)` (make those tests `async`) and every `listProfiles()` with `vault.list()`.

- [ ] **Step 3: main.ts — gate, listener, async import, profiles()**

In `src/bot/multibox/main.ts` replace the Profiles import with:

```ts
import { vault, type Profile } from './ProfileVault.js';
import { VaultPrompt } from './VaultPrompt.js';
```

After the chooser wiring, add the prompt + message listener; gate the add tile:

```ts
    const prompt = new VaultPrompt(vault);
    document.body.appendChild(prompt.el);
    addTile.addEventListener('click', () => {
        void prompt.ensureUnlocked().then(ok => {
            if (ok) {
                chooser.open();
            }
        });
    });

    window.addEventListener('message', ev => {
        if (ev.origin !== location.origin) return;
        const d = ev.data as { type?: string; username?: string; password?: string };
        if (d?.type !== 'rs2b0t:profile-save' || typeof d.username !== 'string' || d.username.length === 0 || typeof d.password !== 'string') return;
        void prompt.ensureUnlocked().then(ok => {
            if (ok) {
                void vault.upsert({ username: d.username!, password: d.password! });
            }
        });
    });
```

(Remove the old plain `addTile.addEventListener('click', () => chooser.open());` line.)

Replace `importProfiles` in the global API and add `profiles`:

```ts
        importProfiles: async (json: string | Profile[]): Promise<number> => {
            if (!(await prompt.ensureUnlocked())) {
                return 0;
            }
            const arr = typeof json === 'string' ? (JSON.parse(json) as Profile[]) : json;
            let n = 0;
            for (const p of Array.isArray(arr) ? arr : []) {
                if (p && typeof p.username === 'string' && p.username.length > 0 && typeof p.password === 'string') {
                    await vault.upsert({ username: p.username, password: p.password });
                    n++;
                }
            }
            return n;
        },
        profiles: (): string[] => vault.list().map(p => p.username)
```

- [ ] **Step 4: BotPanel posts the write-back**

In `src/bot/ui/BotPanel.ts`: change the box import to `import { boxId, boxKey } from '../runtime/box.js';`, delete the `saveProfileForBox` import line, and change the Save handler to:

```ts
        button(buttons, 'Save', () => {
            Credentials.save(userInput.value.trim(), passInput.value);
            if (boxId() !== '' && window.parent !== window) {
                window.parent.postMessage({ type: 'rs2b0t:profile-save', username: userInput.value.trim(), password: passInput.value }, window.location.origin);
            }
            status.textContent = 'saved locally (plaintext)';
            status.className = 'rs2b0t-load-status rs2b0t-load-ok';
        });
```

- [ ] **Step 5: Delete the superseded runtime module**

```bash
git rm src/bot/runtime/Profiles.ts test/runtime/profiles.test.ts
```

- [ ] **Step 6: Verify build + suite**

Run: `bunx tsc --noEmit && bun run build:bot:dev && bun test`
Expected: clean typecheck, bundle builds, all tests pass (ProfileVault/VaultPrompt/ProfileChooser suites included; profiles.test.ts gone).

- [ ] **Step 7: Commit**

```bash
git add src/bot/multibox/ProfileChooser.ts src/bot/multibox/main.ts src/bot/ui/BotPanel.ts test/multibox/ProfileChooser.test.ts
git commit -m "feat(multibox): route all profile access through the encrypted vault"
```

---

### Task 4: Smoke rework + full validation

**Files:**
- Modify: `tools/multibox-test.ts`

**Interfaces:**
- Consumes: `#mbx-vault-pass` / `#mbx-vault-confirm` / `#mbx-vault-go` (Task 2); `multibox.importProfiles` (async) and `multibox.profiles()` (Task 3); existing chooser/drawer/✕ hooks.
- Produces: the shipped validation gate.

- [ ] **Step 1: Extend the Mbx type**

```ts
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; focus(id: number): void; slots(): Snap[]; importProfiles(a: unknown): Promise<number>; profiles(): string[] } };
```

- [ ] **Step 2: Vault setup section**

Insert immediately before the `importProfiles` call (the vault must be unlocked first — `importProfiles` would otherwise block on the modal inside `page.evaluate`):

```ts
    await page.click('#mbx-add');
    await page.fill('#mbx-vault-pass', 'smoke-pass');
    await page.fill('#mbx-vault-confirm', 'smoke-pass');
    await page.click('#mbx-vault-go');
    await page.waitForSelector('.mbx-chooser-overlay:not([hidden]) .mbx-chooser-empty', { timeout: 10000 });
    await page.click('.mbx-chooser-overlay:not([hidden])', { position: { x: 8, y: 8 } });
    console.log('PASS: vault passphrase set; chooser gated behind it');
```

- [ ] **Step 3: Replace the plaintext store assertion**

The old `savedNames` line reads the store as a JSON array — now an encrypted blob. Replace:

```ts
    const savedNames = await page.evaluate(() => (JSON.parse(localStorage.getItem('rs2b0t:multibox:profiles') ?? '[]') as { username: string }[]).map(p => p.username));
```

with:

```ts
    const savedNames = await page.evaluate(() => (globalThis as never as Mbx).multibox.profiles());
    const rawStore = await page.evaluate(() => localStorage.getItem('rs2b0t:multibox:profiles') ?? '');
    if ((JSON.parse(rawStore) as { v?: number }).v !== 1) fail('profile store is not an encrypted blob');
    if (rawStore.includes(u4)) fail('profile store contains a plaintext username');
```

- [ ] **Step 4: Deploy and run the smoke twice**

```bash
sh tools/deploy-local.sh
npx tsx tools/multibox-test.ts http://localhost:8890
npx tsx tools/multibox-test.ts http://localhost:8890
```

Expected: both runs print all PASS lines including `vault passphrase set` and end with `PASS`. (Two runs: the hermetic preamble clears the store, so run 2 re-exercises the set face, not the unlock face — unlock is unit-tested.)

- [ ] **Step 5: Full suite + lint**

```bash
bun test
bunx eslint src/bot/multibox/ProfileVault.ts src/bot/multibox/VaultPrompt.ts src/bot/multibox/ProfileChooser.ts src/bot/multibox/main.ts src/bot/ui/BotPanel.ts eslint.config.ts tools/multibox-test.ts test/multibox/ProfileVault.test.ts test/multibox/VaultPrompt.test.ts test/multibox/ProfileChooser.test.ts
```

Expected: suite green, zero lint errors.

- [ ] **Step 6: Commit**

```bash
git add tools/multibox-test.ts
git commit -m "test(multibox): smoke sets the vault passphrase and asserts ciphertext at rest"
```
