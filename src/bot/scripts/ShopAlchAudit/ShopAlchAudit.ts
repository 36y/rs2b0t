import { reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { Input } from '../../input/Input.js';
import { Skills } from '../../api/skills/Skills.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

type Item = { id: number; slot: number; count: number; name: string | null };
type Snapshot = {
    tick: number;
    shopOpen: boolean;
    inventory: Item[];
    shop: Item[];
    coins: number;
    natureRunes: number;
    magicXp: number;
};

export const SHOP_ALCH_AUDIT_SETTINGS: SettingsSchema = {
    item: { type: 'string', default: '', label: 'Shop item (exact name)', help: 'Already open the shop; choose a visible stock item.' },
    mode: {
        type: 'string',
        default: 'observe',
        options: ['observe', 'inventory-control', 'shop-probe'],
        optionLabels: ['Observe only', 'Normal inventory alch (one cast)', 'Shop stock target (one cast)'],
        label: 'Test mode',
        help: 'Observe sends nothing; inventory-control casts on your pack item; shop-probe sends one spell-on-shop-stock action.'
    }
};

const project = (items: Item[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const item of items) m.set(item.id, (m.get(item.id) ?? 0) + item.count);
    return m;
};

export function itemDeltas(before: Item[], after: Item[]): { id: number; before: number; after: number; delta: number }[] {
    const a = project(before);
    const b = project(after);
    return [...new Set([...a.keys(), ...b.keys()])]
        .map(id => ({ id, before: a.get(id) ?? 0, after: b.get(id) ?? 0, delta: (b.get(id) ?? 0) - (a.get(id) ?? 0) }))
        .filter(row => row.delta !== 0)
        .sort((x, y) => x.id - y.id);
}

function capture(): Snapshot {
    return {
        tick: Game.tick(),
        shopOpen: Shop.isOpen(),
        inventory: reader.inventory().map(i => ({ id: i.id, slot: i.slot, count: i.count, name: i.name })),
        shop: Shop.isOpen()
            ? reader.shopInv(3900).map(i => ({ id: i.id, slot: i.slot, count: i.count, name: i.name }))
            : [],
        coins: Inventory.count('Coins'),
        natureRunes: Inventory.count('Nature rune'),
        magicXp: Skills.xp('magic')
    };
}

/** One-shot observer and legitimate inventory-cast control. No raw packet generation or retries. */
export default class ShopAlchAudit extends LoopingBot {
    private completed = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.sceneReady() && Shop.isOpen(), 0);
        this.log('Shop Alch audit: shop open, capturing state. No shop stock is modified by the audit.');
    }

    override async loop(): Promise<void> {
        if (this.completed) return;
        this.completed = true;

        const wanted = this.settings.str('item', '').trim();
        const mode = this.settings.str('mode', 'observe');
        const before = capture();
        const candidate = before.shop.find(i => i.name?.toLowerCase() === wanted.toLowerCase() && i.count > 0);
        this.log('PRE ' + JSON.stringify(before));

        if (!wanted || !candidate) {
            ScriptRunner.stop('Enter an exact item name visible in the open shop stock.');
            return;
        }
        this.log('SHOP TARGET ' + JSON.stringify(candidate));

        if (mode === 'inventory-control' || mode === 'shop-probe') {
            if (Skills.level('magic') < 55 || Inventory.count('Nature rune') < 1) {
                ScriptRunner.stop('High Alchemy requires 55 Magic and at least one nature rune.');
                return;
            }
            if (!(await Game.openSideTab(6))) {
                ScriptRunner.stop('Could not open magic tab; no action sent.');
                return;
            }
        }

        if (mode === 'shop-probe') {
            if (!Shop.isOpen()) {
                ScriptRunner.stop('Shop closed before probe; no action sent.');
                return;
            }
            const live = reader.shopInv(3900).find(i => i.id === candidate.id && i.slot === candidate.slot && i.count > 0);
            const spellComId = reader.targetButtonByBase(reader.sideTabInterface(6), 'High Level Alchemy');
            if (!live || spellComId === -1) {
                ScriptRunner.stop('Shop item or High Level Alchemy button no longer available; no action sent.');
                return;
            }
            this.log('PROBE_DISPATCH ' + JSON.stringify({ spellComId, itemId: live.id, slot: live.slot, itemComId: live.comId }));
            const sent = Input.castOnItem(spellComId, live.id, live.slot, live.comId);
            this.log('PROBE_CLIENT_ACCEPTED ' + String(sent));
        } else if (mode === 'inventory-control') {
            const inv = Inventory.items().find(i => i.id === candidate.id);
            if (!inv) {
                ScriptRunner.stop('Inventory control requires owning the same item ID; no action sent.');
                return;
            }
            const sent = await Game.castOnItem('High Level Alchemy', inv);
            this.log('CONTROL DISPATCH ' + String(sent));
        } else if (mode !== 'observe') {
            ScriptRunner.stop('Unknown test mode; no action sent.');
            return;
        }

        await Execution.delayTicks(5);
        const after = capture();
        const report = {
            mode,
            selectedShopItem: candidate,
            ticks: [before.tick, after.tick],
            coinsDelta: after.coins - before.coins,
            natureRunesDelta: after.natureRunes - before.natureRunes,
            magicXpDelta: after.magicXp - before.magicXp,
            inventoryDeltas: itemDeltas(before.inventory, after.inventory),
            shopDeltas: before.shopOpen && after.shopOpen ? itemDeltas(before.shop, after.shop) : null,
            shopOpenAfter: after.shopOpen,
            candidateStockBefore: candidate.count,
            candidateStockAfter: after.shopOpen ? (after.shop.find(i => i.id === candidate.id && i.slot === candidate.slot)?.count ?? 0) : null,
            suspiciousGoldWithoutInventoryConsumption:
                after.coins > before.coins && !itemDeltas(before.inventory, after.inventory).some(d => d.id === candidate.id && d.delta < 0),
            before,
            after
        };
        this.log('SHOP_ALCH_AUDIT_REPORT ' + JSON.stringify(report));
        console.info('[ShopAlchAudit]', report);
        ScriptRunner.stop('Shop Alch audit finished; inspect SHOP_ALCH_AUDIT_REPORT in the script log.');
    }
}
