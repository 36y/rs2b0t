import { describe, expect, test } from 'bun:test';
import { processResourcePayload, unavailableResourcePayload } from '../../tools/lib/ResourcePayload.js';

const TRAFFIC = { status: 'available', receivedBytes: 1234, sentBytes: 567 } as const;

describe('resource endpoint payload', () => {
    test('reports an absent browser explicitly for both independent metrics', () => {
        expect(unavailableResourcePayload('no browser', TRAFFIC, 123)).toEqual({
            scope: 'bot-browser',
            sampledAt: 123,
            cpu: { status: 'unavailable', reason: 'no browser' },
            memory: { status: 'unavailable', reason: 'no browser' },
            traffic: TRAFFIC
        });
    });

    test('keeps real RAM visible while CPU establishes its first delta', () => {
        expect(processResourcePayload({
            status: 'available',
            rootPid: 10,
            sampledAtMs: 1,
            processCount: 2,
            logicalCpuCount: 16,
            cpuStatus: 'warming-up',
            cpuCores: null,
            cpuPercent: null,
            memoryBytes: 512,
            memorySource: 'pss',
            memoryUnavailableProcessCount: 0
        }, TRAFFIC, 456)).toEqual({
            scope: 'bot-browser',
            sampledAt: 456,
            cpu: { status: 'warming-up' },
            memory: { status: 'available', memoryBytes: 512, memorySource: 'pss' },
            traffic: TRAFFIC
        });
    });

    test('keeps real RAM visible when only CPU accounting is unavailable', () => {
        expect(processResourcePayload({
            status: 'available',
            rootPid: 10,
            sampledAtMs: 1,
            processCount: 2,
            logicalCpuCount: null,
            cpuStatus: 'unavailable',
            cpuCores: null,
            cpuPercent: null,
            cpuUnavailableReason: 'could not determine Linux clock ticks per second',
            memoryBytes: 512,
            memorySource: 'pss',
            memoryUnavailableProcessCount: 0
        }, TRAFFIC, 457)).toEqual({
            scope: 'bot-browser',
            sampledAt: 457,
            cpu: { status: 'unavailable', reason: 'could not determine Linux clock ticks per second' },
            memory: { status: 'available', memoryBytes: 512, memorySource: 'pss' },
            traffic: TRAFFIC
        });
    });

    test('preserves authoritative cgroup memory and its independent failure reason', () => {
        expect(processResourcePayload({
            status: 'available',
            rootPid: 10,
            sampledAtMs: 1,
            processCount: 4,
            logicalCpuCount: 16,
            cpuStatus: 'warming-up',
            cpuCores: null,
            cpuPercent: null,
            memoryBytes: 2048,
            memorySource: 'cgroup'
        }, TRAFFIC, 500).memory).toEqual({
            status: 'available',
            memoryBytes: 2048,
            memorySource: 'cgroup'
        });

        expect(processResourcePayload({
            status: 'available',
            rootPid: 10,
            sampledAtMs: 2,
            processCount: 4,
            logicalCpuCount: 16,
            cpuStatus: 'warming-up',
            cpuCores: null,
            cpuPercent: null,
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableReason: 'could not read memory.current: denied'
        }, TRAFFIC, 501).memory).toEqual({
            status: 'unavailable',
            reason: 'could not read memory.current: denied'
        });
    });

    test('keeps real CPU visible when RAM cannot be measured', () => {
        expect(processResourcePayload({
            status: 'available',
            rootPid: 10,
            sampledAtMs: 1,
            processCount: 3,
            logicalCpuCount: 8,
            cpuStatus: 'available',
            cpuCores: 1.25,
            cpuPercent: 15.625,
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableProcessCount: 1
        }, TRAFFIC, 789)).toEqual({
            scope: 'bot-browser',
            sampledAt: 789,
            cpu: { status: 'available', cpuCores: 1.25, cpuPercent: 15.625, logicalCpuCount: 8 },
            memory: { status: 'unavailable', reason: 'memory accounting unavailable for 1 live browser process' },
            traffic: TRAFFIC
        });
    });

    test('does not turn a total collection failure into numeric values', () => {
        expect(processResourcePayload({
            status: 'unavailable',
            rootPid: 10,
            sampledAtMs: 1,
            reason: 'root exited'
        }, TRAFFIC, 999)).toEqual({
            scope: 'bot-browser',
            sampledAt: 999,
            cpu: { status: 'unavailable', reason: 'root exited' },
            memory: { status: 'unavailable', reason: 'root exited' },
            traffic: TRAFFIC
        });
    });

    test('keeps proxy traffic failure independent from browser metrics', () => {
        const traffic = { status: 'unavailable', reason: 'counter overflow' } as const;
        expect(unavailableResourcePayload('no browser', traffic, 100).traffic).toEqual(traffic);
    });
});
