// InTree FlyFisherLab baseline. This uses only this fork's existing client APIs.
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Skills } from '../../api/skills/Skills.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import type { Npc } from '../../api/model/Npc.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

const VERSION = '0.1.6-intree';
const BUILD_LABEL = '3T LIVE DROP / INTREE / v0.1.6';
const BOUNDARY_GRACE_MS = 65;
const INCIDENT_REPEAT_TICKS = 25;
const MAX_HISTORY = 32;
const MAX_INCIDENTS = 20;

const ROD = 'Fly fishing rod';
const FEATHER = 'Feather';
const KNIFE = 'Knife';
const LOGS = 'Logs';
const LURE = 'Lure';
const CRAFTED_BOW = 'Arrow shaft';

const EDGE_BANK = new Tile(3094, 3491, 0);
const FISH_RETURN = new Tile(3105, 3430, 0);

const FISH_TILES = [
  { x: 3103, z: 3425 },
  { x: 3103, z: 3424 },
  { x: 3109, z: 3432 },
  { x: 3109, z: 3434 }
];

const KEEP = new Set([
  'fly fishing rod',
  'feather',
  'knife',
  'logs'
]);

const DROP_NAMES = new Set([
  'raw trout',
  'raw salmon',
  'shortbow (u)',
  'willow shortbow (u)',
  'willow shortbow',
  'arrow shaft',
  'arrow shafts'
]);

const BankRuntime = Bank as typeof Bank & {
  close(timeoutMs?: number): Promise<boolean>;
};

type TileCoordinates = {
  x: number;
  z: number;
  level?: number;
};

type Phase =
  | 'idle'
  | 'menu-poll'
  | 'cycling'
  | 'boundary-drop'
  | 'relocating';

type HistoryEntry = {
  tick: number;
  cycle: number;
  event: string;
  detail: string;
};

type CraftIncident = {
  tick: number;
  cycle: number;
  xpGain: number;
  bowGain: number;
  willowGain: number;
  spot: string;
  t3Tick: number;
  t3Target: string;
  lastMoveTick: number;
  history: HistoryEntry[];
};

function distance(
  a: TileCoordinates,
  b: TileCoordinates
): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.z - b.z)
  );
}

function tileKey(tile: TileCoordinates): string {
  return `${tile.x}:${tile.z}:${tile.level ?? 0}`;
}

class FlyFisherLab extends LoopingBot {
  override loopDelay = 0;

  private phase: Phase = 'idle';
  private rideActive = false;
  private generation = 0;

  private spotIndex = -1;
  private spotTileKey = '';

  private menuRequested = false;
  private menuRequestTick = -1;
  private menuPollCount = 0;
  private lastMenuWaitLogTick = -1;
  private forceFreshKnife = false;

  private knifeTick = -1;
  private makeTick = -1;
  private lastIssuedMakeTick = -1;
  private lastIssuedLureTick = -1;
  private lastSpotMovementTick = -1;
  private nextKnifeAllowedTick = -1;

  private lastKnifeAttemptTick = -1;
  private lastMakeAttemptTick = -1;
  private lastLureAttemptTick = -1;
  private lastDropAttemptTick = -1;
  private lastBoundaryDropTick = -1;

  private knifePending = false;
  private makePending = false;
  private lurePending = false;
  private dropPending = false;
  private boundaryDropPending = false;
  private actionBusy = false;

  private relocating = false;
  private relocationBaseline = 0;
  private relocationLureTick = -1;
  private relocationTargetKey = '';
  private lastRelocationLureAttemptTick = -1;

  private observedTick = -1;
  private cycleNumber = 0;

  // Observe the actual tick-feed cadence before enabling packet-sensitive 3t actions.
  // The tick event is a client observation, not proof of the server read boundary.
  private lastTickAtMs = -1;
  private tickGapSamples = 0;
  private tickGapTotalMs = 0;
  private tickGapMinMs = Number.POSITIVE_INFINITY;
  private tickGapMaxMs = 0;
  private tickGapOver900Ms = 0;

  private observeTickCadence(tick: number): void {
    const now = performance.now();
    if (this.lastTickAtMs >= 0) {
      const gap = now - this.lastTickAtMs;
      this.tickGapSamples++;
      this.tickGapTotalMs += gap;
      this.tickGapMinMs = Math.min(this.tickGapMinMs, gap);
      this.tickGapMaxMs = Math.max(this.tickGapMaxMs, gap);
      if (gap > 900) this.tickGapOver900Ms++;
      if (this.tickGapSamples % 100 === 0) {
        this.log(`3T TICK FEED tick=${tick} samples=${this.tickGapSamples}` +
          ` avgMs=${Math.round(this.tickGapTotalMs / this.tickGapSamples)}` +
          ` minMs=${Math.round(this.tickGapMinMs)}` +
          ` maxMs=${Math.round(this.tickGapMaxMs)}` +
          ` gapsOver900Ms=${this.tickGapOver900Ms}` +
          ` selfAnim=${this.selfAnimation()}`);
      }
    }
    this.lastTickAtMs = now;
  }

  private totalKnives = 0;
  private totalMakes = 0;
  private totalLures = 0;
  private totalDrops = 0;
  private boundaryDrops = 0;
  private emptyDropWindows = 0;
  private menuTimeouts = 0;

  private fishingLastXp = 0;
  private fishingXpGained = 0;
  private fishSeen = 0;
  private lastFishCount = 0;

  private fletchingLastXp = 0;
  private fletchingXpGained = 0;
  private fletchingXpEvents = 0;
  private bowInventoryGainEvents = 0;
  private bowItemsDetected = 0;
  private willowShortbowsDetected = 0;
  private lastWillowShortbowCount = 0;
  private lastBowInventory = new Map<string, number>();
  private lastBowNames = '';

  private lastSpotSnapshot = '';
  private lastT3TargetIndex = -1;
  private lastT3TargetTile = '';
  private lastT3Tick = -1;

  // Experimental observations: no packet injection or undisclosed calls.
  private lastAnimId: number | null = null;
  private lastAnimObservedTick = -1;
  private animationChanges = 0;
  private logsConsumed = 0;
  private lastLogCount = 0;
  private bankStartMs = 0;
  private bankMs = 0;
  private bankTrips = 0;
  private fishingTicksObserved = 0;
  private totalTicksObserved = 0;
  private lastAccountedTick = -1;

  private selfAnimation(): number | null {
    // reader.selfAnim() is documented, but the adapter shape is version-dependent.
    try {
      const runtime = reader as unknown as {
        selfAnim?: () => number | null | undefined;
      };
      const value = runtime.selfAnim?.();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  private observeExperimental(source: string): void {
    if (!Game.ingame()) return;
    const tick = Game.tick();
    if (tick !== this.lastAccountedTick) {
      this.lastAccountedTick = tick;
      this.totalTicksObserved++;
      if (this.rideActive && !this.relocating) this.fishingTicksObserved++;
    }
    const anim = this.selfAnimation();
    if (anim !== this.lastAnimId) {
      if (this.lastAnimObservedTick >= 0) this.animationChanges++;
      const nearT3 = this.lastT3Tick >= 0 && tick - this.lastT3Tick <= 3;
      if (nearT3) {
        this.log(`LAB ANIMATION CHANGE tick=${tick} source=${source}` +
          ` from=${this.lastAnimId} to=${anim} sinceT3=${tick-this.lastT3Tick}` +
          ` lastMake=${this.lastIssuedMakeTick} lastLure=${this.lastIssuedLureTick}`);
        this.remember('ANIMATION', `from=${this.lastAnimId} to=${anim} source=${source}`, tick);
      }
      this.lastAnimId = anim;
      this.lastAnimObservedTick = tick;
    }
    const logs = Inventory.count(LOGS);
    if (this.rideActive && !this.actionBusy && logs < this.lastLogCount) {
      const consumed = this.lastLogCount - logs;
      this.logsConsumed += consumed;
      this.log(`LAB LOG CONSUMED tick=${tick} count=${consumed}` +
        ` total=${this.logsConsumed} sinceT3=${tick-this.lastT3Tick}` +
        ` lastMake=${this.lastIssuedMakeTick} lastLure=${this.lastIssuedLureTick}`);
      this.remember('LOG CONSUMED', `count=${consumed} anim=${anim}`,tick);
    }
    this.lastLogCount = logs;
  }

  private labSummary(reason: string): void {
    const seconds = Math.max(1,(Date.now()-this.startTime)/1000);
    this.log(`LAB SUMMARY ${reason} version=${VERSION}`+
      ` fishingXp=${this.fishingXpGained} xpHr=${Math.round(this.fishingXpGained*3600/seconds)}`+
      ` logsConsumed=${this.logsConsumed} logsHeld=${Inventory.count(LOGS)}`+
      ` bowCount=${this.willowShortbowsDetected} fletchXp=${this.fletchingXpGained}`+
      ` bankTrips=${this.bankTrips} bankSeconds=${(this.bankMs/1000).toFixed(1)}`+
      ` fishingTicks=${this.fishingTicksObserved} observedTicks=${this.totalTicksObserved}`+
      ` animChanges=${this.animationChanges}`);
  }

  private history: HistoryEntry[] = [];
  private incidents: CraftIncident[] = [];
  private lastIncidentSummaryTick = -1;

  private startTime = Date.now();

  override async onStart(): Promise<void> {
    this.startTime = Date.now();
    this.lastLogCount = Inventory.count(LOGS);

    this.fishingLastXp = Skills.xp('Fishing');
    this.fletchingLastXp = Skills.xp('Fletching');
    this.lastFishCount = this.fishCount();

    this.lastBowInventory = this.bowInventorySnapshot();
    this.lastBowNames = this.bowInventoryNames();
    this.lastWillowShortbowCount =
      Inventory.count(CRAFTED_BOW);

    this.on('tick', event => {
      this.observedTick = event.tick;
      this.observeTickCadence(event.tick);

      // Observe network positions before any tick-level
      // relocation handling changes the tracked spot.
      this.observeExperimental('tick');

      this.observeCrafting('tick');
      this.observeSpots('tick');
      this.repeatIncidentSummary(event.tick);

      if (
        this.rideActive &&
        !this.relocating &&
        !this.actionBusy
      ) {
        this.checkImmediateSpotMovement(event.tick);
      }
    });

    this.log(`FlyFisherLab v${VERSION} started`);
    this.log('3T SHAFTS experimental controller ON; InTree imports only; no host changes');
    this.log('Reader selfAnim, carrier consumption and banking diagnostics enabled');

    this.log(
      `CRAFT BASELINE tick=${Game.tick()}` +
      ` fletchingXp=${this.fletchingLastXp}` +
      ` willowShortbows=${this.lastWillowShortbowCount}` +
      ` bows=${this.formatBowSnapshot(this.lastBowInventory)}`
    );

    await Execution.delayUntil(
      () => Game.ingame(),
      0
    );
  }

  override onStop(): void {
    this.observeCrafting('stop');
    this.printIncidentSummary('STOP');
    this.labSummary('STOP');
    this.stopRide();
    this.log('FlyFisherLab stopped');
  }

  override onPause(): void {
    this.observeCrafting('pause');
    this.printIncidentSummary('PAUSE');
    this.labSummary('PAUSE');
    this.stopRide();
    this.log('FlyFisherLab paused');
  }

  override onResume(): void {
    this.stopRide();

    this.observeCrafting('resume-before-baseline');

    this.fletchingLastXp = Skills.xp('Fletching');
    this.lastBowInventory = this.bowInventorySnapshot();
    this.lastBowNames = this.bowInventoryNames();
    this.lastWillowShortbowCount =
      Inventory.count(CRAFTED_BOW);

    this.lastSpotSnapshot = '';


    this.log(
      `CRAFT RESUME BASELINE tick=${Game.tick()}` +
      ` fletchingXp=${this.fletchingLastXp}` +
      ` willowShortbows=${this.lastWillowShortbowCount}`
    );

    this.printIncidentSummary('RESUME');
    this.labSummary('RESUME');
    this.log('FlyFisherLab resumed');
  }

  override recoveryAnchor(): Tile {
    return FISH_RETURN;
  }

  override onPaint(
    ctx: CanvasRenderingContext2D
  ): void {
    const seconds = Math.max(
      1,
      (Date.now() - this.startTime) / 1000
    );

    const latest =
      this.incidents[this.incidents.length - 1];

    const lines = [
      `=== ${BUILD_LABEL} ===`,
      `FlyFisher v${VERSION}`,
      `3T SHAFTS: experimental / InTree / host unchanged`,
      `Phase: ${this.phase}`,
      `Cycle: ${this.cycleNumber}`,
      `Tick: ${this.observedTick}`,
      `Fishing XP: ${this.fishingXpGained}`,
      `Fishing XP/hr: ${Math.round(
        this.fishingXpGained * 3600 / seconds
      )}`,
      `Fish seen: ${this.fishSeen}`,
      `Fish held: ${this.fishCount()}`,
      `Arrow shafts detected: ${this.willowShortbowsDetected}`,
      `Fletching XP gained: ${this.fletchingXpGained}`,
      `Fletching XP events: ${this.fletchingXpEvents}`,
      `Bow inventory gains: ${this.bowInventoryGainEvents}`,
      `Bow items detected: ${this.bowItemsDetected}`,
      `Craft incidents retained: ${this.incidents.length}`,
      `Last craft tick: ${latest?.tick ?? 'none'}`,
      `Last craft cycle: ${latest?.cycle ?? 'none'}`,
      `Last craft T3: ${latest?.t3Tick ?? 'none'}`,
      `Last craft spot: ${latest?.t3Target ?? 'none'}`,
      `Last craft spot move: ${latest?.lastMoveTick ?? 'none'}`,
      `Animation ID: ${this.lastAnimId ?? 'unavailable'}`,
      `Animation changes: ${this.animationChanges}`,
      `Logs consumed: ${this.logsConsumed}`,
      `Bank trips: ${this.bankTrips}`,
      `Bank seconds: ${(this.bankMs/1000).toFixed(1)}`,
      `Knife / Make / Lure: ${this.totalKnives} / ${this.totalMakes} / ${this.totalLures}`,
      `Drops: ${this.totalDrops}`,
      `Boundary drops: ${this.boundaryDrops}`,
      `Empty T4: ${this.emptyDropWindows}`,
      `Menu timeouts: ${this.menuTimeouts}`
    ];

    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#00ffb3';
    ctx.fillText(BUILD_LABEL, 12, 20);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;

    let y = 43;

    for (const line of lines) {
      ctx.fillText(line, 12, y);
      y += 16;
    }

    ctx.shadowBlur = 0;
  }

  private fishCount(): number {
    return (
      Inventory.count('Raw trout') +
      Inventory.count('Raw salmon')
    );
  }

  private firstFish() {
    return (
      Inventory.first('Raw trout') ??
      Inventory.first('Raw salmon')
    );
  }

  private missingSupplies(): string[] {
    const missing: string[] = [];

    if (!Inventory.contains(ROD)) {
      missing.push(ROD);
    }

    if (!Inventory.contains(KNIFE)) {
      missing.push(KNIFE);
    }

    if (Inventory.count(FEATHER) <= 0) {
      missing.push(FEATHER);
    }

    if (Inventory.count(LOGS) <= 0) {
      missing.push(LOGS);
    }

    return missing;
  }

  private hasSupplies(): boolean {
    return this.missingSupplies().length === 0;
  }

  // ============================================================
  // RETAINED CRAFT INCIDENT DIAGNOSTICS
  // ============================================================

  private remember(
    event: string,
    detail: string,
    tick = Game.tick()
  ): void {
    this.history.push({
      tick,
      cycle: this.cycleNumber,
      event,
      detail
    });

    if (this.history.length > MAX_HISTORY) {
      this.history.splice(
        0,
        this.history.length - MAX_HISTORY
      );
    }
  }

  private recordCraftIncident(
    tick: number,
    xpGain: number,
    bowGain: number,
    willowGain: number
  ): void {
    let incident =
      this.incidents[this.incidents.length - 1];

    if (!incident || incident.tick !== tick) {
      incident = {
        tick,
        cycle: this.cycleNumber,
        xpGain: 0,
        bowGain: 0,
        willowGain: 0,
        spot: `${this.spotIndex}@${this.spotTileKey}`,
        t3Tick: this.lastT3Tick,
        t3Target:
          `${this.lastT3TargetIndex}@${this.lastT3TargetTile}`,
        lastMoveTick: this.lastSpotMovementTick,
        history: [...this.history]
      };

      this.incidents.push(incident);

      if (this.incidents.length > MAX_INCIDENTS) {
        this.incidents.shift();
      }
    }

    incident.xpGain += xpGain;
    incident.bowGain += bowGain;
    incident.willowGain += willowGain;

    this.log(
      `CRAFT INCIDENT #${this.incidents.length}` +
      ` tick=${incident.tick}` +
      ` cycle=${incident.cycle}` +
      ` xp=${incident.xpGain}` +
      ` bowGain=${incident.bowGain}` +
      ` willowGain=${incident.willowGain}` +
      ` spot=${incident.spot}` +
      ` t3Tick=${incident.t3Tick}` +
      ` t3Target=${incident.t3Target}` +
      ` lastMoveTick=${incident.lastMoveTick}`
    );

    for (const entry of incident.history) {
      this.log(
        `CRAFT HISTORY` +
        ` tick=${entry.tick}` +
        ` cycle=${entry.cycle}` +
        ` event=${entry.event}` +
        ` ${entry.detail}`
      );
    }

    this.log(
      `CRAFT SPOTS tick=${tick}` +
      ` spots=${this.spotSnapshot()}`
    );

    this.lastIncidentSummaryTick = tick;
  }

  private printIncidentSummary(
    reason: string
  ): void {
    if (this.incidents.length === 0) {
      this.log(
        `CRAFT SUMMARY ${reason}` +
        ` incidents=0` +
        ` totalXp=${this.fletchingXpGained}` +
        ` willowShortbows=${this.willowShortbowsDetected}`
      );
      return;
    }

    this.log(
      `CRAFT SUMMARY ${reason}` +
      ` incidents=${this.incidents.length}` +
      ` totalXp=${this.fletchingXpGained}` +
      ` willowShortbows=${this.willowShortbowsDetected}`
    );

    for (let i = 0; i < this.incidents.length; i++) {
      const incident = this.incidents[i];

      this.log(
        `CRAFT SUMMARY ITEM ${i + 1}` +
        ` tick=${incident.tick}` +
        ` cycle=${incident.cycle}` +
        ` xp=${incident.xpGain}` +
        ` bows=${incident.bowGain}` +
        ` willow=${incident.willowGain}` +
        ` t3Tick=${incident.t3Tick}` +
        ` t3Target=${incident.t3Target}` +
        ` spot=${incident.spot}` +
        ` lastMove=${incident.lastMoveTick}`
      );
    }
  }

  private repeatIncidentSummary(tick: number): void {
    if (this.incidents.length === 0) {
      return;
    }

    if (
      this.lastIncidentSummaryTick >= 0 &&
      tick - this.lastIncidentSummaryTick <
        INCIDENT_REPEAT_TICKS
    ) {
      return;
    }

    this.lastIncidentSummaryTick = tick;
    this.printIncidentSummary('PERIODIC');
  }

  // ============================================================
  // CRAFTING DETECTION
  // ============================================================

  private bowInventorySnapshot(): Map<string, number> {
    const result = new Map<string, number>();
    const names = new Set<string>();

    for (const item of Inventory.items()) {
      const name = (item.name ?? '').trim();

      if (/bow/i.test(name)) {
        names.add(name);
      }
    }

    names.add(CRAFTED_BOW);

    for (const name of names) {
      const count = Inventory.count(name);

      if (count > 0) {
        result.set(name, count);
      }
    }

    return result;
  }

  private bowInventoryNames(): string {
    return JSON.stringify(
      [
        ...new Set(
          Inventory.items()
            .map(item => (item.name ?? '').trim())
            .filter(name => /bow/i.test(name))
        )
      ].sort()
    );
  }

  private formatBowSnapshot(
    snapshot: Map<string, number>
  ): string {
    return JSON.stringify(
      [...snapshot.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count }))
    );
  }

  private diagnosticContext(tick: number): string {
    return (
      ` phase=${this.phase}` +
      ` relocating=${this.relocating}` +
      ` makePending=${this.makePending}` +
      ` lurePending=${this.lurePending}` +
      ` animating=${Game.animating()}` +
      ` lastMakeTick=${this.lastIssuedMakeTick}` +
      ` lastLureTick=${this.lastIssuedLureTick}` +
      ` lastSpotMoveTick=${this.lastSpotMovementTick}` +
      ` sinceMake=${
        this.lastIssuedMakeTick >= 0
          ? tick - this.lastIssuedMakeTick
          : -1
      }` +
      ` sinceLure=${
        this.lastIssuedLureTick >= 0
          ? tick - this.lastIssuedLureTick
          : -1
      }` +
      ` sinceSpotMove=${
        this.lastSpotMovementTick >= 0
          ? tick - this.lastSpotMovementTick
          : -1
      }` +
      ` spot=${this.spotTileKey}` +
      ` lastT3Target=${this.lastT3TargetIndex}@${this.lastT3TargetTile}`
    );
  }

  private observeCrafting(source: string): void {
    if (!Game.ingame()) {
      return;
    }

    const tick = Game.tick();

    try {
      const xp = Skills.xp('Fletching');
      const xpGain = Math.max(
        0,
        xp - this.fletchingLastXp
      );

      const current = this.bowInventorySnapshot();
      const currentNames = this.bowInventoryNames();

      const gains: string[] = [];
      const losses: string[] = [];

      let totalBowGain = 0;

      for (const [name, count] of current) {
        const previous =
          this.lastBowInventory.get(name) ?? 0;

        if (count > previous) {
          const gain = count - previous;

          gains.push(`${name}:+${gain}`);
          totalBowGain += gain;
          this.bowItemsDetected += gain;
        }
      }

      for (const [name, previous] of this.lastBowInventory) {
        const count = current.get(name) ?? 0;

        if (count < previous) {
          losses.push(`${name}:-${previous - count}`);
        }
      }

      const willowCount =
        Inventory.count(CRAFTED_BOW);

      const willowGain = Math.max(
        0,
        willowCount -
          this.lastWillowShortbowCount
      );

      if (willowGain > 0) {
        this.willowShortbowsDetected += willowGain;

        this.log(
          `WILLOW SHORTBOW CREATED +${willowGain}` +
          ` tick=${tick}` +
          ` source=${source}` +
          ` held=${willowCount}` +
          this.diagnosticContext(tick)
        );
      }

      if (currentNames !== this.lastBowNames) {
        this.log(
          `BOW NAMES CHANGED tick=${tick}` +
          ` source=${source}` +
          ` names=${currentNames}` +
          this.diagnosticContext(tick)
        );
      }

      if (xpGain > 0) {
        this.fletchingXpGained += xpGain;
        this.fletchingXpEvents++;

        this.log(
          `FLETCHING XP +${xpGain}` +
          ` tick=${tick}` +
          ` source=${source}` +
          ` previousXp=${this.fletchingLastXp}` +
          ` currentXp=${xp}` +
          this.diagnosticContext(tick)
        );
      }

      if (gains.length > 0) {
        this.bowInventoryGainEvents++;

        this.log(
          `BOW INVENTORY GAIN tick=${tick}` +
          ` source=${source}` +
          ` gains=${JSON.stringify(gains)}` +
          ` inventory=${this.formatBowSnapshot(current)}` +
          this.diagnosticContext(tick)
        );
      }

      if (losses.length > 0) {
        this.log(
          `BOW INVENTORY LOSS tick=${tick}` +
          ` source=${source}` +
          ` losses=${JSON.stringify(losses)}` +
          this.diagnosticContext(tick)
        );
      }

      if (
        xpGain > 0 ||
        totalBowGain > 0 ||
        willowGain > 0
      ) {
        this.recordCraftIncident(
          tick,
          xpGain,
          totalBowGain,
          willowGain
        );
      }

      this.fletchingLastXp = xp;
      this.lastBowInventory = current;
      this.lastBowNames = currentNames;
      this.lastWillowShortbowCount = willowCount;
    } catch (error) {
      this.log(
        `CRAFT DIAGNOSTIC ERROR tick=${tick}` +
        ` source=${source}` +
        ` error=${String(error)}`
      );
    }
  }

  // ============================================================
  // FISHING SPOT TRACKING
  // ============================================================

  private spotSnapshot(): string {
    return JSON.stringify(
      this.liveSpots()
        .map(spot => ({
          index: spot.index,
          tile: tileKey(spot.tile())
        }))
        .sort(
          (a, b) =>
            a.index - b.index ||
            a.tile.localeCompare(b.tile)
        )
    );
  }

  private observeSpots(source: string): void {
    if (!Game.ingame()) {
      return;
    }

    if (
      !this.rideActive &&
      !this.relocating
    ) {
      return;
    }

    const tick = Game.tick();
    const snapshot = this.spotSnapshot();

    if (snapshot !== this.lastSpotSnapshot) {
      this.remember(
        'SPOT CHANGE',
        `from=${this.lastSpotSnapshot || 'none'}` +
        ` to=${snapshot}` +
        ` tracked=${this.spotIndex}@${this.spotTileKey}`,
        tick
      );

      this.log(
        `SPOT LIST CHANGED tick=${tick}` +
        ` source=${source}` +
        ` previous=${this.lastSpotSnapshot || 'none'}` +
        ` current=${snapshot}` +
        ` tracked=${this.spotIndex}@${this.spotTileKey}`
      );

      this.lastSpotSnapshot = snapshot;
    }
  }

  private updateFishingEvidence(): void {
    const xp = Skills.xp('Fishing');

    if (xp > this.fishingLastXp) {
      const gain = xp - this.fishingLastXp;

      this.fishingXpGained += gain;

      this.log(
        `FISHING XP +${gain} tick=${Game.tick()}`
      );
    }

    this.fishingLastXp = xp;

    const count = this.fishCount();

    if (count > this.lastFishCount) {
      const gain = count - this.lastFishCount;

      this.fishSeen += gain;

      this.log(
        `FISH GAIN +${gain}` +
        ` tick=${Game.tick()}` +
        ` held=${count}`
      );
    }

    this.lastFishCount = count;
  }

  private atFishingArea(
    tile: TileCoordinates
  ): boolean {
    return distance(tile, FISH_RETURN) <= 12;
  }

  private liveSpots(): Npc[] {
    return Npcs.query()
      .action(LURE)
      .where(npc => {
        const tile = npc.tile();

        return (
          !!tile &&
          tile.level === 0 &&
          FISH_TILES.some(
            known => distance(tile, known) <= 2
          )
        );
      })
      .results();
  }

  private nearestSpot(): Npc | null {
    const playerTile = Game.tile();
    const spots = this.liveSpots();

    if (!playerTile) {
      return null;
    }

    spots.sort(
      (a, b) =>
        distance(playerTile, a.tile()) -
        distance(playerTile, b.tile())
    );

    return spots[0] ?? null;
  }

  private activeSpot(): Npc | null {
    return this.nearestSpot();
  }

  private setSpot(spot: Npc): void {
    this.spotIndex = spot.index;
    this.spotTileKey = tileKey(spot.tile());
  }

  private originalSpotStillPresent(): boolean {
    if (
      this.spotIndex < 0 ||
      !this.spotTileKey
    ) {
      return true;
    }

    return this.liveSpots().some(
      spot =>
        spot.index === this.spotIndex &&
        tileKey(spot.tile()) === this.spotTileKey
    );
  }

  private checkImmediateSpotMovement(
    tick: number
  ): boolean {
    if (
      !this.rideActive ||
      this.relocating ||
      this.spotIndex < 0 ||
      !this.spotTileKey
    ) {
      return false;
    }

    if (this.originalSpotStillPresent()) {
      return false;
    }

    const oldIndex = this.spotIndex;
    const oldTile = this.spotTileKey;
    const replacement = this.nearestSpot();

    this.lastSpotMovementTick = tick;

    this.remember(
      'MOVEMENT DETECTED',
      `old=${oldIndex}@${oldTile}` +
      ` replacement=${
        replacement
          ? `${replacement.index}@${tileKey(replacement.tile())}`
          : 'none'
      }` +
      ` phase=${this.phase}` +
      ` makePending=${this.makePending}`,
      tick
    );

    this.log(
      `SPOT MOVED IMMEDIATE tick=${tick}` +
      ` old=${oldTile}` +
      ` phase=${this.phase}` +
      ` makePending=${this.makePending}` +
      ` makeTick=${this.makeTick}` +
      ` replacement=${
        replacement
          ? tileKey(replacement.tile())
          : 'none'
      }`
    );

    this.beginRelocation(
      'immediate-spot-movement',
      replacement
    );

    this.driveRelocation(tick);

    return true;
  }

  private checkBeforeT3(tick: number): boolean {
    // Sample network information at the most
    // important point in the four-tick sequence.
    this.observeExperimental('pre-T3');

    const originalIndex = this.spotIndex;
    const originalTile = this.spotTileKey;

    const spots = this.liveSpots();

    const originalPresent = spots.some(
      spot =>
        spot.index === originalIndex &&
        tileKey(spot.tile()) === originalTile
    );

    if (originalPresent) {
      return false;
    }

    const playerTile = Game.tile();

    if (playerTile) {
      spots.sort(
        (a, b) =>
          distance(playerTile, a.tile()) -
          distance(playerTile, b.tile())
      );
    }

    const replacement = spots[0] ?? null;

    this.remember(
      'PRE-T3 MOVEMENT',
      `original=${originalIndex}@${originalTile}` +
      ` replacement=${
        replacement
          ? `${replacement.index}@${tileKey(replacement.tile())}`
          : 'none'
      }` +
      ` spots=${this.spotSnapshot()}`,
      tick
    );

    this.log(
      `PRE-T3 SPOT MOVED tick=${tick}` +
      ` original=${originalIndex}@${originalTile}` +
      ` replacement=${
        replacement
          ? `${replacement.index}@${tileKey(replacement.tile())}`
          : 'none'
      }` +
      ` makePending=${this.makePending}`
    );

    this.lastSpotMovementTick = tick;

    this.beginRelocation(
      'pre-T3-spot-movement',
      replacement
    );

    this.driveRelocation(tick);

    return true;
  }

  private async trackAction(
    label: string,
    action: () => boolean | Promise<boolean>
  ): Promise<boolean> {
    this.log(
      `${label} ISSUE tick=${Game.tick()}` +
      ` animating=${Game.animating()}`
    );

    try {
      const success = await action();

      this.log(
        `${label} RESOLVE tick=${Game.tick()}` +
        ` success=${success}`
      );

      return !!success;
    } catch (error) {
      this.log(
        `${label} ERROR tick=${Game.tick()}` +
        ` ${String(error)}`
      );

      return false;
    }
  }

  private stopRide(): void {
    this.generation++;

    this.rideActive = false;
    this.phase = 'idle';

    this.spotIndex = -1;
    this.spotTileKey = '';

    this.menuRequested = false;
    this.menuRequestTick = -1;
    this.menuPollCount = 0;
    this.lastMenuWaitLogTick = -1;
    this.forceFreshKnife = false;

    this.knifeTick = -1;
    this.makeTick = -1;
    this.nextKnifeAllowedTick = -1;

    this.lastKnifeAttemptTick = -1;
    this.lastMakeAttemptTick = -1;
    this.lastLureAttemptTick = -1;
    this.lastDropAttemptTick = -1;
    this.lastBoundaryDropTick = -1;

    this.knifePending = false;
    this.makePending = false;
    this.lurePending = false;
    this.dropPending = false;
    this.boundaryDropPending = false;

    this.relocating = false;
    this.relocationBaseline = 0;
    this.relocationLureTick = -1;
    this.relocationTargetKey = '';
    this.lastRelocationLureAttemptTick = -1;


  }

  private startRide(spot: Npc): void {
    this.stopRide();

    this.setSpot(spot);
    this.rideActive = true;

    this.log(
      `RIDE START tick=${Game.tick()}`
    );

    this.remember(
      'RIDE START',
      `spot=${this.spotIndex}@${this.spotTileKey}` +
      ` spots=${this.spotSnapshot()}`
    );

    this.prepareNextMenu(Game.tick());
  }

  private beginRelocation(
    reason: string,
    spot: Npc | null,
    lureAlreadyIssued = false
  ): void {
    if (this.relocating) {
      return;
    }

    this.lastSpotMovementTick = Game.tick();

    this.remember(
      'RELOCATION START',
      `reason=${reason}` +
      ` target=${
        spot
          ? `${spot.index}@${tileKey(spot.tile())}`
          : 'none'
      }`
    );

    this.relocating = true;
    this.rideActive = false;
    this.phase = 'relocating';

    this.makeTick = -1;
    this.menuRequested = false;

    this.relocationBaseline = this.fishCount();

    this.relocationLureTick = lureAlreadyIssued
      ? Game.tick()
      : -1;

    this.relocationTargetKey =
      lureAlreadyIssued && spot
        ? tileKey(spot.tile())
        : '';

    if (lureAlreadyIssued) {
      this.lastRelocationLureAttemptTick =
        Game.tick();
    }

    this.log(
      `SPOT MOVED PAUSE tick=${Game.tick()}` +
      ` reason=${reason}` +
      ` baseline=${this.relocationBaseline}` +
      ` lastMakeTick=${this.lastIssuedMakeTick}` +
      ` lastLureTick=${this.lastIssuedLureTick}`
    );
  }

  private driveRelocation(tick: number): void {
    if (!this.relocating) {
      return;
    }

    if (this.lurePending) {
      return;
    }

    if (
      this.fishCount() >
      this.relocationBaseline
    ) {
      this.log(
        `SPOT MOVED FISH +1 tick=${tick}` +
        ` restarting=T1`
      );

      this.remember(
        'RELOCATION FISH',
        `tick=${tick}` +
        ` target=${this.relocationTargetKey}`,
        tick
      );

      this.relocating = false;
      this.rideActive = true;
      this.phase = 'cycling';

      this.makeTick = tick - 3;

      this.finishCycleBeforeKnife(tick);
      return;
    }

    const spot = this.nearestSpot();

    if (!spot) {
      return;
    }

    const key = tileKey(spot.tile());

    if (
      this.lastRelocationLureAttemptTick === tick
    ) {
      return;
    }

    if (
      key === this.relocationTargetKey &&
      tick - this.relocationLureTick < 12
    ) {
      return;
    }

    this.setSpot(spot);

    this.relocationTargetKey = key;
    this.relocationLureTick = tick;
    this.lastRelocationLureAttemptTick = tick;
    this.lastIssuedLureTick = tick;

    this.lurePending = true;

    const generation = this.generation;

    this.log(
      `SPOT MOVED LURE tick=${tick}` +
      ` target=${key}`
    );

    this.remember(
      'RELOCATION LURE',
      `target=${spot.index}@${key}` +
      ` spots=${this.spotSnapshot()}`,
      tick
    );

    void this.trackAction(
      'RELOCATE LURE',
      () => spot.interact(LURE)
    ).then(success => {
      if (generation !== this.generation) {
        return;
      }

      this.lurePending = false;

      if (success) {
        this.totalLures++;
      } else {
        this.log(
          `RELOCATE LURE FAILED tick=${Game.tick()}`
        );
      }
    });
  }

  private invalidateMenu(
    reason: string,
    tick: number
  ): void {
    this.menuRequested = false;
    this.menuRequestTick = -1;
    this.menuPollCount = 0;
    this.lastMenuWaitLogTick = -1;

    this.knifeTick = -1;
    this.makeTick = -1;

    this.forceFreshKnife = true;
    this.nextKnifeAllowedTick = tick + 1;
    this.phase = 'idle';

    this.log(
      `MENU INVALIDATED reason=${reason}` +
      ` tick=${tick}`
    );
  }

  private prepareNextMenu(tick: number): void {
    if (!this.rideActive || this.relocating || this.actionBusy ||
        this.dropPending || this.boundaryDropPending ||
        this.lastKnifeAttemptTick === tick ||
        tick < this.nextKnifeAllowedTick) return;
    const spot = this.activeSpot();
    const logs = Inventory.first(LOGS);
    const knife = Inventory.first(KNIFE);
    if (!spot || !logs || !knife) return;
    if (!this.originalSpotStillPresent()) {
      this.beginRelocation('spot-moved-before-batch', this.nearestSpot());
      return;
    }
    this.lastKnifeAttemptTick = tick;
    this.knifeTick = tick;
    this.makeTick = tick;
    this.cycleNumber++;
    this.phase = 'cycling';
    const used = logs.useOn(knife);
    const made = actions.ifButton(8889);
    const closed = actions.closeModal();
    const lured = spot.interact(LURE);
    this.log(`3T SYNC tick=${tick} use=${used} make=${made} close=${closed} lure=${lured} anim=${this.selfAnimation()}`);
    this.remember('3T SYNC', `use=${used} make=${made} close=${closed} lure=${lured}`, tick);
  }

  private driveMenu(tick: number): void {
    if (!this.menuRequested) {
      this.prepareNextMenu(tick);
      return;
    }

    if (tick <= this.menuRequestTick) {
      return;
    }

    this.menuPollCount++;

    if (ChatDialog.isMakeMenu()) {
      this.issueMake(tick);
      return;
    }

    if (this.lastMenuWaitLogTick !== tick) {
      this.lastMenuWaitLogTick = tick;

      this.log(
        `MENU POLLING tick=${tick}` +
        ` waited=${
          tick - this.menuRequestTick
        }`
      );
    }

    if (
      !this.knifePending &&
      tick - this.menuRequestTick >= 4
    ) {
      this.menuTimeouts++;

      this.invalidateMenu(
        'menu-timeout',
        tick
      );
    }
  }

  private issueMake(tick: number): void {
    if (this.lastMakeAttemptTick === tick) {
      return;
    }

    if (!this.originalSpotStillPresent()) {
      this.log(
        `T2 MAKE SKIPPED spot-moved` +
        ` tick=${tick}` +
        ` old=${this.spotTileKey}`
      );

      this.beginRelocation(
        'spot-moved-before-T2',
        this.nearestSpot()
      );

      this.driveRelocation(tick);
      return;
    }

    const shortbow =
      ChatDialog.makeProducts().find(
        product =>
          product
            .toLowerCase()
            .includes('arrow shaft')
      );

    if (!shortbow) {
      this.log(
        `ARROW SHAFT MISSING tick=${tick}` +
        ` products=${
          ChatDialog.makeProducts().join(', ')
        }`
      );

      this.invalidateMenu(
        'arrow-shaft-missing',
        tick
      );

      return;
    }

    const generation = this.generation;

    this.lastMakeAttemptTick = tick;
    this.lastIssuedMakeTick = tick;
    this.log(`LAB T2 BEFORE MAKE tick=${tick} animationId=${this.selfAnimation()} logs=${Inventory.count(LOGS)}`);

    this.menuRequested = false;
    this.makeTick = tick;
    this.phase = 'cycling';

    this.makePending = true;
    this.totalMakes++;

    this.remember(
      'T2 MAKE',
      `spot=${this.spotIndex}@${this.spotTileKey}` +
      ` spots=${this.spotSnapshot()}` +
      ` animating=${Game.animating()}`,
      tick
    );

    this.log(
      `T2 MAKE ARROW SHAFTS (MAKE 1) tick=${tick}` +
      ` knifeGap=${tick - this.knifeTick}`
    );

    void this.trackAction(
      'T2 MAKE',
      () => ChatDialog.makeOne(shortbow)
    ).then(success => {
      if (generation !== this.generation) {
        return;
      }

      this.makePending = false;

      if (!success) {
        this.log(
          `MAKE FAILED tick=${Game.tick()}`
        );
      }
    });
  }

  private tickThreeLure(tick: number): void {
    if (this.lastLureAttemptTick === tick) {
      return;
    }

    this.lastLureAttemptTick = tick;

    if (this.checkBeforeT3(tick)) {
      return;
    }

    const spot = this.activeSpot();

    if (!spot) {
      this.log(
        `T3 SPOT MISSING tick=${tick}`
      );

      this.remember(
        'T3 SPOT MISSING',
        `tracked=${this.spotIndex}@${this.spotTileKey}`,
        tick
      );

      this.beginRelocation(
        'spot-missing',
        null
      );

      return;
    }

    const previousSpot = this.spotTileKey;
    const previousIndex = this.spotIndex;

    this.lastT3TargetIndex = spot.index;
    this.lastT3TargetTile = tileKey(spot.tile());
    this.lastT3Tick = tick;

    const originalPresent =
      this.originalSpotStillPresent();

    const selectedValid = spot.valid();

    const beforeAnim = this.selfAnimation();

    this.remember(
      'T3 BEFORE LURE',
      `original=${previousIndex}@${previousSpot}` +
      ` selected=${spot.index}@${tileKey(spot.tile())}` +
      ` animationId=${beforeAnim ?? 'unavailable'}` +
      ` originalPresent=${originalPresent}` +
      ` selectedValid=${selectedValid}` +
      ` spots=${this.spotSnapshot()}` +
      ` makePending=${this.makePending}` +
      ` animating=${Game.animating()}`,
      tick
    );

    this.log(
      `T3 TARGET tick=${tick}` +
      ` original=${previousIndex}@${previousSpot}` +
      ` selected=${this.lastT3TargetIndex}@${this.lastT3TargetTile}` +
      ` animationId=${beforeAnim ?? 'unavailable'}` +
      ` originalPresent=${originalPresent}` +
      ` selectedValid=${selectedValid}`
    );

    this.setSpot(spot);

    if (
      previousSpot !== this.spotTileKey
    ) {
      this.log(
        `T3 SPOT SWITCH tick=${tick}` +
        ` from=${previousSpot}` +
        ` to=${this.spotTileKey}` +
        ` distance=${distance(
          Game.tile() ?? spot.tile(),
          spot.tile()
        )}`
      );
    }

    const generation = this.generation;

    this.lurePending = true;
    this.lastIssuedLureTick = tick;
    this.log(`LAB T3 BEFORE LURE tick=${tick} animationId=${this.selfAnimation()} makePending=${this.makePending}`);

    this.log(
      `T3 LURE tick=${tick}` +
      ` makeGap=${tick - this.makeTick}` +
      ` makePending=${this.makePending}`
    );

    void this.trackAction(
      'T3 LURE',
      () => spot.interact(LURE)
    ).then(success => {
      if (generation !== this.generation) {
        return;
      }

      this.lurePending = false;

      const afterAnim = this.selfAnimation();

      this.remember(
        'T3 AFTER LURE',
        `target=${spot.index}@${tileKey(spot.tile())}` +
        ` animationId=${
          afterAnim ?? 'unavailable'
        }` +
        ` success=${success}` +
        ` targetValid=${spot.valid()}` +
        ` spots=${this.spotSnapshot()}` +
        ` animating=${Game.animating()}`,
        Game.tick()
      );

      this.log(
        `T3 LURE RESULT tick=${Game.tick()}` +
        ` success=${success}` +
        ` target=${spot.index}@${tileKey(spot.tile())}` +
        ` animationId=${
          afterAnim ?? 'unavailable'
        }` +
        ` targetStillValid=${spot.valid()}`
      );

      if (success) {
        this.totalLures++;
      } else {
        this.log(
          `LURE FAILED tick=${Game.tick()}`
        );
      }

      if (
        this.rideActive &&
        !this.relocating
      ) {
        this.observeExperimental('post-T3');

        this.checkImmediateSpotMovement(
          Game.tick()
        );
      }
    });

    if (
      previousSpot &&
      previousSpot !== this.spotTileKey
    ) {
      this.beginRelocation(
        'T3-spot-switch',
        spot,
        true
      );
    }
  }

  private tickFourDrop(tick: number): void {
    if (this.lastDropAttemptTick === tick) {
      return;
    }

    this.lastDropAttemptTick = tick;

    const fish = this.firstFish();

    if (!fish) {
      this.emptyDropWindows++;

      this.log(
        `T4 EMPTY tick=${tick}` +
        ` boundaryRecheck=true`
      );

      return;
    }

    const generation = this.generation;

    this.dropPending = true;

    this.log(
      `T4 DROP tick=${tick}` +
      ` item=${fish.name ?? 'fish'}`
    );

    void this.trackAction(
      'T4 DROP',
      () => fish.interact('Drop')
    ).then(success => {
      if (generation !== this.generation) {
        return;
      }

      this.dropPending = false;

      if (success) {
        this.totalDrops++;
      }
    });
  }

  private finishCycleBeforeKnife(
    tick: number
  ): void {
    if (
      this.dropPending ||
      this.boundaryDropPending
    ) {
      return;
    }

    if (this.lastBoundaryDropTick === tick) {
      return;
    }

    this.lastBoundaryDropTick = tick;

    const generation = this.generation;

    this.boundaryDropPending = true;
    this.phase = 'boundary-drop';

    void (async () => {
      try {
        let fish = this.firstFish();

        if (!fish) {
          this.log(
            `BOUNDARY GRACE tick=${tick}` +
            ` maxMs=${BOUNDARY_GRACE_MS}`
          );

          await Execution.delayUntil(
            () =>
              this.fishCount() > 0 ||
              Game.tick() !== tick,
            BOUNDARY_GRACE_MS
          );

          if (generation !== this.generation) {
            return;
          }

          fish = this.firstFish();
        }

        if (fish) {
          this.log(
            `BOUNDARY DROP BEFORE KNIFE` +
            ` tick=${Game.tick()}` +
            ` item=${fish.name ?? 'fish'}`
          );

          const success =
            await this.trackAction(
              'BOUNDARY DROP',
              () => fish!.interact('Drop')
            );

          if (generation !== this.generation) {
            return;
          }

          if (success) {
            this.totalDrops++;
            this.boundaryDrops++;
          } else {
            this.log(
              `BOUNDARY DROP FAILED tick=${Game.tick()}`
            );
          }
        } else {
          this.log(
            `BOUNDARY EMPTY tick=${Game.tick()}` +
            ` knifeAllowed=true`
          );
        }
      } catch (error) {
        this.log(
          `BOUNDARY ERROR tick=${Game.tick()}` +
          ` ${String(error)}`
        );
      } finally {
        if (generation === this.generation) {
          this.boundaryDropPending = false;

          if (Game.tick() !== tick) {
            this.log(
              `BOUNDARY TICK SHIFT` +
              ` expected=${tick}` +
              ` actual=${Game.tick()}`
            );
          }

          this.completeCycle(Game.tick());
        }
      }
    })();
  }

  private completeCycle(tick: number): void {
    if (
      !this.rideActive ||
      this.dropPending ||
      this.boundaryDropPending
    ) {
      return;
    }

    this.log(
      `CYCLE ${this.cycleNumber} END` +
      ` tick=${tick}` +
      ` duration=${tick - this.knifeTick}`
    );

    this.makeTick = -1;
    this.phase = 'idle';

    this.prepareNextMenu(tick);
  }

  private driveTick(tick: number): void {
    if (!this.rideActive) return;
    const offset = this.knifeTick >= 0 ? tick - this.knifeTick : 3;
    if (offset >= 3) {
      // Keep the four-action manipulation tick exclusive.
      this.prepareNextMenu(tick);
      return;
    }
    // Drop at most one fish on each spare tick (+1, +2), never
    // on the manipulation tick. No async waits or ride interruption.
    if (offset > 0 && this.lastDropAttemptTick !== tick) {
      this.lastDropAttemptTick = tick;
      const fish = this.firstFish();
      if (fish) {
        const dropped = fish.interact('Drop');
        this.log(`3T LIVE DROP tick=${tick} offset=${offset} item=${fish.name} accepted=${dropped}`);
        if (dropped) this.totalDrops++;
      }
    }
  }

  private async initiateFishing(): Promise<void> {
    if (this.actionBusy) {
      return;
    }

    const spot = this.nearestSpot();

    if (!spot) {
      await Execution.delayTicks(1);
      return;
    }

    this.actionBusy = true;

    try {
      this.lastIssuedLureTick = Game.tick();

      const success =
        await this.trackAction(
          'INITIAL LURE',
          () => spot.interact(LURE)
        );

      if (!success) {
        return;
      }

      await Execution.delayUntil(
        () =>
          Game.animating() ||
          !spot.valid(),
        1800
      );

      this.startRide(spot);
    } finally {
      this.actionBusy = false;
    }
  }

  private async dropCatch(): Promise<void> {
    if (this.actionBusy) {
      return;
    }

    this.stopRide();
    this.actionBusy = true;

    try {
      for (const item of Inventory.items()) {
        if (
          !DROP_NAMES.has(
            (item.name ?? '').toLowerCase()
          )
        ) {
          continue;
        }

        await this.trackAction(
          'CLEANUP DROP',
          () => item.interact('Drop')
        );
      }
    } finally {
      this.actionBusy = false;
    }
  }

  private async walkToFishing(): Promise<void> {
    if (this.actionBusy) {
      return;
    }

    this.stopRide();
    this.actionBusy = true;

    try {
      await Traversal.walkResilient(
        FISH_RETURN,
        {
          ...Traversal.pureWalk,
          radius: 4,
          attempts: 6,
          timeoutMs: 180000,
          log: message => this.log(message)
        }
      );
    } finally {
      this.actionBusy = false;
    }
  }

  private async restock(): Promise<void> {
    if (this.actionBusy) {
      return;
    }

    this.stopRide();
    this.actionBusy = true;
    this.bankTrips++;
    this.bankStartMs = Date.now();

    try {
      this.log(
        `RESTOCK START missing=${
          this.missingSupplies().join(', ')
        }`
      );

      const opened = await Banking.open({
        stand: EDGE_BANK,
        log: message => this.log(message)
      });

      if (!opened) {
        this.log('BANK OPEN FAILED');
        return;
      }

      const ready = await Bank.waitReady(
        10000,
        message => this.log(message)
      );

      if (!ready) {
        this.log('BANK NOT READY');
        return;
      }

      await Bank.depositAllMatching(
        name => !KEEP.has(name.toLowerCase()),
        message => this.log(message)
      );

      if (!Inventory.contains(ROD)) {
        await Bank.withdrawX(ROD, 1);
      }

      if (!Inventory.contains(KNIFE)) {
        await Bank.withdrawX(KNIFE, 1);
      }

      if (Inventory.count(FEATHER) <= 0) {
        await Bank.withdrawX(
          FEATHER,
          this.settings.num(
            'featherWithdrawAmount',
            10000
          )
        );
      }

      if (Inventory.count(LOGS) <= 0) {
        await Bank.withdrawX(
          LOGS,
          this.settings.num(
            'carrierWithdrawAmount',
            2
          )
        );
      }

      await BankRuntime.close();

      this.log(
        `RESTOCK COMPLETE missing=${
          this.missingSupplies().join(', ')
        }`
      );
    } catch (error) {
      this.log(
        `RESTOCK ERROR ${String(error)}`
      );
    } finally {
      this.bankMs += Math.max(0, Date.now()-this.bankStartMs);
      this.lastLogCount = Inventory.count(LOGS);
      this.actionBusy = false;
    }

    if (this.hasSupplies()) {
      await this.walkToFishing();
    }
  }

  override async loop(): Promise<void> {
    if (!Game.ingame()) {
      return;
    }

    const tile = Game.tile();

    if (!tile) {
      return;
    }

    this.observeExperimental('loop');
    this.observeCrafting('loop');
    this.observeSpots('loop');
    this.updateFishingEvidence();

    if (
      !this.actionBusy &&
      this.rideActive &&
      !this.relocating &&
      this.atFishingArea(tile)
    ) {
      if (
        this.checkImmediateSpotMovement(
          Game.tick()
        )
      ) {
        return;
      }
    }

    if (
      this.actionBusy ||
      this.dropPending ||
      this.boundaryDropPending
    ) {
      return;
    }

    if (!this.hasSupplies()) {
      await this.restock();
      return;
    }

    if (Inventory.isFull()) {
      await this.dropCatch();
      return;
    }

    if (!this.atFishingArea(tile)) {
      await this.walkToFishing();
      return;
    }

    if (this.relocating) {
      this.driveRelocation(Game.tick());
      return;
    }

    if (this.rideActive) {
      this.driveTick(Game.tick());
      return;
    }

    await this.initiateFishing();
  }
}

export const FLYFISHER_LAB_SETTINGS: SettingsSchema = {
  featherWithdrawAmount: { type: 'number', label: 'Feathers to withdraw', default: 10000 },
  carrierWithdrawAmount: { type: 'number', label: 'Normal logs to withdraw', default: 2 }
};

export default FlyFisherLab;
