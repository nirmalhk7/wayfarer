"use client";

import { useEffect, useRef, useState } from "react";

import {
  COMMODITIES,
  DELIVERY,
  UPGRADE_COSTS,
  acceptDelivery,
  buyUpgrade,
  canConfirmDock,
  canDock,
  completeDelivery,
  createGame,
  deliveryRoute,
  distanceMeters,
  dock,
  getRumors,
  marketQuote,
  resolveEncounter,
  trade,
} from "./engine.mjs";
import {
  cargoTotals,
  formatDistance,
  formatRumor,
  portStatusCopy,
} from "./view-model.mjs";

type Position = { latitude: number; longitude: number; accuracy?: number };
interface Commodity { id: string; name: string; basePrice: number }
interface Market { commodityId: string; stock: number; price: number }
interface Port { id: string; name: string; position: Position; flavor?: string; market: Market[] }
interface Encounter {
  type: "pirates" | "distress" | "debris";
  severity: number;
  portId: string;
  title?: string;
  description?: string;
  message?: string;
}
interface TradeReceipt {
  portId: string;
  commodityId: string;
  side: "buy" | "sell";
  quantity: number;
  unitPrice: number;
  total: number;
  costBasis: number | null;
  profit: number | null;
}
interface Player { credits: number; cargoCapacity: number; cargo: Record<string, number>; hull: number }
interface GameState {
  origin: Position;
  seed: string;
  originPortId: string;
  ports: Port[];
  discoveredPortIds: string[];
  revealedMarkets: Record<string, boolean>;
  dockedPortId: string;
  encounter: Encounter | null;
  destinationPortId?: string | null;
  lastTrade?: TradeReceipt;
  delivery?: { status: "active" | "delivered"; loaded: number };
  player: Player;
}
interface Rumor { commodityId: string; commodityName: string; price: "cheap" | "fair" | "expensive" }
interface Upgrade { id: "cargo" | "hull"; name: string; detail: string }
interface DisplayRumor { id: string; headline: string; detail: string; tone: string }
type Outcome = GameState;
interface SavedGameEnvelope {
  version: 1;
  originPolicy: "persisted-origin";
  game: GameState;
}

const STORAGE_KEY = "wayfarer-save-v1";
const TRAINING_STORAGE_KEY = "wayfarer-training-v1";
const SAVE_VERSION = 1;
const DEMO_ORIGIN: Position = { latitude: 0, longitude: 0 };
const TRAINING_SEED = "wayfarer-training-v1";
const MAX_FIX_AGE_MS = 5_000;
const MARKET_ACCESS_MS = 60_000;
const LOCATION_IDLE = "Location is checked only on request."
const UPGRADES: Upgrade[] = [
  { id: "cargo", name: "Expand cargo bay", detail: "Add 4 cargo slots" },
  { id: "hull", name: "Install hull plating", detail: "Add 1 hull integrity" },
];

function isGameState(value: unknown): value is GameState {
  return typeof value === "object" && value !== null
    && Array.isArray((value as GameState).ports)
    && typeof (value as GameState).player === "object";
}

function createEngineGame(position: Position): GameState {
  return createGame(position) as GameState;
}

function readSavedGame(key: string): GameState | null {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (
      typeof parsed === "object"
      && parsed !== null
      && (parsed as SavedGameEnvelope).version === SAVE_VERSION
      && (parsed as SavedGameEnvelope).originPolicy === "persisted-origin"
      && isGameState((parsed as SavedGameEnvelope).game)
    ) {
      return (parsed as SavedGameEnvelope).game;
    }
  } catch {
    // Corrupt and legacy saves fall back to a location-centered fresh game.
  }
  return null;
}

function writeSavedGame(key: string, game: GameState) {
  try {
    const save: SavedGameEnvelope = { version: SAVE_VERSION, originPolicy: "persisted-origin", game };
    window.localStorage.setItem(key, JSON.stringify(save));
    return true;
  } catch {
    // A full or unavailable browser store should not interrupt play.
    return false;
  }
}

function metersBetween(position: Position | null, port: Port) {
  if (!position) return Number.POSITIVE_INFINITY;
  try {
    const value = distanceMeters(position, port.position);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function positionFromFix({ coords }: GeolocationPosition): Position {
  return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
}

function isFreshFix({ timestamp }: GeolocationPosition) {
  const age = Date.now() - timestamp;
  return age >= 0 && age <= MAX_FIX_AGE_MS;
}

const SCOPE_PORTS = [
  { x: 22, y: 27, callsign: "WFR-00" },
  { x: 63, y: 22, callsign: "LMN-17" },
  { x: 82, y: 45, callsign: "CND-04" },
  { x: 19, y: 61, callsign: "VEL-09" },
  { x: 53, y: 74, callsign: "MRW-31" },
  { x: 29, y: 85, callsign: "ORC-22" },
  { x: 80, y: 80, callsign: "KPL-08" },
];

function MarketOrders({ game, portId, docked, busy, onOrder }: {
  game: GameState;
  portId: string;
  docked: boolean;
  busy: boolean;
  onOrder: (commodityId: string, side: "buy" | "sell", quantity: number) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  if (!docked) return <p className="wf-locked">Dock to see exact commodity prices and trade.</p>;

  return (
    <ul className="wf-market-table" aria-label="Commodity market">
      {(COMMODITIES as Commodity[]).map((commodity) => {
        const quote = marketQuote(game, portId, commodity.id);
        const value = quantities[commodity.id] ?? "1";
        const quantity = Number(value);
        const valid = Number.isSafeInteger(quantity) && quantity > 0;
        return (
          <li className="wf-market-row" key={commodity.id}>
            <strong>{commodity.name}</strong>
            <span>Buy {quote.ask} cr · Sell {quote.bid} cr per unit</span>
            <span>Stock {quote.stock} · In hold {game.player.cargo[commodity.id] ?? 0} · Can buy {quote.maxBuy}</span>
            <div className="wf-trade-controls">
              <label className="wf-quantity">
                Units
                <input
                  aria-label={`${commodity.name} units`}
                  type="number"
                  min="1"
                  step="1"
                  value={value}
                  onChange={(event) => {
                    const next = event.target.value;
                    setQuantities((current) => ({ ...current, [commodity.id]: next }));
                  }}
                  disabled={busy}
                />
              </label>
              <button aria-label={`Buy ${commodity.name}`} className="wf-icon-button" type="button"
                onClick={() => onOrder(commodity.id, "buy", quantity)}
                disabled={busy || !valid || quantity > quote.maxBuy}>
                Buy{valid && quantity <= quote.maxBuy ? ` · ${quote.ask * quantity} cr` : ""}
              </button>
              <button aria-label={`Sell ${commodity.name}`} className="wf-icon-button" type="button"
                onClick={() => onOrder(commodity.id, "sell", quantity)}
                disabled={busy || !valid || quantity > quote.maxSell}>
                Sell{valid && quantity <= quote.maxSell ? ` · ${quote.bid * quantity} cr` : ""}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function GameShell() {
  const [liveGame, setLiveGame] = useState<GameState>(() => createEngineGame(DEMO_ORIGIN));
  const [trainingGame, setTrainingGame] = useState<GameState>(() =>
    createGame({ ...DEMO_ORIGIN, seed: TRAINING_SEED }) as GameState,
  );
  const [liveFix, setLiveFix] = useState<GeolocationPosition | null>(null);
  const [trainingPosition, setTrainingPosition] = useState<Position>(DEMO_ORIGIN);
  const [selectedPortId, setSelectedPortId] = useState(liveGame.originPortId);
  const [training, setTraining] = useState(false);

  const [notice, setNotice] = useState("Welcome, captain. Select a port to plot a course.");
  const [checkingLocation, setCheckingLocation] = useState(false);
  const checkingLocationRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [originReady, setOriginReady] = useState(false);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const emptyTrainingSave = useRef<GameState | null>(null);
  const [marketRevision, setMarketRevision] = useState(0);
  const campaignName = training ? "Training" : "Live";

  const game = training ? trainingGame : liveGame;
  const setGame = training ? setTrainingGame : setLiveGame;
  const activeEncounter = game.encounter;
  const position = training ? trainingPosition : liveFix && positionFromFix(liveFix);
  const ports = game.ports;
  const commodities = COMMODITIES as Commodity[];
  const selectedPort = ports.find((port) => port.id === selectedPortId) ?? ports[0];
  const scopeTarget = SCOPE_PORTS[ports.indexOf(selectedPort)];
  const distance = selectedPort ? metersBetween(position, selectedPort) : Number.POSITIVE_INFINITY;
  const isInRange = (portId: string) => Boolean(position && (
    training ? canDock(game, portId, position) : canConfirmDock(game, portId, position)
  ));
  const dockable = isInRange(selectedPort.id);
  const docked = dockable && selectedPort.id === game.dockedPortId;
  const destination = ports.find((port) => port.id === game.destinationPortId);
  const routeArrived = Boolean(destination && destination.id === game.dockedPortId && isInRange(destination.id));
  const receipt = game.lastTrade;
  const receiptPort = ports.find((port) => port.id === receipt?.portId);
  const receiptCommodity = commodities.find((commodity) => commodity.id === receipt?.commodityId);
  const contractRoute = deliveryRoute(game) as { origin: Port; destination: Port } | null;
  const busy = !loaded || checkingLocation;
  const totals = cargoTotals(game.player?.cargo);
  const credits = game.player?.credits ?? 0;
  const capacity = game.player?.cargoCapacity ?? 0;
  const hull = game.player?.hull ?? 1;
  const hullMax = 5;

  useEffect(() => {
    const restoredGame = readSavedGame(STORAGE_KEY);
    const restoredTraining = readSavedGame(TRAINING_STORAGE_KEY);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (restoredTraining) setTrainingGame(restoredTraining);
      if (restoredGame) {
        setLiveGame(restoredGame);
        setSelectedPortId(restoredGame.dockedPortId || restoredGame.originPortId);
        setOriginReady(true);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded && originReady) writeSavedGame(STORAGE_KEY, liveGame);
  }, [liveGame, loaded, originReady]);

  useEffect(() => {
    if (loaded && training && trainingGame !== emptyTrainingSave.current) {
      writeSavedGame(TRAINING_STORAGE_KEY, trainingGame);
    }
  }, [loaded, training, trainingGame]);

  useEffect(() => {
    if (!liveFix) return;
    const timer = window.setTimeout(() => setLiveFix(null), MARKET_ACCESS_MS);
    return () => window.clearTimeout(timer);
  }, [liveFix]);

  const toggleTraining = (enabled: boolean) => {
    if (checkingLocationRef.current) return;
    const next = enabled ? trainingGame : liveGame;
    const port = next.ports.find(({ id }) => id === next.dockedPortId);
    if (enabled) setTrainingPosition(port?.position ?? next.origin);
    setSelectedPortId(port?.id ?? next.originPortId);
    setNotice(enabled ? "Training is active. Practice with a separate ship and balance." : "Live campaign selected.");
    setLiveFix(null);
    setTraining(enabled);
  };

  const runAction = (action: () => Outcome, message: string) => {
    try {
      setGame(action());
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Command rejected by station control.");
    }
  };

  const runContract = (action: (current: GameState) => Outcome, message: string) => {
    if (!docked || busy || checkingLocationRef.current || activeEncounter) return;
    try {
      const key = training ? TRAINING_STORAGE_KEY : STORAGE_KEY;
      const stored = readSavedGame(key);
      if (stored && JSON.stringify(stored.delivery) !== JSON.stringify(game.delivery)) {
        throw new Error("The saved contract has changed. Reload before continuing.");
      }
      const next = action(game);
      if (!writeSavedGame(key, next)) throw new Error("Contract could not be saved. Try again.");
      setGame(next);
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Contract could not be saved.");
    }
  };

  const resetCampaign = () => {
    if (busy || checkingLocationRef.current) return;
    try {
      window.localStorage.removeItem(training ? TRAINING_STORAGE_KEY : STORAGE_KEY);
    } catch {
      resetDialog.current?.close();
      setNotice(`Could not remove the ${campaignName} save from this browser. Try again.`);
      return;
    }
    if (training) {
      const fresh = createGame({ ...DEMO_ORIGIN, seed: TRAINING_SEED }) as GameState;
      emptyTrainingSave.current = fresh;
      setTrainingGame(fresh);
      setTrainingPosition(fresh.origin);
      setSelectedPortId(fresh.originPortId);
    } else {
      const fresh = createEngineGame(DEMO_ORIGIN);
      setLiveGame(fresh);
      setLiveFix(null);
      setOriginReady(false);
      setSelectedPortId(fresh.originPortId);
    }
    setMarketRevision((revision) => revision + 1);
    resetDialog.current?.close();
    setNotice(`${campaignName} game data reset.`);
  };

  const checkLiveLocation = (action: (fix: Position) => void) => {
    if (busy || checkingLocationRef.current) return;
    if (!navigator.geolocation) {
      setNotice("Location is unavailable. You can still play in Training.");
      return;
    }

    checkingLocationRef.current = true;
    setCheckingLocation(true);
    setNotice("Checking your location…");
    const finish = () => {
      checkingLocationRef.current = false;
      setCheckingLocation(false);
    };
    navigator.geolocation.getCurrentPosition(
      (location) => {
        const fix = positionFromFix(location);
        if (!isFreshFix(location) || !Number.isFinite(location.coords.accuracy) || location.coords.accuracy < 0
          || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)
          || Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180) {
          setLiveFix(null);
          setNotice("The location reading could not be used. Try again while safely stopped.");
        } else {
          setLiveFix(location);
          action(fix);
        }
        finish();
      },
      (error) => {
        setLiveFix(null);
        setNotice(error.code === 1
          ? "Location permission was denied. You can still play in Training."
          : "Location could not be confirmed. Try again while safely stopped.");
        finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  };

  const confirmPort = (portId: string, fix: Position, map = game) => {
    if (canConfirmDock(map, portId, fix)) return true;
    setNotice("Docking range could not be confirmed. Try again while safely stopped within range.");
    return false;
  };

  const requestDock = () => {
    if (busy || activeEncounter) return;
    const dockAt = (fix: Position) => runAction(
      () => dock(game, selectedPort.id, fix) as GameState,
      `Docked at ${selectedPort.name}.`,
    );
    if (training) {
      if (dockable && !docked) dockAt(trainingPosition);
      return;
    }

    checkLiveLocation((fix) => {
      if (originReady) {
        if (confirmPort(selectedPort.id, fix)) dockAt(fix);
        return;
      }

      const firstGame = createEngineGame(fix);
      if (!confirmPort(firstGame.originPortId, fix, firstGame)) return;
      setLiveGame(firstGame);
      setOriginReady(true);
      setSelectedPortId(firstGame.originPortId);
      setNotice(`Docked at ${firstGame.ports[0].name}.`);
    });
  };

  const placeOrder = (commodityId: string, side: "buy" | "sell", quantity: number) => {
    if (!docked || busy || activeEncounter) return;
    const settle = () => runAction(
      () => trade(game, { portId: selectedPort.id, commodityId, side, quantity }) as GameState,
      side === "buy" ? "Cargo loaded. Choose a destination on the star chart." : "Sale complete. Your receipt is in the Port Market.",
    );

    if (training) settle();
    else checkLiveLocation((fix) => {
      if (confirmPort(selectedPort.id, fix)) settle();
    });
  };

  const resolve = (choice: "run" | "pay" | "fight" | "help") => {
    runAction(() => resolveEncounter(game, choice) as GameState, "Encounter resolved.");
  };

  const rumors: DisplayRumor[] = (() => {
    try {
      return (selectedPort ? getRumors(game, selectedPort.id) : []).map((rumor: Rumor) =>
        formatRumor({ ...rumor, port: selectedPort?.name }),
      );
    } catch {
      return [];
    }
  })();

  return (
    <main className="wf-console" aria-label="Wayfarer space trading console">
      <header className="wf-topbar">
        <div className="wf-brand">
          <span className="wf-brand-mark" aria-hidden="true" />
          <div><h1>WAYFARER</h1><p>Independent trader network · Sol sector</p></div>
        </div>
        <div className="wf-location" role="status">
          <span className="wf-signal" aria-hidden="true" />
          {training ? "Training navigator" : liveFix ? `Last location check · ±${Math.round(liveFix.coords.accuracy)} m` : LOCATION_IDLE}
        </div>
      </header>

      <section className="wf-status-strip" aria-label="Ship status">
        <div><span>Credits</span><strong>{Number(credits).toLocaleString()} cr</strong></div>
        <div><span>Cargo</span><strong>{totals.units} / {capacity || "?"} units</strong></div>
        <div><span>Hull</span><strong>{hull} / {hullMax}</strong></div>
        <div><span>Manifest</span><strong>{totals.types} commodity types</strong></div>
      </section>

      <p className="wf-notice" role="status">{notice}</p>

      <div className="wf-dashboard">
        <section className="wf-panel wf-chart" aria-labelledby="wf-chart-title">
          <div className="wf-panel-heading"><h2 id="wf-chart-title">Local Star Chart</h2></div>
          <div className="wf-radar" aria-label="Constellation plot of nearby trade ports">
            <span className="wf-radar-ring wf-radar-ring--one" aria-hidden="true" />
            <span className="wf-radar-ring wf-radar-ring--two" aria-hidden="true" />
            <span className="wf-radar-axis wf-radar-axis--x" aria-hidden="true" />
            <span className="wf-radar-axis wf-radar-axis--y" aria-hidden="true" />
            <span className="wf-scope-readout">Schematic scope</span>
            {scopeTarget && <span className="wf-scope-vector" aria-hidden="true"
              style={{ clipPath: `polygon(50% 51.8%, ${scopeTarget.x}% ${scopeTarget.y - 0.2}%, ${scopeTarget.x}% ${scopeTarget.y + 0.2}%, 50% 52.2%)` }} />}
            <span className="wf-ship-marker" aria-hidden="true" />
            {ports.slice(0, SCOPE_PORTS.length).map((port, index) => {
              const { x, y, callsign } = SCOPE_PORTS[index];
              return (
                <button
                  className={`wf-port-dot ${selectedPort.id === port.id ? "is-selected" : ""} ${game.discoveredPortIds.includes(port.id) ? "is-visited" : ""}`}
                  key={port.id}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  onClick={() => setSelectedPortId(port.id)}
                  type="button"
                  disabled={busy}
                  aria-pressed={selectedPort.id === port.id}
                  aria-label={`Select ${port.name}`}
                >
                  <span className="wf-port-symbol" aria-hidden="true" />
                  <span className="wf-port-name">{port.name}</span>
                  <span className="wf-port-callsign">{callsign}</span>
                </button>
              );
            })}
          </div>
          <p className="wf-scope-key"><strong>Triangle: ship</strong><span>Diamond: port</span><span>Amber: selected</span></p>
          <p className="wf-test-caption"><strong>Public pilot preset unavailable.</strong> Desk check complete. Field validation pending.
            {" "}The chart shows generated test points. Use Training for route tests. Do not travel to these points.</p>
          <details className="wf-port-list">
            <summary>Port list and discoveries ({game.discoveredPortIds.length} / {ports.length})</summary>
            <ul>
              {ports.map((port) => (
                <li key={port.id}>
                  <button className="wf-icon-button" type="button" disabled={busy}
                    aria-pressed={selectedPort.id === port.id} onClick={() => setSelectedPortId(port.id)}>
                    {port.name}
                  </button>
                  <span>{game.discoveredPortIds.includes(port.id) ? "Visited" : "Unvisited"} · {formatDistance(metersBetween(position, port))}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="wf-panel wf-port-detail" aria-labelledby="wf-port-title">
          <div className="wf-panel-heading"><h2 id="wf-port-title">{selectedPort.name}</h2><span className="wf-panel-state">{scopeTarget?.callsign}</span></div>
          <p className="wf-port-flavor">{selectedPort.flavor ?? "Generated test port. Use Training to simulate arrival."}</p>
          <p className="wf-range">{training
            ? portStatusCopy({ portName: selectedPort.name, distanceMeters: distance, dockable, docked })
            : docked ? "Market open after your recent check-in. Each trade checks your location again."
              : position ? `Range at last check · ${formatDistance(distance)}`
                : "Check in when safely stopped to use the live market."}</p>
          {destination && (
            <p className="wf-route">Route to {destination.name} · {routeArrived ? "Arrived" : `${totals.units} units aboard`}</p>
          )}
          <div className="wf-port-actions">
            <button className="wf-button wf-button--primary" onClick={requestDock} type="button"
              disabled={busy || Boolean(activeEncounter) || (training && (!dockable || docked))}>
              {training && docked ? "Docked" : !training && !originReady ? "Start live check-in"
                : !training && docked ? "Refresh check-in" : "Request docking"}
            </button>
            <button className="wf-button wf-button--subtle" type="button"
              disabled={busy || (!training && !originReady) || docked || destination?.id === selectedPort.id}
              onClick={() => setGame({ ...game, destinationPortId: selectedPort.id })}>
              {destination?.id === selectedPort.id ? "Destination selected" : "Set destination"}
            </button>
            <label className="wf-training-toggle">
              <input checked={training} disabled={busy} onChange={(event) => toggleTraining(event.target.checked)} type="checkbox" />
              Training Simulator
            </label>
            {training && <button className="wf-button wf-button--subtle" onClick={() => {
              setTrainingPosition(selectedPort.position);
              setNotice(`Simulator moved you to ${selectedPort.name}.`);
            }} type="button">Virtually arrive</button>}
          </div>
        </section>

        <section className="wf-panel wf-market" aria-labelledby="wf-market-title">
          <div className="wf-panel-heading"><h2 id="wf-market-title">Port Market</h2><span className="wf-panel-state">{docked ? "Open for trading" : "Dock to unlock"}</span></div>
          {contractRoute && <section aria-label="Cargo contract" className="wf-receipt wf-contract">
            <header><h3>{DELIVERY.title}</h3><span>Reward {DELIVERY.reward} cr</span></header>
            <p>{contractRoute.origin.name} → {contractRoute.destination.name} · {DELIVERY.quantity} Ion Fuel</p>
            {!game.delivery && <>
              <p>Dock at {contractRoute.origin.name} to accept.</p>
              <button className="wf-button wf-button--subtle" type="button"
                disabled={busy || Boolean(activeEncounter) || !docked || selectedPort.id !== contractRoute.origin.id}
                onClick={() => runContract(acceptDelivery, "Contract accepted. Buy Ion Fuel at Wayfarer Freeport.")}>Accept cargo contract</button>
            </>}
            {game.delivery?.status === "active" && <>
              <p className="wf-contract-progress" aria-live="polite">{game.delivery.loaded} / {DELIVERY.quantity} Ion Fuel reserved</p>
              <p>{game.delivery.loaded < DELIVERY.quantity
                ? `Buy Ion Fuel at ${contractRoute.origin.name}. Your contract fuel is reserved from sale.`
                : `Select ${contractRoute.destination.name} on the chart or port list and dock there to deliver.`}</p>
              <button className="wf-button wf-button--subtle" type="button"
                disabled={busy || Boolean(activeEncounter) || !docked || selectedPort.id !== contractRoute.destination.id
                  || game.delivery.loaded < DELIVERY.quantity}
                onClick={() => runContract(completeDelivery, `Delivery complete. Received ${DELIVERY.reward} cr.`)}>Deliver reserved cargo</button>
            </>}
            {game.delivery?.status === "delivered" && <p>Delivered · {DELIVERY.reward} cr paid</p>}
          </section>}
          <MarketOrders key={`${training}-${selectedPort.id}-${marketRevision}`} game={game} portId={selectedPort.id}
            docked={docked} busy={busy || Boolean(activeEncounter)} onOrder={placeOrder} />
          {receipt && (
            <section className="wf-receipt" aria-label="Last trade receipt" aria-live="polite">
              <h3>Last trade receipt</h3>
              <p>{receipt.side === "buy" ? "Bought" : "Sold"} {receipt.quantity} × {receiptCommodity?.name}
                {" at "}{receiptPort?.name} · {receipt.unitPrice} cr per unit</p>
              <p>{receipt.side === "buy" ? "Paid" : "Proceeds"} {receipt.total} cr</p>
              {receipt.side === "sell" && <p>{receipt.costBasis === null
                ? "Purchase cost unavailable for some cargo from an older save."
                : `Purchase cost ${receipt.costBasis} cr · ${(receipt.profit ?? 0) < 0 ? "Loss" : "Profit"} ${Math.abs(receipt.profit ?? 0)} cr`}</p>}
              {(receipt.profit ?? 0) > 0 && <a href="#wf-upgrades-title">See ship upgrades</a>}
            </section>
          )}
        </section>

        <section className="wf-panel wf-manifest" aria-labelledby="wf-manifest-title">
          <div className="wf-panel-heading"><h2 id="wf-manifest-title">Ship Manifest</h2></div>
          <div className="wf-ship-diagram" aria-hidden="true"><span /></div>
          <dl className="wf-manifest-grid"><div><dt>Available credits</dt><dd>{Number(credits).toLocaleString()} cr</dd></div><div><dt>Free cargo space</dt><dd>{Math.max(0, Number(capacity || 0) - totals.units)} units</dd></div><div><dt>Hull integrity</dt><dd>{hull} / {hullMax}</dd></div></dl>
          <h3 id="wf-upgrades-title" tabIndex={-1}>Upgrades</h3>
          <div className="wf-upgrades">{UPGRADES.map((upgrade) => {
            const cost = UPGRADE_COSTS[upgrade.id];
            const shortfall = cost - credits;
            const effect = upgrade.id === "cargo" ? "Cargo capacity increased by 4." : "Hull integrity increased by 1.";
            return (
              <button className="wf-upgrade" key={upgrade.id} type="button"
                disabled={busy || (!training && !originReady) || Boolean(activeEncounter) || shortfall > 0}
                onClick={() => runAction(() => buyUpgrade(game, upgrade.id) as GameState, `${effect} Paid ${cost} cr.`)}>
                <strong>{upgrade.name}</strong>
                <span>{upgrade.detail} · {cost} cr</span>
                {shortfall > 0 && <span>{shortfall} cr short</span>}
              </button>
            );
          })}</div>
          <section className="wf-data" aria-labelledby="wf-data-title">
            <h3 id="wf-data-title">Local game data</h3>
            <p>This browser stores separate Live and Training saves with your ship, cargo, markets, visits, contract and last receipt.
              Live saves include your starting coordinates and generated port coordinates. Training uses a simulated map.
              Recent location checks stay in memory.</p>
            <button className="wf-button wf-button--subtle" type="button" disabled={busy || Boolean(activeEncounter)}
              onClick={() => resetDialog.current?.showModal()}>Reset {campaignName} game data</button>
          </section>
        </section>
        <section className="wf-panel wf-news" aria-labelledby="wf-news-title">
          <div className="wf-panel-heading"><h2 id="wf-news-title">Galactic News</h2></div>
          <ul className="wf-rumor-list">
            {rumors.length ? rumors.map((rumor) => (
              <li className={`wf-rumor wf-rumor--${rumor.tone}`} key={rumor.id}>
                <strong>{rumor.headline}</strong><span>{rumor.detail}</span>
              </li>
            )) : <li className="wf-empty">No actionable transmissions. Keep your antenna clear.</li>}
          </ul>
        </section>

      </div>

      <dialog ref={resetDialog} className="wf-reset-dialog" aria-labelledby="wf-reset-title" aria-describedby="wf-reset-description">
        <h2 id="wf-reset-title">Reset {campaignName} game data?</h2>
        <p id="wf-reset-description">This permanently removes your {campaignName} progress and its saved coordinates from this browser.
          Your {training ? "Live" : "Training"} save is kept.</p>
        <form method="dialog">
          <button className="wf-button wf-button--subtle" type="submit">Cancel</button>
          <button className="wf-button wf-button--primary" type="button" onClick={resetCampaign}>Confirm {campaignName} reset</button>
        </form>
      </dialog>

      {activeEncounter && <section className="wf-encounter" aria-labelledby="wf-encounter-title" role="dialog" aria-modal="true">
        <h2 id="wf-encounter-title">{activeEncounter.title ?? activeEncounter.type ?? "Unidentified encounter"}</h2><p>{activeEncounter.description ?? activeEncounter.message ?? "A ship is hailing you for a decision."}</p>
        <div className="wf-encounter-actions">{(activeEncounter.type === "distress" ? ["help", "run"] : ["run", "pay", "fight"]).map((choice) => <button className="wf-button wf-button--primary" key={choice} disabled={busy} onClick={() => resolve(choice as "run" | "pay" | "fight" | "help")} type="button">{choice}</button>)}</div>
      </section>}
    </main>
  );
}

export { GameShell };
