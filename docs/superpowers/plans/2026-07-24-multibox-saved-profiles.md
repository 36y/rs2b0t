# MultiBox Saved Profiles + Rail Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "+ add bot" loads a saved profile (or creates one), each profile's bot auto-logs-in with its last script + config restored (login + arm, no auto-start), and the rail collapses behind a drawer handle.

**Architecture:** A thin profile store in wall-origin localStorage rides the existing per-box persistence — `DomSlotOps` already spawns iframes with `?box=<username>`, and script settings / per-bot Global / last-selected script already persist per box. So profiles only need to remember `{username, password}`, feed `controller.add(account)` (which injects creds and arms auto-login), and stay in sync when a panel saves new creds. The store lives in `src/bot/runtime/` (not `multibox/`) so BotPanel can write back without importing multibox code; this refines the spec's `ProfileStore.ts` placement — same responsibility, one shared home instead of two modules.

**Tech Stack:** TypeScript ESM (explicit `.js` import suffixes), bun test + happy-dom (preloaded via `bunfig.toml`), Playwright-driven Electron smoke via `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-07-24-multibox-saved-profiles-design.md`

## Global Constraints

- Comments: terse, near-comment-free (user law). Only constraint-stating comments; no rationale/history.
- Storage keys: profiles `rs2b0t:multibox:profiles`; legacy roster `rs2b0t:multibox:accounts` (adopt-once); drawer `rs2b0t:multibox:railHidden`.
- Resume depth is login + arm: never call `runner.start` from profile code.
- Wall starts empty: no profile auto-load at boot.
- No new dependencies.
- Tests: `bun test` (happy-dom global; clear `sessionStorage`/`localStorage` in beforeEach/afterEach). Electron smoke runs with `npx tsx`, NEVER `bun` (bun attaches a debugger to Electron).
- Commit only the files you touched (the user commits concurrently on this checkout — never `git add -A`; check `git log` before committing).
- Existing public API (`multibox.add/focus/slots`, `controller.add(account?)`) must keep working — the smoke's first half depends on it.

---

### Task 1: Profiles store (`src/bot/runtime/Profiles.ts`)

**Files:**
- Create: `src/bot/runtime/Profiles.ts`
- Test: `test/runtime/profiles.test.ts`

**Interfaces:**
- Consumes: `boxId()` from `src/bot/runtime/box.ts` (returns `''` outside a multibox iframe).
- Produces (later tasks import all of these from `#/bot/runtime/Profiles.js` / `../runtime/Profiles.js`):
  - `interface Profile { username: string; password: string }`
  - `listProfiles(): Profile[]`
  - `upsertProfile(p: Profile): void`
  - `removeProfile(username: string): void`
  - `saveProfileForBox(username: string, password: string, box?: string): void`

- [ ] **Step 1: Write the failing test**

`test/runtime/profiles.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { listProfiles, removeProfile, saveProfileForBox, upsertProfile } from '#/bot/runtime/Profiles.js';

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
};
beforeEach(clearAll);
afterEach(clearAll);

describe('Profiles', () => {
    test('empty store lists nothing', () => {
        expect(listProfiles()).toEqual([]);
    });

    test('upsert adds, then updates in place preserving order', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        upsertProfile({ username: 'bob', password: 'b' });
        upsertProfile({ username: 'alice', password: 'a2' });
        expect(listProfiles()).toEqual([
            { username: 'alice', password: 'a2' },
            { username: 'bob', password: 'b' }
        ]);
    });

    test('upsert rejects an empty username', () => {
        upsertProfile({ username: '', password: 'x' });
        expect(listProfiles()).toEqual([]);
    });

    test('remove deletes by username', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        removeProfile('alice');
        expect(listProfiles()).toEqual([]);
    });

    test('adopts the legacy pre-#30 roster when no profiles key exists', () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ username: 'old', password: 'p' }, { username: 7, password: 'x' }]));
        expect(listProfiles()).toEqual([{ username: 'old', password: 'p' }]);
        expect(localStorage.getItem(KEY)).toBe(JSON.stringify([{ username: 'old', password: 'p' }]));
    });

    test('an emptied store does not resurrect the legacy roster', () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify([{ username: 'old', password: 'p' }]));
        expect(listProfiles()).toEqual([{ username: 'old', password: 'p' }]);
        removeProfile('old');
        expect(listProfiles()).toEqual([]);
    });

    test('malformed stored JSON reads as absent', () => {
        localStorage.setItem(KEY, '{nope');
        expect(listProfiles()).toEqual([]);
    });

    test('saveProfileForBox writes only inside a named box', () => {
        saveProfileForBox('alice', 'a', '');
        expect(listProfiles()).toEqual([]);
        saveProfileForBox('', 'pw', 'somebox');
        expect(listProfiles()).toEqual([]);
        saveProfileForBox('alice', 'a', 'alice');
        expect(listProfiles()).toEqual([{ username: 'alice', password: 'a' }]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/runtime/profiles.test.ts`
Expected: FAIL — cannot resolve `#/bot/runtime/Profiles.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/runtime/Profiles.ts`:

```ts
import { boxId } from './box.js';

export interface Profile {
    username: string;
    password: string;
}

const KEY = 'rs2b0t:multibox:profiles';
const LEGACY_KEY = 'rs2b0t:multibox:accounts';

const hasLocal = typeof localStorage !== 'undefined';

function parse(raw: string | null): Profile[] | null {
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

function save(profiles: Profile[]): void {
    if (hasLocal) {
        localStorage.setItem(KEY, JSON.stringify(profiles));
    }
}

export function listProfiles(): Profile[] {
    if (!hasLocal) {
        return [];
    }
    const cur = parse(localStorage.getItem(KEY));
    if (cur) {
        return cur;
    }
    // adopt the pre-#30 AccountRoster once
    const legacy = parse(localStorage.getItem(LEGACY_KEY));
    if (legacy) {
        save(legacy);
        return legacy;
    }
    return [];
}

export function upsertProfile(p: Profile): void {
    if (p.username.length === 0) {
        return;
    }
    const all = listProfiles();
    const i = all.findIndex(x => x.username === p.username);
    const entry = { username: p.username, password: p.password };
    if (i >= 0) {
        all[i] = entry;
    } else {
        all.push(entry);
    }
    save(all);
}

export function removeProfile(username: string): void {
    save(listProfiles().filter(x => x.username !== username));
}

export function saveProfileForBox(username: string, password: string, box = boxId()): void {
    if (box === '' || username.length === 0) {
        return;
    }
    upsertProfile({ username, password });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/runtime/profiles.test.ts`
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/runtime/Profiles.ts test/runtime/profiles.test.ts
git commit -m "feat(multibox): profile store with legacy-roster adoption"
```

---

### Task 2: Panel creds write-back

**Files:**
- Modify: `src/bot/ui/BotPanel.ts` (imports block; Save handler at ~line 225)

**Interfaces:**
- Consumes: `saveProfileForBox(username, password)` from Task 1 (default `box = boxId()` — standalone bot.html has box `''`, so this is a no-op there).
- Produces: nothing new; behavior only.

No new unit test: the guard logic is covered by Task 1's `saveProfileForBox` tests and there is no BotPanel DOM harness; the end-to-end effect is asserted by the smoke in Task 6.

- [ ] **Step 1: Add the import**

In `src/bot/ui/BotPanel.ts`, next to the existing `Credentials` import:

```ts
import { saveProfileForBox } from '../runtime/Profiles.js';
```

- [ ] **Step 2: Write back on Save**

In `buildCredentials()`, extend the Save handler:

```ts
        button(buttons, 'Save', () => {
            Credentials.save(userInput.value.trim(), passInput.value);
            saveProfileForBox(userInput.value.trim(), passInput.value);
            status.textContent = 'saved locally (plaintext)';
            status.className = 'rs2b0t-load-status rs2b0t-load-ok';
        });
```

- [ ] **Step 3: Verify build + suite**

Run: `bunx tsc --noEmit && bun test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/bot/ui/BotPanel.ts
git commit -m "feat(multibox): panel Save writes creds back to the bot's profile"
```

---

### Task 3: ProfileChooser modal component

**Files:**
- Create: `src/bot/multibox/ProfileChooser.ts`
- Test: `test/multibox/ProfileChooser.test.ts`

**Interfaces:**
- Consumes: `listProfiles` / `upsertProfile` / `removeProfile` / `Profile` from Task 1.
- Produces (Task 4 consumes): `class ProfileChooser { constructor(onLoad: (p: Profile) => void); readonly el: HTMLDivElement; open(): void; close(): void }`. Stable DOM hooks (smoke + CSS): `.mbx-chooser-overlay` (el, `hidden` when closed), `.mbx-profile-row`, `.mbx-profile-name`, `.mbx-profile-del`, `#mbx-new-user`, `#mbx-new-pass`, `#mbx-new-go`, `.mbx-chooser-empty`.

- [ ] **Step 1: Write the failing test**

`test/multibox/ProfileChooser.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProfileChooser } from '#/bot/multibox/ProfileChooser.js';
import { listProfiles, upsertProfile, type Profile } from '#/bot/runtime/Profiles.js';

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '';
};
beforeEach(clearAll);
afterEach(clearAll);

function make(): { chooser: ProfileChooser; loaded: Profile[] } {
    const loaded: Profile[] = [];
    const chooser = new ProfileChooser(p => loaded.push(p));
    document.body.appendChild(chooser.el);
    return { chooser, loaded };
}

describe('ProfileChooser', () => {
    test('starts hidden; open lists saved profiles', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        upsertProfile({ username: 'bob', password: 'b' });
        const { chooser } = make();
        expect(chooser.el.hidden).toBe(true);
        chooser.open();
        expect(chooser.el.hidden).toBe(false);
        const names = Array.from(chooser.el.querySelectorAll('.mbx-profile-name')).map(n => n.textContent);
        expect(names).toEqual(['alice', 'bob']);
    });

    test('clicking a row loads that profile and closes', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('.mbx-profile-row') as HTMLElement).click();
        expect(loaded).toEqual([{ username: 'alice', password: 'a' }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('the delete button removes the profile without loading it', () => {
        upsertProfile({ username: 'alice', password: 'a' });
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('.mbx-profile-del') as HTMLElement).click();
        expect(listProfiles()).toEqual([]);
        expect(loaded).toEqual([]);
        expect(chooser.el.hidden).toBe(false);
        expect(chooser.el.querySelector('.mbx-chooser-empty')).not.toBeNull();
    });

    test('create-new trims, saves and loads the profile', () => {
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('#mbx-new-user') as HTMLInputElement).value = ' carol ';
        (chooser.el.querySelector('#mbx-new-pass') as HTMLInputElement).value = 'pw';
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(listProfiles()).toEqual([{ username: 'carol', password: 'pw' }]);
        expect(loaded).toEqual([{ username: 'carol', password: 'pw' }]);
        expect(chooser.el.hidden).toBe(true);
    });

    test('create-new with an empty username does nothing', () => {
        const { chooser, loaded } = make();
        chooser.open();
        (chooser.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        expect(loaded).toEqual([]);
        expect(chooser.el.hidden).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/multibox/ProfileChooser.test.ts`
Expected: FAIL — cannot resolve `#/bot/multibox/ProfileChooser.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/multibox/ProfileChooser.ts`:

```ts
import { listProfiles, removeProfile, upsertProfile, type Profile } from '../runtime/Profiles.js';

export class ProfileChooser {
    readonly el: HTMLDivElement;

    private list: HTMLDivElement;
    private user: HTMLInputElement;
    private pass: HTMLInputElement;

    constructor(private onLoad: (p: Profile) => void) {
        this.el = document.createElement('div');
        this.el.className = 'mbx-chooser-overlay';
        this.el.hidden = true;
        this.el.addEventListener('click', ev => {
            if (ev.target === this.el) {
                this.close();
            }
        });

        const box = document.createElement('div');
        box.className = 'mbx-chooser';

        const title = document.createElement('div');
        title.className = 'mbx-chooser-title';
        title.textContent = 'saved profiles';

        this.list = document.createElement('div');
        this.list.className = 'mbx-chooser-list';

        const form = document.createElement('form');
        form.className = 'mbx-chooser-form';
        this.user = document.createElement('input');
        this.user.id = 'mbx-new-user';
        this.user.placeholder = 'username';
        this.pass = document.createElement('input');
        this.pass.id = 'mbx-new-pass';
        this.pass.type = 'password';
        this.pass.placeholder = 'password';
        const go = document.createElement('button');
        go.id = 'mbx-new-go';
        go.type = 'submit';
        go.textContent = 'create + load';
        form.append(this.user, this.pass, go);
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            const username = this.user.value.trim();
            if (username.length === 0) {
                return;
            }
            const p = { username, password: this.pass.value };
            upsertProfile(p);
            this.user.value = '';
            this.pass.value = '';
            this.close();
            this.onLoad(p);
        });

        box.append(title, this.list, form);
        this.el.appendChild(box);
    }

    open(): void {
        this.render();
        this.el.hidden = false;
        this.user.focus();
    }

    close(): void {
        this.el.hidden = true;
    }

    private render(): void {
        this.list.textContent = '';
        const profiles = listProfiles();
        if (profiles.length === 0) {
            const none = document.createElement('div');
            none.className = 'mbx-chooser-empty';
            none.textContent = 'no saved profiles yet';
            this.list.appendChild(none);
            return;
        }
        for (const p of profiles) {
            const row = document.createElement('div');
            row.className = 'mbx-profile-row';
            const name = document.createElement('span');
            name.className = 'mbx-profile-name';
            name.textContent = p.username;
            const del = document.createElement('button');
            del.className = 'mbx-profile-del';
            del.type = 'button';
            del.textContent = '✕';
            del.addEventListener('click', ev => {
                ev.stopPropagation();
                removeProfile(p.username);
                this.render();
            });
            row.append(name, del);
            row.addEventListener('click', () => {
                this.close();
                this.onLoad(p);
            });
            this.list.appendChild(row);
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/multibox/ProfileChooser.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/multibox/ProfileChooser.ts test/multibox/ProfileChooser.test.ts
git commit -m "feat(multibox): load-or-create profile chooser modal"
```

---

### Task 4: Wire the chooser into the wall (+ importProfiles API + CSS)

**Files:**
- Modify: `src/bot/multibox/main.ts`
- Modify: `public-bot/multibox.html` (CSS block only)

**Interfaces:**
- Consumes: `ProfileChooser` (Task 3); `upsertProfile`, `Profile` (Task 1); existing `controller.add(account)` — injects creds then arms auto-login; box id = username so settings/last-script restore via existing per-box persistence.
- Produces: `multibox.importProfiles(json: string | Profile[]): number` on the global API (returns count imported); "+ add bot" opens the chooser instead of adding an empty slot.

- [ ] **Step 1: Rewire main.ts**

In `src/bot/multibox/main.ts` add imports:

```ts
import { ProfileChooser } from './ProfileChooser.js';
import { upsertProfile, type Profile } from '../runtime/Profiles.js';
```

Replace the add-tile listener (and its "No prompt" comment):

```ts
    const chooser = new ProfileChooser(p => {
        controller.add(p);
        renderRail();
    });
    document.body.appendChild(chooser.el);
    addTile.addEventListener('click', () => chooser.open());
```

Extend the global API object:

```ts
    (globalThis as Record<string, unknown>).multibox = {
        controller,
        add: (a?: Account) => controller.add(a),
        focus: (id: number) => { controller.focus(id); renderRail(); },
        slots: () => controller.snapshot(),
        importProfiles: (json: string | Profile[]): number => {
            const arr = typeof json === 'string' ? (JSON.parse(json) as Profile[]) : json;
            let n = 0;
            for (const p of Array.isArray(arr) ? arr : []) {
                if (p && typeof p.username === 'string' && p.username.length > 0 && typeof p.password === 'string') {
                    upsertProfile({ username: p.username, password: p.password });
                    n++;
                }
            }
            return n;
        }
    };
```

- [ ] **Step 2: Add the chooser CSS**

In `public-bot/multibox.html`, append inside the `<style>` block (before `</style>`):

```css
        .mbx-chooser-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
        .mbx-chooser-overlay[hidden] { display: none; }
        .mbx-chooser { width: 300px; max-height: 70vh; overflow-y: auto; background: #111; border: 1px solid #333; border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .mbx-chooser-title { color: #5be05b; }
        .mbx-chooser-list { display: flex; flex-direction: column; gap: 4px; }
        .mbx-chooser-empty { color: #666; }
        .mbx-profile-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border: 1px solid #2c2c2c; border-radius: 4px; cursor: pointer; }
        .mbx-profile-row:hover { border-color: #04A800; }
        .mbx-profile-del { background: none; border: 0; color: #666; cursor: pointer; font: inherit; }
        .mbx-profile-del:hover { color: #e05b5b; }
        .mbx-chooser-form { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #2c2c2c; padding-top: 8px; }
        .mbx-chooser-form input { background: #000; border: 1px solid #333; color: #ddd; padding: 5px 7px; border-radius: 3px; font: inherit; }
        .mbx-chooser-form button { background: #07330a; border: 1px solid #04A800; color: #5be05b; padding: 5px 7px; border-radius: 3px; cursor: pointer; font: inherit; }
```

- [ ] **Step 3: Verify build + suite**

Run: `bunx tsc --noEmit && bun run build:bot:dev && bun test`
Expected: clean typecheck, bundle builds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/bot/multibox/main.ts public-bot/multibox.html
git commit -m "feat(multibox): + add bot opens the profile chooser; importProfiles API"
```

---

### Task 5: Rail drawer

**Files:**
- Modify: `public-bot/multibox.html` (handle element + CSS)
- Modify: `src/bot/multibox/DomSlotOps.ts` (live rail width; mirror pause when hidden)
- Modify: `src/bot/multibox/main.ts` (toggle + persistence)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `#mbx-drawer` handle; `mbx-rail-hidden` class on `#mbx-app`; state persisted under `rs2b0t:multibox:railHidden` (`'1'`/`'0'`).

No unit test: this is DOM/CSS wiring with no extractable logic (the repo does not unit-test `DomSlotOps`); the smoke in Task 6 asserts hide/show behavior.

- [ ] **Step 1: Add the handle + CSS**

In `public-bot/multibox.html`, add the handle as the last child of `#mbx-app`:

```html
    <div id="mbx-app">
        <div id="mbx-main"></div>
        <div id="mbx-rail">
            <div id="mbx-add" class="mbx-addtile">+ add bot</div>
        </div>
        <div id="mbx-drawer" title="show/hide bots">▶</div>
    </div>
```

Append to the `<style>` block:

```css
        #mbx-drawer { position: fixed; top: 50%; right: 264px; transform: translateY(-50%); z-index: 50; width: 16px; height: 56px; display: flex; align-items: center; justify-content: center; background: #111; border: 1px solid #333; border-right: 0; border-radius: 4px 0 0 4px; color: #666; cursor: pointer; }
        #mbx-drawer:hover { color: #04A800; border-color: #04A800; }
        #mbx-app.mbx-rail-hidden #mbx-rail { display: none; }
        #mbx-app.mbx-rail-hidden #mbx-drawer { right: 0; }
        #mbx-app.mbx-rail-hidden .mbx-slot.is-focused .mbx-clip { right: 0; }
```

- [ ] **Step 2: DomSlotOps reads the live rail width + pauses hidden mirrors**

In `src/bot/multibox/DomSlotOps.ts`, add below the `RAIL_W` constant:

```ts
function railWidth(): number {
    return document.getElementById('mbx-rail')?.offsetWidth ?? RAIL_W;
}
```

In `applyLayout()`, replace `const mainW = window.innerWidth - RAIL_W;` with:

```ts
            const mainW = window.innerWidth - railWidth();
```

In `paintMirror`, replace the mode guard with:

```ts
        if (this.mode !== 'focused' || this.el.offsetParent === null) {
            return;
        }
```

(`offsetParent` is null while the rail is `display: none` — the mirror copy is skipped; the bot keeps ticking.)

- [ ] **Step 3: Toggle + persistence in main.ts**

In `boot()` in `src/bot/multibox/main.ts` (after the chooser wiring):

```ts
    const app = document.getElementById('mbx-app')!;
    const drawer = document.getElementById('mbx-drawer')!;
    const RAIL_HIDDEN_KEY = 'rs2b0t:multibox:railHidden';
    function setRailHidden(hidden: boolean): void {
        app.classList.toggle('mbx-rail-hidden', hidden);
        drawer.textContent = hidden ? '◀' : '▶';
        localStorage.setItem(RAIL_HIDDEN_KEY, hidden ? '1' : '0');
        // the focused slot re-fits the widened/narrowed main pane via its resize listener
        window.dispatchEvent(new Event('resize'));
    }
    drawer.addEventListener('click', () => setRailHidden(!app.classList.contains('mbx-rail-hidden')));
    if (localStorage.getItem(RAIL_HIDDEN_KEY) === '1') {
        setRailHidden(true);
    }
```

- [ ] **Step 4: Verify build + suite**

Run: `bunx tsc --noEmit && bun run build:bot:dev && bun test`
Expected: clean typecheck, bundle builds, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add public-bot/multibox.html src/bot/multibox/DomSlotOps.ts src/bot/multibox/main.ts
git commit -m "feat(multibox): collapsible rail drawer"
```

---

### Task 6: Smoke extension + full local validation

**Files:**
- Modify: `tools/multibox-test.ts`

**Interfaces:**
- Consumes: `multibox.importProfiles` (Task 4); DOM hooks `#mbx-add`, `.mbx-profile-row`, `#mbx-new-user`, `#mbx-new-pass`, `#mbx-new-go` (Task 3), `#mbx-drawer`, `#mbx-rail` (Task 5); localStorage key `rs2b0t:multibox:profiles` (Task 1).
- Produces: the shipped validation gate for this feature.

- [ ] **Step 1: Extend the Mbx type**

In `tools/multibox-test.ts`, replace the `Mbx` type:

```ts
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; focus(id: number): void; slots(): Snap[]; importProfiles(a: unknown): number } };
```

- [ ] **Step 2: Add the profile + drawer assertions**

Insert before the final `console.log('\nPASS');`:

```ts
    const u3 = `mbx${tag}c`;
    const u4 = `mbx${tag}d`;

    const imported = await page.evaluate(u => (globalThis as never as Mbx).multibox.importProfiles([{ username: u, password: 'test' }]), u3);
    if (imported !== 1) fail(`importProfiles imported ${imported}, expected 1`);
    await page.click('#mbx-add');
    await page.click(`.mbx-profile-row:has-text("${u3}")`);
    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 3 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(() => fail('profile-loaded bot did not reach ingame within 90s'));
    console.log('PASS: chooser loaded a saved profile into a live slot');

    await page.click('#mbx-add');
    await page.fill('#mbx-new-user', u4);
    await page.fill('#mbx-new-pass', 'test');
    await page.click('#mbx-new-go');
    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 4 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(() => fail('create-new bot did not reach ingame within 90s'));
    const savedNames = await page.evaluate(() => (JSON.parse(localStorage.getItem('rs2b0t:multibox:profiles') ?? '[]') as { username: string }[]).map(p => p.username));
    if (!savedNames.includes(u4)) fail(`create-new did not persist a profile (saved: ${savedNames.join(', ')})`);
    const boxed = await page.evaluate(u => Array.from(document.querySelectorAll('iframe')).some(f => f.src.includes(`box=${u}`)), u3);
    if (!boxed) fail('profile bot iframe missing its ?box= namespace');
    console.log('PASS: create-new persisted a profile; slots namespaced by username');

    await page.click('#mbx-drawer');
    if (!(await page.evaluate(() => document.getElementById('mbx-rail')!.offsetWidth === 0))) fail('drawer did not hide the rail');
    await page.click('#mbx-drawer');
    if (!(await page.evaluate(() => document.getElementById('mbx-rail')!.offsetWidth > 0))) fail('drawer did not restore the rail');
    console.log('PASS: rail drawer toggles');
```

- [ ] **Step 3: Deploy and run the smoke**

```bash
sh tools/deploy-local.sh
npx tsx tools/multibox-test.ts http://localhost:8890
```

Expected: all six PASS lines (two accounts ingame; render decoupled; switch keeps sessions; chooser load; create-new persisted; drawer toggles), then `PASS`. Local engine at :8890 must be up. Give it a LONG budget (4 bots × login waits).

- [ ] **Step 4: Full suite + lint on touched files**

```bash
bun test
bunx eslint src/bot/runtime/Profiles.ts src/bot/multibox/ProfileChooser.ts src/bot/multibox/main.ts src/bot/multibox/DomSlotOps.ts src/bot/ui/BotPanel.ts tools/multibox-test.ts test/runtime/profiles.test.ts test/multibox/ProfileChooser.test.ts
```

Expected: suite green; zero lint errors on touched files.

- [ ] **Step 5: Commit**

```bash
git add tools/multibox-test.ts
git commit -m "test(multibox): smoke covers profile chooser, create-new and rail drawer"
```
