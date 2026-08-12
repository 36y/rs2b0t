import { reader, type PlayerSnapshot } from '../../adapter/ClientAdapter.js';
import { Player } from '../model/Player.js';
import EntityQuery from '../query/Query.js';

/** PlayerSnapshot + empty ops for snapshot-first EntityQuery. */
type PlayerSnapRow = PlayerSnapshot & { ops: readonly (string | null)[] };

/**
 * Player queries.
 * @see docs/reference/api-entities.md
 */
export const Players = {
    query(): EntityQuery<Player> {
        return EntityQuery.fromSnapshots(
            (): readonly PlayerSnapRow[] =>
                reader.players().map(s => ({ ...s, ops: [] as readonly (string | null)[] })),
            s => new Player(s)
        );
    }
};

export { Player };
