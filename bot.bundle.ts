import fs from 'fs';

import { buildIdentityDefines, resolveBuildIdentity, writeVersionJson } from './tools/lib/buildIdentity.js';

// Bot client build: src/bot/main.ts → botclient.js, console always kept.
// Why: no terser pass, so `globalThis.__rs2b0t` keeps stable property names for externally-compiled scripts and string-keyed self-tests; Bun's minifier shortens locals only.

const TARGET_NAME = process.env.TARGET ?? (process.argv.slice(2).includes('scripts') && fs.existsSync('out/intree-scripts.json')
    ? (JSON.parse(fs.readFileSync('out/intree-scripts.json', 'utf8')) as { target: string }).target
    : 'local');

// Public login keys per target: 1024-bit RSA, exponent 65537, upstream's 512-bit default was rotated out.
// Why: local is the engine repo's committed private.pem public half; LOCAL_RSAE/LOCAL_RSAN override it against an unmodified upstream engine, and live's rotated modulus arrives as LIVE_RSAN at build time.
const TARGET_RSA: Record<string, { rsae: string; rsan: string }> = {
    local: {
        rsae: process.env.LOCAL_RSAE ?? '65537',
        rsan: process.env.LOCAL_RSAN ?? '135523076496100112838368820296627333081299340012903560093710594598681655098748405760144616526347126272127045237860467661349157596468705435014708178676542187051745346055229544524388140867808854007219907874939518784380039390430841371837588073879981616508242779530473286487605800927487856120184640386127488369021'
    },
    live: {
        rsae: '65537',
        rsan: process.env.LIVE_RSAN ?? ''
    },
    // prod = the client hosted on the game server (same-origin, no proxy); ops/scripts/build.sh injects PROD_RSAN from the served client.js.
    prod: {
        rsae: '65537',
        rsan: process.env.PROD_RSAN ?? ''
    }
};

if (!(TARGET_NAME in TARGET_RSA)) {
    console.error(`Unknown TARGET '${TARGET_NAME}'. Valid: ${Object.keys(TARGET_RSA).join(', ')}.`);
    process.exit(1);
}

const scriptsOnlyRequested = process.argv.slice(2).includes('scripts');
const previousManifest = scriptsOnlyRequested && fs.existsSync('out/intree-scripts.json')
    ? JSON.parse(fs.readFileSync('out/intree-scripts.json', 'utf8')) as { target?: string; rsa?: { rsae: string; rsan: string } }
    : null;
if (scriptsOnlyRequested && previousManifest?.target !== TARGET_NAME) throw new Error('Build target differs from the running client.');
const rsa = scriptsOnlyRequested && previousManifest?.rsa ? previousManifest.rsa : TARGET_RSA[TARGET_NAME] ?? TARGET_RSA.local;
if ((TARGET_NAME === 'live' || TARGET_NAME === 'prod') && rsa.rsan === '') {
    const envVar = TARGET_NAME === 'live' ? 'LIVE_RSAN' : 'PROD_RSAN';
    console.error(`TARGET=${TARGET_NAME} requires ${envVar} (rs2b2t rotated modulus). Aborting.`);
    process.exit(1);
}

// Reuse the identity embedded in the installed host when rebuilding scripts.
// In particular, BUILD_TIME must not change between script-only builds.
const identity = scriptsOnlyRequested
    ? (() => {
        if (!fs.existsSync('out/version.json')) {
            throw new Error('Missing host build identity. Run a full client build first.');
        }
        const saved = JSON.parse(fs.readFileSync('out/version.json', 'utf8')) as {
            commit?: string; short?: string; dirty?: boolean; builtAt?: string;
        };
        if (!saved.commit || !saved.short || !saved.builtAt || typeof saved.dirty !== 'boolean') {
            throw new Error('Invalid host build identity. Run a full client build first.');
        }
        return { commit: saved.commit, short: saved.short, dirty: saved.dirty, builtAt: saved.builtAt };
    })()
    : resolveBuildIdentity();

const define = {
    'process.env.SECURE_ORIGIN': JSON.stringify(process.env.SECURE_ORIGIN ?? 'false'),
    'process.env.RS2B0T_TARGET': JSON.stringify(TARGET_NAME),
    'process.env.LOGIN_RSAE': JSON.stringify(rsa.rsae),
    'process.env.LOGIN_RSAN': JSON.stringify(rsa.rsan),
    // shipped default is OFF: Client.ts/LocType.ts/NpcType.ts/ObjType.ts/SeqType.ts gate on === '1'
    'process.env.STRICT_PACKETS': JSON.stringify(process.env.STRICT_PACKETS ?? ''),
    'process.env.STRICT_CONFIG': JSON.stringify(process.env.STRICT_CONFIG ?? ''),
    ...buildIdentityDefines(identity)
};

const args = process.argv.slice(2);
const scriptsOnly = args.includes('scripts');
const prod = !args.includes('dev');
if (scriptsOnly && !fs.existsSync('out/intree-scripts.json')) {
    throw new Error('Build and launch the full bot client once before building scripts only.');
}

if (!fs.existsSync('out')) {
    fs.mkdirSync('out');
}

if (!scriptsOnly) fs.copyFileSync('src/client/3rdparty/tinymidipcm/tinymidipcm.wasm', 'out/tinymidipcm.wasm');

// Build the client and InTree registration entry together so Bun shares the
// runtime modules between them rather than creating duplicate singletons.
const entries = [
    'src/bot/main.ts',
    'src/bot/scripts/index.ts'
];
const build = await Bun.build({
    entrypoints: entries,
    sourcemap: 'external',
    define,
    minify: prod,
    splitting: true,
    naming: { entry: '[name].js', chunk: 'chunks/[name]-[hash].js', asset: '[name]-[hash].[ext]' }
});
if (!build.success) {
    build.logs.forEach((x: unknown) => console.log(x));
    process.exit(1);
}

const outputs = new Map<string, string>();
for (const output of build.outputs) {
    if (output.path.endsWith('.map')) continue;
    const generated = output.path.split('/').pop()!;
    const target = generated === 'main.js' ? 'botclient.js'
        : generated === 'index.js' ? 'intree-scripts.js'
        : generated === 'OnDemandWorker.js' ? 'ondemandworker.js'
        : generated === 'NavWorker.js' ? 'navworker.js'
        : generated;
    const relative = output.path.replace(/^.*?\/(chunks\/.*)$/, '$1');
    const name = relative.startsWith('chunks/') ? relative : target;
    const text = await output.text();
    outputs.set(name, text.replace('sourceMappingURL=' + generated + '.map', 'sourceMappingURL=' + target + '.map'));
    if (output.sourcemap) outputs.set(name + '.map', await output.sourcemap.text());
}
const hostSource = outputs.get('botclient.js') ?? '';
if (!hostSource) throw new Error('Bot client entrypoint missing from build outputs');
const hostFingerprint = Bun.hash(hostSource).toString(36);
if (scriptsOnly) {
    // Compare against the installed host, not a timestamp-dependent manifest hash.
    // Reject host-only changes and changed build defines before publishing scripts.
    if (!fs.existsSync('out/botclient.js') || fs.readFileSync('out/botclient.js', 'utf8') !== hostSource) {
        throw new Error('Host bundle changed. Full client rebuild and page restart required.');
    }
    const existing = JSON.parse(fs.readFileSync('out/intree-scripts.json', 'utf8')) as { hostFingerprint?: string; runtimeChunks?: string[]; target?: string };
    if (existing.target !== TARGET_NAME) {
        throw new Error('The host runtime or build target changed. Full client rebuild and page restart required.');
    }
    for (const chunk of existing.runtimeChunks ?? []) {
        const next = outputs.get(chunk);
        if (!next || !fs.existsSync('out/' + chunk) || fs.readFileSync('out/' + chunk, 'utf8') !== next) {
            throw new Error('Shared host chunk changed (' + chunk + '). Full client restart required.');
        }
    }
}
for (const [name, source] of outputs) {
    if (scriptsOnly && (name === 'botclient.js' || name === 'botclient.js.map')) continue;
    fs.mkdirSync('out/' + name.split('/').slice(0, -1).join('/'), { recursive: true });
    fs.writeFileSync('out/' + name, source);
}
// Fingerprint only chunks imported by the running host, not script-only
// chunks that legitimately change on each script rebuild.
const runtimeChunks = [...outputs.keys()].filter(name =>
    name.startsWith('chunks/') && name.endsWith('.js') && hostSource.includes(name)
).sort();
const scriptSource = outputs.get('intree-scripts.js');
if (!scriptSource) throw new Error('InTree script entrypoint missing from build outputs');
const version = Bun.hash([...outputs.entries()].filter(([name]) => name === 'intree-scripts.js' || name.startsWith('chunks/')).map(([name, value]) => name + value).join('')).toString(36);
fs.writeFileSync('out/intree-scripts.json', JSON.stringify({ version, runtimeChunks, hostFingerprint, target: TARGET_NAME, rsa }));

if (!scriptsOnly) for (const [entry, name] of [
    ['src/bot/multibox/main.ts', 'multibox.js'],
    ['src/client/io/OnDemandWorker.ts', 'ondemandworker.js'],
    ['src/bot/event/webwalk/NavWorker.ts', 'navworker.js']
] as const) {
    const extra = await Bun.build({ entrypoints: [entry], sourcemap: 'external', define, minify: prod });
    if (!extra.success) {
        extra.logs.forEach((x: unknown) => console.log(x));
        process.exit(1);
    }
    let source = await extra.outputs[0].text();
    const generated = extra.outputs[0].path.split('/').pop()!;
    source = source.replace('sourceMappingURL=' + generated + '.map', 'sourceMappingURL=' + name + '.map');
    fs.writeFileSync('out/' + name, source);
    fs.writeFileSync('out/' + name + '.map', extra.outputs[0].sourcemap ? await extra.outputs[0].sourcemap.text() : '');
}

if (!scriptsOnly) writeVersionJson('out/version.json', identity);
console.log(
    scriptsOnly ? `InTree scripts rebuilt: ${version} (host preserved)` : `bot bundle built (${prod ? 'prod' : 'dev'}): out/botclient.js  git=${identity.dirty ? `${identity.short}-dirty` : identity.short}`
);
