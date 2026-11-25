"use client";

import { useEffect, useRef, useState } from "react";

import {
  COMMODITIES,
  buyUpgrade,
  canDock,
  createGame,
  distanceMeters,
  dock,
  getRumors,
  resolveEncounter,
  trade,
} from "./engine.mjs";
import {
  cargoTotals,
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
  player: Player;
}
interface Rumor { commodityId: string; commodityName: string; price: "cheap" | "fair" | "expensive" }
interface Upgrade { id: "cargo" | "hull"; name: string; detail: string }
interface DisplayRumor { id: string; headline: string; detail: string; tone: string }
type Outcome = GameState;
type SaveStatus = "loading" | "fresh" | "restored";
interface SavedGameEnvelope {
  version: 1;
  originPolicy: "persisted-origin";
  game: GameState;
}

const STORAGE_KEY = "wayfarer-save-v1";
const SAVE_VERSION = 1;
const DEMO_ORIGIN: Position = { latitude: 39.7392, longitude: -104.9903 };
const FALLBACK_UPGRADES: Upgrade[] = [
  { id: "cargo", name: "Expanded cargo bay", detail: "+4 cargo capacity" },
  { id: "hull", name: "Hull plating", detail: "+1 hull integrity" },
];

function isGameState(value: unknown): value is GameState {
  return typeof value === "object" && value !== null
    && Array.isArray((value as GameState).ports)
    && typeof (value as GameState).player === "object";
}

function createEngineGame(position: Position): GameState {
  return createGame(position) as GameState;
}

function readSavedGame(): GameState | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
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

function metersBetween(position: Position, port: Port) {
  try {
    const value = distanceMeters(position, port.position);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function marketPrice(port: Port, commodityId: string) {
  return port.market?.find((entry) => entry.commodityId === commodityId)?.price;
}

function cargoAmount(game: GameState, commodityId: string) {
  return game.player.cargo[commodityId] ?? 0;
}

export default function GameShell() {
  const [game, setGame] = useState<GameState>(() => createEngineGame(DEMO_ORIGIN));
  const [livePosition, setLivePosition] = useState<Position>(DEMO_ORIGIN);
  const [trainingPosition, setTrainingPosition] = useState<Position>(DEMO_ORIGIN);
  const [selectedPortId, setSelectedPortId] = useState<string>(() => game.ports[0]?.id ?? "");
  const [training, setTraining] = useState(false);
  const [locationMode, setLocationMode] = useState("Connecting to navigation…");
  const [notice, setNotice] = useState("Welcome, captain. Select a port to plot a course.");
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(() => game.encounter);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [originReady, setOriginReady] = useState(false);
  const saveStatusRef = useRef<SaveStatus>("loading");
  const pendingLivePositionRef = useRef<Position | null>(null);
  const centeredOnLivePositionRef = useRef(false);

  const position = training ? trainingPosition : livePosition;
  const ports = game.ports;
  const commodities = COMMODITIES as Commodity[];
  const selectedPort = ports.find((port) => port.id === selectedPortId) ?? ports[0];
  const distance = selectedPort ? metersBetween(position, selectedPort) : Number.POSITIVE_INFINITY;
  const dockable = selectedPort ? Boolean(canDock(game, selectedPort.id, position)) : false;
  const dockedPortId = game.dockedPortId;
  const docked = Boolean(selectedPort && dockedPortId === selectedPort.id);
  const totals = cargoTotals(game.player?.cargo);
  const credits = game.player?.credits ?? 0;
  const capacity = game.player?.cargoCapacity ?? 0;
  const hull = game.player?.hull ?? 1;
  const hullMax = 5;

  useEffect(() => {
    const restoredGame = readSavedGame();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (restoredGame) {
        saveStatusRef.current = "restored";
        setGame(restoredGame);
        setSelectedPortId(restoredGame.dockedPortId || restoredGame.ports[0]?.id || "");
        setActiveEncounter(restoredGame.encounter);
        setSaveStatus("restored");
        setOriginReady(true);
        return;
      }

      const livePosition = pendingLivePositionRef.current;
      saveStatusRef.current = "fresh";
      if (livePosition) {
        centeredOnLivePositionRef.current = true;
        setGame(createEngineGame(livePosition));
        setOriginReady(true);
      }
      setSaveStatus("fresh");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (saveStatus === "loading" || !originReady) return;
    try {
      const save: SavedGameEnvelope = {
        version: SAVE_VERSION,
        originPolicy: "persisted-origin",
        game,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    } catch {
      // A full or unavailable browser store should not interrupt flight.
    }
  }, [game, originReady, saveStatus]);

  useEffect(() => {
    if (training) return;
    if (!navigator.geolocation) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setLocationMode("Navigation unavailable — demo origin engaged.");
          setOriginReady(true);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (location) => {
        if (cancelled) return;
        const livePosition = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
        };
        pendingLivePositionRef.current = livePosition;
        setLivePosition(livePosition);
        if (
          saveStatusRef.current === "fresh"
          && !centeredOnLivePositionRef.current
        ) {
          centeredOnLivePositionRef.current = true;
          setGame(createEngineGame(livePosition));
          setSelectedPortId("port-1");
          setOriginReady(true);
        }
        setLocationMode(`Live navigator · ±${Math.round(location.coords.accuracy)} m`);
      },
      () => {
        if (cancelled) return;
        pendingLivePositionRef.current = null;
        setLivePosition(DEMO_ORIGIN);
        setLocationMode("Location permission denied — demo origin engaged.");
        setOriginReady(true);
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
    );
    return () => {
      cancelled = true;
      pendingLivePositionRef.current = null;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [training]);

  const toggleTraining = (enabled: boolean) => {
    if (enabled) {
      setTrainingPosition(game.origin);
      setOriginReady(true);
    }
    setLivePosition(DEMO_ORIGIN);
    setLocationMode("Connecting to navigation…");
    setTraining(enabled);
  };

  const applyOutcome = (outcome: Outcome, fallback: string) => {
    setGame(outcome);
    setNotice(fallback);
    if (outcome.encounter) setActiveEncounter(outcome.encounter);
  };

  const runAction = (action: () => Outcome, fallback: string) => {
    try {
      applyOutcome(action(), fallback);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Command rejected by station control.");
    }
  };

  const requestDock = () => {
    if (!selectedPort) return;
    runAction(
      () => dock(game, selectedPort.id, position, { demo: training }) as GameState,
      `Docked at ${selectedPort.name}.`,
    );
  };

  const tradeOne = (commodityId: string, direction: "buy" | "sell") => {
    if (!selectedPort || !docked) return;
    runAction(
      () => trade(game, { portId: selectedPort.id, commodityId, side: direction, quantity: 1 }) as GameState,
      `${direction === "buy" ? "Purchased" : "Sold"} one unit.`,
    );
  };

  const resolve = (choice: "run" | "pay" | "fight" | "help") => {
    runAction(() => resolveEncounter(game, choice) as GameState, "Encounter resolved.");
    setActiveEncounter(null);
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
        <div>
          <p className="wf-kicker">Independent trader network · Sol sector</p>
          <h1>WAYFARER</h1>
        </div>
        <div className="wf-location" role="status">
          <span className="wf-signal" aria-hidden="true" />
          {training ? "Training navigator" : locationMode}
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
        <section className="wf-panel wf-news" aria-labelledby="wf-news-title">
          <div className="wf-panel-heading"><p className="wf-kicker">Network relay</p><h2 id="wf-news-title">Galactic News</h2></div>
          <ul className="wf-rumor-list">
            {rumors.length ? rumors.map((rumor) => (
              <li className={`wf-rumor wf-rumor--${rumor.tone}`} key={rumor.id}>
                <strong>{rumor.headline}</strong><span>{rumor.detail}</span>
              </li>
            )) : <li className="wf-empty">No actionable transmissions. Keep your antenna clear.</li>}
          </ul>
        </section>

        <section className="wf-panel wf-chart" aria-labelledby="wf-chart-title">
          <div className="wf-panel-heading"><p className="wf-kicker">Navigator</p><h2 id="wf-chart-title">Local Star Chart</h2></div>
          <div className="wf-radar" aria-label="Constellation plot of nearby trade ports">
            <span className="wf-radar-ring wf-radar-ring--one" aria-hidden="true" />
            <span className="wf-radar-ring wf-radar-ring--two" aria-hidden="true" />
            <span className="wf-radar-axis wf-radar-axis--x" aria-hidden="true" />
            <span className="wf-radar-axis wf-radar-axis--y" aria-hidden="true" />
            <span className="wf-ship-marker" aria-label="Your current position">✦</span>
            {ports.slice(0, 7).map((port, index) => (
              <button
                className={`wf-port-dot wf-port-dot--${index} ${selectedPort?.id === port.id ? "is-selected" : ""}`}
                key={port.id}
                onClick={() => setSelectedPortId(port.id)}
                type="button"
                aria-pressed={selectedPort?.id === port.id}
                aria-label={`Select ${port.name}`}
              >
                <span aria-hidden="true" />{port.name}
              </button>
            ))}
          </div>
          <div className="wf-chart-footer"><span>{training ? "Simulator" : "GPS"}: {position.latitude.toFixed(4)}, {position.longitude.toFixed(4)}</span><span>Range measured in real space</span></div>
        </section>

        <section className="wf-panel wf-port-detail" aria-labelledby="wf-port-title">
          <div className="wf-panel-heading"><p className="wf-kicker">Selected destination</p><h2 id="wf-port-title">{selectedPort?.name ?? "No port selected"}</h2></div>
          <p className="wf-port-flavor">{selectedPort?.flavor ?? "A registered independent trading port."}</p>
          <p className="wf-range">{selectedPort ? portStatusCopy({ portName: selectedPort.name, distanceMeters: distance, dockable, docked }) : "Select a destination."}</p>
          <div className="wf-port-actions">
            <button className="wf-button wf-button--primary" onClick={requestDock} type="button" disabled={!dockable || docked}> {docked ? "Docked" : "Request docking"} </button>
            <label className="wf-training-toggle"><input checked={training} onChange={(event) => toggleTraining(event.target.checked)} type="checkbox" /> Training Simulator</label>
            {training && <button className="wf-button wf-button--subtle" onClick={() => { if (selectedPort) { setTrainingPosition(selectedPort.position); setNotice(`Simulator moved you to ${selectedPort.name}.`); } }} type="button">Virtually arrive</button>}
          </div>
        </section>

        <section className="wf-panel wf-market" aria-labelledby="wf-market-title">
          <div className="wf-panel-heading"><p className="wf-kicker">{docked ? "Authenticated exchange" : "Encrypted until docked"}</p><h2 id="wf-market-title">Port Market</h2></div>
          {docked ? <div className="wf-market-table" role="table" aria-label="Commodity market">
            {commodities.map((commodity) => {
              const price = selectedPort ? marketPrice(selectedPort, commodity.id) : undefined;
              const amount = cargoAmount(game, commodity.id);
              return <div className="wf-market-row" role="row" key={commodity.id}>
                <span role="cell">{commodity.name}</span><strong role="cell">{Number.isFinite(price) ? `${price} cr` : "Quote pending"}</strong><span role="cell">Hold: {amount}</span>
                <span className="wf-trade-controls" role="cell"><button aria-label={`Buy ${commodity.name}`} className="wf-icon-button" onClick={() => tradeOne(commodity.id, "buy")} type="button">Buy</button><button aria-label={`Sell ${commodity.name}`} className="wf-icon-button" disabled={!amount} onClick={() => tradeOne(commodity.id, "sell")} type="button">Sell</button></span>
              </div>;
            })}
          </div> : <p className="wf-locked">Dock to decrypt exact commodity prices and trading controls.</p>}
        </section>

        <section className="wf-panel wf-manifest" aria-labelledby="wf-manifest-title">
          <div className="wf-panel-heading"><p className="wf-kicker">Ship systems</p><h2 id="wf-manifest-title">Ship Manifest</h2></div>
          <dl className="wf-manifest-grid"><div><dt>Available credits</dt><dd>{Number(credits).toLocaleString()} cr</dd></div><div><dt>Free cargo space</dt><dd>{Math.max(0, Number(capacity || 0) - totals.units)} units</dd></div><div><dt>Hull integrity</dt><dd>{hull} / {hullMax}</dd></div></dl>
          <h3>Upgrades</h3>
          <div className="wf-upgrades">{FALLBACK_UPGRADES.map((upgrade) => <button className="wf-upgrade" key={upgrade.id} onClick={() => runAction(() => buyUpgrade(game, upgrade.id) as GameState, `${upgrade.name} installed.`)} type="button"><strong>{upgrade.name}</strong><span>{upgrade.detail}</span></button>)}</div>
        </section>
      </div>

      {activeEncounter && <section className="wf-encounter" aria-labelledby="wf-encounter-title" role="dialog" aria-modal="true">
        <p className="wf-kicker">Incoming priority channel</p><h2 id="wf-encounter-title">{activeEncounter.title ?? activeEncounter.type ?? "Unidentified encounter"}</h2><p>{activeEncounter.description ?? activeEncounter.message ?? "A ship is hailing you for a decision."}</p>
        <div className="wf-encounter-actions">{(activeEncounter.type === "distress" ? ["help", "run"] : ["run", "pay", "fight"]).map((choice) => <button className="wf-button wf-button--primary" key={choice} onClick={() => resolve(choice as "run" | "pay" | "fight" | "help")} type="button">{choice}</button>)}</div>
      </section>}
    </main>
  );
}

export { GameShell };
