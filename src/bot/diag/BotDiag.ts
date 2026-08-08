// docs/MULTIBOX.md#diagnostics
//
// The per-frame half of diagnostics: one bot's main-thread cost and the queue
// depths most likely to grow. The wall drains this on every sample tick, so each
// value is "since the last drain" and needs no clock of its own.

import { boxId } from '../runtime/box.js';
import { PhaseTimer } from './PhaseTimer.js';
import type { Phase, SlowSpan } from './PhaseTimer.js';

export interface FrameSample {
    box: string;
    ingame: boolean;
    /** Main-thread ms spent in each phase since the last drain. */
    logicMs: number;
    drawMs: number;
    /** Slowest single occurrence, which a mean would hide. */
    logicMaxMs: number;
    drawMaxMs: number;
    logicCount: number;
    drawCount: number;
    /** Long phases with wall-clock windows, so the wall can attribute a stall. */
    slowSpans: SlowSpan[];
}

/** Reads live client state without importing Client, which would be a cycle. */
export interface DiagClientView {
    ingame: boolean;
}

export class BotDiagnostics {
    readonly timer: PhaseTimer;
    private view: DiagClientView | null = null;

    constructor(private readonly box: string) {
        this.timer = new PhaseTimer(box);
    }

    attach(view: DiagClientView): void {
        this.view = view;
    }

    measure<T>(phase: Phase, body: () => T): T {
        return this.timer.measure(phase, body);
    }

    drain(): FrameSample {
        if (!this.view) {
            throw new Error(`[rs2b0t] diagnostics drained on ${this.box} before a client attached`);
        }
        const totals = this.timer.drain();
        return {
            box: this.box,
            ingame: this.view.ingame,
            logicMs: totals.ms.logic,
            drawMs: totals.ms.draw,
            logicMaxMs: totals.maxMs.logic,
            drawMaxMs: totals.maxMs.draw,
            logicCount: totals.count.logic,
            drawCount: totals.count.draw,
            slowSpans: totals.slowSpans
        };
    }
}

export const BotDiag = new BotDiagnostics(boxId());
