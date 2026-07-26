import type { CpuPayload, MemoryPayload, ResourcePayload, TrafficPayload } from '../../src/bot/multibox/ResourcePayload.js';
import type { CgroupResourceSample } from './CgroupResourceSampler.js';
import type { ProcessResourceSample } from './ProcessResourceSampler.js';

type BrowserResourceSample = CgroupResourceSample | ProcessResourceSample;

export type {
    AvailableCpuPayload,
    AvailableMemoryPayload,
    CpuPayload,
    MemoryPayload,
    MemorySource,
    ResourcePayload,
    TrafficPayload,
    TrafficTotals,
    UnavailableMetricPayload,
    WarmingCpuPayload
} from '../../src/bot/multibox/ResourcePayload.js';

export function unavailableResourcePayload(reason: string, traffic: TrafficPayload, sampledAt = Date.now()): ResourcePayload {
    return {
        scope: 'bot-browser',
        sampledAt,
        cpu: { status: 'unavailable', reason },
        memory: { status: 'unavailable', reason },
        traffic
    };
}

export function processResourcePayload(sample: BrowserResourceSample, traffic: TrafficPayload, sampledAt = Date.now()): ResourcePayload {
    if (sample.status === 'unavailable') {
        return unavailableResourcePayload(sample.reason, traffic, sampledAt);
    }

    const cpu: CpuPayload = sample.cpuStatus === 'available' && sample.cpuCores !== null && sample.cpuPercent !== null && sample.logicalCpuCount !== null
        ? {
            status: 'available',
            cpuCores: sample.cpuCores,
            cpuPercent: sample.cpuPercent,
            logicalCpuCount: sample.logicalCpuCount
        }
        : sample.cpuStatus === 'warming-up'
            ? { status: 'warming-up' }
            : {
                status: 'unavailable',
                reason: sample.cpuUnavailableReason ?? 'browser CPU accounting is unavailable'
            };

    const memory: MemoryPayload = sample.memoryBytes !== null && sample.memorySource !== 'unavailable'
        ? {
            status: 'available',
            memoryBytes: sample.memoryBytes,
            memorySource: sample.memorySource
        }
        : {
            status: 'unavailable',
            reason: 'memoryUnavailableReason' in sample && sample.memoryUnavailableReason
                ? sample.memoryUnavailableReason
                : 'memoryUnavailableProcessCount' in sample && sample.memoryUnavailableProcessCount > 0
                    ? `memory accounting unavailable for ${sample.memoryUnavailableProcessCount} live browser process${sample.memoryUnavailableProcessCount === 1 ? '' : 'es'}`
                    : 'browser memory accounting is unavailable'
        };

    return { scope: 'bot-browser', sampledAt, cpu, memory, traffic };
}
