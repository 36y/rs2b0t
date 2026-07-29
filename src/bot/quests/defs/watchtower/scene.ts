import { Execution } from '../../../api/Execution.js';
import { Locs } from '../../../api/queries/Locs.js';

/**
 * Wait for scenery to exist again after a level change or teleport. A blank Locs
 * query does not mean the loc is absent, so every scripted crossing in this quest
 * settles before it decides anything is missing.
 * @see docs/NAV.md#level-change-loc-lag
 */
export async function settleScene(within: number = 16): Promise<void> {
    await Execution.delayTicks(2);
    await Execution.delayUntil(() => Locs.query().within(within).count() > 0, 5000);
}
