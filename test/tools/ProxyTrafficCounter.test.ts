import { describe, expect, test } from 'bun:test';
import { payloadByteLength, ProxyTrafficCounter } from '../../tools/lib/ProxyTrafficCounter.js';

describe('ProxyTrafficCounter', () => {
    test('starts at authoritative zero and accumulates both directions exactly', () => {
        const counter = new ProxyTrafficCounter();
        expect(counter.snapshot()).toEqual({ status: 'available', receivedBytes: 0, sentBytes: 0 });

        counter.addReceived(1536);
        counter.addSent(512);
        expect(counter.snapshot()).toEqual({ status: 'available', receivedBytes: 1536, sentBytes: 512 });
    });

    test('counts streamed HTTP response chunks as they are consumed', async () => {
        const counter = new ProxyTrafficCounter();
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(3));
                controller.enqueue(new Uint8Array(5));
                controller.close();
            }
        });

        const body = await new Response(counter.countStream(source, 'received')).arrayBuffer();
        expect(body.byteLength).toBe(8);
        expect(counter.snapshot()).toEqual({ status: 'available', receivedBytes: 8, sentBytes: 0 });
    });

    test('measures binary and UTF-8 WebSocket application payloads', () => {
        expect(payloadByteLength('a💾')).toBe(5);
        expect(payloadByteLength(new Uint8Array(7).subarray(2, 6))).toBe(4);
        expect(payloadByteLength(new ArrayBuffer(9))).toBe(9);
    });

    test('invalid and overflowing input becomes permanently unavailable without stale totals', () => {
        const invalid = new ProxyTrafficCounter();
        invalid.addReceived(10);
        invalid.addSent(0.5);
        expect(invalid.snapshot()).toEqual({
            status: 'unavailable',
            reason: 'proxy traffic counter received an invalid byte count'
        });
        invalid.addReceived(1);
        expect(invalid.snapshot()).not.toHaveProperty('receivedBytes');

        const overflow = new ProxyTrafficCounter();
        overflow.addSent(Number.MAX_SAFE_INTEGER);
        overflow.addSent(1);
        expect(overflow.snapshot()).toEqual({
            status: 'unavailable',
            reason: 'proxy traffic counter exceeded the safe integer range'
        });
    });
});
