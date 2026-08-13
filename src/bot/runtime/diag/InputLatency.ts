// docs/decisions/multibox-telemetry-honesty.md
// Why: "a right-click takes 2 seconds" is the symptom that gets reported, so it is measured directly rather than inferred from CPU.
// Why: Firefox has no Long Tasks API but does implement Event Timing, which reports how long an input waited plus how long its handler ran -- the number a user perceives as lag.

const DEFAULT_THRESHOLD_MS = 100;

interface InputLatencyReading {
    maxMs: number;
    count: number;
}

interface EventTimingEntry {
    duration: number;
    name: string;
}

interface ObserverLike {
    observe(options: { type: string; durationThreshold?: number; buffered?: boolean }): void;
    disconnect(): void;
}

type ObserverFactory = (onEntries: (entries: EventTimingEntry[]) => void) => ObserverLike;

export class InputLatency {
    private maxMs = 0;
    private count = 0;
    private worstName = '';
    private observer: ObserverLike | null = null;

    constructor(
        private readonly makeObserver: ObserverFactory,
        private readonly thresholdMs: number = DEFAULT_THRESHOLD_MS
    ) {}

    /**
     * Event Timing is required, not optional: without it the wall would silently
     * report zero input lag while the user watches a click take two seconds.
     */
    start(): void {
        if (this.observer) {
            throw new Error('[rs2b0t] input latency observer is already started');
        }
        this.observer = this.makeObserver(entries => {
            for (const entry of entries) {
                this.count++;
                if (entry.duration > this.maxMs) {
                    this.maxMs = entry.duration;
                    this.worstName = entry.name;
                }
            }
        });
        this.observer.observe({ type: 'event', durationThreshold: this.thresholdMs, buffered: true });
    }

    stop(): void {
        this.observer?.disconnect();
        this.observer = null;
    }

    get worstEvent(): string {
        return this.worstName;
    }

    drain(): InputLatencyReading {
        const out = { maxMs: this.maxMs, count: this.count };
        this.maxMs = 0;
        this.count = 0;
        return out;
    }
}

/** Throws rather than degrading to a blind sampler if the API is absent. */
export function browserObserverFactory(scope: typeof globalThis = globalThis): ObserverFactory {
    const Ctor = (scope as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    const supported = Ctor?.supportedEntryTypes;
    if (!Ctor || !supported || !supported.includes('event')) {
        throw new Error('[rs2b0t] this browser has no Event Timing; input latency cannot be measured');
    }
    return onEntries =>
        new Ctor(list => {
            onEntries(list.getEntries() as unknown as EventTimingEntry[]);
        }) as unknown as ObserverLike;
}
