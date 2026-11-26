import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import {
  COMMODITIES,
  DELIVERY,
  acceptDelivery,
  completeDelivery,
  deliveryRoute,
  UPGRADE_COST,
  buyUpgrade,
  createGame,
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
import {
  armSelectedPortGeofence,
  armSelectedPortWithForegroundFallback,
  disarmSelectedPortGeofence,
  getBackgroundLocationStatus,
  requestBackgroundLocationPermissions,
  subscribeToBackgroundLocationSamples,
  type LocationSample,
} from "./src/location";
import { requestAndroidNotificationPermission } from "./src/location/notificationPermission";
import {
  LEGACY_STORAGE_KEY,
  LIVE_RESET_MARKER,
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
  repairDockingCoordinatorForGame,
  selectDockingTarget,
  type DockingCoordinator,
} from "./src/ui/dockingCoordinator";
import {
  acknowledgePersistedDockingProof,
  clearPersistedDockingCoordinator,
  loadPersistedDockingCoordinator,
  pausePersistedDockingCoordinator,
  persistDockingCoordinator,
  persistSelectedDockingTarget,
  processPersistedBackgroundSamples,
  processPersistedForegroundSamples,
  subscribeToDockingCoordinator,
} from "./src/ui/dockingSessionStore";
import {
  BackgroundPermissionModal,
  DockingStatusCard,
} from "./src/ui/DockingStatusCard";

import { COCKPIT as COLORS } from "./src/ui/cockpitTheme";

const DEMO_ORIGIN: Coordinates = { latitude: 39.7392, longitude: -104.9903 };

async function clearLiveDockingData() {
  await Promise.all([
    clearPersistedDockingCoordinator(),
    AsyncStorage.removeItem(LEGACY_STORAGE_KEY),
  ]);
  const background = await getBackgroundLocationStatus();
  // Queue disarm even if a previously requested registration is still pending.
  if (background.available) await disarmSelectedPortGeofence();
}
const SCOPE_STARS = [[9,18], [28,14], [43,34], [64,12], [89,17], [91,57], [72,63], [18,78], [51,85], [88,88]];

type Tab = "chart" | "market" | "ship";

function Button({
  label,
  accessibilityLabel = label,
  onPress,
  disabled = false,
  tone = "lime",
  compact = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "lime" | "ghost" | "danger";
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
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

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
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
            hitSlop={10}
            style={[
              styles.portNode,
              {
                left: `${point.x}%`,
                top: `${point.y}%`,
                transform: [{ translateX: -28 }, { translateY: -22 }],
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
    <Modal transparent visible>
      <View style={styles.modalScrim}>
        <View style={styles.encounterCard}>
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
      </View>
    </Modal>
  );
}

function toLocationSample(location: Location.LocationObject): LocationSample {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    horizontalAccuracyMeters: location.coords.accuracy,
    altitudeMeters: location.coords.altitude,
    verticalAccuracyMeters: location.coords.altitudeAccuracy,
    headingDegrees: location.coords.heading,
    speedMetersPerSecond: location.coords.speed,
    recordedAtMs: location.timestamp,
    isMocked: location.mocked === true,
  };
}

async function requestBackgroundNotificationAccess() {
  const androidApiLevel = typeof Platform.Version === "number"
    ? Platform.Version
    : Number.parseInt(String(Platform.Version), 10);
  return requestAndroidNotificationPermission({
    platform: Platform.OS,
    apiLevel: Number.isFinite(androidApiLevel) ? androidApiLevel : 0,
    checkPostNotifications: () => PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    ),
    requestPostNotifications: () => PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    ),
  });
}

export default function App() {
  const { width } = useWindowDimensions();
  const initialCampaigns = useMemo<Campaigns>(() => ({
    live: createGame({ origin: DEMO_ORIGIN, seed: "wayfarer-mobile-live-v2" }),
    training: createGame({ origin: DEMO_ORIGIN, seed: "wayfarer-mobile-training-v2" }),
  }), []);
  const [campaigns, setCampaigns] = useState<Campaigns>(initialCampaigns);
  const [mode, setMode] = useState<CampaignMode>("live");
  const [positions, setPositions] = useState<Record<CampaignMode, Coordinates>>({
    live: DEMO_ORIGIN,
    training: DEMO_ORIGIN,
  });
  const [selectedPortIds, setSelectedPortIds] = useState<Record<CampaignMode, string>>({
    live: "port-0",
    training: "port-0",
  });
  const [coordinators, setCoordinators] = useState<Record<CampaignMode, DockingCoordinator>>({
    live: createDockingCoordinator({ id: "port-0", coords: DEMO_ORIGIN }),
    training: createDockingCoordinator({ id: "port-0", coords: DEMO_ORIGIN }),
  });
  const [tab, setTab] = useState<Tab>("chart");
  const [showPortList, setShowPortList] = useState(false);
  const [booting, setBooting] = useState(true);
  const [saveReady, setSaveReady] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const livePausedRef = useRef(false);
  const [liveStartAttempt, setLiveStartAttempt] = useState(0);
  const [resetMode, setResetMode] = useState<CampaignMode | null>(null);
  const [resetting, setResetting] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);
  const contractSavingRef = useRef(false);
  const liveProofWrites = useRef(0);
  const deferredCoordinator = useRef<DockingCoordinator | null>(null);
  const resetInProgress = useRef(false);
  const emptyTrainingSave = useRef<GameState | null>(null);
  const [foregroundOnly, setForegroundOnly] = useState(true);
  const [showBackgroundExplanation, setShowBackgroundExplanation] = useState(false);
  const [locationStatus, setLocationStatus] = useState("ACQUIRING NAV SIGNAL");
  const [notice, setNotice] = useState("WELCOME, CAPTAIN");
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const campaignsRef = useRef(campaigns);
  const selectedPortIdsRef = useRef(selectedPortIds);
  const liveSaveQueue = useRef(createLatestWriteQueue<GameState | null>(async (snapshot) => {
    if (snapshot) {
      await AsyncStorage.setItem(storageKeyForMode("live"), encodeGameState(snapshot));
    } else {
      // Mark Live as paused before removing the old coordinate-bearing data.
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
  const selectedPortId = selectedPortIds[mode];
  const coordinator = coordinators[mode];

  const selectedPort = useMemo(
    () => game.ports.find((port) => port.id === selectedPortId) ?? game.ports[0],
    [game.ports, selectedPortId],
  );
  const dockedPort = activeDockedPort(game, coordinator);
  const selectedDistance = distanceMeters(position, selectedPort.position);
  const usedCargo = cargoUnits(game.player.cargo);
  const radarSize = Math.min(width - 32, 390);
  const liveSession = coordinators.live.session;
  const liveAuthorizedSession = coordinators.live.authorizedDock?.session;
  const livePausedAt = liveAuthorizedSession?.pausedAt ?? liveSession.pausedAt;
  const liveSessionActiveAt = liveSession.pausedAt === null ? liveSession.lastValidAt : null;
  const liveAuthorizedActiveAt = liveAuthorizedSession?.pausedAt === null
    ? liveAuthorizedSession.lastValidAt
    : null;

  useEffect(() => { campaignsRef.current = campaigns; }, [campaigns]);
  useEffect(() => { selectedPortIdsRef.current = selectedPortIds; }, [selectedPortIds]);

  useEffect(() => {
    if (livePausedAt === null) return;
    const delay = Math.max(0, livePausedAt + 30_001 - Date.now());
    const timeout = setTimeout(() => { void pausePersistedDockingCoordinator(); }, delay);
    return () => clearTimeout(timeout);
  }, [livePausedAt]);

  useEffect(() => {
    const activeTimestamps = [liveSessionActiveAt, liveAuthorizedActiveAt]
      .filter((timestamp): timestamp is number => timestamp !== null && timestamp !== undefined);
    if (activeTimestamps.length === 0) return;
    const oldest = Math.min(...activeTimestamps);
    const delay = Math.max(0, oldest + 30_001 - Date.now());
    const timeout = setTimeout(() => { void pausePersistedDockingCoordinator(); }, delay);
    return () => clearTimeout(timeout);
  }, [liveAuthorizedActiveAt, liveSessionActiveAt]);

  const processLiveCoordinator = useEffectEvent(async (
    next: DockingCoordinator,
    gameSnapshot = campaignsRef.current.live,
  ) => {
    if (livePausedRef.current) return;
    if (contractSavingRef.current) {
      deferredCoordinator.current = next;
      return;
    }
    const transition = resolveCoordinatorTransition(gameSnapshot, next);
    if (transition.proofId === null) {
      setCoordinators((current) => ({ ...current, live: transition.coordinator }));
      if (transition.game !== gameSnapshot) {
        setCampaigns((current) => current.live === gameSnapshot
          ? { ...current, live: transition.game }
          : current);
        setNotice("DEPARTED · DOCKING LINK REVOKED");
      }
      return;
    }

    liveProofWrites.current += 1;
    try {
      // The game must reach durable storage first. A crash before proof
      // acknowledgment leaves an unconsumed coordinator proof that can replay.
      await liveSaveQueue.current.writeThrough(transition.game);
      if (livePausedRef.current) return;
      setCampaigns((current) => current.live === gameSnapshot
        ? { ...current, live: transition.game }
        : current);
      const acknowledged = await acknowledgePersistedDockingProof(transition.proofId);
      if (!acknowledged) return;
      setNotice(transition.game.dockedPortId
        ? "DOCKING PROOF ACCEPTED"
        : "DEPARTED · DOCKING LINK REVOKED");
    } catch {
      setNotice("SAVE FAILED · DOCKING PROOF RETAINED");
    } finally {
      liveProofWrites.current -= 1;
    }
  });

  useEffect(() => {
    if (contractSaving || !deferredCoordinator.current) return;
    const next = deferredCoordinator.current;
    deferredCoordinator.current = null;
    void processLiveCoordinator(next);
  }, [contractSaving]);

  useEffect(() => subscribeToDockingCoordinator((next) => {
    void processLiveCoordinator(next);
  }), []);

  useEffect(() => subscribeToBackgroundLocationSamples((sample) => {
    if (livePausedRef.current) return;
    setPositions((current) => ({
      ...current,
      live: { latitude: sample.latitude, longitude: sample.longitude },
    }));
    setLocationStatus(`BACKGROUND FIX · ±${Math.round(sample.horizontalAccuracyMeters ?? 0)} M`);
  }), []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || booting || livePausedRef.current) return;
      void getBackgroundLocationStatus()
        .then((status) => {
          if (livePausedRef.current) return;
          if (!status.available) {
            setForegroundOnly(true);
            setNotice("BACKGROUND TASKS UNAVAILABLE · FOREGROUND ONLY");
            return;
          }
          const foregroundGranted = status.permissions.foreground === "granted";
          const backgroundGranted = status.permissions.background === "granted";
          setForegroundOnly(!backgroundGranted);
          if (!foregroundGranted) {
            locationSubscription.current?.remove();
            locationSubscription.current = null;
            setLocationStatus("GPS PERMISSION REVOKED");
            setNotice("LOCATION REVOKED · QUALIFICATION PAUSED");
            void pausePersistedDockingCoordinator();
          } else if (!backgroundGranted) {
            setNotice("BACKGROUND PERMISSION DENIED · FOREGROUND ONLY");
          }
        })
        .catch(() => setForegroundOnly(true));
    });
    return () => subscription.remove();
  }, [booting]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      let live: GameState | null = null;
      let training: GameState | null = null;
      let resetPending = false;
      try {
        const [liveRaw, trainingRaw, legacyRaw] = await Promise.all([
          AsyncStorage.getItem(storageKeyForMode("live")),
          AsyncStorage.getItem(storageKeyForMode("training")),
          AsyncStorage.getItem(LEGACY_STORAGE_KEY),
        ]);
        resetPending = liveRaw === LIVE_RESET_MARKER;
        live = resetPending ? null : decodeGameState(liveRaw ?? legacyRaw);
        training = decodeGameState(trainingRaw);
      } catch {
        // Corrupt or unavailable saves start isolated local campaigns.
      }

      const keepLivePaused = () => {
        const nextTraining = training ?? initialCampaigns.training;
        setCampaigns({ live: initialCampaigns.live, training: nextTraining });
        setPositions({ live: DEMO_ORIGIN, training: nextTraining.origin });
        setLocationStatus("LIVE NAVIGATION PAUSED");
        setSaveReady(true);
        setBooting(false);
      };
      if (resetPending) {
        livePausedRef.current = true;
        setLivePaused(true);
        try {
          await clearLiveDockingData();
        } catch {
          if (!cancelled) {
            keepLivePaused();
            setNotice("LIVE CLEANUP INCOMPLETE · TRY RESET AGAIN");
          }
          return;
        }
        if (cancelled) return;
        if (liveStartAttempt === 0) {
          keepLivePaused();
          return;
        }
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission.status !== "granted" && resetPending) {
        keepLivePaused();
        setNotice("LOCATION DENIED · LIVE NAVIGATION REMAINS PAUSED");
        return;
      }
      if (permission.status !== "granted") {
        const nextLive = live ?? createGame({ origin: DEMO_ORIGIN, seed: "wayfarer-mobile-live-v2" });
        const nextTraining = training ?? initialCampaigns.training;
        setCampaigns({ live: nextLive, training: nextTraining });
        setPositions({ live: nextLive.origin, training: nextTraining.origin });
        setMode("training");
        setLocationStatus("GPS DENIED · FOREGROUND UNAVAILABLE");
        setNotice("ENABLE LOCATION FOR REAL-WORLD DOCKING");
        setSaveReady(true);
        setBooting(false);
        return;
      }

      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const coordinates = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
        const nextLive = live ?? createGame({ origin: coordinates, seed: "wayfarer-mobile-live-v2" });
        const nextTraining = training ?? initialCampaigns.training;
        // A foreground process restart is a discontinuity: pause first so the
        // next fix can recover, but never earns the unobserved wall-clock gap.
        const persisted = await pausePersistedDockingCoordinator()
          ?? await loadPersistedDockingCoordinator();
        const repaired = persisted ? repairDockingCoordinatorForGame(nextLive, persisted) : null;
        const persistedPort = repaired
          ? nextLive.ports.find((port) => port.id === repaired.target.id)
          : null;
        const liveTargetPort = persistedPort ?? nextLive.ports[0];
        const liveCoordinator = persistedPort && repaired
          ? { ...repaired, target: { id: persistedPort.id, coords: persistedPort.position } }
          : createDockingCoordinator({ id: liveTargetPort.id, coords: liveTargetPort.position });
        const trainingTarget = nextTraining.ports[0];

        const nextCampaigns = { live: nextLive, training: nextTraining };
        const nextPortIds = { live: liveTargetPort.id, training: trainingTarget.id };
        campaignsRef.current = nextCampaigns;
        selectedPortIdsRef.current = nextPortIds;
        setCampaigns(nextCampaigns);
        setPositions({ live: coordinates, training: nextTraining.origin });
        setSelectedPortIds(nextPortIds);
        setCoordinators({
          live: liveCoordinator,
          training: createDockingCoordinator({ id: trainingTarget.id, coords: trainingTarget.position }),
        });
        await persistDockingCoordinator(liveCoordinator);
        if (resetPending) {
          await liveSaveQueue.current.writeThrough(nextLive);
          livePausedRef.current = false;
          setLivePaused(false);
        }
        setLocationStatus(`GPS LOCK · ±${Math.round(current.coords.accuracy ?? 0)} M`);

        let backgroundGranted = false;
        try {
          const backgroundStatus = await getBackgroundLocationStatus();
          backgroundGranted = backgroundStatus.permissions.background === "granted";
        } catch {
          backgroundGranted = false;
        }
        const notificationPermission = backgroundGranted
          ? await requestBackgroundNotificationAccess()
          : "not-required";
        if (cancelled) return;
        let backgroundMode: "background" | "foreground-only" = backgroundGranted
          ? "background"
          : "foreground-only";
        if (backgroundGranted) {
          backgroundMode = await armSelectedPortWithForegroundFallback(armSelectedPortGeofence, {
            portId: liveTargetPort.id,
            latitude: liveTargetPort.position.latitude,
            longitude: liveTargetPort.position.longitude,
            radiusMeters: 120,
          });
          if (backgroundMode === "foreground-only") {
            setNotice("BACKGROUND ARMING UNAVAILABLE · KEEP APP OPEN");
          } else if (notificationPermission === "denied") {
            setNotice("BACKGROUND NAVIGATION ACTIVE · NOTIFICATIONS BLOCKED");
          }
        }
        setForegroundOnly(backgroundMode === "foreground-only");

        await processPersistedBackgroundSamples([toLocationSample(current)]);
        setSaveReady(true);
        setBooting(false);

        const watcher = await Location.watchPositionAsync(
          {
            // Foreground-only navigation remains playable without continuous
            // GPS. High accuracy is reserved for the geofence-triggered task.
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 10,
            timeInterval: 10_000,
          },
          (update) => {
            if (cancelled || livePausedRef.current) return;
            setPositions((positions) => ({
              ...positions,
              live: { latitude: update.coords.latitude, longitude: update.coords.longitude },
            }));
            setLocationStatus(`GPS LOCK · ±${Math.round(update.coords.accuracy ?? 0)} M`);
            void processPersistedForegroundSamples([toLocationSample(update)]);
          },
        );
        if (cancelled || livePausedRef.current) watcher.remove();
        else locationSubscription.current = watcher;
      } catch {
        if (resetPending && livePausedRef.current) {
          keepLivePaused();
          setNotice("LIVE LOCATION UNAVAILABLE · TRY AGAIN WHILE SAFELY STOPPED");
          return;
        }
        const nextLive = live ?? createGame({ origin: DEMO_ORIGIN, seed: "wayfarer-mobile-live-v2" });
        const nextTraining = training ?? initialCampaigns.training;
        setCampaigns({ live: nextLive, training: nextTraining });
        setPositions({ live: nextLive.origin, training: nextTraining.origin });
        setMode("training");
        setLocationStatus("GPS UNAVAILABLE · TRAINING ACTIVE");
        setNotice("LIVE NAVIGATION UNAVAILABLE · TRAINING CAMPAIGN IS ISOLATED");
        setSaveReady(true);
        setBooting(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
      locationSubscription.current?.remove();
    };
  }, [initialCampaigns, liveStartAttempt]);

  const liveCampaign = campaigns.live;
  const trainingCampaign = campaigns.training;
  useEffect(() => {
    if (!saveReady || livePaused || livePausedRef.current) return;
    void liveSaveQueue.current.schedule(liveCampaign)
      .catch(() => setNotice("SAVE FAILED · LIVE CAMPAIGN REMAINS IN MEMORY"));
  }, [liveCampaign, livePaused, saveReady]);

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
    if (target === "live") {
      livePausedRef.current = true;
      setLivePaused(true);
      setLocationStatus("LIVE NAVIGATION PAUSED");
      locationSubscription.current?.remove();
      locationSubscription.current = null;
    }
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
    if (resetInProgress.current || contractSavingRef.current || (mode === "live" && livePausedRef.current)) return;
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
    if (contractSavingRef.current || resetInProgress.current || !dockedPort
      || (mode === "live" && livePausedRef.current)) return;
    if (mode === "live" && liveProofWrites.current > 0) {
      setNotice("Docking is being saved. Try the contract again in a moment.");
      return;
    }
    contractSavingRef.current = true;
    setContractSaving(true);
    try {
      const current = campaignsRef.current[mode];
      if (activeDockedPort(current, coordinator)?.id !== dockedPort.id) return;
      const next = action(current);
      await (mode === "live" ? liveSaveQueue : trainingSaveQueue).current.writeThrough(next);
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

  async function selectPort(portId: string) {
    if (contractSavingRef.current) return;
    const port = game.ports.find((candidate) => candidate.id === portId);
    if (!port) return;
    setSelectedPortIds((current) => ({ ...current, [mode]: portId }));
    if (mode === "training") {
      setCoordinators((current) => ({
        ...current,
        training: selectDockingTarget(current.training, { id: port.id, coords: port.position }),
      }));
    } else {
      try {
        if (livePausedRef.current) return;
        const next = await persistSelectedDockingTarget({ id: port.id, coords: port.position });
        setCoordinators((current) => ({ ...current, live: next }));
        if (!foregroundOnly && !livePausedRef.current) {
          await armSelectedPortGeofence({
            portId: port.id,
            latitude: port.position.latitude,
            longitude: port.position.longitude,
            radiusMeters: 120,
          });
        }
      } catch {
        setForegroundOnly(true);
        setNotice("BACKGROUND ARMING UNAVAILABLE · KEEP APP OPEN");
      }
    }
    void Haptics.selectionAsync();
  }

  async function requestBackgroundAccess() {
    setShowBackgroundExplanation(false);
    try {
      const notificationPermission = await requestBackgroundNotificationAccess();
      const permissions = await requestBackgroundLocationPermissions();
      const granted = permissions.background === "granted";
      setForegroundOnly(!granted);
      if (livePausedRef.current) return;
      if (!granted) {
        setNotice("BACKGROUND PERMISSION DENIED · FOREGROUND ONLY");
        return;
      }
      const liveGame = campaignsRef.current.live;
      const portId = selectedPortIdsRef.current.live;
      const port = liveGame.ports.find((candidate) => candidate.id === portId) ?? liveGame.ports[0];
      await armSelectedPortGeofence({
        portId: port.id,
        latitude: port.position.latitude,
        longitude: port.position.longitude,
        radiusMeters: 120,
      });
      setNotice(notificationPermission === "denied"
        ? "BACKGROUND NAVIGATION ENABLED · NOTIFICATIONS BLOCKED"
        : "BACKGROUND NAVIGATION ENABLED");
    } catch {
      setForegroundOnly(true);
      setNotice("BACKGROUND PERMISSION UNAVAILABLE · FOREGROUND ONLY");
    }
  }

  function beginBackgroundPermissionRequest() {
    const androidVersion = typeof Platform.Version === "number"
      ? Platform.Version
      : Number.parseInt(String(Platform.Version), 10);
    if (Platform.OS === "android" && androidVersion >= 30) {
      setShowBackgroundExplanation(true);
    } else {
      void requestBackgroundAccess();
    }
  }

  function executeTrade(quote: MarketQuote, side: "buy" | "sell", quantity: number) {
    if (!dockedPort) return;
    mutate(
      (current) => trade(current, { portId: dockedPort.id, commodityId: quote.commodityId, side, quantity }),
      side === "buy" ? "CARGO LOADED · SELECT A DESTINATION ON THE CHART" : "SALE COMPLETE · SEE YOUR TRADE RECEIPT",
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
        <View style={styles.brand}>
          <View style={styles.brandMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.shipPointer} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.appTitle} accessibilityRole="header">WAYFARER</Text>
            <Text style={styles.appEyebrow}>Independent trader network</Text>
          </View>
        </View>
        <View style={styles.gpsBadge}>
          <View style={[styles.signalDot, mode === "training" && styles.signalDotTraining]} />
          <Text numberOfLines={2} style={styles.gpsText}>
            {mode === "training" ? "TRAINING CAMPAIGN" : locationStatus}
          </Text>
        </View>
      </View>

      <View style={styles.statusBar}>
        <Stat label="CREDITS" value={`${game.player.credits} CR`} />
        <Stat label="CARGO" value={`${usedCargo}/${game.player.cargoCapacity}`} />
        <Stat label="HULL" value={`${game.player.hull}/${game.player.maxHull}`} warning={game.player.hull < game.player.maxHull} />
      </View>

      <View accessibilityLiveRegion="polite" style={styles.noticeBar}>
        <Text numberOfLines={2} style={styles.noticeText}>{notice}</Text>
      </View>

      <ScrollView
        key={tab}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tab === "chart" && (
          <>
            <SectionHeader eyebrow="NAVIGATOR" title="LOCAL STAR CHART" />
            <View style={styles.testContentNotice}>
              <Text style={styles.testContentNoticeText}>
                Public pilot preset unavailable. Desk check complete. Field validation pending.
              </Text>
              <Text style={styles.testContentNoticeText}>
                The chart shows generated test points. Use Training for route tests. Do not travel to these points.
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPortList }}
              onPress={() => setShowPortList((shown) => !shown)} style={styles.portListRow}>
              <Text style={styles.commodityName}>Port list · {game.discoveredPortIds.length} of {game.ports.length} visited</Text>
            </Pressable>
            {showPortList && <View style={styles.panel}>
              {game.ports.map((port) => {
                const visited = game.discoveredPortIds.includes(port.id);
                const range = formatDistance(distanceMeters(position, port.position));
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedPort.id === port.id }}
                    accessibilityLabel={`Select ${port.name}, ${visited ? "visited" : "unvisited"}, ${range}`}
                    key={port.id}
                    onPress={() => { void selectPort(port.id); }}
                    style={styles.portListRow}
                  >
                    <Text style={[styles.commodityName, selectedPort.id === port.id && styles.limeText]}>{port.name}</Text>
                    <Text style={styles.commodityMeta}>{visited ? "Visited" : "Unvisited"} · {range}</Text>
                  </Pressable>
                );
              })}
            </View>}
            <View style={styles.panel}>
              <StarChart
                game={game}
                onSelect={(portId) => { void selectPort(portId); }}
                position={position}
                selectedPortId={selectedPort.id}
                size={radarSize - 34}
              />
              <Text style={styles.scopeLegend}>Triangle: ship · Diamond: port · Amber: selected</Text>
            </View>

            <View style={styles.destinationCard}>
              <View style={styles.destinationTopline}>
                <View style={styles.flexOne}>
                  <Text style={styles.eyebrow}>SELECTED DESTINATION</Text>
                  <Text style={styles.destinationName}>{selectedPort.name}</Text>
                  <Text style={styles.callsign}>{selectedPort.callsign}</Text>
                </View>
                <View style={styles.rangeBox}>
                  <Text style={styles.rangeLabel}>RANGE</Text>
                  <Text style={styles.rangeValue}>{formatDistance(selectedDistance)}</Text>
                </View>
              </View>

              {mode === "live" && livePaused ? (
                <Button label="Start live navigation" onPress={() => {
                  setSaveReady(false);
                  setBooting(true);
                  setLiveStartAttempt((attempt) => attempt + 1);
                }} />
              ) : (
                <DockingStatusCard
                  coordinator={coordinator}
                  foregroundOnly={mode === "live" && foregroundOnly}
                  onEnableBackground={beginBackgroundPermissionRequest}
                />
              )}

              <View style={styles.rumorGrid}>
                {getRumors(game, selectedPort.id).slice(0, 3).map((rumor) => (
                  <View key={rumor.commodityId} style={styles.rumorRow}>
                    <Text numberOfLines={1} style={styles.rumorText}>{rumorSummary(rumor.commodityName, rumor.band)}</Text>
                    <BandPill band={rumor.band} />
                  </View>
                ))}
              </View>

              <View style={styles.trainingRow}>
                <View style={styles.flexOne}>
                  <Text style={styles.trainingTitle}>TRAINING CAMPAIGN</Text>
                  <Text style={styles.trainingCopy}>Separate save, cargo, credits, markets, and encounters.</Text>
                </View>
                <Switch
                  accessibilityLabel="Training simulator"
                  disabled={contractSaving}
                  onValueChange={(enabled) => {
                    if (contractSavingRef.current) return;
                    setMode(enabled ? "training" : "live");
                    setNotice(enabled
                      ? "TRAINING CAMPAIGN ACTIVE · LIVE PROGRESS UNCHANGED"
                      : "LIVE CAMPAIGN ACTIVE");
                  }}
                  thumbColor={mode === "training" ? COLORS.accent : COLORS.muted}
                  trackColor={{ false: COLORS.line, true: COLORS.frame }}
                  value={mode === "training"}
                />
              </View>
              {mode === "training" && (
                <Button
                  label={`SIMULATE 10 MIN QUALIFICATION · ${selectedPort.callsign}`}
                  onPress={simulateQualification}
                  tone="ghost"
                />
              )}
            </View>

            <SectionHeader eyebrow="GALACTIC NEWS" title="MARKET INTELLIGENCE" />
            <View style={styles.panel}>
              {game.ports.slice(1, 4).map((port) => {
                const rumors = getRumors(game, port.id);
                const signal = rumors.find((rumor) => rumor.band !== "steady") ?? rumors[0];
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={port.id}
                    onPress={() => { void selectPort(port.id); }}
                    style={styles.newsRow}
                  >
                    <View style={[styles.newsSignal, signal.band === "expensive" && styles.newsSignalHot]} />
                    <View style={styles.flexOne}>
                      <Text style={styles.newsHeadline}>{rumorSummary(signal.commodityName, signal.band)}</Text>
                      <Text style={styles.newsMeta}>{port.callsign} · {formatDistance(distanceMeters(position, port.position))}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {tab === "market" && (
          <>
            <SectionHeader eyebrow="PORT MARKET" title={dockedPort?.name ?? "NO DOCKING LINK"} />
            <CargoContract game={game} dockedPortId={dockedPort?.id} saving={contractSaving}
              onAccept={() => { void saveContract(acceptDelivery, "Contract accepted. Buy Ion Fuel at Wayfarer Freeport."); }}
              onDeliver={() => { void saveContract(completeDelivery, `Delivery complete. Received ${DELIVERY.reward} cr.`); }} />
            <LastTrade game={game} onUpgrades={() => setTab("ship")} />
            {!dockedPort ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyGlyph}>⌁</Text>
                <Text style={styles.emptyTitle}>MARKET ENCRYPTED</Text>
                <Text style={styles.emptyCopy}>Select a starport and complete its automatic 10-minute docking qualification to reveal exact prices.</Text>
                <Button label="RETURN TO CHART" onPress={() => setTab("chart")} tone="ghost" />
              </View>
            ) : (
              <View style={styles.marketPanel}>
                <View style={styles.marketBanner}>
                  <View>
                    <Text style={styles.marketBannerLabel}>DOCKED</Text>
                    <Text style={styles.marketBannerValue}>{dockedPort.callsign}</Text>
                  </View>
                  <View style={styles.marketBannerRight}>
                    <Text style={styles.marketBannerLabel}>AVAILABLE</Text>
                    <Text style={styles.marketBannerValue}>{game.player.credits} CR</Text>
                  </View>
                </View>
                {dockedPort.market.map((quote) => (
                  <MarketRow
                    key={`${mode}-${dockedPort.id}-${quote.commodityId}`}
                    game={game}
                    onOrder={(side, quantity) => executeTrade(quote, side, quantity)}
                    quote={quote}
                  />
                ))}
                <Text style={styles.spreadNote}>Station spread applies. Shared-market synchronization comes after MVP validation.</Text>
              </View>
            )}
          </>
        )}

        {tab === "ship" && (
          <>
            <SectionHeader eyebrow="SHIP SYSTEMS" title="THE WAYWARD" />
            <SectionHeader eyebrow="SHIPYARD" title="UPGRADES" />
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
                  <Button compact disabled={shortfall > 0 || (mode === "live" && livePaused)} label="Install"
                    accessibilityLabel={`${label}, ${cost} credits`}
                    onPress={() => mutate(
                      (current) => buyUpgrade(current, id),
                      id === "cargo" ? "CARGO PODS INSTALLED · 4 SLOTS ADDED" : "HULL PLATING INSTALLED",
                    )} />
                </View>
              );
            })}
            <View style={styles.shipHero}>
              <View style={styles.shipSilhouette}>
                <View style={styles.shipNose} />
                <View style={styles.shipBody} />
                <View style={styles.shipWingLeft} />
                <View style={styles.shipWingRight} />
                <View style={styles.engineGlow} />
              </View>
              <Text style={styles.shipClass}>COURIER-CLASS · REGISTRY WFR-731</Text>
            </View>

            <View style={styles.shipStats}>
              <Stat label="HULL INTEGRITY" value={`${game.player.hull}/${game.player.maxHull}`} />
              <Stat label="HOLD CAPACITY" value={`${usedCargo}/${game.player.cargoCapacity}`} />
            </View>

            <SectionHeader eyebrow="MANIFEST" title="CARGO HOLD" />
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

            <SectionHeader eyebrow="ON THIS DEVICE" title="Local game data" />
            <View style={styles.receipt}>
              <Text style={styles.receiptLine}>
                Live and Training have separate local saves for ship, cargo, markets, visits, contract and the last receipt.
                Live saves include starting and generated port coordinates plus the selected docking target and qualification progress.
                New Training saves use a simulated map. Older Training saves may include coordinates from their initial location.
                Raw location readings and movement trails are not saved.
              </Text>
              <Text style={styles.receiptLine}>Android manages app permissions and system backups separately.</Text>
              <Button label={`Reset ${mode === "live" ? "Live" : "Training"} game data`}
                disabled={contractSaving} onPress={() => setResetMode(mode)} tone="ghost" />
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        {([
          ["chart", "CHART"],
          ["market", "MARKET"],
          ["ship", "SHIP"],
        ] as const).map(([key, label]) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            key={key}
            onPress={() => {
              setTab(key);
              void Haptics.selectionAsync();
            }}
            style={[styles.tab, tab === key && styles.tabActive]}
          >
            <View importantForAccessibility="no" style={[
              styles.tabMark,
              key === "chart" && styles.tabMarkChart,
              key === "ship" && styles.tabMarkShip,
              tab === key && styles.tabMarkActive,
            ]} />
            <Text style={[styles.tabLabel, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={resetMode !== null} transparent onRequestClose={() => { if (!resetting) setResetMode(null); }}>
        <View style={styles.modalScrim}>
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
        </View>
      </Modal>
      <EncounterModal game={game} onResolve={handleEncounter} />
      <BackgroundPermissionModal
        onCancel={() => setShowBackgroundExplanation(false)}
        onContinue={() => { void requestBackgroundAccess(); }}
        visible={showBackgroundExplanation}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { flex: 1, minWidth: 175, flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#80664e", backgroundColor: COLORS.contract },
  scopeLabel: { position: "absolute", left: 8, top: 7, fontSize: 10, color: COLORS.muted },
  scopeStar: { position: "absolute", width: 2, height: 2, backgroundColor: "#91afc8", borderRadius: 1 },
  scopeVector: { position: "absolute", height: 1, backgroundColor: "#ac855c" },
  shipPointer: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 15, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: COLORS.signal },
  scopeLegend: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  contract: { backgroundColor: COLORS.contract, borderStyle: "dashed", borderColor: "#80664e" },
  contractHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
  contractReward: { color: COLORS.accent, fontSize: 12, fontVariant: ["tabular-nums"] },
  tabMark: { width: 13, height: 10, borderWidth: 1, borderColor: COLORS.muted },
  tabMarkChart: { width: 11, height: 11, borderRadius: 6 },
  tabMarkShip: { width: 9, height: 9, transform: [{ rotate: "45deg" }] },
  tabMarkActive: { borderColor: COLORS.accent },
  flexOne: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: COLORS.void, paddingTop: Platform.OS === "android" ? 18 : 0 },
  bootScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.void, padding: 28 },
  bootMark: { width: 68, height: 68, borderWidth: 1, borderColor: COLORS.accent, alignItems: "center", justifyContent: "center", transform: [{ rotate: "45deg" }] },
  bootMarkText: { color: COLORS.accent, fontWeight: "900", fontSize: 30, transform: [{ rotate: "-45deg" }] },
  bootTitle: { color: COLORS.text, fontWeight: "900", fontSize: 40, letterSpacing: -2, marginTop: 36 },
  bootSubtitle: { color: COLORS.muted, fontSize: 10, letterSpacing: 2, marginTop: 8, textAlign: "center" },
  bootSpinner: { marginTop: 54 },
  bootStatus: { color: COLORS.accent, fontSize: 10, letterSpacing: 1.5, marginTop: 16 },
  appHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderColor: COLORS.frame },
  appEyebrow: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  appTitle: { color: COLORS.text, fontSize: 28, letterSpacing: 1.4, fontWeight: "900" },
  gpsBadge: { maxWidth: "100%", minHeight: 34, paddingHorizontal: 8, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: COLORS.line },
  signalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.signal },
  signalDotTraining: { backgroundColor: COLORS.accent },
  gpsText: { color: COLORS.muted, flexShrink: 1, fontSize: 11 },
  statusBar: { flexDirection: "row", flexWrap: "wrap", backgroundColor: COLORS.panel, borderBottomWidth: 1, borderColor: COLORS.line },
  stat: { flex: 1, minWidth: 88, paddingHorizontal: 10, paddingVertical: 9, borderRightWidth: 1, borderColor: COLORS.line },
  statLabel: { color: COLORS.muted, fontSize: 10, letterSpacing: .6 },
  statValue: { color: COLORS.text, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "800", marginTop: 3 },
  warning: { color: COLORS.alert },
  noticeBar: { minHeight: 38, justifyContent: "center", borderBottomWidth: 1, borderColor: COLORS.line, paddingVertical: 7, marginHorizontal: 16 },
  noticeText: { color: COLORS.signal, fontSize: 12, fontWeight: "600" },
  testContentNotice: { borderWidth: 1, borderColor: "#80664e", backgroundColor: COLORS.contract, padding: 10, marginBottom: 10, gap: 5 },
  testContentNoticeText: { color: COLORS.text, fontSize: 12, lineHeight: 18 },
  scrollContent: { padding: 16, paddingBottom: 30 },
  sectionHeader: { marginTop: 6, marginBottom: 10 },
  eyebrow: { color: COLORS.signal, fontSize: 10, letterSpacing: .6, fontWeight: "700" },
  sectionTitle: { color: COLORS.text, fontSize: 24, fontWeight: "800", letterSpacing: -.45, marginTop: 2 },
  panel: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 12, marginBottom: 16 },
  radar: { alignSelf: "center", overflow: "hidden", backgroundColor: COLORS.deep, borderWidth: 1, borderColor: "#466178" },
  radarRing: { position: "absolute", left: "50%", top: "50%", borderRadius: 999, borderWidth: 1, borderColor: "#466178" },
  radarAxisHorizontal: { position: "absolute", top: "50%", left: 12, right: 12, height: 1, backgroundColor: "#31465b" },
  radarAxisVertical: { position: "absolute", left: "50%", top: 12, bottom: 12, width: 1, backgroundColor: "#31465b" },
  shipMarker: { position: "absolute", zIndex: 2, width: 24, height: 24, marginLeft: -12, marginTop: -12, alignItems: "center", justifyContent: "center" },
  portNode: { position: "absolute", zIndex: 3, width: 56, minHeight: 44, alignItems: "center", justifyContent: "center" },
  portDiamond: { width: 10, height: 10, borderWidth: 1, borderColor: COLORS.signal, backgroundColor: COLORS.deep, transform: [{ rotate: "45deg" }] },
  portDiamondVisited: { backgroundColor: COLORS.signal },
  portDiamondSelected: { width: 13, height: 13, borderColor: COLORS.accent, backgroundColor: COLORS.accent },
  portNodeLabel: { color: COLORS.muted, backgroundColor: COLORS.deep, fontSize: 10, marginTop: 5, fontWeight: "700" },
  portNodeLabelSelected: { color: COLORS.accent },
  destinationCard: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 16, marginBottom: 22 },
  destinationTopline: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  destinationName: { color: COLORS.text, fontSize: 24, fontWeight: "900", letterSpacing: -.7, marginTop: 3 },
  callsign: { color: COLORS.muted, fontSize: 10, letterSpacing: 1.1, marginTop: 4 },
  rangeBox: { minWidth: 74, alignItems: "flex-end" },
  rangeLabel: { color: COLORS.muted, fontSize: 10, letterSpacing: .6 },
  rangeValue: { color: COLORS.signal, fontSize: 15, fontWeight: "800", marginTop: 3 },
  limeText: { color: COLORS.accent },
  rumorGrid: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.line, marginVertical: 15, paddingVertical: 6 },
  rumorRow: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 8 },
  rumorText: { flex: 1, color: COLORS.text, fontSize: 9, letterSpacing: .4 },
  band: { borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 7, paddingVertical: 4 },
  bandCheap: { borderColor: COLORS.frame, backgroundColor: "#172a36" },
  bandExpensive: { borderColor: "#8a5050", backgroundColor: "#281e28" },
  bandText: { color: COLORS.muted, fontSize: 7, fontWeight: "800", letterSpacing: .6 },
  trainingRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  trainingTitle: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  trainingCopy: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  button: { minHeight: 46, borderWidth: 1, borderColor: COLORS.accent, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 8 },
  buttonCompact: { minHeight: 48, paddingHorizontal: 10, marginTop: 0 },
  buttonLime: { backgroundColor: COLORS.accent },
  buttonGhost: { backgroundColor: "transparent", borderColor: COLORS.line },
  buttonDanger: { backgroundColor: COLORS.alert, borderColor: COLORS.alert },
  buttonDisabled: { backgroundColor: "transparent", borderColor: COLORS.line, opacity: .78 },
  buttonPressed: { opacity: .82 },
  buttonLabel: { color: COLORS.text, fontSize: 12, fontWeight: "700", textAlign: "center" },
  buttonLabelDark: { color: COLORS.void },
  newsRow: { minHeight: 61, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line, gap: 11 },
  newsSignal: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  newsSignalHot: { backgroundColor: COLORS.alert },
  newsHeadline: { color: COLORS.text, fontSize: 10, fontWeight: "800", letterSpacing: .4 },
  newsMeta: { color: COLORS.muted, fontSize: 8, letterSpacing: .7, marginTop: 4 },
  chevron: { color: COLORS.muted, fontSize: 24 },
  emptyCard: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 28, alignItems: "center" },
  emptyGlyph: { color: COLORS.accent, fontSize: 42 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900", marginTop: 12 },
  emptyCopy: { color: COLORS.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginVertical: 12 },
  marketPanel: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 12 },
  marketBanner: { flexDirection: "row", justifyContent: "space-between", backgroundColor: COLORS.panelLift, borderWidth: 1, borderColor: COLORS.line, padding: 12, marginBottom: 7 },
  marketBannerRight: { alignItems: "flex-end" },
  marketBannerLabel: { color: COLORS.muted, fontSize: 7, letterSpacing: 1.2 },
  marketBannerValue: { color: COLORS.accent, fontSize: 12, fontWeight: "900", marginTop: 3 },
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
  spreadNote: { color: COLORS.muted, fontSize: 8, lineHeight: 13, marginTop: 12 },
  shipHero: { height: 164, borderWidth: 1, borderColor: "#466178", backgroundColor: COLORS.deep, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden" },
  shipSilhouette: { width: 190, height: 92, alignItems: "center", justifyContent: "center" },
  shipNose: { position: "absolute", right: 7, width: 0, height: 0, borderTopWidth: 18, borderBottomWidth: 18, borderLeftWidth: 42, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: COLORS.text },
  shipBody: { position: "absolute", right: 45, width: 105, height: 34, borderRadius: 14, backgroundColor: "#23415a", borderWidth: 1, borderColor: COLORS.signal },
  shipWingLeft: { position: "absolute", left: 35, top: 11, width: 88, height: 23, backgroundColor: "#456680", transform: [{ skewX: "-28deg" }] },
  shipWingRight: { position: "absolute", left: 35, bottom: 11, width: 88, height: 23, backgroundColor: "#456680", transform: [{ skewX: "28deg" }] },
  engineGlow: { position: "absolute", left: 22, width: 28, height: 20, borderRadius: 10, backgroundColor: COLORS.accent, shadowColor: COLORS.accent, shadowOpacity: 1, shadowRadius: 14, elevation: 8 },
  shipClass: { position: "absolute", bottom: 12, color: COLORS.muted, fontSize: 10, letterSpacing: .6 },
  shipStats: { flexDirection: "row", borderWidth: 1, borderColor: COLORS.line, marginBottom: 20 },
  manifestRow: { minHeight: 45, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line },
  manifestSymbol: { width: 36, color: COLORS.accent, fontSize: 9, fontWeight: "900" },
  manifestName: { flex: 1, color: COLORS.text, fontSize: 11 },
  manifestQuantity: { color: COLORS.muted, fontSize: 11, fontWeight: "900" },
  upgradeCard: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  upgradeTitle: { color: COLORS.text, fontSize: 13, fontWeight: "800" },
  upgradeCopy: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
  tabBar: { minHeight: 62, flexDirection: "row", backgroundColor: COLORS.deep, borderTopWidth: 1, borderColor: COLORS.frame, paddingBottom: Platform.OS === "android" ? 6 : 0 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, borderTopWidth: 2, borderTopColor: "transparent" },
  tabActive: { borderTopColor: COLORS.accent, backgroundColor: COLORS.panelLift },
  tabLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: .7 },
  tabTextActive: { color: COLORS.accent },
  modalScrim: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: "rgba(0,0,0,.78)" },
  encounterCard: { borderWidth: 2, borderColor: COLORS.alert, backgroundColor: COLORS.panel, padding: 22 },
  alertCode: { color: COLORS.alert, fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  encounterTitle: { color: COLORS.text, fontSize: 30, fontWeight: "900", marginTop: 5 },
  encounterCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
  encounterActions: { marginTop: 16 },
});
