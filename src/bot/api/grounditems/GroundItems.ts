import { reader } from '../../adapter/ClientAdapter.js';
import { GroundItem } from '../model/GroundItem.js';
import EntityQuery from '../query/Query.js';

/**
 * Ground-item queries.
 * @see docs/reference/api-entities.md
 */
export const GroundItems = {
    query(): EntityQuery<GroundItem> {
        return EntityQuery.fromSnapshots(
            () => reader.groundItems(),
            s => new GroundItem(s)
        );
    }
};

export { GroundItem };
