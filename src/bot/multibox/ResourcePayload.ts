export interface AvailableCpuPayload {
    status: 'available';
    cpuCores: number;
    cpuPercent: number;
    logicalCpuCount: number;
}

export interface WarmingCpuPayload {
    status: 'warming-up';
}

export interface UnavailableMetricPayload {
    status: 'unavailable';
    reason: string;
}

export type CpuPayload = AvailableCpuPayload | WarmingCpuPayload | UnavailableMetricPayload;

export type MemorySource = 'cgroup' | 'pss' | 'rss';

export interface AvailableMemoryPayload {
    status: 'available';
    memoryBytes: number;
    memorySource: MemorySource;
}

export type MemoryPayload = AvailableMemoryPayload | UnavailableMetricPayload;

export interface TrafficTotals {
    receivedBytes: number;
    sentBytes: number;
}

export type TrafficPayload = ({ status: 'available' } & TrafficTotals) | UnavailableMetricPayload;

export interface ResourcePayload {
    scope: 'bot-browser';
    sampledAt: number;
    cpu: CpuPayload;
    memory: MemoryPayload;
    traffic: TrafficPayload;
}
