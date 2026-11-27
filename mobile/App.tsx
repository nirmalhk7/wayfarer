import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";

import {
  COMMODITIES,
  DELIVERY,
  acceptDelivery,
  completeDelivery,
  deliveryRoute,
  UPGRADE_COST,
  buyUpgrade,
  distanceMeters,
  getRumors,
  orderLimit,
  resolveEncounter,
  trade,
  type Coordinates,
  type GameState,
  type MarketQuote,
  type PriceBand,
} from "./src/game/engine";
import {
  cargoUnits,
  chartPosition,
  formatDistance,
  rumorSummary,
} from "./src/game/presentation";
import { useSubdivisionArrival } from "./src/location/useSubdivisionArrival";
import { stopLegacyPointTasks } from "./src/location/retiredPointTasks";
import { createSubdivisionCampaign, recordSubdivisionVisit } from "./src/game/subdivisionCampaign";
import { locateSubdivision, PILOT_PORTS } from "./src/territories/subdivisions";
import {
  LEGACY_STORAGE_KEY,
  LIVE_RESET_MARKER,
  SUBDIVISION_LIVE_STORAGE_KEY,
  decodeGameState,
  encodeGameState,
  storageKeyForMode,
  type CampaignMode,
} from "./src/persistence";
import {
  activeDockedPort,
  createLatestWriteQueue,
  resolveCoordinatorTransition,
  updateCampaign,
  type Campaigns,
} from "./src/ui/campaignState";
import {
  applyCoordinatorSample,
  createDockingCoordinator,
  selectDockingTarget,
  type DockingCoordinator,
} from "./src/ui/dockingCoordinator";
import { clearPersistedDockingCoordinator } from "./src/ui/dockingSessionStore";
import { COCKPIT as COLORS } from "./src/ui/cockpitTheme";
import { FlightScene } from "./src/ui/FlightScene";
import { LiveSubdivisionChart, TerritoryChart } from "./src/ui/TerritoryChart";
import { createNorthCoastTraining, NORTH_COAST_ORIGIN, territoryAt, usesNorthCoastTrainingMap } from "./src/territories/northCoast";

async function clearLiveDockingData() {
  await stopLegacyPointTasks();
  await Promise.all([
    clearPersistedDockingCoordinator(),
    AsyncStorage.removeItem(LEGACY_STORAGE_KEY),
  ]);
}
const SCOPE_STARS = [[9,18], [28,14], [43,34], [64,12], [89,17], [91,57], [72,63], [18,78], [51,85], [88,88]];

type Tab = "bridge" | "chart" | "market" | "ship";

function Button({
  label,
  accessibilityLabel = label,
  onPress,
  disabled = false,
  tone = "lime",
  compact = false,
  selected,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "lime" | "ghost" | "danger";
  compact?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        tone === "lime" && styles.buttonLime,
        tone === "ghost" && styles.buttonGhost,
        tone === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonLabel, (tone === "lime" || tone === "danger") && !disabled && styles.buttonLabelDark]}>{label}</Text>
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>;
}

function Stat({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warning && styles.warning]}>{value}</Text>
    </View>
  );
}

function BandPill({ band }: { band: PriceBand }) {
  return (
    <View style={[
      styles.band,
      band === "cheap" && styles.bandCheap,
      band === "expensive" && styles.bandExpensive,
    ]}>
      <Text style={styles.bandText}>{band.toUpperCase()}</Text>
    </View>
  );
}

function StarChart({
  game,
  position,
  selectedPortId,
  onSelect,
  size,
}: {
  game: GameState;
  position: Coordinates;
  selectedPortId: string;
  onSelect: (portId: string) => void;
  size: number;
}) {
  const ship = chartPosition(game.origin, position);
  const target = game.ports.find(({ id }) => id === selectedPortId);
  const aim = target ? chartPosition(game.origin, target.position) : ship;
  const dx = (aim.x - ship.x) * size / 100;
  const dy = (aim.y - ship.y) * size / 100;
  const vectorLength = Math.hypot(dx, dy);
  const vectorAngle = Math.atan2(dy, dx) * 180 / Math.PI;

  return (
    <View accessibilityLabel="Nearby starport chart" style={[styles.radar, { height: size, width: size }]}>
      {SCOPE_STARS.map(([x, y]) => <View key={x} style={[styles.scopeStar, { left: `${x}%`, top: `${y}%` }]} />)}
      <Text style={styles.scopeLabel}>Local scope</Text>
      {vectorLength > 0 && <View pointerEvents="none" style={[styles.scopeVector, {
        top: `${(aim.y + ship.y) / 2}%`, left: `${(aim.x + ship.x) / 2}%`,
        width: vectorLength, marginLeft: -vectorLength / 2,
        transform: [{ rotate: `${vectorAngle}deg` }],
      }]} />}
      <View style={[
        styles.radarRing,
        {
          width: size * 0.72,
          height: size * 0.72,
          marginLeft: size * -0.36,
          marginTop: size * -0.36,
        },
      ]} />
      <View style={[
        styles.radarRing,
        {
          width: size * 0.4,
          height: size * 0.4,
          marginLeft: size * -0.2,
          marginTop: size * -0.2,
        },
      ]} />
      <View style={styles.radarAxisHorizontal} />
      <View style={styles.radarAxisVertical} />
      <View pointerEvents="none" style={[styles.shipMarker, { left: `${ship.x}%`, top: `${ship.y}%` }]}>
        <View style={styles.shipPointer} />
      </View>
      {game.ports.map((port, index) => {
        const point = index === 0
          ? { x: 50, y: 50 }
          : chartPosition(game.origin, port.position);
        const selected = port.id === selectedPortId;
        const visited = game.discoveredPortIds.includes(port.id);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${port.name}, ${formatDistance(distanceMeters(position, port.position))}`}
            accessibilityState={{ selected }}
            key={port.id}
            onPress={() => onSelect(port.id)}
            style={[
              styles.portNode,
              {
                left: `${point.x}%`,
                top: `${point.y}%`,
                transform: [{ translateX: -28 }, { translateY: -24 }],
              },
            ]}
          >
            <View style={[
              styles.portDiamond,
              visited && styles.portDiamondVisited,
              selected && styles.portDiamondSelected,
            ]} />
            <Text numberOfLines={1} style={[styles.portNodeLabel, selected && styles.portNodeLabelSelected]}>
              {port.callsign}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MarketRow({ quote, game, onOrder }: {
  quote: MarketQuote;
  game: GameState;
  onOrder: (side: "buy" | "sell", quantity: number) => void;
}) {
  const commodity = COMMODITIES.find((item) => item.id === quote.commodityId)!;
  const [units, setUnits] = useState("1");
  const quantity = Number(units);
  const valid = /^\d+$/.test(units) && Number.isSafeInteger(quantity) && quantity > 0;
  const maxBuy = orderLimit(game, quote, "buy");
  const maxSell = orderLimit(game, quote, "sell");
  const canBuy = valid && quantity <= maxBuy;
  const canSell = valid && quantity <= maxSell;
  const buyLabel = canBuy ? `Buy · ${quote.ask * quantity} cr` : "Buy";
  const sellLabel = canSell ? `Sell · ${quote.bid * quantity} cr` : "Sell";
  return (
    <View style={styles.marketRow}>
      <View style={styles.commodityIdentity}>
        <View style={styles.commodityBadge}><Text style={styles.commodityBadgeText}>{commodity.symbol}</Text></View>
        <View style={styles.flexOne}>
          <Text style={styles.commodityName}>{commodity.name}</Text>
          <Text style={styles.commodityMeta}>Buy {quote.ask} cr · Sell {quote.bid} cr per unit</Text>
          <Text style={styles.commodityMeta}>Stock {quote.stock} · In hold {game.player.cargo[quote.commodityId] ?? 0} · Can buy {maxBuy}</Text>
        </View>
      </View>
      <View style={styles.tradeButtons}>
        <View>
          <Text style={styles.commodityMeta}>Units</Text>
          <TextInput
            accessibilityLabel={`${commodity.name} units`}
            keyboardType="number-pad"
            maxLength={12}
            onChangeText={setUnits}
            selectTextOnFocus
            style={styles.orderQuantity}
            value={units}
          />
        </View>
        <Button compact disabled={!canBuy} label={buyLabel}
          accessibilityLabel={`Buy ${commodity.name}${canBuy ? `, ${quote.ask * quantity} credits` : ""}`}
          onPress={() => onOrder("buy", quantity)} />
        <Button compact disabled={!canSell} label={sellLabel}
          accessibilityLabel={`Sell ${commodity.name}${canSell ? `, ${quote.bid * quantity} credits` : ""}`}
          onPress={() => onOrder("sell", quantity)} tone="ghost" />
      </View>
    </View>
  );
}

function CargoContract({ game, dockedPortId, saving, onAccept, onDeliver }: {
  game: GameState;
  dockedPortId: string | undefined;
  saving: boolean;
  onAccept: () => void;
  onDeliver: () => void;
}) {
  const route = deliveryRoute(game);
  if (!route) return null;
  const delivery = game.delivery;
  return (
    <View style={[styles.receipt, styles.contract]}>
      <View style={styles.contractHeading}>
        <Text style={styles.receiptTitle} accessibilityRole="header">{DELIVERY.title}</Text>
        <Text style={styles.contractReward}>Reward {DELIVERY.reward} cr</Text>
      </View>
      <Text style={styles.receiptLine}>
        {route.origin.name} → {route.destination.name} · {DELIVERY.quantity} Ion Fuel
      </Text>
      {!delivery && <>
        <Text style={styles.receiptLine}>Dock at {route.origin.name} to accept.</Text>
        <Button label="Accept cargo contract" disabled={saving || Boolean(game.encounter) || dockedPortId !== route.origin.id}
          onPress={onAccept} tone="ghost" />
      </>}
      {delivery?.status === "active" && <>
        <Text style={styles.receiptLine} accessibilityLiveRegion="polite">{delivery.loaded} / {DELIVERY.quantity} Ion Fuel reserved</Text>
        <Text style={styles.receiptLine}>{delivery.loaded < DELIVERY.quantity
          ? `Buy Ion Fuel at ${route.origin.name}. Your contract fuel is reserved from sale.`
          : `Select ${route.destination.name} on the chart or port list and dock there to deliver.`}</Text>
        <Button label="Deliver reserved cargo" disabled={saving || Boolean(game.encounter)
          || dockedPortId !== route.destination.id || delivery.loaded < DELIVERY.quantity}
          onPress={onDeliver} tone="ghost" />
      </>}
      {delivery?.status === "delivered" && <Text style={styles.receiptLine}>Delivered · {DELIVERY.reward} cr paid</Text>}
    </View>
  );
}

function LastTrade({ game, onUpgrades }: { game: GameState; onUpgrades: () => void }) {
  const receipt = game.lastTrade;
  if (!receipt) return null;
  const commodity = COMMODITIES.find((item) => item.id === receipt.commodityId);
  const port = game.ports.find(({ id }) => id === receipt.portId);
  const total = receipt.unitPrice * receipt.quantity;
  const profit = receipt.side === "sell" && receipt.costBasis !== null ? total - receipt.costBasis : null;
  return (
    <View style={styles.receipt}>
      <Text style={styles.receiptTitle} accessibilityRole="header">Last trade receipt</Text>
      <Text style={styles.receiptLine}>
        {`${receipt.side === "buy" ? "Bought" : "Sold"} ${receipt.quantity} × ${commodity?.name} at ${port?.name}`}
      </Text>
      <Text style={styles.receiptLine}>
        {`${receipt.side === "buy" ? "Paid" : "Proceeds"} ${total} cr · ${receipt.unitPrice} cr per unit`}
      </Text>
      {receipt.side === "sell" && <Text style={styles.receiptLine}>{profit === null
        ? "Purchase cost unavailable for cargo from an older save."
        : `Purchase cost ${receipt.costBasis} cr · ${profit < 0 ? "Loss" : "Profit"} ${Math.abs(profit)} cr`}</Text>}
      {(profit ?? 0) > 0 && <Button label="View ship upgrades" onPress={onUpgrades} tone="ghost" />}
    </View>
  );
}

function EncounterModal({ game, onResolve }: {
  game: GameState;
  onResolve: (choice: "run" | "pay" | "fight" | "help") => void;
}) {
  const encounter = game.encounter;
  if (!encounter) return null;
  const distress = encounter.type === "distress";
  const copy = encounter.type === "pirates"
    ? "Raiders have locked weapons. Your cargo or your hull may pay the toll."
    : encounter.type === "customs"
      ? "A customs cutter requests manifest verification and an expedited inspection fee."
      : "A damaged courier is broadcasting a weak rescue signal.";
  return (
    <Modal transparent visible onRequestClose={() => { /* Resolve the encounter before returning to flight. */ }}>
      <ScrollView contentContainerStyle={styles.modalScrim}>
        <View style={styles.encounterCard} accessibilityViewIsModal>
          <Text style={styles.alertCode}>PRIORITY CONTACT · SEVERITY {encounter.severity}</Text>
          <Text style={styles.encounterTitle}>{encounter.type.toUpperCase()}</Text>
          <Text style={styles.encounterCopy}>{copy}</Text>
          <View style={styles.encounterActions}>
            {distress ? (
              <>
                <Button label="RENDER AID" onPress={() => onResolve("help")} />
                <Button label="BREAK CONTACT" onPress={() => onResolve("run")} tone="ghost" />
              </>
            ) : (
              <>
                <Button label="FIGHT" onPress={() => onResolve("fight")} tone="danger" />
                <Button label="PAY" onPress={() => onResolve("pay")} />
                <Button label="RUN" onPress={() => onResolve("run")} tone="ghost" />
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Wayfarer />
    </SafeAreaProvider>
  );
}

function Wayfarer() {
  const { width } = useWindowDimensions();
  const initialCampaigns = useMemo<Campaigns>(() => ({
    live: createSubdivisionCampaign(),
    training: createNorthCoastTraining(),
  }), []);
  const [campaigns, setCampaigns] = useState<Campaigns>(initialCampaigns);
  const [mode, setMode] = useState<CampaignMode>("training");
  const [positions, setPositions] = useState<Record<CampaignMode, Coordinates>>({
    live: initialCampaigns.live.origin,
    training: NORTH_COAST_ORIGIN,
  });
  const [selectedPortIds, setSelectedPortIds] = useState<Record<CampaignMode, string>>({
    live: initialCampaigns.live.ports[0].id,
    training: "port-0",
  });
  const [coordinators, setCoordinators] = useState<Record<CampaignMode, DockingCoordinator>>({
    live: createDockingCoordinator({ id: initialCampaigns.live.ports[0].id, coords: initialCampaigns.live.origin }),
    training: createDockingCoordinator({ id: "port-0", coords: NORTH_COAST_ORIGIN }),
  });
  const [tab, setTab] = useState<Tab>("bridge");
  const [stationPanel, setStationPanel] = useState<"contracts" | "trade">("contracts");
  const [showPortList, setShowPortList] = useState(false);
  const [booting, setBooting] = useState(true);
  const [saveReady, setSaveReady] = useState(false);
  const [liveRequested, setLiveRequested] = useState(false);
  const [liveStartAttempt, setLiveStartAttempt] = useState(0);
  const live = useSubdivisionArrival(mode === "live" && liveRequested, liveStartAttempt);
  const [resetMode, setResetMode] = useState<CampaignMode | null>(null);
  const [resetting, setResetting] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);
  const contractSavingRef = useRef(false);
  const resetInProgress = useRef(false);
  const emptyTrainingSave = useRef<GameState | null>(null);
  const locationStatus = live.presence.status;
  const [notice, setNotice] = useState("WELCOME, CAPTAIN");
  const campaignsRef = useRef(campaigns);
  const liveSaveQueue = useRef(createLatestWriteQueue<GameState | null>(async (snapshot) => {
    if (snapshot) {
      await AsyncStorage.setItem(SUBDIVISION_LIVE_STORAGE_KEY, encodeGameState(snapshot));
    } else {
      // Mark Live as paused before removing the old coordinate-bearing data.
      await AsyncStorage.setItem(SUBDIVISION_LIVE_STORAGE_KEY, LIVE_RESET_MARKER);
      await AsyncStorage.setItem(storageKeyForMode("live"), LIVE_RESET_MARKER);
      await clearLiveDockingData();
    }
  }));
  const trainingSaveQueue = useRef(createLatestWriteQueue<GameState | null>(async (snapshot) => {
    const key = storageKeyForMode("training");
    if (snapshot) await AsyncStorage.setItem(key, encodeGameState(snapshot));
    else await AsyncStorage.removeItem(key);
  }));

  const game = campaigns[mode];
  const position = positions[mode];
  const selectedPortId = mode === "live" ? live.presence.geoid : selectedPortIds.training;
  const coordinator = coordinators[mode];

  const selectedPort = useMemo(
    () => game.ports.find((port) => port.id === selectedPortId) ?? game.ports[0],
    [game.ports, selectedPortId],
  );
  const pilotPort = PILOT_PORTS.find((port) => port.geoid === live.presence.geoid);
  const dockedPort = mode === "live"
    ? game.ports.find((port) => port.id === pilotPort?.geoid) ?? null
    : activeDockedPort(game, coordinator);
  const berthed = dockedPort?.id === selectedPort.id;
  const regionalTraining = mode === "training" && usesNorthCoastTrainingMap(game);
  const trainingArea = regionalTraining ? locateSubdivision(selectedPort.position, 0) : null;
  const selectedCounty = trainingArea?.kind === "inside" ? trainingArea.port.countyName
    : regionalTraining ? territoryAt(selectedPort.position)?.name : pilotPort?.countyName;
  const selectedDistance = distanceMeters(position, selectedPort.position);
  const usedCargo = cargoUnits(game.player.cargo);
  const radarSize = Math.min(width - 40, 440);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "bridge") return false;
      setTab("bridge");
      return true;
    });
    return () => back.remove();
  }, [tab]);

  useEffect(() => { campaignsRef.current = campaigns; }, [campaigns]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const [newLiveRaw, oldLiveRaw, trainingRaw, legacyRaw] = await Promise.all([
          AsyncStorage.getItem(SUBDIVISION_LIVE_STORAGE_KEY),
          AsyncStorage.getItem(storageKeyForMode("live")),
          AsyncStorage.getItem(storageKeyForMode("training")),
          AsyncStorage.getItem(LEGACY_STORAGE_KEY),
        ]);
        const resetPending = newLiveRaw === LIVE_RESET_MARKER
          || (oldLiveRaw === LIVE_RESET_MARKER && newLiveRaw === null);
        if (resetPending) await clearLiveDockingData();
        else await stopLegacyPointTasks().catch(() => {});
        if (cancelled) return;
        const oldLive = resetPending ? null : decodeGameState(oldLiveRaw ?? legacyRaw, "live");
        const nextLive = decodeGameState(newLiveRaw, "subdivision-live")
          ?? (oldLive ? createSubdivisionCampaign(oldLive) : initialCampaigns.live);
        const nextTraining = decodeGameState(trainingRaw, "training") ?? initialCampaigns.training;
        setCampaigns({ live: nextLive, training: nextTraining });
        setPositions((current) => ({ ...current, training: nextTraining.origin }));
        setCoordinators((current) => ({
          ...current,
          training: createDockingCoordinator({ id: nextTraining.ports[0].id, coords: nextTraining.origin }),
        }));
      } catch {
        if (!cancelled) setNotice("LOCAL SAVE UNAVAILABLE");
      } finally {
        if (!cancelled) {
          setSaveReady(true);
          setBooting(false);
        }
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, [initialCampaigns]);

  const arrivedGeoid = live.presence.geoid;
  useEffect(() => {
    if (!saveReady || !arrivedGeoid) return;
    setCampaigns((current) => updateCampaign(current, "live", (game) => recordSubdivisionVisit(game, arrivedGeoid)));
  }, [arrivedGeoid, saveReady]);

  const liveCampaign = campaigns.live;
  const trainingCampaign = campaigns.training;
  useEffect(() => {
    if (!saveReady || resetInProgress.current || liveCampaign.discoveredPortIds.length === 0) return;
    void liveSaveQueue.current.schedule(liveCampaign)
      .catch(() => setNotice("SAVE FAILED · LIVE CAMPAIGN REMAINS IN MEMORY"));
  }, [liveCampaign, saveReady]);

  useEffect(() => {
    if (!saveReady || resetInProgress.current || trainingCampaign === emptyTrainingSave.current) return;
    void trainingSaveQueue.current.schedule(trainingCampaign)
      .catch(() => setNotice("SAVE FAILED · TRAINING CAMPAIGN REMAINS IN MEMORY"));
  }, [trainingCampaign, saveReady]);

  async function resetCampaign() {
    if (!resetMode || resetInProgress.current || contractSavingRef.current) return;
    const target = resetMode;
    resetInProgress.current = true;
    setResetting(true);
    if (target === "live") setLiveRequested(false);
    try {
      await (target === "live" ? liveSaveQueue : trainingSaveQueue).current.writeThrough(null);
      setNotice(target === "live" ? "LIVE GAME DATA RESET" : "TRAINING GAME DATA RESET");
    } catch {
      setNotice("RESET INCOMPLETE · TRY AGAIN");
    } finally {
      const fresh = initialCampaigns[target];
      if (target === "training") emptyTrainingSave.current = fresh;
      const port = fresh.ports[0];
      setCampaigns((current) => ({ ...current, [target]: fresh }));
      setCoordinators((current) => ({
        ...current,
        [target]: createDockingCoordinator({ id: port.id, coords: port.position }),
      }));
      setPositions((current) => ({ ...current, [target]: fresh.origin }));
      setSelectedPortIds((current) => ({ ...current, [target]: port.id }));
      resetInProgress.current = false;
      setResetting(false);
      setResetMode(null);
    }
  }

  function mutate(action: (current: GameState) => GameState, success: string) {
    if (resetInProgress.current || contractSavingRef.current) return;
    if (mode === "live" && !live.currentGeoid()) return;
    try {
      const base = campaignsRef.current[mode];
      const updated = action(base);
      setCampaigns((current) => current[mode] === base
        ? updateCampaign(current, mode, () => updated)
        : current);
      setNotice(success);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "COMMAND REJECTED");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function saveContract(action: (current: GameState) => GameState, message: string) {
    if (mode !== "training" || contractSavingRef.current || resetInProgress.current || !dockedPort) return;
    contractSavingRef.current = true;
    setContractSaving(true);
    try {
      const current = campaignsRef.current[mode];
      if (activeDockedPort(current, coordinator)?.id !== dockedPort.id) return;
      const next = action(current);
      await trainingSaveQueue.current.writeThrough(next);
      setCampaigns((previous) => ({ ...previous, [mode]: next }));
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Contract could not be saved. Try again.");
    } finally {
      contractSavingRef.current = false;
      setContractSaving(false);
    }
  }

  function simulateQualification() {
    if (contractSavingRef.current) return;
    let next = createDockingCoordinator({ id: selectedPort.id, coords: selectedPort.position });
    const start = Date.now();
    for (let elapsed = 0; elapsed <= 600_000; elapsed += 15_000) {
      next = applyCoordinatorSample(next, {
        latitude: selectedPort.position.latitude,
        longitude: selectedPort.position.longitude,
        horizontalAccuracyMeters: 5,
        altitudeMeters: null,
        verticalAccuracyMeters: null,
        headingDegrees: null,
        speedMetersPerSecond: 0,
        recordedAtMs: start + elapsed,
        isMocked: false,
      }, start + elapsed);
    }
    const transition = resolveCoordinatorTransition(campaigns.training, next);
    setPositions((current) => ({ ...current, training: selectedPort.position }));
    setCampaigns((current) => ({ ...current, training: transition.game }));
    setCoordinators((current) => ({ ...current, training: transition.coordinator }));
    setNotice(`TRAINING QUALIFICATION COMPLETE · ${selectedPort.callsign}`);
    void Haptics.selectionAsync();
  }

  function plotCourse(portId: string) {
    if (contractSavingRef.current || mode !== "training") return;
    const port = game.ports.find((candidate) => candidate.id === portId);
    if (!port) return;
    setSelectedPortIds((current) => ({ ...current, training: portId }));
    setCoordinators((current) => ({
      ...current,
      training: selectDockingTarget(current.training, { id: port.id, coords: port.position }),
    }));
    void Haptics.selectionAsync();
    setTab("bridge");
  }

  function executeTrade(quote: MarketQuote, side: "buy" | "sell", quantity: number) {
    if (!dockedPort) return;
    const order = { portId: dockedPort.id, commodityId: quote.commodityId, side, quantity };
    if (mode === "live" && live.currentGeoid() !== order.portId) return;
    mutate(
      (current) => {
        if (mode === "training") return trade(current, order);
        const known = recordSubdivisionVisit(current, order.portId);
        const traded = trade({ ...known, dockedPortId: order.portId }, order);
        return { ...traded, dockedPortId: null };
      },
      side === "sell" ? "Sale complete. Check your receipt."
        : mode === "live" ? "Cargo loaded. Your hold travels with you." : "Cargo loaded. Plot your next course on the chart.",
    );
  }

  function handleEncounter(choice: "run" | "pay" | "fight" | "help") {
    mutate((current) => resolveEncounter(current, choice), `CONTACT RESOLVED · ${choice.toUpperCase()}`);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.bootScreen}>
        <StatusBar style="light" />
        <View style={styles.bootMark}><Text style={styles.bootMarkText}>W</Text></View>
        <Text style={styles.bootTitle}>WAYFARER</Text>
        <Text style={styles.bootSubtitle}>TRADE THE CITY · CHART THE UNKNOWN</Text>
        <ActivityIndicator color={COLORS.accent} size="small" style={styles.bootSpinner} />
        <Text style={styles.bootStatus}>{locationStatus}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.appHeader}>
        <Text style={styles.appTitle}>WAYFARER</Text>
        <Text style={styles.gpsText}>
          {mode === "training" ? "Training" : locationStatus}
        </Text>
      </View>
      <ScrollView
        key={tab}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {tab === "bridge" && (
          <>
            <FlightScene
              vista={berthed ? "docked" : "flight"}
              callsign={selectedPort.callsign}
              title={mode === "live" && !pilotPort ? "North Coast Live" : selectedPort.name}
              status={mode === "live"
                ? pilotPort ? pilotPort.countyName + " · GEOID " + pilotPort.geoid : "Humboldt and Del Norte counties"
                : [selectedPort.callsign, trainingArea?.kind === "inside" ? trainingArea.port.name : selectedCounty, berthed ? "Docked" : "Approach · " + formatDistance(selectedDistance)]
                  .filter(Boolean).join(" · ")}
            >
              {berthed ? (
                <Button label="Enter station market" onPress={() => {
                  setStationPanel("contracts");
                  setTab("market");
                }} />
              ) : mode === "training" ? (
                <Button label="Simulate approach" accessibilityLabel={"Simulate approach to " + selectedPort.name}
                  onPress={simulateQualification} disabled={contractSaving} />
              ) : (
                <Button label={liveRequested ? "Retry Live navigation" : "Start live navigation"} onPress={() => {
                  setLiveRequested(true);
                  setLiveStartAttempt((attempt) => attempt + 1);
                }} />
              )}
            </FlightScene>
            <View style={styles.pageBody}>
              <View style={styles.statusBar}>
                <Stat label="Credits" value={game.player.credits + " CR"} />
                <Stat label="Cargo" value={usedCargo + "/" + game.player.cargoCapacity} />
                <Stat label="Hull" value={game.player.hull + "/" + game.player.maxHull}
                  warning={game.player.hull < game.player.maxHull} />
              </View>
              {mode === "live" && liveRequested && <Button label="Pause Live navigation"
                onPress={() => setLiveRequested(false)} tone="ghost" />}
              {!berthed && mode === "training" && <Text style={styles.receiptLine}>
                Training advances the 10-minute docking check without using GPS.
              </Text>}
              <View style={styles.trainingRow}>
                <View style={styles.flexOne}>
                  <Text style={styles.trainingTitle}>Training simulator</Text>
                  <Text style={styles.trainingCopy}>Training starts offline. Live navigation requires a separate action.</Text>
                </View>
                <Switch accessibilityLabel="Training simulator" disabled={contractSaving}
                  onValueChange={(enabled) => {
                    if (contractSavingRef.current) return;
                    if (enabled) setLiveRequested(false);
                    setMode(enabled ? "training" : "live");
                    setNotice(enabled ? "TRAINING CAMPAIGN ACTIVE · LIVE PROGRESS UNCHANGED" : "LIVE CAMPAIGN ACTIVE");
                  }}
                  thumbColor={mode === "training" ? COLORS.accent : COLORS.muted}
                  trackColor={{ false: COLORS.line, true: COLORS.frame }} value={mode === "training"} />
              </View>
              {mode === "live" && <Text style={styles.testContentNoticeText}>
                Live is a foreground pilot in Humboldt and Del Norte counties. Your subdivision opens its market. Follow local travel rules.
              </Text>}
            </View>
          </>
        )}

        {tab === "chart" && mode === "live" && (
          <View style={styles.pageBody}>
            <SectionHeader title="North Coast Live ports" />
            <Text style={styles.receiptLine}>TIGER/Line 2025 · 10 Census county subdivisions · foreground pilot</Text>
            <Text style={styles.receiptLine}>A fresh, accurate fix within a subdivision opens its market. Access pauses near unclear boundaries.</Text>
            <LiveSubdivisionChart currentGeoid={pilotPort?.geoid} />
            {PILOT_PORTS.map((port) => (
              <View key={port.geoid} style={styles.portListRow}>
                <Text style={styles.commodityName}>{port.name}{pilotPort?.geoid === port.geoid ? " · Present" : ""}</Text>
                <Text style={styles.commodityMeta}>{port.countyName} · GEOID {port.geoid}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "chart" && mode === "training" && (
          <View style={styles.pageBody}>
            <SectionHeader title={regionalTraining ? "North Coast chart" : "Plot a course"} />
            {regionalTraining ? (
              <>
                <Text style={styles.receiptLine}>Humboldt and Del Norte counties · California</Text>
                <Text style={styles.receiptLine}>Training scenarios use simulated docking. In Live, each Census subdivision is one port.</Text>
                <TerritoryChart ports={game.ports} ship={position} selectedPort={selectedPort} />
              </>
            ) : (
              <>
                <Text style={styles.receiptLine}>Select a starport to return to the bridge on its approach.</Text>
                <StarChart game={game} position={position} selectedPortId={selectedPort.id}
                  onSelect={plotCourse} size={radarSize} />
              </>
            )}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPortList }}
              onPress={() => setShowPortList((shown) => !shown)} style={styles.portListRow}>
              <Text style={styles.commodityName}>Scenario list · {game.discoveredPortIds.length} of {game.ports.length} visited</Text>
            </Pressable>
            {showPortList && game.ports.map((port) => {
              const visited = game.discoveredPortIds.includes(port.id);
              const range = formatDistance(distanceMeters(position, port.position));
              const selected = selectedPort.id === port.id;
              const area = regionalTraining ? locateSubdivision(port.position, 0) : null;
              const county = regionalTraining ? territoryAt(port.position) : null;
              const description = [visited ? "visited" : "unvisited", county?.name,
                area?.kind === "inside" ? area.port.name : null, range].filter(Boolean);
              return (
                <Pressable accessibilityRole="button" accessibilityState={{ selected }}
                  accessibilityLabel={["Select " + port.name, ...description].join(", ")}
                  key={port.id} onPress={() => plotCourse(port.id)} style={styles.portListRow}>
                  <Text style={[styles.commodityName, selected && styles.limeText]}>{port.name}</Text>
                  <Text style={styles.commodityMeta}>{description.join(" · ")}</Text>
                </Pressable>
              );
            })}
            <View style={styles.testContentNotice}>
              <Text style={styles.testContentNoticeText}>
                Training scenarios are fictional. Only official subdivisions are Live ports.
              </Text>
              <Text style={styles.testContentNoticeText}>
                {regionalTraining
                  ? "County outlines are approximate. Training stations are fictional. Do not travel to these points."
                  : "This legacy Training chart shows simulated scenarios. Do not travel to these points."}
              </Text>
            </View>
            <SectionHeader title="Market transmissions" />
            {getRumors(game, selectedPort.id).slice(0, 3).map((rumor) => (
              <View key={rumor.commodityId} style={styles.rumorRow}>
                <Text style={styles.rumorText}>{rumorSummary(rumor.commodityName, rumor.band)}</Text>
                <BandPill band={rumor.band} />
              </View>
            ))}
            {game.ports.slice(1, 4).map((port) => {
              const rumors = getRumors(game, port.id);
              const signal = rumors.find((rumor) => rumor.band !== "steady") ?? rumors[0];
              return (
                <Pressable accessibilityRole="button" key={port.id} onPress={() => plotCourse(port.id)}
                  accessibilityLabel={port.name + ", " + rumorSummary(signal.commodityName, signal.band)}
                  style={styles.newsRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.commodityName}>{port.name}</Text>
                    <Text style={styles.rumorText}>{rumorSummary(signal.commodityName, signal.band)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {tab === "market" && (
          <>
            {dockedPort && <FlightScene vista="market" title={dockedPort.name}
              status={"Concourse · " + game.player.credits + " CR available"} />}
            <View style={styles.pageBody}>
              {dockedPort ? (
                <View style={styles.counterChoices}>
                  {mode === "training" && <Button compact label="Contract desk" accessibilityLabel="Open contract desk"
                    selected={stationPanel === "contracts"}
                    tone={stationPanel === "contracts" ? "lime" : "ghost"}
                    onPress={() => setStationPanel("contracts")} />}
                  <Button compact label="Trade counter" accessibilityLabel="Open trade counter"
                    selected={mode === "live" || stationPanel === "trade"}
                    tone={mode === "live" || stationPanel === "trade" ? "lime" : "ghost"}
                    onPress={() => setStationPanel("trade")} />
                </View>
              ) : (
                <>
                  <SectionHeader title={mode === "training" ? "Contract log" : "Live market"} />
                  <Text style={styles.emptyTitle}>Market encrypted</Text>
                  <Text style={styles.emptyCopy}>{mode === "training" ? "Complete simulated docking qualification to access prices." : "Confirm your location within a pilot subdivision to access its market."}</Text>
                  <Button label="Return to bridge" onPress={() => setTab("bridge")} tone="ghost" />
                </>
              )}
              {mode === "training" && (!dockedPort || stationPanel === "contracts") && (
                <CargoContract game={game} dockedPortId={dockedPort?.id} saving={contractSaving}
                  onAccept={() => { void saveContract(acceptDelivery, "Contract accepted. Buy Ion Fuel at Wayfarer Freeport."); }}
                  onDeliver={() => { void saveContract(completeDelivery, "Delivery complete. Received " + DELIVERY.reward + " cr."); }} />
              )}
              {(mode === "live" || !dockedPort || stationPanel === "trade") && (
                <LastTrade game={game} onUpgrades={() => setTab("ship")} />
              )}
              {dockedPort && (mode === "live" || stationPanel === "trade") && (
                <View style={styles.marketPanel}>
                  <SectionHeader title="Trade counter" />
                  {dockedPort.market.map((quote) => (
                    <MarketRow key={mode + "-" + dockedPort.id + "-" + quote.commodityId}
                      game={game} onOrder={(side, quantity) => executeTrade(quote, side, quantity)} quote={quote} />
                  ))}
                  <Text style={styles.spreadNote}>Station prices are local to this save.</Text>
                </View>
              )}
            </View>
          </>
        )}

        {tab === "ship" && (
          <>
            <FlightScene vista="cargo" title="The Wayward" status="Cargo hold · Registry WFR-731" />
            <View style={styles.pageBody}>
              <View style={styles.statusBar}>
                <Stat label="Credits" value={game.player.credits + " CR"} />
                <Stat label="Hull integrity" value={game.player.hull + "/" + game.player.maxHull} />
                <Stat label="Hold capacity" value={usedCargo + "/" + game.player.cargoCapacity} />
              </View>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stowage}>
                {Array.from({ length: Math.min(12, game.player.cargoCapacity) }, (_, index) =>
                  <View key={index} style={[styles.stowageSlot, index < usedCargo && styles.stowageOccupied]} />)}
              </View>
              <SectionHeader title="Shipyard upgrades" />
              {([
                ["cargo", "Install expanded cargo pods", "+4 cargo capacity"],
                ["hull", "Install reactive hull plating", "+1 hull integrity"],
              ] as const).map(([id, label, benefit]) => {
                const cost = UPGRADE_COST[id];
                const shortfall = cost - game.player.credits;
                return (
                  <View key={id} style={styles.upgradeCard}>
                    <View style={styles.flexOne}>
                      <Text style={styles.upgradeTitle}>{label}</Text>
                      <Text style={styles.upgradeCopy}>{benefit} · {cost} cr</Text>
                      {shortfall > 0 && <Text style={styles.upgradeCopy}>{shortfall} cr short</Text>}
                    </View>
                    <Button compact disabled={shortfall > 0 || (mode === "live" && !dockedPort)} label="Install"
                      accessibilityLabel={`${label}, ${cost} credits`}
                      onPress={() => mutate(
                        (current) => buyUpgrade(current, id),
                        id === "cargo" ? "CARGO PODS INSTALLED · 4 SLOTS ADDED" : "HULL PLATING INSTALLED",
                      )} />
                  </View>
                );
              })}
              <SectionHeader title="Cargo manifest" />
              <View style={styles.panel}>
                {COMMODITIES.map((commodity) => {
                  const quantity = game.player.cargo[commodity.id] ?? 0;
                  return (
                    <View key={commodity.id} style={styles.manifestRow}>
                      <Text style={styles.manifestSymbol}>{commodity.symbol}</Text>
                      <Text style={styles.manifestName}>{commodity.name}</Text>
                      <Text style={[styles.manifestQuantity, quantity > 0 && styles.limeText]}>{quantity} U</Text>
                    </View>
                  );
                })}
              </View>

              <SectionHeader title="Local game data" />
              <View style={styles.receipt}>
                <Text style={styles.receiptLine}>
                  Live and Training have separate local saves for ship, cargo, markets, visits, contract and the last receipt.
                  Live saves include visited subdivision IDs and local trade progress. Precise fixes stay in memory.
                  Older Live progress is retained separately, with ship, credits and cargo carried forward.
                  Training scenarios and older Training maps keep their separate save.
                </Text>
                <Text style={styles.receiptLine}>Android manages app permissions and system backups separately.</Text>
                <Button label={`Reset ${mode === "live" ? "Live" : "Training"} game data`}
                  disabled={contractSaving} onPress={() => setResetMode(mode)} tone="ghost" />
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <View accessibilityLiveRegion="polite" style={styles.noticeBar}>
        <Text style={styles.noticeText}>{notice}</Text>
      </View>
      <View style={styles.tabBar}>
        {([
          ["bridge", "Bridge"],
          ["chart", "Chart"],
          ["market", "Station"],
          ["ship", "Hold"],
        ] as const).map(([key, label]) => (
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
            key={key} onPress={() => {
              setTab(key);
              void Haptics.selectionAsync();
            }}
            style={[styles.tab, tab === key && styles.tabActive]}>
            <Text style={[styles.tabLabel, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={resetMode !== null} transparent onRequestClose={() => { if (!resetting) setResetMode(null); }}>
        <ScrollView contentContainerStyle={styles.modalScrim}>
          <View style={styles.encounterCard} accessibilityViewIsModal>
            <Text style={styles.receiptTitle} accessibilityRole="header">
              {resetMode === "live" ? "Reset Live game data?" : "Reset Training game data?"}
            </Text>
            <Text style={styles.receiptLine}>
              {resetMode === "live"
                ? "This permanently removes Live progress, coordinates and docking data from the app. Your Training save is kept."
                : "This permanently removes Training progress and its saved coordinates from the app. Your Live save is kept."}
            </Text>
            <Button label="Cancel" disabled={resetting} tone="ghost" onPress={() => setResetMode(null)} />
            <Button label={resetMode === "live" ? "Confirm Live reset" : "Confirm Training reset"}
              disabled={resetting} tone="danger" onPress={() => { void resetCampaign(); }} />
          </View>
        </ScrollView>
      </Modal>
      <EncounterModal game={game} onResolve={handleEncounter} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pageBody: { paddingHorizontal: 20, gap: 4 },
  counterChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 13 },
  scroll: { flex: 1 },
  stowage: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 16 },
  stowageSlot: { width: 17, height: 19, borderWidth: 1, borderColor: COLORS.frame, borderRadius: 2 },
  stowageOccupied: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  scopeLabel: { position: "absolute", left: 8, top: 7, fontSize: 10, color: COLORS.muted },
  scopeStar: { position: "absolute", width: 2, height: 2, backgroundColor: "#91afc8", borderRadius: 1 },
  scopeVector: { position: "absolute", height: 1, backgroundColor: "#ac855c" },
  shipPointer: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 15, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: COLORS.signal },
  contract: { backgroundColor: COLORS.contract, borderStyle: "dashed", borderColor: "#80664e" },
  contractHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
  contractReward: { color: COLORS.accent, fontSize: 12, fontVariant: ["tabular-nums"] },
  flexOne: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: COLORS.void },
  bootScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.void, padding: 28 },
  bootMark: { width: 68, height: 68, borderWidth: 1, borderColor: COLORS.accent, alignItems: "center", justifyContent: "center", transform: [{ rotate: "45deg" }] },
  bootMarkText: { color: COLORS.accent, fontWeight: "900", fontSize: 30, transform: [{ rotate: "-45deg" }] },
  bootTitle: { color: COLORS.text, fontWeight: "900", fontSize: 40, letterSpacing: -2, marginTop: 36 },
  bootSubtitle: { color: COLORS.muted, fontSize: 10, letterSpacing: 2, marginTop: 8, textAlign: "center" },
  bootSpinner: { marginTop: 54 },
  bootStatus: { color: COLORS.accent, fontSize: 10, letterSpacing: 1.5, marginTop: 16 },
  appHeader: { width: "100%", maxWidth: 680, alignSelf: "center", minHeight: 50, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 7, paddingHorizontal: 20, paddingVertical: 9 },
  appTitle: { color: COLORS.text, fontSize: 19, letterSpacing: 2.2, fontWeight: "900" },
  gpsText: { color: COLORS.signal, flexShrink: 1, fontSize: 13, fontWeight: "700" },
  statusBar: { flexDirection: "row", flexWrap: "wrap", borderBottomWidth: 1, borderColor: COLORS.line, marginBottom: 12 },
  stat: { flex: 1, minWidth: 86, paddingVertical: 8, paddingRight: 9 },
  statLabel: { color: COLORS.muted, fontSize: 12 },
  statValue: { color: COLORS.text, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "800", marginTop: 3 },
  warning: { color: COLORS.alert },
  noticeBar: { paddingHorizontal: 20, paddingVertical: 8, borderTopWidth: 1, borderColor: COLORS.line },
  noticeText: { color: COLORS.signal, fontSize: 12, lineHeight: 17 },
  testContentNotice: { paddingVertical: 12, gap: 5 },
  testContentNoticeText: { color: COLORS.text, fontSize: 12, lineHeight: 18 },
  scrollContent: { width: "100%", maxWidth: 680, alignSelf: "center", paddingBottom: 22 },
  sectionTitle: { color: COLORS.text, fontFamily: "serif", fontSize: 25, fontWeight: "700", marginTop: 8, marginBottom: 8 },
  panel: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 12, marginBottom: 16 },
  radar: { alignSelf: "center", overflow: "hidden", backgroundColor: COLORS.deep, borderWidth: 1, borderColor: COLORS.line, marginTop: 12, marginBottom: 12 },
  radarRing: { position: "absolute", left: "50%", top: "50%", borderRadius: 999, borderWidth: 1, borderColor: "#466178" },
  radarAxisHorizontal: { position: "absolute", top: "50%", left: 12, right: 12, height: 1, backgroundColor: "#31465b" },
  radarAxisVertical: { position: "absolute", left: "50%", top: 12, bottom: 12, width: 1, backgroundColor: "#31465b" },
  shipMarker: { position: "absolute", zIndex: 2, width: 24, height: 24, marginLeft: -12, marginTop: -12, alignItems: "center", justifyContent: "center" },
  portNode: { position: "absolute", zIndex: 3, width: 56, minHeight: 48, alignItems: "center", justifyContent: "center" },
  portDiamond: { width: 10, height: 10, borderWidth: 1, borderColor: COLORS.signal, backgroundColor: COLORS.deep, transform: [{ rotate: "45deg" }] },
  portDiamondVisited: { backgroundColor: COLORS.signal },
  portDiamondSelected: { width: 13, height: 13, borderColor: COLORS.accent, backgroundColor: COLORS.accent },
  portNodeLabel: { color: COLORS.muted, backgroundColor: COLORS.deep, fontSize: 10, marginTop: 5, fontWeight: "700" },
  portNodeLabelSelected: { color: COLORS.accent },
  limeText: { color: COLORS.accent },
  rumorRow: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 8 },
  rumorText: { flexShrink: 1, color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  band: { borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 7, paddingVertical: 4 },
  bandCheap: { borderColor: COLORS.frame, backgroundColor: "#172a36" },
  bandExpensive: { borderColor: "#8a5050", backgroundColor: "#281e28" },
  bandText: { color: COLORS.text, fontSize: 11, fontWeight: "800" },
  trainingRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, marginTop: 12 },
  trainingTitle: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
  trainingCopy: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  button: { minHeight: 50, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 8, marginTop: 8 },
  buttonCompact: { minHeight: 48, paddingHorizontal: 10, marginTop: 0 },
  buttonLime: { backgroundColor: COLORS.accent },
  buttonGhost: { backgroundColor: "transparent", borderColor: COLORS.line },
  buttonDanger: { backgroundColor: COLORS.alert, borderColor: COLORS.alert },
  buttonDisabled: { backgroundColor: "transparent", borderColor: COLORS.line, opacity: .78 },
  buttonPressed: { opacity: .82 },
  buttonLabel: { color: COLORS.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
  buttonLabelDark: { color: COLORS.void },
  newsRow: { minHeight: 61, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line, gap: 11 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: "800" },
  emptyCopy: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  marketPanel: { paddingBottom: 10 },
  marketRow: { borderTopWidth: 1, borderColor: COLORS.line, gap: 8, paddingVertical: 12 },
  commodityIdentity: { flex: 1.25, flexDirection: "row", alignItems: "center", gap: 8 },
  commodityBadge: { width: 30, height: 30, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center" },
  commodityBadgeText: { color: COLORS.accent, fontSize: 8, fontWeight: "900" },
  commodityName: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  commodityMeta: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  tradeButtons: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 8 },
  orderQuantity: { minWidth: 54, minHeight: 48, color: COLORS.text, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 8 },
  portListRow: { minHeight: 48, justifyContent: "center", borderTopWidth: 1, borderColor: COLORS.line, paddingVertical: 8 },
  receipt: { gap: 7, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel },
  receiptTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800" },
  receiptLine: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  spreadNote: { color: COLORS.muted, fontSize: 12, marginTop: 10 },
  manifestRow: { minHeight: 48, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line, gap: 8 },
  manifestSymbol: { width: 36, color: COLORS.accent, fontSize: 9, fontWeight: "900" },
  manifestName: { flex: 1, color: COLORS.text, fontSize: 14 },
  manifestQuantity: { color: COLORS.muted, fontSize: 13, fontWeight: "800" },
  upgradeCard: { borderTopWidth: 1, borderColor: COLORS.line, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  upgradeTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  upgradeCopy: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
  tabBar: { minHeight: 56, flexDirection: "row", borderTopWidth: 1, borderColor: COLORS.line, gap: 8, paddingHorizontal: 8 },
  tab: { flex: 1, minHeight: 48, paddingVertical: 8, alignItems: "center", justifyContent: "center", borderTopWidth: 2, borderTopColor: "transparent" },
  tabActive: { borderTopColor: COLORS.accent, backgroundColor: COLORS.panel },
  tabLabel: { color: COLORS.muted, fontSize: 13, textAlign: "center", fontWeight: "700" },
  tabTextActive: { color: COLORS.accent },
  modalScrim: { flexGrow: 1, justifyContent: "center", padding: 22, backgroundColor: "rgba(0,0,0,.78)" },
  encounterCard: { borderWidth: 2, borderColor: COLORS.alert, backgroundColor: COLORS.panel, padding: 22 },
  alertCode: { color: COLORS.alert, fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  encounterTitle: { color: COLORS.text, fontSize: 30, fontWeight: "900", marginTop: 5 },
  encounterCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
  encounterActions: { marginTop: 16 },
});
