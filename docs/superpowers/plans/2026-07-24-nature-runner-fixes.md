# Nature Runner Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NatureCrafter runner stock-aware at Jiminua's store, parameterize bank withdrawals, cap trade offers at 25, restock when broke, add a Go-bank park button, and loot dead runners' noted essence.

**Architecture:** All behavior changes live in the runner half of `src/bot/scripts/NatureCrafter.ts`. Store-visit decisions are extracted into a new pure module `NatureRunnerLogic.ts` (CakeStallLogic pattern) so they unit-test without a client. Two tiny API extensions: a pick predicate on `Shop.sell` and a count-capped `Trade.offer` built on the engine's `Offer X` + count dialog.

**Tech Stack:** TypeScript (bun), bun:test, existing bot API (Shop/Trade/Bank/GroundItems/Paint), Playwright smokes in `tools/`.

**Spec:** `docs/superpowers/specs/2026-07-24-nature-runner-fixes-design.md` (committed on this branch).

## Global Constraints

- Branch: `nature-runner-fixes` (off main; already created, spec cherry-picked as its first commit). The old `master-nature-crafter` branch is DEAD — it was squash-merged to main as PR #15 (`e00bc8d`); do not touch it.
- Constants are laws, verbatim: `TRADE_CAP = 25`, `BUY_ONLY_STOCK = 30`, `LOW_COINS = 1000`, `PICKUP_RANGE = 20`, `STORE_PASSES = 6`. Not settings.
- Master mode behavior is untouched. Every change is runner-side.
- Comment style: near-comment-free; only magic-number/constraint comments (user law — see the existing file's style).
- Conventional commits; every commit message ends with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No new dependencies. `bun test` must stay green after every task. Lint (`bunx eslint <changed files>`) must add zero new warnings.
- Import alias in tests: `#/bot/...` (see `test/scripts/CakeStallLogic.test.ts`).

---

### Task 1: Baselines

**Files:** none modified (measurement only)

**Interfaces:**
- Consumes: nothing
- Produces: recorded baselines later tasks compare against (test count, tsc status, which sim base the live smokes run on)

- [x] **Step 1: Confirm branch and tree**

Run: `git status --short --branch`
Expected: `## nature-runner-fixes`, clean tree, tip commit `docs: nature-runner fixes design spec`.

- [x] **Step 2: Full test baseline**

Run: `bun test 2>&1 | tail -5`
Expected: 0 fail. Record the pass count — later tasks must not go below it.

- [x] **Step 3: Typecheck baseline**

Run: `bunx tsc --noEmit 2>&1 | tail -3`
Record the error count (may be non-zero pre-existing). Later tasks require **no new** errors, not zero.

- [x] **Step 4: Live smoke baseline (env permitting)**

Check which sim is up: `curl -sf -o /dev/null http://localhost:8888/bot.html && echo 8888 || (curl -sf -o /dev/null http://localhost:8890/bot.html && echo 8890)`.
If one answers, run the UNMODIFIED runner smoke against it and record base + result:
`bun tools/naturecrafter-runner-test.ts http://localhost:<port> 12`
Expected: PASS (this proves env health before any code change; failures after code changes can then be attributed to code).
If no sim is up: record "no sim — live steps deferred" and continue; Task 11 lists what remains manual.

---

### Task 2: NatureRunnerLogic pure module (TDD)

**Files:**
- Create: `src/bot/scripts/NatureRunnerLogic.ts`
- Test: `test/scripts/NatureRunnerLogic.test.ts`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces (used by Tasks 5–9):
  - `TRADE_CAP: 25`, `BUY_ONLY_STOCK: 30`, `LOW_COINS: 1000`, `PICKUP_RANGE: 20`, `STORE_PASSES: 6`
  - `type StoreStep = { op: 'buy' | 'sell'; n: number } | { op: 'done' }`
  - `planStoreStep(stock: number, noted: number, unnoted: number): StoreStep`
  - `offerCount(unnoted: number): number`

- [x] **Step 1: Write the failing test**

Create `test/scripts/NatureRunnerLogic.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';

import { planStoreStep, offerCount, TRADE_CAP, BUY_ONLY_STOCK } from '#/bot/scripts/NatureRunnerLogic.js';

describe('planStoreStep (one store action per pass, re-planned against live stock)', () => {
    test('holding the full trade cap = done, regardless of stock', () => {
        expect(planStoreStep(0, 40, TRADE_CAP)).toEqual({ op: 'done' });
        expect(planStoreStep(100, 0, TRADE_CAP + 1)).toEqual({ op: 'done' });
    });

    test('over-stocked shop (>30) = buy-only, never sell', () => {
        expect(planStoreStep(BUY_ONLY_STOCK + 1, 40, 0)).toEqual({ op: 'buy', n: 25 });
        expect(planStoreStep(100, 40, 10)).toEqual({ op: 'buy', n: 15 });
    });

    test('at exactly 30 stock the deficit rule applies (deficit 0, so buy)', () => {
        expect(planStoreStep(BUY_ONLY_STOCK, 40, 0)).toEqual({ op: 'buy', n: 25 });
    });

    test('empty shop = classic sell-then-buy-back', () => {
        expect(planStoreStep(0, 40, 0)).toEqual({ op: 'sell', n: 25 });
        expect(planStoreStep(25, 15, 0)).toEqual({ op: 'buy', n: 25 });
    });

    test('partial stock sells only the deficit', () => {
        expect(planStoreStep(20, 40, 0)).toEqual({ op: 'sell', n: 5 });
    });

    test('shop ran dry mid-buy: sell exactly what is missing to reach 25', () => {
        expect(planStoreStep(0, 40, 17)).toEqual({ op: 'sell', n: 8 });
    });

    test('sell is bounded by the notes actually held', () => {
        expect(planStoreStep(0, 3, 0)).toEqual({ op: 'sell', n: 3 });
    });

    test('no notes left: buy whatever stock exists', () => {
        expect(planStoreStep(10, 0, 0)).toEqual({ op: 'buy', n: 10 });
    });

    test('nothing to sell, nothing to buy = done (leave with a partial load)', () => {
        expect(planStoreStep(0, 0, 10)).toEqual({ op: 'done' });
    });
});

describe('offerCount (trade-window law: never more than 25)', () => {
    test('caps at TRADE_CAP', () => {
        expect(offerCount(52)).toBe(25);
        expect(offerCount(26)).toBe(25);
    });

    test('offers what is held when under the cap', () => {
        expect(offerCount(17)).toBe(17);
        expect(offerCount(25)).toBe(25);
        expect(offerCount(0)).toBe(0);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test test/scripts/NatureRunnerLogic.test.ts`
Expected: FAIL — cannot resolve `#/bot/scripts/NatureRunnerLogic.js`.

- [x] **Step 3: Write the implementation**

Create `src/bot/scripts/NatureRunnerLogic.ts`:

```ts
export const TRADE_CAP = 25; // max essence offered per trade; the store-visit target
export const BUY_ONLY_STOCK = 30; // shop stock above which the runner only buys (drain mode)
export const LOW_COINS = 1000; // coin floor: below it, bank instead of shopping
export const PICKUP_RANGE = 20; // max tiles to chase a dropped noted stack
export const STORE_PASSES = 6; // bound on plan/act passes per store visit

export type StoreStep = { op: 'buy' | 'sell'; n: number } | { op: 'done' };

export function planStoreStep(stock: number, noted: number, unnoted: number): StoreStep {
    const need = TRADE_CAP - unnoted;
    if (need <= 0) {
        return { op: 'done' };
    }
    if (stock > BUY_ONLY_STOCK) {
        return { op: 'buy', n: need };
    }
    const toSell = Math.min(noted, Math.max(0, need - stock));
    if (toSell > 0) {
        return { op: 'sell', n: toSell };
    }
    if (stock > 0) {
        return { op: 'buy', n: Math.min(need, stock) };
    }
    return { op: 'done' };
}

export function offerCount(unnoted: number): number {
    return Math.max(0, Math.min(TRADE_CAP, unnoted));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test test/scripts/NatureRunnerLogic.test.ts`
Expected: 12 pass, 0 fail.

- [x] **Step 5: Lint + commit**

```bash
bunx eslint src/bot/scripts/NatureRunnerLogic.ts test/scripts/NatureRunnerLogic.test.ts
git add src/bot/scripts/NatureRunnerLogic.ts test/scripts/NatureRunnerLogic.test.ts
git commit -m "feat(scripts): NatureRunnerLogic — stock-aware store planner + trade cap

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Shop.sell pick predicate

**Files:**
- Modify: `src/bot/api/hud/Shop.ts` (the `sell` method, currently lines 78–103)

**Interfaces:**
- Consumes: nothing new
- Produces (used by Task 6): `Shop.sell(name: string, n: number, pick?: (i: { id: number; count: number; slot: number }) => boolean): Promise<number>` — pick chooses among same-name pack slots (e.g. sell only the noted stack). Existing callers unchanged (param optional).

Why: the deficit-sell runs while holding BOTH noted and unnoted essence. Today's first-name-match could sell the just-bought unnoted ones — selling and re-buying the same items forever.

- [x] **Step 1: Extend sell() with pick**

In `src/bot/api/hud/Shop.ts`, replace the top of the `sell` while-loop:

```ts
    async sell(name: string, n: number): Promise<number> {
        let sold = 0;
        while (sold < n && Shop.isOpen()) {
            const it = reader.shopInv(SHOP_PLAYER_COM).find(s => s.name?.toLowerCase() === name.toLowerCase());
            if (!it) {
                break;
            }
```

with:

```ts
    // pick chooses among same-name pack slots (e.g. sell the noted stack, not unnoted singles)
    async sell(name: string, n: number, pick?: (i: { id: number; count: number; slot: number }) => boolean): Promise<number> {
        let sold = 0;
        while (sold < n && Shop.isOpen()) {
            const matches = reader.shopInv(SHOP_PLAYER_COM).filter(s => s.name?.toLowerCase() === name.toLowerCase());
            const it = pick ? matches.find(pick) : matches[0];
            if (!it) {
                break;
            }
```

The rest of the method body (stepOpIndex, invButton, countHeld delta) is unchanged.

- [x] **Step 2: Verify suite + lint**

Run: `bun test 2>&1 | tail -3` — pass count ≥ Task 1 baseline.
Run: `bunx eslint src/bot/api/hud/Shop.ts` — clean.

- [x] **Step 3: Commit**

```bash
git add src/bot/api/hud/Shop.ts
git commit -m "feat(api): Shop.sell pick predicate — choose among same-name pack slots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Trade.offer — exact-count offer via Offer X

**Files:**
- Modify: `src/bot/api/hud/Trade.ts`

**Interfaces:**
- Consumes: `reader.countDialogOpen()` + `actions.answerCountDialog(n)` (already used by `Bank.withdrawX`, `src/bot/api/hud/Bank.ts:56-59`)
- Produces (used by Task 7): `Trade.offer(itemName: string, n: number, pick?: (i: { count: number; id: number; slot: number }) => boolean): Promise<boolean>` — offers exactly n, never more.

Engine facts (verified in `~/code/rs2b2t-content/scripts/interface_trade/interfaces/tradeside.if`): tradeside inv ops are option1 `Offer 1`, option2 `Offer 5`, option3 `Offer 10`, option4 `Offer All`, option5 `Offer X` (count dialog). Non-stackable offers appear as N count-1 entries in `myOffer()` — sum them.

- [x] **Step 1: Add the OFFER_X constant**

In `src/bot/api/hud/Trade.ts`, after `const OFFER_ALL = 4;` add:

```ts
const OFFER_X = 5; // tradeside option5 = "Offer X" -> count dialog
```

- [x] **Step 2: Add offer() after offerAll()**

```ts
    // offer exactly n (never more): Offer-X + count dialog; pick chooses among same-name slots
    async offer(itemName: string, n: number, pick?: (i: { count: number; id: number; slot: number }) => boolean): Promise<boolean> {
        if (n <= 0 || !reader.tradeOfferOpen()) {
            return false;
        }

        const matches = reader.tradeSidePack().filter(i => i.name?.toLowerCase() === itemName.toLowerCase());
        const it = pick ? matches.find(pick) : matches[0];
        if (!it) {
            return false;
        }

        if (!(await ActionRouter.driver.invButton(it.id, it.slot, OFFER_INV, OFFER_X))) {
            return false;
        }

        if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
            return false;
        }

        actions.answerCountDialog(n);
        return Execution.delayUntil(() => Trade.myOffer().reduce((s, o) => s + Math.max(1, o.count), 0) >= n, 4000);
    },
```

- [x] **Step 3: Verify suite + lint**

Run: `bun test 2>&1 | tail -3` — pass count ≥ baseline.
Run: `bunx eslint src/bot/api/hud/Trade.ts` — clean.

- [x] **Step 4: Commit**

```bash
git add src/bot/api/hud/Trade.ts
git commit -m "feat(api): Trade.offer — exact-count offer via Offer-X count dialog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Runner settings + BankRestock rewrite

**Files:**
- Modify: `src/bot/scripts/NatureCrafter.ts` (SETTINGS, imports, class fields/accessors, `BankRestock`)

**Interfaces:**
- Consumes: `LOW_COINS` from Task 2
- Produces (used by Tasks 6–8): bot accessors `essPerRestock(): number`, `coinTarget(): number`

Note: the `LOW_COINS` floor fully engages once Task 6 adds the store-task coins gate; between Tasks 5 and 6 a below-floor runner may still visit the store once (transient mid-plan state, acceptable).

- [x] **Step 1: Imports + constant removal**

Add to the imports in `src/bot/scripts/NatureCrafter.ts`:

```ts
import { LOW_COINS } from './NatureRunnerLogic.js';
```

Delete the `COINS_BUFFER` constant line:

```ts
const COINS_BUFFER = 10000; // fare + un-note margin buffer
```

- [x] **Step 2: SETTINGS additions**

In the `SETTINGS` object, after the `bankAt` entry add:

```ts
    withdrawEss: { type: 'number', default: 0, min: 0, label: 'Essence per restock (0 = all)', help: 'Runner: noted essence withdrawn per bank restock; 0 = the whole bank stack' },
    withdrawCoins: { type: 'number', default: 10000, min: 0, label: 'Coins target at restock', help: 'Runner: top coins up to this at each restock (boat fares + shop buy-backs)' }
```

- [x] **Step 3: Fields + accessors**

After `private bankAt = 0;` add:

```ts
    private essPer = 0;
    private coinsTarget = 10000;
```

In `onStart()`, after the `this.bankAt = ...` line add (the `Math.max(LOW_COINS, ...)` clamp prevents a target below the floor from re-triggering restock forever):

```ts
        this.essPer = Math.max(0, this.settings.num('withdrawEss', 0));
        this.coinsTarget = Math.max(LOW_COINS, this.settings.num('withdrawCoins', 10000));
```

Next to the other accessors (`bankThreshold()` etc.) add:

```ts
    essPerRestock(): number { return this.essPer; }
    coinTarget(): number { return this.coinsTarget; }
```

- [x] **Step 4: Replace BankRestock**

Replace the entire `BankRestock` class with:

```ts
class BankRestock implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return essCount() === 0 || Inventory.count(COINS) < LOW_COINS; }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Ardougne bank');
        await this.bot.walkTo(ARD_BANK, 3);
        const opened = (await Bank.openBooth(ARD_BANK, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the Ardougne bank — retrying');
            return;
        }

        await Bank.setNoteMode(false);
        const needCoins = this.bot.coinTarget() - Inventory.count(COINS);
        if (needCoins > 0 && Bank.count(COINS) > 0) {
            await Bank.withdrawX(COINS, Math.min(needCoins, Bank.count(COINS)));
        }
        if (Inventory.count(COINS) < LOW_COINS) {
            this.bot.log('NatureCrafter runner: out of coins (bank + pack) for fares and buy-backs. Stopping.');
            ScriptRunner.stop();
            return;
        }

        const banked = Bank.count(ESSENCE);
        if (banked === 0) {
            if (essCount() === 0) {
                this.bot.log('NatureCrafter runner: out of Rune essence in the bank. Stopping.');
                ScriptRunner.stop();
            }
            return;
        }
        const per = this.bot.essPerRestock();
        const want = per > 0 ? Math.min(per, banked) : banked;
        await Bank.setNoteMode(true);
        await Bank.withdrawX(ESSENCE, want);
        await Execution.delayUntil(() => essCount() > 0, 3000);
        await Bank.setNoteMode(false);
        this.bot.log(`withdrew ${essCount()} essence (${notedEssence() > 0 ? 'noted' : 'unnoted'}) + coins topped to ${Inventory.count(COINS)}`);
    }
}
```

(The `withdrew ... (noted)` log shape is asserted by `tools/naturecrafter-runner-test.ts` — keep it.)

- [x] **Step 5: Verify suite + lint**

Run: `bun test 2>&1 | tail -3` — pass count ≥ baseline.
Run: `bunx eslint src/bot/scripts/NatureCrafter.ts` — clean.

- [x] **Step 6: Commit**

```bash
git add src/bot/scripts/NatureCrafter.ts
git commit -m "feat(scripts): nature runner withdraw params + coin-floor restock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Stock-aware UnNoteEssence

**Files:**
- Modify: `src/bot/scripts/NatureCrafter.ts` (`UnNoteEssence` class, `BATCH` constant, imports)

**Interfaces:**
- Consumes: `planStoreStep`, `STORE_PASSES`, `LOW_COINS` (Task 2); `Shop.sell(..., pick)` (Task 3)
- Produces: nothing new

- [x] **Step 1: Imports + constant removal**

Extend the Task 5 import line to:

```ts
import { planStoreStep, LOW_COINS, STORE_PASSES } from './NatureRunnerLogic.js';
```

Delete the `BATCH` constant line:

```ts
const BATCH = 26; // essence un-noted per store visit
```

- [x] **Step 2: Replace UnNoteEssence + add the stock helper**

Replace the entire `UnNoteEssence` class with (keep `openUnnoteShop()` as is):

```ts
function shopEssStock(): number {
    return Shop.stock().find(s => s.name.toLowerCase() === ESSENCE.toLowerCase())?.count ?? 0;
}

class UnNoteEssence implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return notedEssence() > 0 && unnotedEssence() === 0 && Inventory.count(COINS) >= LOW_COINS; }
    async execute(): Promise<void> {
        this.bot.setStatus('topping up unnoted essence at the store');
        await this.bot.walkTo(STORE_TILE, 3);
        if (!(await openUnnoteShop())) {
            this.bot.log(`couldn't open ${UNNOTE_NPC}'s store — retrying`);
            return;
        }
        for (let pass = 0; pass < STORE_PASSES; pass++) {
            const stock = shopEssStock();
            const step = planStoreStep(stock, notedEssence(), unnotedEssence());
            if (step.op === 'done') {
                break;
            }
            const before = { noted: notedEssence(), unnoted: unnotedEssence() };
            if (step.op === 'sell') {
                this.bot.log(`selling ${step.n} noted essence to ${UNNOTE_NPC} (stock ${stock})`);
                await Shop.sell(ESSENCE, step.n, i => i.id !== ESSENCE_ID);
            } else {
                this.bot.log(`buying ${step.n} essence from stock (${stock} in the shop)`);
                await Shop.buy(ESSENCE, step.n);
            }
            if (notedEssence() === before.noted && unnotedEssence() === before.unnoted) {
                this.bot.log('store pass made no progress (out of coins or raced) — leaving with what we have');
                break;
            }
        }
        await Shop.close();
        this.bot.log(`store visit done: ${unnotedEssence()} unnoted held (noted left: ${notedEssence()})`);
    }
}
```

The `i => i.id !== ESSENCE_ID` pick sells the NOTED stack only. `Shop.buy` self-bounds when stock runs out; the next pass's deficit sell covers the shortfall (spec §1).

- [x] **Step 3: Verify suite + lint**

Run: `bun test 2>&1 | tail -3`; `bunx eslint src/bot/scripts/NatureCrafter.ts`.

- [x] **Step 4: Commit**

```bash
git add src/bot/scripts/NatureCrafter.ts
git commit -m "feat(scripts): stock-aware un-note — buy-only over 30 stock, deficit sell, coins gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: DriveTrade offer cap

**Files:**
- Modify: `src/bot/scripts/NatureCrafter.ts` (`DriveTrade` class, imports)

**Interfaces:**
- Consumes: `offerCount`, `TRADE_CAP` (Task 2); `Trade.offer` (Task 4)
- Produces: nothing new

- [x] **Step 1: Extend the logic import**

```ts
import { planStoreStep, offerCount, LOW_COINS, STORE_PASSES, TRADE_CAP } from './NatureRunnerLogic.js';
```

- [x] **Step 2: Replace DriveTrade**

Replace the entire `DriveTrade` class with:

```ts
class DriveTrade implements Task {
    private pending = 0;
    private beforeUnnoted = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return Trade.active(); }
    async execute(): Promise<void> {
        if (Trade.onOfferScreen()) {
            if (Trade.myOffer().length === 0) {
                const held = unnotedEssence();
                const n = offerCount(held);
                if (n <= 0) {
                    await Execution.delayTicks(1);
                    return;
                }
                this.pending = n;
                this.beforeUnnoted = held;
                this.bot.setStatus('offering essence');
                if (held <= TRADE_CAP) {
                    this.bot.log(`trade open — offering ${n} essence`);
                    await Trade.offerAll(ESSENCE, i => i.id === ESSENCE_ID);
                } else {
                    this.bot.log(`holding ${held} unnoted — offering the ${n} cap`);
                    await Trade.offer(ESSENCE, n, i => i.id === ESSENCE_ID);
                }
            } else {
                this.bot.setStatus('accepting the offer');
                await Trade.accept();
            }
            return;
        }
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the trade');
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 2500) && this.pending > 0) {
                const delivered = this.beforeUnnoted - unnotedEssence();
                if (delivered > 0) {
                    this.bot.countDelivery(delivered);
                    this.bot.log(`delivered ${delivered} essence to the master`);
                }
                this.pending = 0;
            }
        }
    }
}
```

(Delivery is counted from the unnoted delta, not `=== 0`, because the over-cap path deliberately keeps a remainder.)

- [x] **Step 3: Verify suite + lint**

Run: `bun test 2>&1 | tail -3`; `bunx eslint src/bot/scripts/NatureCrafter.ts`.

- [x] **Step 4: Commit**

```bash
git add src/bot/scripts/NatureCrafter.ts
git commit -m "feat(scripts): cap runner trade offers at 25 essence

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Go-bank park button

**Files:**
- Modify: `src/bot/scripts/NatureCrafter.ts` (bot field/accessor, `onPaint`, new `GoBankPark` task, runner task order)

**Interfaces:**
- Consumes: bot `walkTo`, `Game.tile()`, Paint `buttons()` (`p.buttons([{id,label}]) => clicked id | null`, see `AIOQuester.ts:183`)
- Produces (used by Task 9's ordering): `goBankActive(): boolean` on the bot; `GoBankPark` sits directly after `DriveTrade` in the runner task list

- [x] **Step 1: Field + accessor**

After the `coinsTarget` field add:

```ts
    private goBank = false;
```

Next to the other accessors add:

```ts
    goBankActive(): boolean { return this.goBank; }
```

- [x] **Step 2: Paint button (runner branch only)**

In `onPaint`, inside the `else` (runner) branch after the two `p.row(...)` lines, add:

```ts
            p.gap();
            const clicked = p.buttons([{ id: 'gobank', label: this.goBank ? 'Resume' : 'Go bank' }]);
            if (clicked === 'gobank') {
                this.goBank = !this.goBank;
                this.log(this.goBank ? 'Go bank pressed — heading to the Ardougne bank to park' : 'Resume pressed — back to the loop');
            }
```

- [x] **Step 3: GoBankPark task**

Add after the `DriveTrade` class:

```ts
class GoBankPark implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return this.bot.goBankActive() && !Trade.active(); }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (!here || here.distanceTo(ARD_BANK) > 4) {
            this.bot.setStatus('Go bank: walking to the Ardougne bank');
            await this.bot.walkTo(ARD_BANK, 3);
            return;
        }
        this.bot.setStatus('parked at the bank — press Resume');
        await Execution.delayTicks(2);
    }
}
```

- [x] **Step 4: Runner task order**

In `onStart()`'s runner branch, change the `this.add(...)` to:

```ts
            this.add(
                new ContinueDialog(),
                new DriveTrade(this),
                new GoBankPark(this),
                new DeliverEssence(this),
                new UnNoteEssence(this),
                new BankRestock(this)
            );
```

- [x] **Step 5: Verify suite + lint**

Run: `bun test 2>&1 | tail -3`; `bunx eslint src/bot/scripts/NatureCrafter.ts`.

- [x] **Step 6: Commit**

```bash
git add src/bot/scripts/NatureCrafter.ts
git commit -m "feat(scripts): Go bank paint button — walk to Ardougne bank and park until Resume

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Ground noted-essence pickup

**Files:**
- Modify: `src/bot/scripts/NatureCrafter.ts` (imports, helper, new `PickupNotedEssence` task, runner task order)

**Interfaces:**
- Consumes: `GroundItems.query()` (`src/bot/api/queries/GroundItems.ts`; entity has `.name`, `.id`, `.count`, `.interact('Take')`); `PICKUP_RANGE` (Task 2)
- Produces: nothing new

- [x] **Step 1: Imports**

```ts
import { GroundItems, type GroundItem } from '../api/queries/GroundItems.js';
```

Extend the logic import with `PICKUP_RANGE`:

```ts
import { planStoreStep, offerCount, LOW_COINS, STORE_PASSES, TRADE_CAP, PICKUP_RANGE } from './NatureRunnerLogic.js';
```

- [x] **Step 2: Helper + task**

Add after `GoBankPark`:

```ts
function groundNotedEss(): GroundItem | null {
    return GroundItems.query()
        .where(g => (g.name ?? '').toLowerCase() === ESSENCE.toLowerCase() && g.id !== ESSENCE_ID)
        .within(PICKUP_RANGE)
        .nearest();
}

class PickupNotedEssence implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return !Trade.active() && groundNotedEss() !== null; }
    async execute(): Promise<void> {
        const drop = groundNotedEss();
        if (!drop) {
            return;
        }
        this.bot.setStatus('picking up dropped noted essence');
        this.bot.log(`noted essence on the ground (${drop.count}) — another runner died? picking it up`);
        const before = notedEssence();
        if (!(await drop.interact('Take'))) {
            await Execution.delayTicks(2);
            return;
        }
        await Execution.delayUntil(() => notedEssence() > before, 8000);
        if (notedEssence() > before) {
            this.bot.log(`picked up ${notedEssence() - before} noted essence`);
        }
    }
}
```

(Success is measured by `notedEssence()` growing, NOT `Inventory.used()` — a picked-up note merges into an existing stack without changing slot count.)

- [x] **Step 3: Final runner task order**

```ts
            this.add(
                new ContinueDialog(),
                new DriveTrade(this),
                new GoBankPark(this),
                new PickupNotedEssence(this),
                new DeliverEssence(this),
                new UnNoteEssence(this),
                new BankRestock(this)
            );
```

- [x] **Step 4: Verify suite + lint**

Run: `bun test 2>&1 | tail -3`; `bunx eslint src/bot/scripts/NatureCrafter.ts`.

- [x] **Step 5: Commit**

```bash
git add src/bot/scripts/NatureCrafter.ts
git commit -m "feat(scripts): runner loots ground noted essence (dead-runner recovery)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Smoke updates for the 25 target

**Files:**
- Modify: `tools/naturecrafter-e2e-test.ts:82,110`
- Modify: `tools/naturecrafter-runner-test.ts:58` (comment only)

**Interfaces:**
- Consumes: nothing
- Produces: smokes aligned with the 25-essence store target

The runner smoke's success predicate (`unnoted >= 20`) and the `withdrew ... (noted)` log regex already hold under the new behavior — no assertion change there. The e2e smoke's note-of-1 wedge regression must track the new batch size.

- [x] **Step 1: e2e seed 27 → 26**

In `tools/naturecrafter-e2e-test.ts` line 82, replace:

```ts
    await cheatQuiet(pageR, '~bankitem blankrune 27'); // 27 = 26 + 1 -> leaves a "note of 1" (the finding-#1 wedge case)
```

with:

```ts
    await cheatQuiet(pageR, '~bankitem blankrune 26'); // 26 = 25 + 1 -> leaves a "note of 1" (the finding-#1 wedge case)
```

- [x] **Step 2: e2e crafted threshold 54 → 52**

Line 110, replace:

```ts
        if (m.natures >= 54 && m.rcXp > xp0) { crafted = true; } // all 27 essence crafted (27*2) — a note-of-1 wedge would stall at 52
```

with:

```ts
        if (m.natures >= 52 && m.rcXp > xp0) { crafted = true; } // all 26 essence crafted (26*2) — a note-of-1 wedge would stall at 50
```

- [x] **Step 3: runner-test comment**

Line 58, replace the trailing comment:

```ts
    await cheatQuiet(page, '~bankitem blankrune 52'); // 2 batches — withdraws as one note, un-notes 26 at a time
```

with:

```ts
    await cheatQuiet(page, '~bankitem blankrune 52'); // 2+ batches — withdraws as one note, un-notes 25 at a time
```

- [x] **Step 4: Stale-reference sweep**

Run: `grep -rn "26" tools/naturecrafter-*.ts | grep -v -E "2655|3260|2600|2690"` — confirm no remaining batch-26 assumptions (master-test's `SEED = 26` stays: it's master-side pack capacity, unrelated to the runner batch).

- [x] **Step 5: Commit**

```bash
git add tools/naturecrafter-e2e-test.ts tools/naturecrafter-runner-test.ts
git commit -m "test(tools): align naturecrafter smokes with the 25-essence store target

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Full verification + live acceptance

**Files:** none (verification)

**Interfaces:**
- Consumes: everything above
- Produces: evidence for the completion claim

- [x] **Step 1: Suite + typecheck + lint**

```bash
bun test 2>&1 | tail -3
bunx tsc --noEmit 2>&1 | tail -3
bunx eslint src/bot/scripts/NatureRunnerLogic.ts src/bot/scripts/NatureCrafter.ts src/bot/api/hud/Shop.ts src/bot/api/hud/Trade.ts test/scripts/NatureRunnerLogic.test.ts
```

Expected: pass count ≥ Task 1 baseline; tsc errors ≤ Task 1 baseline (no new); eslint clean.

- [x] **Step 2: Runner smoke (live, env permitting)**

Using the base recorded in Task 1: `bun tools/naturecrafter-runner-test.ts http://localhost:<port> 12`
Expected: PASS with `unnoted=25` in the tail samples and store logs showing `selling 25 noted essence` / `buying 25 essence`.
Note: if the sim serves a prebuilt bot bundle, rebuild/redeploy it first the same way the Task 1 baseline run was served (`bun run build:bot` + the sim's deploy path); confirm the new log strings appear to prove fresh code is running.

- [x] **Step 3: e2e smoke (live, env permitting)**

`bun tools/naturecrafter-e2e-test.ts http://localhost:<port> 15`
Expected: PASS — runner delivers 25 then the leftover 1; master crafts ≥52 natures.

- [x] **Step 4: Manual/headed checks (document results honestly)**

These three have no headless harness; verify headed against the sim (or defer to the user with an explicit note in the final report):
1. **Drain mode:** pre-stock Jiminua above 30 (sell ~40 notes by hand or via a second account), start the runner → paint/status shows a buy with NO preceding sell (`buying 25 essence from stock (40 in the shop)`).
2. **Go bank:** press `Go bank` mid-loop → bot walks to the Ardougne bank, status `parked at the bank — press Resume`, button label now `Resume`; press it → loop resumes.
3. **Pickup:** drop a noted essence stack near the bot (second account or manual drop) → log `picked up N noted essence`.

- [x] **Step 5: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` (merge/PR decision belongs to the user's normal PR flow — repo pattern is PRs into main).
