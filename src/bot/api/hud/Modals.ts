import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../core/Execution.js';

/**
 * Closing main modals.
 *
 * `actions.closeModal()` only *sends* the close — it is a CLOSE_BUTTON menu
 * action, and the modal stays in `reader.modals().main` until the server
 * answers a tick or more later. Code that closes and reads on with no wait sees
 * the modal still up, and so does every other task in the loop: the next one to
 * poll "is a modal open?" fires a second close, which lands a tick later on
 * whatever modal is open *by then*. That is the fight — a journal read's stale
 * close shutting the scroll a later step just opened.
 *
 * Waiting for the close to land is what stops it. The task loop is cooperative,
 * so a closer that awaits its own close yields with the modal genuinely gone
 * and nobody else has a reason to close anything.
 */

/** One tick of server round-trip, plus room for a dropped action to be re-sent. */
const CLOSE_TIMEOUT_MS = 3000;

export const Modals = {
    main(): number {
        return reader.modals().main;
    },

    isOpen(): boolean {
        return reader.modals().main !== -1;
    },

    /**
     * Close the open main modal and wait for it to actually go away.
     *
     * True when nothing was open or the modal cleared; false when it is still up
     * after {@link CLOSE_TIMEOUT_MS} — a real failure worth logging, not a
     * timing artefact.
     */
    async close(): Promise<boolean> {
        const before = reader.modals().main;
        if (before === -1) {
            return true;
        }
        if (!actions.closeModal()) {
            // No close button on this root: nothing more this can do, and the
            // caller's own oracle decides whether that matters.
            return reader.modals().main === -1;
        }
        return Execution.delayUntil(() => reader.modals().main !== before, CLOSE_TIMEOUT_MS);
    },

    /** Close whatever is up, if anything, and settle. Never reports failure. */
    async closeIfOpen(): Promise<void> {
        if (reader.modals().main !== -1) {
            await Modals.close();
        }
    }
};
