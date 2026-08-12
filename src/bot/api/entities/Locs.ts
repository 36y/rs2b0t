import { reader } from '../../adapter/ClientAdapter.js';
import { Loc } from './index.js';
import EntityQuery from './Query.js';

/**
 * Scenery queries. Empty for about a tick after a level change — blank does not
 * mean absent.
 *
 * Uses snapshot-first filtering so name/action/within do not allocate a Loc for
 * every piece of scenery in the scene.
 * @see docs/reference/api-entities.md
 * @see docs/decisions/level-change-lag.md
 */
export const Locs = {
    query(): EntityQuery<Loc> {
        return EntityQuery.fromSnapshots(
            () => reader.locs(),
            s => new Loc(s)
        );
    }
};

export { Loc };
