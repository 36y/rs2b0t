import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#3rdparty/audio.js', () => ({
    playWave: async (): Promise<void> => {},
    setWaveVolume: (): void => {}
}));
mock.module('#3rdparty/tinymidipcm.js', () => ({
    playMidi: (): void => {},
    setMidiVolume: (): void => {},
    stopMidi: (): void => {}
}));

const { default: ClientBuild } = await import('#/client/ClientBuild.js');
const { default: LocType } = await import('#/config/LocType.js');
const { default: Model } = await import('#/dash3d/Model.js');

// deltaId, then per position: deltaPos, shape byte; 0 terminates each list.
// loc 5 and loc 9 each sit at tile (1,2) with one model apiece.
const LOC_STREAM = (): Uint8Array => new Uint8Array([6, 67, 0, 0, 4, 67, 0, 0, 0]);

const MODEL_OF: Record<number, number> = { 5: 100, 9: 200 };

describe('checkLocations model readiness', () => {
    let listCalls: number;
    let loaded: Set<number>;
    let requested: number[];
    let origList: typeof LocType.list;
    let origRequest: typeof Model.requestDownload;

    beforeEach(() => {
        listCalls = 0;
        loaded = new Set();
        requested = [];
        origList = LocType.list;
        origRequest = Model.requestDownload;

        LocType.list = (id: number): LocType => {
            listCalls++;
            const loc = Object.create(LocType.prototype) as LocType;
            loc.model = [MODEL_OF[id]];
            loc.active = false;
            loc.forcedecor = false;
            return loc;
        };

        Model.requestDownload = (id: number): boolean => {
            if (loaded.has(id)) {
                return true;
            }
            requested.push(id);
            return false;
        };
    });

    afterEach(() => {
        LocType.list = origList;
        Model.requestDownload = origRequest;
    });

    test('decodes the loc stream once, then watches only the missing models', () => {
        const src = LOC_STREAM();

        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);
        expect(requested).toEqual([100, 200]);

        // second tick: same answer, without walking the stream again
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);

        loaded.add(100);
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);

        loaded.add(200);
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(true);
        expect(listCalls).toBe(2);
    });

    test('a region whose models are already loaded is ready with nothing requested', () => {
        loaded.add(100);
        loaded.add(200);

        expect(ClientBuild.checkLocations(LOC_STREAM(), 0, 0)).toBe(true);
        expect(requested).toEqual([]);
    });

    test('re-scans when the same region data is placed at new offsets', () => {
        const src = LOC_STREAM();

        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);

        expect(ClientBuild.checkLocations(src, 8, 8)).toBe(false);
        expect(listCalls).toBe(4);
    });

    test('keeps re-requesting a model that has not arrived yet', () => {
        const src = LOC_STREAM();

        ClientBuild.checkLocations(src, 0, 0);
        loaded.add(100);
        ClientBuild.checkLocations(src, 0, 0);
        ClientBuild.checkLocations(src, 0, 0);

        // 200 stays armed for re-request; 100 drops out once it lands
        expect(requested.filter(id => id === 200).length).toBe(3);
        expect(requested.filter(id => id === 100).length).toBe(1);
    });
});
