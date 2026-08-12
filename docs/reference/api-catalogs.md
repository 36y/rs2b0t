[Manual](../README.md) › [Scripting API](../API.md) › World catalogs

# World catalogs

## World catalogs

Reusable data tables and pure helpers for out-of-tree scripts. These are the same
catalogs the bundled Fisher / Miner / Woodcutter / Thiever / WalkTo bots use —
import them from `@rs2b0t/api` rather than hard-coding tiles.

### Bank locations

Known bank stands and openers. Prefer [`Banking.open`](api-banking.md) for the walk +
open; use this catalog when you need the nearest stand or a named bank tile.

```ts
interface BankLocation {
    name: string;
    tile: Tile;
    requires?: { skill?: { name: string; level: number }; quest?: string };
    access?: BankObjectAccess;   // chest / open-first banks
}

BANK_LOCATIONS: BankLocation[]
bankDistance(from, bank): number          // Euclidean, same plane
nearestBank(from): BankLocation | null    // unlocked for this account
nearestUsableBank(from, usable): BankLocation | null
bankUnlocked(bank): boolean               // quest/skill gates
```

```ts
import { BANK_LOCATIONS, nearestBank, Banking } from '@rs2b0t/api';

const bank = nearestBank(Game.tile()!);
if (bank) await Banking.open({ stand: bank.tile });
```

### Tools

Axe / pickaxe tiers and kit math for gathering scripts.

```ts
type ToolReq =
  | { kind: 'tiered'; skill; tiers: ToolTier[]; label; equip? }
  | { kind: 'exact'; name; min?; restock?; equip? };

PICKAXES / AXES: readonly ToolTier[]   // best-first (rune → bronze)
TINDERBOX / HAMMER / KNIFE / CHISEL / NEEDLE

pickaxeReq(equip?) / axeReq(equip?) / exactTool(name, opts?) / tinderboxReq()
bestPickaxe(level, available) / bestAxe(level, available)
bestFromTiers(level, tiers, available)
toolRestockPlan(reqs, skillLevel, invCount, bankCount)
hasAllTools / missingToolLabels / toolKeepNames / toolKitLabel
toolsNeedingEquip / bestHeldToolNames / surplusHeldToolNames
bankHasBetterGatherTool / canWieldTool / toolAttackLevel
```

### Tool acquire (planning)

Pure planners for buy / repair / smith routes. **Plans only** — scripts still
execute the walk, bank, and shop steps (see GatheringBot).

```ts
type ToolAcquireMode = 'off' | 'on'
parseToolAcquireMode(raw)
TOOL_ACQUIRE_SETTING / FORGETFUL_BANK_SETTING   // settingsSchema fragments
BOB_VENDOR / NURMOF_VENDOR / GERRANT_VENDOR / HARRY_VENDOR
PICKAXE_SHOP_COSTS / AXE_SHOP_COSTS / FISHING_SHOP_COSTS
AXE_SMITH_LEVEL / AXE_BAR_FOR / VARROCK_ANVIL_STAND

type ToolAcquirePlan =
  | { kind: 'repair'; brokenName; label; vendor; prefer }
  | { kind: 'buy'; name; cost; qty; vendor; equip; reason }
  | { kind: 'smith'; name; bar; smithLevel; vendorBank; anvilStand; equip; reason }

planGatherToolAcquire(reqs, world, { upgrade })
planPickaxeAcquire / planAxeAcquire / planBrokenToolRepair
planFishingGearBuys / fishingGearShopCart / planFishingGearAcquire
canFundPlan / coinsToWithdraw / acquireKeepNames
```

`AcquireWorld` is a pure snapshot interface (`skillLevel`, `heldCount`,
`invCount`, `bankCount`, `worn`) — no client calls inside the planner.

### Gathering locations

Shared camp model for Fisher / Miner / Woodcutter.

```ts
interface GatheringLocation {
    name; spot: Tile; bankStand: Tile; verified: boolean;
    boothName?; boothOp?; obstacles?; resources?; notes?;
}

// resolution: "None" → null; named → match; "Auto" → nearest camp in the same
// 64×64 map square as startTile (else freeform null)
resolveGatheringLocation(setting, startTile, table)
locationOptions(table)            // ['Auto', …names, 'None']
boothFields(loc) / sameMapSquare / MAP_SQUARE / DEFAULT_BOOTH_*

FISHING_LOCATIONS / resolveFishingLocation / FISHING_LOCATION_OPTIONS
MINING_LOCATIONS / resolveMiningLocation / MINING_LOCATION_OPTIONS
WOODCUTTING_LOCATIONS / resolveWoodcuttingLocation / WOODCUTTING_LOCATION_OPTIONS
```

## See also

- [More catalogs](api-catalogs-2.md)
- [Scripting API index](../API.md)
