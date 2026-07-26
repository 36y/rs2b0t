import { describe, expect, test } from 'bun:test';
import { TrafficMeter, type TrafficMessage } from '#/io/TrafficMeter.js';

class FakeChannel {
    readonly messages: TrafficMessage[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    postMessage(message: TrafficMessage): void {
        this.messages.push(message);
    }

    close(): void {
        this.closed = true;
    }
}

describe('TrafficMeter', () => {
    test('publishes exact deltas and clears only delivered available counters', () => {
        const channel = new FakeChannel();
        const meter = new TrafficMeter({
            channelFactory: () => channel as unknown as BroadcastChannel,
            setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
            clearTimeout: () => undefined
        });

        meter.addReceived(1536);
        meter.addSent(512);
        meter.publish();
        meter.publish();

        expect(channel.messages).toEqual([
            { type: 'rs2b0t:traffic', status: 'available', receivedBytes: 1536, sentBytes: 512 },
            { type: 'rs2b0t:traffic', status: 'available', receivedBytes: 0, sentBytes: 0 }
        ]);
        meter.close();
        expect(channel.closed).toBe(true);
    });

    test('heartbeats on the configured timer while idle', () => {
        const channel = new FakeChannel();
        let heartbeat: (() => void) | null = null;
        const meter = new TrafficMeter({
            channelFactory: () => channel as unknown as BroadcastChannel,
            setTimeout: callback => {
                heartbeat = callback;
                return 1 as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimeout: () => undefined
        });

        expect(heartbeat).not.toBeNull();
        heartbeat!();
        expect(channel.messages).toEqual([
            { type: 'rs2b0t:traffic', status: 'available', receivedBytes: 0, sentBytes: 0 }
        ]);
        meter.close();
    });

    test('reports invalid and overflowing byte counts instead of fabricating totals', () => {
        const channel = new FakeChannel();
        const meter = new TrafficMeter({
            channelFactory: () => channel as unknown as BroadcastChannel,
            setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
            clearTimeout: () => undefined
        });

        meter.addSent(Number.MAX_SAFE_INTEGER);
        meter.addSent(1);
        expect(channel.messages.at(-1)).toEqual({
            type: 'rs2b0t:traffic',
            status: 'unavailable',
            reason: 'browser traffic counter received an invalid byte count'
        });
        meter.close();
    });

    test('validates the heartbeat interval', () => {
        expect(() => new TrafficMeter({ intervalMs: 0 })).toThrow('traffic publish interval must be positive');
    });
});
