# Hosted MultiBox Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the MultiBox wall same-origin from the engine image at `/rs2b0t/wall`, alongside the unchanged single client, so a hosted user runs several accounts in one tab instead of one tab each.

**Architecture:** `tools/pack-rs2b0t.sh` already stages a self-contained `/rs2b0t/` subtree into the engine image; it grows to stage the wall's page and bundle too. Everything stays same-origin, so `/crc` and both WebSockets work exactly as they do for the single client — no proxy, no CORS. Two code changes clear the way: the wall's iframe target must exist in the subtree, and the resource card must degrade honestly when no proxy is serving its telemetry endpoint.

**Tech Stack:** TypeScript, Bun (build + test), `bun:test` with happy-dom, POSIX sh for packaging, playwright-core for live smokes, Caddy + Docker in the `rs2b2t` repo.

**Spec:** `docs/superpowers/specs/2026-07-26-hosted-multibox-wall-design.md`

## Global Constraints

- Run tests with `bun test <path>`. There is no `test` npm script.
- Import inside `src/` with the `#/*` alias (`#/bot/multibox/ResourcePanel.js`) or a relative `./`-path matching the file's neighbours; both appear in the codebase. Always keep the `.js` extension.
- Comments are near-absent by house style. Write a comment only where the *why* is genuinely non-obvious; never restate the code, never leave rationale or history.
- Never push to `main` — it is PR-only. All work lands on `hosted-multibox-wall`.
- The `prod` build target aborts without `PROD_RSAN`. For every local pack, pass the **local** engine modulus, never a production value.
- Do not add a `/__rs2b0t/resources` route to the engine. The card measures the user's browser; a server-side sample would be wrong rather than absent.
- The Caddy path is `/rs2b0t/wall` with **no** trailing slash, and no redirect to a trailing-slash form.

---

### Task 1: Resource card — an absent monitor hides host rows, a broken one stays loud

**Files:**
- Modify: `src/bot/multibox/ResourcePanel.ts`
- Modify: `public-bot/multibox.html:85-86`
- Modify: `src/bot/multibox/main.ts:17-25`
- Test: `test/multibox/ResourcePanel.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ResourcePanelNodes` gains optional `cpuRow?: HTMLElement` and `memoryRow?: HTMLElement`. `ResourcePanelOptions` gains `now?: () => number`. No other task depends on these.

**Why this is needed:** `refresh()` fetches `/__rs2b0t/resources` *first*, and every failure path short-circuits into `renderAll()`, which writes the same failure text to `cpu`, `memory` **and** `traffic` (`ResourcePanel.ts:335`). The in-page traffic collector is only consulted later, inside `readTraffic()`, which that early return never reaches. Hosted (and local-dev) walls have no proxy serving that endpoint, so without this change the wall loses its traffic row too — even though traffic is fully measurable in the browser.

- [ ] **Step 1: Write the failing tests**

Add to `test/multibox/ResourcePanel.test.ts`. Note `makeNodes()` already exists in this file; add a second helper rather than changing it, so existing tests keep exercising the no-row-elements shape.

```ts
function makeNodesWithRows(): ResourcePanelNodes & { cpuRow: HTMLElement; memoryRow: HTMLElement } {
    const base = makeNodes();
    const cpuRow = document.createElement('div');
    const memoryRow = document.createElement('div');
    document.body.append(cpuRow, memoryRow);
    return { ...base, cpuRow, memoryRow };
}

function browserTraffic(receivedBytes: number, sentBytes: number): TrafficSnapshot {
    return { status: 'available', receivedBytes, sentBytes };
}

describe('ResourcePanel without a resource monitor', () => {
    test('a 404 hides the host rows and keeps traffic measured in the browser', async () => {
        const nodes = makeNodesWithRows();
        let bytes = 0;
        let clock = 1_700_000_000_000;
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response({}, 404),
            getTrafficSnapshot: () => browserTraffic(bytes, bytes),
            now: () => clock
        });

        await panel.refresh();
        expect(nodes.cpuRow.hidden).toBe(true);
        expect(nodes.memoryRow.hidden).toBe(true);

        bytes = 2048;
        clock += 1000;
        await panel.refresh();
        expect(nodes.traffic.textContent).toContain('↓');
        expect(nodes.traffic.textContent).not.toContain('offline');
    });

    test('once latched off it stops polling the missing endpoint', async () => {
        const nodes = makeNodesWithRows();
        let fetches = 0;
        const panel = new ResourcePanel(nodes, {
            fetch: async () => {
                fetches++;
                return response({}, 404);
            },
            getTrafficSnapshot: () => browserTraffic(0, 0),
            now: () => 1_700_000_000_000
        });

        await panel.refresh();
        await panel.refresh();
        await panel.refresh();
        expect(fetches).toBe(1);
    });

    test('a monitor that exists but is broken still reports on every row', async () => {
        const nodes = makeNodesWithRows();
        const panel = new ResourcePanel(nodes, {
            fetch: async () => response({}, 500),
            getTrafficSnapshot: () => browserTraffic(0, 0),
            now: () => 1_700_000_000_000
        });

        await panel.refresh();
        expect(nodes.cpuRow.hidden).toBe(false);
        expect(nodes.memoryRow.hidden).toBe(false);
        expect(nodes.cpu.textContent).toContain('monitor error');
        expect(nodes.traffic.textContent).toContain('monitor error');
    });
});
```

Add `TrafficSnapshot` to the existing type import at the top of the file if it is not already imported — it is, on line 3.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/multibox/ResourcePanel.test.ts`
Expected: FAIL — the three new tests error on `now` not being a valid option and on `hidden` staying `false`.

- [ ] **Step 3: Implement**

In `src/bot/multibox/ResourcePanel.ts`, extend the two exported shapes:

```ts
export interface ResourcePanelNodes {
    botCount: HTMLElement;
    cpu: HTMLElement;
    memory: HTMLElement;
    traffic: HTMLElement;
    cpuRow?: HTMLElement;
    memoryRow?: HTMLElement;
}

export interface ResourcePanelOptions {
    fetch?: ResourceFetch;
    getTrafficSnapshot?: () => TrafficSnapshot;
    endpoint?: string;
    intervalMs?: number;
    now?: () => number;
}
```

Add two private fields alongside the existing ones:

```ts
private readonly now: () => number;
private hostTelemetry = true;
```

and in the constructor:

```ts
this.now = options.now ?? (() => Date.now());
```

Replace the opening of `refresh()` so an absent monitor is handled before the existing failure paths:

```ts
async refresh(): Promise<boolean> {
    if (!this.hostTelemetry) {
        return this.refreshTrafficOnly();
    }

    let response: Response;
    try {
        response = await this.fetchResource(this.endpoint, { cache: 'no-store' });
    } catch {
        this.previousTraffic = null;
        this.renderAll(OFFLINE, 'resource monitor is offline');
        return false;
    }

    if (response.status === 404) {
        this.hostTelemetry = false;
        this.previousTraffic = null;
        for (const row of [this.nodes.cpuRow, this.nodes.memoryRow]) {
            if (row) {
                row.hidden = true;
            }
        }
        return this.refreshTrafficOnly();
    }

    if (!response.ok) {
```

Leave the rest of `refresh()` untouched. Add one private method next to `rateForTraffic`:

```ts
private refreshTrafficOnly(): boolean {
    const traffic = this.readTraffic(null, this.now());
    render(this.nodes.traffic, traffic);
    return traffic.status !== 'error';
}
```

In `public-bot/multibox.html`, give the two host rows ids (lines 85-86). Change only the opening `<div>` of each row:

```html
<div id="mbx-resource-cpu-row" class="mbx-resource-row" title="CPU used by every process/thread in the dedicated bot browser"><span class="mbx-resource-label">CPU</span><span id="mbx-resource-cpu" class="mbx-resource-value">measuring…</span></div>
<div id="mbx-resource-memory-row" class="mbx-resource-row" title="Current memory charged to the dedicated bot browser"><span class="mbx-resource-label">RAM</span><span id="mbx-resource-memory" class="mbx-resource-value">measuring…</span></div>
```

In `src/bot/multibox/main.ts`, pass the row elements:

```ts
    const resources = new ResourcePanel(
        {
            botCount: document.getElementById('mbx-resource-bots')!,
            cpu: document.getElementById('mbx-resource-cpu')!,
            memory: document.getElementById('mbx-resource-memory')!,
            traffic: document.getElementById('mbx-resource-traffic')!,
            cpuRow: document.getElementById('mbx-resource-cpu-row')!,
            memoryRow: document.getElementById('mbx-resource-memory-row')!
        },
        { getTrafficSnapshot: () => traffic.snapshot() }
    );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/multibox/`
Expected: PASS — 52 tests. The 49 that passed before must still pass; the first test in the file asserts against `multibox.html`'s markup, so confirm it did not break on the id additions.

- [ ] **Step 5: Commit**

```bash
git add src/bot/multibox/ResourcePanel.ts src/bot/multibox/main.ts public-bot/multibox.html test/multibox/ResourcePanel.test.ts
git commit -m "fix(multibox): an absent resource monitor took the traffic row down with it

A wall served straight from the engine has no proxy answering
/__rs2b0t/resources, and refresh() fetched before it read the in-page
collector — so a 404 blanked all three rows, including the one metric the
browser can measure by itself.

Treat a 404 as absent: hide the host rows once, keep reporting traffic. Every
other failure still shouts on every row, because a monitor that exists and is
misbehaving is a different thing from one that was never there."
```

---

### Task 2: Login key falls back to the same-origin client bundle

**Files:**
- Modify: `src/config/loginKey.ts` (already present, untracked)
- Test: `test/config/loginKey.test.ts` (already present, untracked)

**Interfaces:**
- Consumes: nothing.
- Produces: `extractLoginModulus(text: string): string | null` — unanchored, finds a ≥250-digit run anywhere in a body. `parseLoginModulus` keeps its existing anchored behaviour and signature.

**Why two functions:** `parseLoginModulus` is anchored `/^\d{250,}$/` against the whole trimmed body, which is right for the proxy's plain-text reply and can never match inside a JS bundle. The fallback reads a minified bundle, so it needs the unanchored form. Keeping them separate stops the strict endpoint from silently accepting noise.

- [ ] **Step 1: Write the failing tests**

Add to `test/config/loginKey.test.ts`:

```ts
function serveByUrl(routes: Record<string, { body: string; ok?: boolean }>): void {
    stubFetch(async (input: string) => {
        const route = routes[input];
        return route ? new Response(route.body, { status: route.ok === false ? 404 : 200 }) : new Response('missing', { status: 404 });
    });
}

test('the anchored parser rejects a bundle the extractor accepts', () => {
    const bundle = `var t=${MODULUS_A};function e(){}`;
    expect(parseLoginModulus(bundle)).toBeNull();
    expect(extractLoginModulus(bundle)).toBe(MODULUS_A);
    expect(extractLoginModulus('no digits here')).toBeNull();
    expect(extractLoginModulus('12345')).toBeNull();
});

test('a missing /loginkey falls back to the same-origin client bundle', async () => {
    serveByUrl({
        '/loginkey': { body: 'not found', ok: false },
        '/client/client.js': { body: `var t=${MODULUS_B};` }
    });
    expect(await refreshLoginKey()).toBe(true);
    expect(loginModulus()).toBe(BigInt(MODULUS_B));
});

test('/loginkey wins when both answer', async () => {
    serveByUrl({
        '/loginkey': { body: MODULUS_A },
        '/client/client.js': { body: `var t=${MODULUS_B};` }
    });
    expect(await refreshLoginKey()).toBe(true);
    expect(loginModulus()).toBe(BigInt(MODULUS_A));
});

test('both sources failing leaves the baked key alone', async () => {
    serveByUrl({});
    expect(await refreshLoginKey()).toBe(false);
});
```

Extend the module import on line 3 to include `extractLoginModulus`. `stubFetch` currently types its argument as a zero-arg impl; widen it so the URL is visible:

```ts
function stubFetch(impl: (input: string) => Promise<Response>): void {
    globalThis.fetch = impl as unknown as typeof fetch;
}
```

`serve()` already ignores its argument, so it still compiles against the widened type.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/config/loginKey.test.ts`
Expected: FAIL — `extractLoginModulus` is not exported.

- [ ] **Step 3: Implement**

In `src/config/loginKey.ts`, add the extractor and rewrite `refreshLoginKey` as a two-source chain. Leave `loginModulus`, `loginExponent`, `parseLoginModulus`, and `resetLoginKey` untouched.

```ts
const CLIENT_BUNDLE = '/client/client.js';

export function extractLoginModulus(text: string): string | null {
    const match = /\d{250,}/.exec(text);
    return match ? match[0] : null;
}

async function readModulus(url: string, extract: (text: string) => string | null): Promise<string | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            return null;
        }
        return extract(await res.text());
    } catch {
        return null;
    }
}

export async function refreshLoginKey(): Promise<boolean> {
    const next = (await readModulus('/loginkey', parseLoginModulus)) ?? (await readModulus(CLIENT_BUNDLE, extractLoginModulus));
    if (!next || next === modulus) {
        return false;
    }

    modulus = next;
    return true;
}
```

Update the file's header comment to say the client re-fetches from `/loginkey` when a proxy is serving one, and otherwise from the same-origin client bundle.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/config/loginKey.test.ts`
Expected: PASS. All pre-existing tests in the file must still pass — in particular `a missing /loginkey route leaves the baked key alone` and `a garbage body leaves the baked key alone`, which now exercise both sources because `serve()` answers every URL.

- [ ] **Step 5: Commit**

```bash
git add src/config/loginKey.ts test/config/loginKey.test.ts
git commit -m "feat(config): recover a rotated login key without a proxy

refreshLoginKey only knew /loginkey, which nothing but tools/live-proxy.ts
serves — so the hosted client, which runs same-origin with no proxy at all,
had no way back from a key rotation.

Fall back to the client bundle the game server already serves. The anchored
parser cannot read a minified bundle, so the fallback gets its own unanchored
extractor rather than loosening the endpoint's."
```

---

### Task 3: Pack the wall into the `/rs2b0t/` subtree

**Files:**
- Modify: `tools/pack-rs2b0t.sh`

**Interfaces:**
- Consumes: `out/multibox.js` — already emitted by `bot.bundle.ts:70`, which `pack-rs2b0t.sh` already runs via `bun run build:bot`. No build change needed.
- Produces: the staged subtree `index.html`, `bot.html`, `multibox.html`, `bot/multibox.js`. Task 5 and Task 8 both assert on these exact paths.

**The trap:** `DomSlotOps.ts:102` resolves every slot to `new URL('bot.html' + qs, document.baseURI).href`. Under `/rs2b0t/multibox.html` that is `/rs2b0t/bot.html` — a file the subtree does not currently contain, because `bot.html` is staged only as `index.html`. Without it every slot 404s while the single client still looks perfectly healthy.

- [ ] **Step 1: Stage the wall's files**

In `tools/pack-rs2b0t.sh`, add `out/multibox.js out/multibox.js.map` to the existing `cp` into `$DEST/bot/`, then extend the page copies:

```sh
cp public-bot/bot.html "$DEST/index.html"
cp public-bot/bot.html "$DEST/bot.html"
cp public-bot/multibox.html "$DEST/multibox.html"
```

- [ ] **Step 2: Stamp every page for cache-busting**

`botclient.js` and `multibox.js` are static assets Cloudflare caches for hours, while the pages themselves are dynamic. Replace the single-page `sed` block with one that stamps all three:

```sh
V="$(shasum out/botclient.js | cut -c1-10)"
M="$(shasum out/multibox.js | cut -c1-10)"

stamp() {
    sed -i '' "$2" "$1" 2>/dev/null || sed -i "$2" "$1"
}

stamp "$DEST/index.html" "s#\./bot/botclient\.js#./bot/botclient.js?v=$V#g"
stamp "$DEST/bot.html" "s#\./bot/botclient\.js#./bot/botclient.js?v=$V#g"
stamp "$DEST/multibox.html" "s#\./bot/multibox\.js#./bot/multibox.js?v=$M#g"
```

Update the header comment (it currently reads `NOT the multibox wall — single instance only`) and the final `echo` to name the wall.

- [ ] **Step 3: Run the pack against the local engine**

The `prod` target aborts without `PROD_RSAN`. Use the **local** modulus, which is the committed default in `bot.bundle.ts:24`:

```bash
PROD_RSAN="$(grep -oE "'[0-9]{250,}'" bot.bundle.ts | head -1 | tr -d "'")" \
ENGINE=~/code/rs2b2t-engine sh tools/pack-rs2b0t.sh
```

That pulls the committed local modulus straight out of `bot.bundle.ts:24`. Verified to yield a value starting `135523076496...`. Never substitute a production modulus here.

- [ ] **Step 4: Verify every file landed and every page is stamped**

```bash
ENGINE=~/code/rs2b2t-engine
ls "$ENGINE/public/rs2b0t/index.html" "$ENGINE/public/rs2b0t/bot.html" \
   "$ENGINE/public/rs2b0t/multibox.html" "$ENGINE/public/rs2b0t/bot/multibox.js"
grep -o 'botclient\.js?v=[0-9a-f]*' "$ENGINE/public/rs2b0t/index.html" "$ENGINE/public/rs2b0t/bot.html"
grep -o 'multibox\.js?v=[0-9a-f]*' "$ENGINE/public/rs2b0t/multibox.html"
```

Expected: all four files listed without error, a `?v=` stamp on both `botclient.js` references, and one on `multibox.js`. An unstamped page means the `sed` pattern missed and a stale bundle will be served after deploy.

- [ ] **Step 5: Commit**

```bash
git add tools/pack-rs2b0t.sh
git commit -m "feat(tools): stage the multibox wall into the hosted subtree

The wall's page and bundle now ship beside the single client, plus bot.html
itself — DomSlotOps resolves every slot relative to baseURI, so a wall at
/rs2b0t/multibox.html asks for /rs2b0t/bot.html, which the subtree only ever
had under the name index.html.

All three pages get a content-hash stamp; the pages are dynamic but the
bundles sit in Cloudflare for hours."
```

---

### Task 4: MultiBox link in the single client's panel

**Files:**
- Modify: `src/bot/runtime/box.ts`
- Modify: `src/bot/ui/BotPanel.ts:50-52`
- Modify: `public-bot/bot.html` (style block)
- Test: `test/runtime/box.test.ts` (create)

**Interfaces:**
- Consumes: `boxId()` from `src/bot/runtime/box.ts`, already imported by `BotPanel.ts:5`.
- Produces: `wallLinkHref(box: string): string | null`.

**Why a helper rather than a DOM test:** `BotPanel`'s constructor is `(root: HTMLElement, host: BotHostImpl)` and building a `BotHostImpl` in a unit test is disproportionate. The decision worth testing is the href rule, so extract that and let `BotPanel` apply it.

**Why `./multibox.html` and not `./wall`:** one build serves two layouts. From `/rs2b0t/index.html` the relative href gives `/rs2b0t/multibox.html`; from local dev's `/bot.html` it gives `/multibox.html`. Both are real files the engine serves by exact path. `./wall` would resolve to `/wall` locally, which does not exist. The pretty `/rs2b0t/wall` URL is for humans and the README.

- [ ] **Step 1: Write the failing test**

Create `test/runtime/box.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { wallLinkHref } from '#/bot/runtime/box.js';

test('the standalone client links to the wall', () => {
    expect(wallLinkHref('')).toBe('./multibox.html');
});

test('a wall slot does not link to the wall it is already inside', () => {
    expect(wallLinkHref('someaccount')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/runtime/box.test.ts`
Expected: FAIL — `wallLinkHref` is not exported from `box.ts`.

- [ ] **Step 3: Implement**

Append to `src/bot/runtime/box.ts`:

```ts
export function wallLinkHref(box: string): string | null {
    return box === '' ? './multibox.html' : null;
}
```

In `src/bot/ui/BotPanel.ts`, extend the import on line 5 to `import { boxId, boxKey, wallLinkHref } from '../runtime/box.js';`, then add the link immediately after `root.appendChild(title);` (line 52):

```ts
        const wallHref = wallLinkHref(boxId());
        if (wallHref) {
            const wall = document.createElement('a');
            wall.className = 'rs2b0t-wall-link';
            wall.href = wallHref;
            wall.textContent = 'MultiBox';
            wall.title = 'Run several accounts in one tab';
            title.appendChild(wall);
        }
```

In `public-bot/bot.html`, add to the style block, next to the other `#rs2b0t` rules:

```css
        .rs2b0t-wall-link {
            float: right;
            color: #04A800;
            text-decoration: none;
            font-weight: normal;
        }

        .rs2b0t-wall-link:hover {
            text-decoration: underline;
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/runtime/ test/ui/`
Expected: PASS, with no regression in the existing `test/ui/` suites.

- [ ] **Step 5: Commit**

```bash
git add src/bot/runtime/box.ts src/bot/ui/BotPanel.ts public-bot/bot.html test/runtime/box.test.ts
git commit -m "feat(ui): point the single client at the wall

Keeping the single client as the default costs discoverability, so the panel
now links to the wall — but only from a standalone client, never from a slot
already inside one.

The href is relative on purpose: one build has to work both at /rs2b0t/ and at
local dev's /bot.html."
```

---

### Task 5: `hosted-wall-test.ts` — prove the packed subtree before prod

**Files:**
- Create: `tools/hosted-wall-test.ts`
- Modify: `tools/run-all-smokes.ts` (exclusion list)

**Interfaces:**
- Consumes: the staged subtree from Task 3 and the hidden host rows from Task 1.
- Produces: nothing other tasks consume.

**Pattern:** mirrors `tools/hosted-proof-test.ts` (same-origin proof against the local engine) and borrows the `globalThis.multibox` driving API from `tools/multibox-test.ts`. Plain Chromium is right here — background throttling is not under test, so there is no reason to reach for Electron.

**Known gap, by design:** the local engine has no Caddy, so the `/rs2b0t/wall` rewrite cannot be exercised locally. This test loads `/rs2b0t/multibox.html` directly. The pretty URL is a post-deploy manual check (see Task 7).

- [ ] **Step 1: Write the test**

Create `tools/hosted-wall-test.ts`:

```ts
import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const tag = Date.now().toString(36).slice(-6);
const u1 = `hw${tag}a`;
const u2 = `hw${tag}b`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

interface Snap { id: number; username: string; ingame: boolean }
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; slots(): Snap[] } };

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await page.goto(`${base}/rs2b0t/multibox.html`);
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    console.log('wall booted at /rs2b0t/');

    const host = await page.evaluate(() => window.location.host);
    if (host !== new URL(base).host) fail(`served from '${host}', expected the game origin '${new URL(base).host}'`);

    await page.evaluate(([a, b]) => {
        const m = (globalThis as never as Mbx).multibox;
        m.add({ username: a, password: 'test' });
        m.add({ username: b, password: 'test' });
    }, [u1, u2]);

    const srcs = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => new URL((f as HTMLIFrameElement).src).pathname));
    if (srcs.length !== 2) fail(`expected 2 slot iframes, got ${srcs.length}`);
    for (const src of srcs) {
        if (src !== '/rs2b0t/bot.html') fail(`slot iframe resolved to '${src}', expected '/rs2b0t/bot.html' — is bot.html staged?`);
    }
    console.log(`slot iframes resolved under /rs2b0t/: ${srcs.join(', ')}`);

    await page.waitForFunction(() => {
        const s = (globalThis as never as Mbx).multibox.slots();
        return s.length === 2 && s.every(x => x.ingame);
    }, undefined, { timeout: 90000 }).catch(() => fail('both bots did not reach ingame within 90s'));

    const users = (await page.evaluate(() => (globalThis as never as Mbx).multibox.slots())).map(s => s.username).sort();
    if (users[0] === users[1]) fail(`accounts collided: ${users.join(', ')}`);
    console.log(`PASS: two distinct accounts ingame (${users.join(', ')})`);

    const card = await page.evaluate(() => ({
        cpuHidden: (document.getElementById('mbx-resource-cpu-row') as HTMLElement).hidden,
        memoryHidden: (document.getElementById('mbx-resource-memory-row') as HTMLElement).hidden,
        bots: document.getElementById('mbx-resource-bots')!.textContent ?? '',
        traffic: document.getElementById('mbx-resource-traffic')!.textContent ?? ''
    }));
    if (!card.cpuHidden || !card.memoryHidden) fail(`host rows still shown with no resource monitor (cpu ${card.cpuHidden}, ram ${card.memoryHidden})`);
    if (!card.bots.startsWith('2 bots')) fail(`bot count read '${card.bots}', expected '2 bots'`);
    if (card.traffic.includes('offline')) fail(`traffic row read '${card.traffic}' — the absent monitor took it down`);
    console.log(`resource card: ${card.bots}, traffic '${card.traffic}', host rows hidden`);

    console.log('PASS — hosted /rs2b0t/ wall works same-origin (prod target, no proxy)');
} finally {
    await browser.close();
}
```

- [ ] **Step 2: Exclude it from the default smoke fleet**

`tools/hosted-wall-test.ts` needs the packed `/rs2b0t/` subtree, not the plain `deploy-local.sh` layout, so it belongs with the SPECIAL-environment smokes. Add it to the `SPECIAL` array at `tools/run-all-smokes.ts:4`:

```ts
const SPECIAL = ['desktop-test', 'hosted-proof-test', 'hosted-wall-test', 'external-script-test', 'e2e-smoke', 'multibox-test', 'rendergate-test', 'merlin-tail-test', 'pip-solo-test'];
```

Line 31 filters on `f.includes(s)`, so the bare name is enough.

- [ ] **Step 3: Run it against the local engine**

The engine must be running (`npm run quickstart` in `~/code/rs2b2t-engine`, web on `:8890`) with the Task 3 pack already staged.

Run: `bun tools/hosted-wall-test.ts http://localhost:8890`
Expected: `PASS — hosted /rs2b0t/ wall works same-origin (prod target, no proxy)`

If it fails on the iframe path, `bot.html` did not stage — go back to Task 3. If it fails on the host rows, Task 1 did not latch off — check what the engine actually returns for `/__rs2b0t/resources`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8890/__rs2b0t/resources
```

Expected `404`. If the engine answers with some other status for unknown paths, widen the check in `refresh()` to match it and update the Task 1 tests to cover both codes.

If the browser crashes rather than failing an assertion, drop `{ swiftshader: true }` and run on the real GPU — two live clients under SwiftShader is markedly heavier than the single client `hosted-proof-test.ts` drives, and SwiftShader has crashed smokes in this repo before.

- [ ] **Step 4: Confirm the single client still passes unchanged**

Run: `bun tools/hosted-proof-test.ts http://localhost:8890`
Expected: `PASS — hosted /rs2b0t/ client works same-origin (prod target, no proxy)`

This is the regression gate on `/rs2b0t` itself; the whole design rests on the single client being untouched.

- [ ] **Step 5: Commit**

```bash
git add tools/hosted-wall-test.ts tools/run-all-smokes.ts
git commit -m "test(tools): prove the hosted wall before it reaches prod

Packs to the local engine and drives the real subtree: two accounts ingame,
slot iframes resolving to /rs2b0t/bot.html, and a resource card that hides the
rows it cannot measure without blanking the one it can.

The iframe-path assertion is the point — a missing bot.html leaves the single
client looking perfectly healthy while every slot 404s."
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/DEV.md:5-9` (run-modes table) and the resource-telemetry section
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Update the run-modes table**

The hosted row's Client cell becomes single **+** wall, with both URLs:

```markdown
| **Hosted (prod)** | `make deploy` *(in `~/code/rs2b2t`)* | single (`/rs2b0t`) + wall (`/rs2b0t/wall`) | **same-origin** at `w1.rs2b2t.com/rs2b0t` |
```

- [ ] **Step 2: Write down the throttling limit**

Add under the hosting section. State it plainly — this is the thing a hosted user most needs to know, and the reason the desktop shell still exists:

```markdown
The hosted wall runs every bot in one tab, so all of them hold full speed while
that tab is visible — a strict improvement on one tab per account, where every
tab but the front one is starved. It does not survive being backgrounded: the
game loop is `setTimeout`-driven and Chrome clamps hidden tabs to 1/sec, so
minimising the wall starves all of it. For unattended running use `bun run b0t`,
whose Electron shell disables background throttling.
```

- [ ] **Step 3: Note what the hosted resource card can and cannot measure**

Add to the resource-telemetry section, which currently describes only the proxy-served case:

```markdown
Bot count and traffic are measured inside the browser, so they work on any wall.
CPU and RAM come from the local proxy's `/__rs2b0t/resources`; a wall served
straight from an engine (hosted, or `deploy-local.sh`) has no such endpoint, and
those two rows are hidden rather than shown as permanently `offline`.
```

- [ ] **Step 4: Update the README**

Extend the existing hosted line so the wall is discoverable:

```markdown
A single-instance build is hosted at **https://w1.rs2b2t.com/rs2b0t** — open it,
log in with an rs2b2t account, pick a script, and run. To run several accounts in
one tab, use the MultiBox wall at **https://w1.rs2b2t.com/rs2b0t/wall** (keep the
tab visible; a backgrounded tab is throttled by the browser).
```

- [ ] **Step 5: Commit**

```bash
git add docs/DEV.md README.md
git commit -m "docs: the hosted client now has a wall

Says what the wall does and does not buy: every bot at full speed in one tab,
and nothing at all once that tab is backgrounded."
```

---

### Task 7: `rs2b2t` repo — route and guard the wall

**Files (all in `~/code/rs2b2t`, a separate repo and a separate branch):**
- Modify: `ops/Caddyfile.game:32-38`
- Modify: `ops/scripts/build.sh:54-57`

**Interfaces:**
- Consumes: the staged subtree from Task 3. `build.sh` already calls `pack-rs2b0t.sh` at line 53 and needs no change there.

- [ ] **Step 1: Branch**

```bash
cd ~/code/rs2b2t
git switch -c hosted-multibox-wall
```

- [ ] **Step 2: Add the route**

In `ops/Caddyfile.game`, after the existing `handle /rs2b0t/` block:

```
	handle /rs2b0t/wall {
		rewrite * /rs2b0t/multibox.html
		reverse_proxy world1:8888
	}
```

The existing matchers are exact-path, so there is no conflict, and `/rs2b0t/bot/*` still falls through to the reverse proxy.

**No trailing slash, and no redirect to one.** Both `./bot/multibox.js` and `DomSlotOps`' `new URL('bot.html', document.baseURI)` resolve against the browser-visible URL, not the rewritten target. From `/rs2b0t/wall` they give `/rs2b0t/bot/multibox.js` and `/rs2b0t/bot.html`, which is correct; from `/rs2b0t/wall/` they would each go a directory deeper and 404.

- [ ] **Step 3: Extend the staging guard**

In `ops/scripts/build.sh`, widen the existing check at line 54 so a partial pack fails the build rather than shipping a wall whose slots 404:

```bash
for f in index.html bot.html multibox.html bot/botclient.js bot/multibox.js; do
    [[ -f "$STAGE/engine/public/rs2b0t/$f" ]] || die "rs2b0t $f not staged into public/rs2b0t/ (pack-rs2b0t.sh failed?)"
done
```

Leave the `PROD_MOD` grep on `botclient.js` (lines 56-57) exactly as it is — login happens inside the slot iframe, which is `botclient.js`.

- [ ] **Step 4: Verify the Caddyfile parses**

```bash
cd ~/code/rs2b2t
docker run --rm -v "$PWD/ops/Caddyfile.game:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile
```

Expected: `Valid configuration`. If Caddy is installed locally, `caddy validate --config ops/Caddyfile.game` does the same without Docker.

- [ ] **Step 5: Commit**

```bash
git add ops/Caddyfile.game ops/scripts/build.sh
git commit -m "feat(ops): route and guard the hosted multibox wall

/rs2b0t/wall rewrites to the staged multibox.html, with no trailing slash — the
wall's assets and its slot iframes both resolve against the visible URL, so a
trailing slash would push every one of them a directory deeper.

The staging guard now covers all five files the wall needs, so a partial pack
fails the build instead of shipping slots that 404."
```

---

### Task 8: Deploy and verify in production

**Files:** none — this is the rollout.

- [ ] **Step 1: Land both branches**

Open a PR for `hosted-multibox-wall` in each repo and merge. `main` is PR-only in both; do not push directly. The `rs2b2t` change must be merged before the image build, since `build.sh` runs from that checkout.

- [ ] **Step 2: Build and deploy**

```bash
cd ~/code/rs2b2t
make build
make push
make deploy
```

`build.sh` derives `PROD_MOD` from SSM and bakes it; the new guard from Task 7 fails the build if any of the five wall files is missing.

- [ ] **Step 3: Verify the single client did not regress**

Load `https://w1.rs2b2t.com/rs2b0t`, log in with a registered account, start a script. This is the first thing to check — the whole design rests on it being untouched.

- [ ] **Step 4: Verify the wall**

Load `https://w1.rs2b2t.com/rs2b0t/wall`. Confirm, in order:

1. The page loads and the rail renders — proves the Caddy rewrite and that `multibox.js` resolved (the trailing-slash trap would fail here).
2. Adding two **registered** accounts brings both ingame. Prod registration is on, so there is no auto-create; use real accounts, as `tools/b0t.sh` notes for the Electron wall.
3. The resource card reads `2 bots` with a live traffic rate and no CPU/RAM rows.
4. The `MultiBox` link on `/rs2b0t` reaches the wall.

- [ ] **Step 5: Roll back if any check fails**

```bash
cd ~/code/rs2b2t
make deploy TAG=<previous-tag>
```

Do not attempt a forward fix against prod. The single client and the wall ship in the same image, so a broken wall is a reason to roll the image back, not to patch it live.

---

## Notes for the implementer

**What is deliberately not being fixed**

- **The backgrounded-tab limit.** Documented in Task 6, not fixed. A Web Worker message clock would fix it (workers are exempt from background throttling, and the repo already ships two), and the single client would inherit it. Deliberately out of scope.
- **The per-tab slot ceiling.** `multibox-test.ts` proves 2 slots; the 9-bot soak uses 9 separate browser contexts, i.e. separate renderer processes, while same-origin iframes share one main thread. Shipping uncapped and measuring from real use.
- **The `/client/client.js` fallback is a safety net, not a guarantee.** `ops/scripts/build.sh:51` already warns when the stock client's modulus drifts from the authoritative SSM key; while that warning is live the fallback would read a stale value. A deliberate `rotate-login-key` should still trigger an rs2b0t rebuild.

**The two failure modes most likely to bite**

1. `bot.html` missing from the subtree — the single client looks perfectly healthy and every wall slot 404s. Task 5 asserts the iframe path precisely to catch this.
2. A trailing slash on the Caddy route — everything 404s at once. Not reproducible locally (no Caddy), so it is Task 8 step 4 check 1.
