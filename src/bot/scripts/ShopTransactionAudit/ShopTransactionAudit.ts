import { reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Shop } from '../../api/shop/Shop.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

type Item = { id: number; slot: number; count: number; name: string | null };
type Snapshot = { tick: number; shopOpen: boolean; inventory: Item[]; stock: Item[]; coins: number };
const count = (items: Item[], id: number) => items.filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);
const snapshot = (): Snapshot => {
    const shopOpen = Shop.isOpen();
    const inventory = reader.inventory().map(i => ({ id: i.id, slot: i.slot, count: i.count, name: i.name }));
    return {
        tick: Game.tick(), shopOpen, inventory,
        stock: shopOpen ? reader.shopInv(3900).map(i => ({ id: i.id, slot: i.slot, count: i.count, name: i.name })) : [],
        coins: count(inventory, 995)
    };
};

export const SHOP_TRANSACTION_AUDIT_SETTINGS: SettingsSchema = {
    item: { type: 'string', default: 'Bucket', label: 'Item (exact shop name)', help: 'Open the shop before starting; use an inexpensive item.' },
    mode: {
        type: 'string', default: 'observe', label: 'Test mode',
        options: ['observe', 'buy-one', 'sell-one'],
        optionLabels: ['Observe only', 'Buy one', 'Sell one'],
        help: 'Exactly one normal shop transaction per run; no burst or retry.'
    }
};

/** One-shot, low-volume public-server shop accounting diagnostic. */
export default class ShopTransactionAudit extends LoopingBot {
    private completed = false;

    override async onStart(): Promise<void> {
        const ready = await Execution.delayUntil(() => Game.sceneReady() && Shop.isOpen(), 10000);
        if (!ready) ScriptRunner.stop('Open a shop before starting Shop Transaction Audit.');
    }

    override async loop(): Promise<void> {
        if (this.completed) return;
        this.completed = true;
        if (!Shop.isOpen()) {
            ScriptRunner.stop('Shop is not open.');
            return;
        }

        const mode = this.settings.str('mode', 'observe');
        const wanted = this.settings.str('item', 'Bucket').trim();
        const before = snapshot();
        const target = before.stock.find(i => i.name?.toLowerCase() === wanted.toLowerCase() && i.count > 0);
        this.log('SHOP_TRANSACTION_PRE ' + JSON.stringify(before));
        if (!wanted || !target) {
            ScriptRunner.stop('Select an exact item name currently in shop stock.');
            return;
        }

        let returned = 0;
        if (mode === 'buy-one') {
            returned = await Shop.buyById(target.id, 1);
        } else if (mode === 'sell-one') {
            if (count(before.inventory, target.id) < 1) {
                ScriptRunner.stop('Sell control requires one owned copy of the selected shop item.');
                return;
            }
            returned = await Shop.sell(wanted, 1, i => i.id === target.id);
        } else if (mode !== 'observe') {
            ScriptRunner.stop('Unknown mode; no transaction sent.');
            return;
        }

        await Execution.delayTicks(3);
        const after = snapshot();
        const inventoryDelta = count(after.inventory, target.id) - count(before.inventory, target.id);
        const stockDelta = after.shopOpen ? count(after.stock, target.id) - count(before.stock, target.id) : null;
        const coinsDelta = after.coins - before.coins;
        const expectedInventoryDelta = mode === 'buy-one' ? 1 : mode === 'sell-one' ? -1 : 0;
        const unexpected = mode === 'observe'
            ? inventoryDelta !== 0 || coinsDelta !== 0
            : returned !== 1 || inventoryDelta !== expectedInventoryDelta
                || (mode === 'buy-one' && coinsDelta > 0)
                || (mode === 'sell-one' && coinsDelta < 0);
        const report = {
            mode, target, apiReturnedCount: returned,
            tickRange: [before.tick, after.tick],
            inventoryDelta, stockDelta, coinsDelta,
            stockComparable: before.shopOpen && after.shopOpen,
            unexpected, note: 'Stock can restock naturally; coin prices vary by shop. No proof of duplication without corroboration.',
            before, after
        };
        this.log('SHOP_TRANSACTION_AUDIT_REPORT ' + JSON.stringify(report));
        console.info('[ShopTransactionAudit]', report);
        ScriptRunner.stop(unexpected
            ? 'Unexpected shop accounting result; inspect SHOP_TRANSACTION_AUDIT_REPORT.'
            : 'Shop transaction audit finished; inspect SHOP_TRANSACTION_AUDIT_REPORT.');
    }
}
