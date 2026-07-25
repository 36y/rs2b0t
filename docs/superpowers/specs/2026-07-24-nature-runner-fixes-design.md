# Nature Runner Fixes — Design

2026-07-24. Runner-side changes to `NatureCrafter.ts` on branch `master-nature-crafter`
(rebased onto main before implementation). The master mode is untouched.

## Problems

- The un-note step blindly sells a flat 26 noted essence and buys 26 back, ignoring
  live shop stock (world-shared across runners).
- Bank withdrawal amounts (essence, coins) are hardcoded.
- A runner that runs out of coins mid-cycle wedges at the store instead of restocking.
- No way to manually recall a runner to the bank.
- A dead runner's noted-essence stack is left on the ground.

## Changes

### 1. Stock-aware store visit (Jiminua)

Replace the flat sell-26/buy-26 with a re-planning loop around a pure decision
function, evaluated each pass against live `Shop.stock()`:

```
need = TRADE_CAP(25) − unnotedHeld
need ≤ 0                → done (close shop)
stock > BUY_ONLY_STOCK(30) → buy need           (drain mode — never sell)
stock ≤ 30              → sell min(notedHeld, max(0, need − stock)), then buy need
```

- Re-plan after every buy/sell, bounded passes (6). A shop that runs dry mid-buy is
  handled by the next pass: the deficit formula sells exactly what is still missing
  to reach 25 and buys it back — including when another runner sniped the stock.
- Empty shop degenerates to today's behavior (sell 25, buy 25 back).
- In the ≤30 band the runner sells only the deficit (`need − stock`), not a flat 25:
  same "sell what it needs to get to 25" formula as the run-dry fallback, applied
  uniformly; conserves the note stack.
- If 25 is unreachable (notes spent, shop dry, or coins below floor), leave and
  deliver the partial load rather than idle.
- The decision function lives in a new pure module `NatureRunnerLogic.ts`
  (CakeStallLogic pattern) for clientless unit tests.

### 2. Withdraw parameters + restock triggers

New runner settings:

- `withdrawEss` — noted essence per restock. Default `0` = all banked (today's
  behavior). Withdraws `min(param || banked, banked)`.
- `withdrawCoins` — coin **target** after restock. Default 10000 (today's buffer).
  Top-up-to semantics: withdraws `target − held`, never stacks extra.

`BankRestock` triggers when out of essence (noted + unnoted both 0) **or** coins
below `LOW_COINS(1000)` (covers fares + worst-case 25-ess buyback with margin).
The store task requires coins ≥ `LOW_COINS` so a broke runner banks instead of
wedging at the shop. Honest stops as today: bank has no essence, or coins can't be
topped back above the floor.

### 3. Trade offer cap

A runner never offers more than `TRADE_CAP(25)` essence in a trade window.

- Normal path (unnoted ≤ 25, guaranteed by the store target): keep the proven
  one-click Offer-All.
- Over-cap path (stale accounts holding 26 from the old build): new stepped
  `Trade.offer(name, n, pick?)` — Offer-10/5/1 clicks verified against `myOffer()`
  between clicks — offers exactly 25, keeps the rest.

### 4. "Go bank" paint button

Runner paint gets a `Go bank` button (`p.buttons()`). Pressing it sets a flag; a
new `GoBankPark` task walks to the Ardougne bank and **parks** (status "parked at
bank"). The button label flips to `Resume`, which clears the flag and releases the
loop. Priority sits just below `DriveTrade` so an open trade completes first.
Limitation (accepted): a press during an in-flight `walkResilient` leg takes effect
when that leg finishes; interrupting walks is out of scope.

### 5. Ground noted-essence pickup

If a noted essence stack appears on the ground (another runner died — or we did),
pick it up: `GroundItems.query()` filtered to name `Rune essence` with
`id !== ESSENCE_ID` (noted variant), `within(PICKUP_RANGE = 20)`, `.nearest()` →
`interact('Take')`, verified by `notedEssence()` increasing. One click per stack;
merges into the single note slot, so no inventory pressure. Priority: below
`GoBankPark` (parked stays parked), above `DeliverEssence` (ground stacks despawn —
grab before the trade run). Unnoted singles and coins from a death pile are out of
scope (25 extra pickups, slot pressure, trade-cap interference).

### 6. API extensions

- `Shop.sell(name, n, pick?)` — pick predicate (like `Trade.offerAll`). Required
  for correctness: the deficit-sell must target the noted stack; today's
  first-name-match could sell just-bought unnoted essence and loop forever.
- `Trade.offer(name, n, pick?)` — stepped capped offer (§3). `tradeSidePack()`
  already exposes per-item ops.

## Runner task priority (new order)

`ContinueDialog` → `DriveTrade` → `GoBankPark` → `PickupNotedEssence` →
`DeliverEssence` → `UnNoteEssence` → `BankRestock`

## Constants (laws, not settings)

| Constant | Value | Meaning |
|---|---|---|
| `TRADE_CAP` | 25 | max essence offered per trade; store target |
| `BUY_ONLY_STOCK` | 30 | shop stock above which the runner only buys |
| `LOW_COINS` | 1000 | coin floor: below it, bank instead of shopping |
| `PICKUP_RANGE` | 20 | max tiles to chase a ground noted stack |

## Amendments (found during execution)

- **Bounded ground-pickup retries.** `Take` that never lands (full pack, unreachable
  stack) would keep `PickupNotedEssence.validate()` true forever and starve
  deliveries. After 3 failed attempts the drop is ignored for 2 minutes.
- **Coin target clamped to `MIN_COIN_TARGET = 3000`.** A target at or just above
  `LOW_COINS` left the runner below the floor again after one boat fare, so it
  ping-ponged bank↔boat. `coinTargetFor()` raises any lower setting; unit-tested.
- **Three extra live probes** beyond the plan (see Testing).
- **Pickup fires at task boundaries, not mid-walk** (found live). `TaskBot.loop()` runs the
  first valid task's `execute()` to completion — only random events yield — so a stack that
  lands while the runner is walking Ardougne→Karamja is seen when that leg ends, not
  immediately. Acceptable: the runner's cycle is mostly short executes (store passes,
  delivery waits, bank visits), and a dead runner's stack is near those spots anyway.
  Making walks abortable would mean an abort hook on the shared `walkResilient` — out of
  scope here.

## Testing

- Unit (`test/scripts/NatureRunnerLogic.test.ts`): buy-only above 30, deficit sell
  at/below 30, run-dry re-plan, done-at-25, noted-bounded sell, nothing-possible →
  leave, offer-cap math.
- Existing `tools/naturecrafter-runner-test.ts` + `-e2e-test.ts` smokes still pass.
- New live probes: `naturecrafter-cap-test.ts` (a 27-essence runner offers exactly
  25), `naturecrafter-gobank-test.ts` (real canvas click on the paint button →
  parks → Resume releases), `naturecrafter-pickup-test.ts` (drops its own note and
  loots it back). All three registered in the smoke fleet's timeout table.

## Out of scope

- Master-mode changes; interrupting in-flight walks; picking up unnoted
  essence/coins from death piles; making the 25/30/1000 constants configurable.
