import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { CgroupResourceSampler, resolveDedicatedCgroupDir } from '../../tools/lib/CgroupResourceSampler.js';

type FileValue = string | Error;

class SnapshotFiles {
    private readonly values = new Map<string, FileValue[]>();

    constructor(cgroupDir: string, snapshots: Array<{ cpu: FileValue; memory: FileValue; procs: FileValue }>) {
        this.values.set(join(cgroupDir, 'cpu.stat'), snapshots.map(snapshot => snapshot.cpu));
        this.values.set(join(cgroupDir, 'memory.current'), snapshots.map(snapshot => snapshot.memory));
        this.values.set(join(cgroupDir, 'cgroup.procs'), snapshots.map(snapshot => snapshot.procs));
    }

    readonly read = async (path: string): Promise<string> => {
        const values = this.values.get(path);
        const value = values?.shift();
        if (value === undefined) throw new Error(`unexpected read: ${path}`);
        if (value instanceof Error) throw value;
        return value;
    };
}

function samplerFor(
    snapshots: Array<{ cpu: FileValue; memory: FileValue; procs: FileValue }>,
    times: number[],
    options: { cgroupDir?: string; rootPid?: number; logicalCpuCount?: number | (() => number) } = {}
): CgroupResourceSampler {
    const cgroupDir = options.cgroupDir ?? '/sys/fs/cgroup/rs2b0t-viewer-test';
    const files = new SnapshotFiles(cgroupDir, snapshots);
    return new CgroupResourceSampler({
        cgroupDir,
        rootPid: options.rootPid ?? 100,
        readFile: files.read,
        now: () => times.shift() ?? Number.NaN,
        logicalCpuCount: options.logicalCpuCount ?? 8
    });
}

describe('CgroupResourceSampler', () => {
    test('warms once, then reports exact cgroup CPU deltas and memory', async () => {
        const sampler = samplerFor([
            { cpu: 'usage_usec 1000000\nuser_usec 800000\nsystem_usec 200000\n', memory: '4096\n', procs: '100\n101\n' },
            { cpu: 'usage_usec 2500000\nuser_usec 2000000\nsystem_usec 500000\n', memory: '8192\n', procs: '100\n101\n' }
        ], [1_000, 2_000]);

        expect(await sampler.sample()).toEqual({
            status: 'available',
            rootPid: 100,
            sampledAtMs: 1_000,
            processCount: 2,
            logicalCpuCount: 8,
            cpuStatus: 'warming-up',
            cpuCores: null,
            cpuPercent: null,
            memoryBytes: 4096,
            memorySource: 'cgroup'
        });

        const sample = await sampler.sample();
        expect(sample).toMatchObject({
            status: 'available',
            cpuStatus: 'available',
            memoryBytes: 8192,
            memorySource: 'cgroup'
        });
        if (sample.status !== 'available') return;
        expect(sample.cpuCores).toBeCloseTo(1.5, 12);
        expect(sample.cpuPercent).toBeCloseTo(18.75, 12);
    });

    test('process creation and exit do not invalidate cumulative cgroup CPU', async () => {
        const sampler = samplerFor([
            { cpu: 'usage_usec 4000000\n', memory: '9000\n', procs: '100\n101\n102\n' },
            { cpu: 'usage_usec 4500000\n', memory: '7000\n', procs: '100\n777\n' }
        ], [0, 1_000], { logicalCpuCount: 4 });

        await sampler.sample();
        expect(await sampler.sample()).toEqual({
            status: 'available',
            rootPid: 100,
            sampledAtMs: 1_000,
            processCount: 2,
            logicalCpuCount: 4,
            cpuStatus: 'available',
            cpuCores: 0.5,
            cpuPercent: 12.5,
            memoryBytes: 7000,
            memorySource: 'cgroup'
        });
    });

    test('requires the registered root to remain a direct cgroup member and resets the baseline', async () => {
        const sampler = samplerFor([
            { cpu: 'usage_usec 1000000\n', memory: '1000\n', procs: '100\n101\n' },
            { cpu: 'usage_usec 2000000\n', memory: '1000\n', procs: '101\n' },
            { cpu: 'usage_usec 3000000\n', memory: '1000\n', procs: '100\n102\n' },
            { cpu: 'usage_usec 3500000\n', memory: '1000\n', procs: '100\n' }
        ], [0, 1_000, 2_000, 3_000], { logicalCpuCount: 4 });

        await sampler.sample();
        expect(await sampler.sample()).toEqual({
            status: 'unavailable',
            rootPid: 100,
            sampledAtMs: 1_000,
            reason: 'registered root PID 100 is not directly in the cgroup'
        });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'warming-up' });
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'available',
            cpuCores: 0.5,
            cpuPercent: 12.5
        });
    });

    test('rejects malformed, negative, and unsafe CPU counters without a last-known fallback', async () => {
        const unsafe = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
        const sampler = samplerFor([
            { cpu: 'usage_usec nope\n', memory: '1000\n', procs: '100\n' },
            { cpu: 'usage_usec -1\n', memory: '1100\n', procs: '100\n' },
            { cpu: `usage_usec ${unsafe}\n`, memory: '1200\n', procs: '100\n' },
            { cpu: 'usage_usec 1000000\n', memory: '1300\n', procs: '100\n' },
            { cpu: 'usage_usec 1500000\n', memory: '1400\n', procs: '100\n' }
        ], [0, 1_000, 2_000, 3_000, 4_000], { logicalCpuCount: 4 });

        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuCores: null,
            cpuPercent: null,
            cpuUnavailableReason: 'cpu.stat usage_usec is malformed',
            memoryBytes: 1000
        });
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuUnavailableReason: 'cpu.stat usage_usec must not be negative',
            memoryBytes: 1100
        });
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuUnavailableReason: "cpu.stat usage_usec exceeds JavaScript's safe integer range",
            memoryBytes: 1200
        });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'warming-up', memoryBytes: 1300 });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'available', cpuCores: 0.5, memoryBytes: 1400 });
    });

    test('rejects a regressing counter for one interval and recovers from its valid endpoint', async () => {
        const sampler = samplerFor([
            { cpu: 'usage_usec 5000000\n', memory: '1000\n', procs: '100\n' },
            { cpu: 'usage_usec 4000000\n', memory: '1000\n', procs: '100\n' },
            { cpu: 'usage_usec 4500000\n', memory: '1000\n', procs: '100\n' }
        ], [0, 1_000, 2_000], { logicalCpuCount: 4 });

        await sampler.sample();
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuCores: null,
            cpuPercent: null,
            cpuUnavailableReason: 'cgroup CPU usage counter regressed'
        });
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'available',
            cpuCores: 0.5,
            cpuPercent: 12.5
        });
    });

    test('rejects a non-advancing clock and recovers on the next interval', async () => {
        const sampler = samplerFor([
            { cpu: 'usage_usec 1000000\n', memory: '1000\n', procs: '100\n' },
            { cpu: 'usage_usec 1200000\n', memory: '1000\n', procs: '100\n' },
            { cpu: 'usage_usec 1700000\n', memory: '1000\n', procs: '100\n' }
        ], [1_000, 1_000, 2_000], { logicalCpuCount: 2 });

        await sampler.sample();
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuUnavailableReason: 'monotonic sampling clock did not advance'
        });
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'available',
            cpuCores: 0.5,
            cpuPercent: 25
        });
    });

    test('reports invalid memory independently and never reuses an earlier value', async () => {
        const unsafe = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
        const sampler = samplerFor([
            { cpu: 'usage_usec 0\n', memory: '5000\n', procs: '100\n' },
            { cpu: 'usage_usec 100000\n', memory: '-1\n', procs: '100\n' },
            { cpu: 'usage_usec 200000\n', memory: unsafe, procs: '100\n' },
            { cpu: 'usage_usec 300000\n', memory: 'not-a-number\n', procs: '100\n' },
            { cpu: 'usage_usec 400000\n', memory: '4500\n', procs: '100\n' }
        ], [0, 1_000, 2_000, 3_000, 4_000], { logicalCpuCount: 2 });

        expect(await sampler.sample()).toMatchObject({ memoryBytes: 5000, memorySource: 'cgroup' });
        expect(await sampler.sample()).toMatchObject({
            cpuStatus: 'available',
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableReason: 'memory.current must not be negative'
        });
        expect(await sampler.sample()).toMatchObject({
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableReason: "memory.current exceeds JavaScript's safe integer range"
        });
        expect(await sampler.sample()).toMatchObject({
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableReason: 'memory.current is malformed'
        });
        expect(await sampler.sample()).toMatchObject({ memoryBytes: 4500, memorySource: 'cgroup' });
    });

    test('strictly validates cgroup.procs and sampler registration', async () => {
        const malformed = samplerFor([
            { cpu: 'usage_usec 1\n', memory: '1\n', procs: '100\nnot-a-pid\n' }
        ], [0]);
        expect(await malformed.sample()).toMatchObject({
            status: 'unavailable',
            reason: 'cgroup.procs PID is malformed'
        });

        const duplicate = samplerFor([
            { cpu: 'usage_usec 1\n', memory: '1\n', procs: '100\n100\n' }
        ], [0]);
        expect(await duplicate.sample()).toMatchObject({
            status: 'unavailable',
            reason: 'cgroup.procs contains duplicate PID 100'
        });

        const relative = samplerFor([], [0], { cgroupDir: 'relative/cgroup' });
        expect(await relative.sample()).toMatchObject({
            status: 'unavailable',
            reason: 'cgroup directory must be an absolute path'
        });

        const badRoot = samplerFor([], [0], { rootPid: Number.MAX_SAFE_INTEGER + 1 });
        expect(await badRoot.sample()).toMatchObject({
            status: 'unavailable',
            reason: 'registered root PID must be a positive safe integer'
        });
    });

    test('reports file errors explicitly and recovers without retained values', async () => {
        const sampler = samplerFor([
            { cpu: new Error('permission denied'), memory: new Error('memory denied'), procs: '100\n' },
            { cpu: 'usage_usec 1000000\n', memory: '2000\n', procs: '100\n' },
            { cpu: 'usage_usec 1500000\n', memory: '2500\n', procs: '100\n' }
        ], [0, 1_000, 2_000], { logicalCpuCount: 4 });

        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuUnavailableReason: 'could not read cpu.stat: permission denied',
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableReason: 'could not read memory.current: memory denied'
        });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'warming-up', memoryBytes: 2000 });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'available', cpuCores: 0.5, memoryBytes: 2500 });
    });

    test('serializes concurrent samples before reading the clock or files', async () => {
        let calls = 0;
        let releaseFirst: () => void = () => {};
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const reads = new Map<string, number>();
        const sampler = new CgroupResourceSampler({
            cgroupDir: '/sys/fs/cgroup/rs2b0t-viewer-test',
            rootPid: 100,
            logicalCpuCount: 2,
            now: () => ++calls * 1_000,
            readFile: async path => {
                const count = (reads.get(path) ?? 0) + 1;
                reads.set(path, count);
                if (path.endsWith('cgroup.procs')) return '100\n';
                if (path.endsWith('memory.current')) return '1000\n';
                if (count === 1) await firstGate;
                return count === 1 ? 'usage_usec 1000000\n' : 'usage_usec 1500000\n';
            }
        });

        const first = sampler.sample();
        await Promise.resolve();
        const second = sampler.sample();
        await Promise.resolve();
        // The clock is deliberately read immediately after cpu.stat resolves,
        // so the blocked first counter read has not acquired a timestamp yet.
        expect(calls).toBe(0);
        expect(reads.get('/sys/fs/cgroup/rs2b0t-viewer-test/cpu.stat')).toBe(1);

        releaseFirst();
        const [warmup, sample] = await Promise.all([first, second]);
        expect(warmup).toMatchObject({ cpuStatus: 'warming-up' });
        expect(sample).toMatchObject({ cpuStatus: 'available', cpuCores: 0.5 });
        expect(calls).toBe(2);
    });
});

describe('resolveDedicatedCgroupDir', () => {
    test('resolves only the unified rs2b0t viewer leaf beneath the configured cgroup root', async () => {
        const reads: string[] = [];
        const result = await resolveDedicatedCgroupDir(321, {
            procRoot: '/test/proc',
            cgroupRoot: '/test/cgroup',
            readFile: async path => {
                reads.push(path);
                return '1:net_cls:/\n0::/user.slice/app.slice/rs2b0t-viewer-mcp-321\n';
            }
        });

        expect(reads).toEqual(['/test/proc/321/cgroup']);
        expect(result).toEqual({
            status: 'available',
            cgroupDir: '/test/cgroup/user.slice/app.slice/rs2b0t-viewer-mcp-321'
        });
    });

    test('rejects a shared browser/terminal cgroup instead of falling back to its counters', async () => {
        expect(await resolveDedicatedCgroupDir(321, {
            readFile: async () => '0::/user.slice/app-org.kde.konsole.scope\n'
        })).toEqual({
            status: 'unavailable',
            reason: 'registered root is not in a dedicated rs2b0t viewer cgroup (found app-org.kde.konsole.scope)'
        });
    });

    test('rejects missing, duplicate, malformed, and unreadable unified memberships', async () => {
        expect(await resolveDedicatedCgroupDir(321, {
            readFile: async () => '1:net_cls:/\n'
        })).toMatchObject({ status: 'unavailable', reason: 'registered root has no unified cgroup-v2 membership' });

        expect(await resolveDedicatedCgroupDir(321, {
            readFile: async () => '0::/rs2b0t-viewer-one\n0::/rs2b0t-viewer-two\n'
        })).toMatchObject({ status: 'unavailable', reason: 'registered root has duplicate unified cgroup-v2 memberships' });

        expect(await resolveDedicatedCgroupDir(321, {
            readFile: async () => '0::/user.slice/../rs2b0t-viewer-321\n'
        })).toMatchObject({ status: 'unavailable', reason: 'registered root cgroup-v2 path is malformed' });

        expect(await resolveDedicatedCgroupDir(321, {
            readFile: async () => { throw new Error('gone'); }
        })).toMatchObject({ status: 'unavailable', reason: 'could not read registered root cgroup membership: gone' });
    });

    test('validates the registered PID and both filesystem roots', async () => {
        expect(await resolveDedicatedCgroupDir(0)).toMatchObject({
            status: 'unavailable',
            reason: 'registered root PID must be a positive safe integer'
        });
        expect(await resolveDedicatedCgroupDir(1, { procRoot: 'relative' })).toMatchObject({
            status: 'unavailable',
            reason: 'proc root must be an absolute path'
        });
        expect(await resolveDedicatedCgroupDir(1, { cgroupRoot: 'relative' })).toMatchObject({
            status: 'unavailable',
            reason: 'cgroup root must be an absolute path'
        });
    });
});
