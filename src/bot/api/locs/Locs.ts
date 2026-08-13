import { reader } from '../../adapter/ClientAdapter.js';
import { Loc } from '../model/Loc.js';
import EntityQuery from '../query/Query.js';

// Why: empty for about a tick after a level change, so blank does not mean absent.
// Why: snapshot-first filtering keeps name/action/within from allocating a Loc for every piece of scenery in the scene.

/**
 * Scenery queries.
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
