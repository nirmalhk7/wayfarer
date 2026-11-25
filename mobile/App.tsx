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
  View,
  useWindowDimensions,
} from "react-native";

import {
  COMMODITIES,
  buyUpgrade,
  createGame,
  distanceMeters,
  getRumors,
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
  getBackgroundLocationStatus,
  requestBackgroundLocationPermissions,
  subscribeToBackgroundLocationSamples,
  type LocationSample,
} from "./src/location";
import { requestAndroidNotificationPermission } from "./src/location/notificationPermission";
import {
  LEGACY_STORAGE_KEY,
  TRAINING_ORIGIN,
  decodeGameState,
  encodeGameState,
  restoreTrainingGame,
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

const DEMO_ORIGIN = TRAINING_ORIGIN;
const COLORS = {
  void: "#050b0a",
  deep: "#081310",
  panel: "#0d1d18",
  panelLift: "#12261f",
  line: "#2f4336",
  cream: "#f2edcf",
  muted: "#8f9d8d",
  lime: "#c5df57",
  limeDark: "#6f812b",
  amber: "#f0a43b",
  coral: "#ef674e",
};

type Tab = "chart" | "market" | "ship";

function Button({
  label,
  onPress,
  disabled = false,
  tone = "lime",
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "lime" | "ghost" | "danger";
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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
      <Text style={[styles.buttonLabel, tone === "lime" && styles.buttonLabelDark]}>{label}</Text>
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
  return (
    <View accessibilityLabel="Nearby starport chart" style={[styles.radar, { height: size }]}>
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
      <View style={styles.shipMarker}>
        <Text style={styles.shipMarkerGlyph}>◆</Text>
        <Text style={styles.shipMarkerLabel}>YOU</Text>
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
            key={port.id}
            onPress={() => onSelect(port.id)}
            hitSlop={10}
            style={[
              styles.portNode,
              {
                left: `${point.x}%`,
                top: `${point.y}%`,
                transform: [{ translateX: -22 }, { translateY: -22 }],
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

function MarketRow({
  quote,
  cargo,
  onBuy,
  onSell,
}: {
  quote: MarketQuote;
  cargo: number;
  onBuy: () => void;
  onSell: () => void;
}) {
  const commodity = COMMODITIES.find((item) => item.id === quote.commodityId)!;
  return (
    <View style={styles.marketRow}>
      <View style={styles.commodityIdentity}>
        <View style={styles.commodityBadge}><Text style={styles.commodityBadgeText}>{commodity.symbol}</Text></View>
        <View style={styles.flexOne}>
          <Text style={styles.commodityName}>{commodity.name}</Text>
          <Text style={styles.commodityMeta}>STOCK {quote.stock} · HOLD {cargo}</Text>
        </View>
      </View>
      <View style={styles.quoteColumn}>
        <Text style={styles.askPrice}>{quote.ask} CR</Text>
        <Text style={styles.bidPrice}>BID {quote.bid}</Text>
      </View>
      <View style={styles.tradeButtons}>
        <Button compact label="BUY" onPress={onBuy} />
        <Button compact disabled={cargo < 1} label="SELL" onPress={onSell} tone="ghost" />
      </View>
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
    <Modal animationType="fade" transparent visible>
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
    training: restoreTrainingGame(null),
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
  const [booting, setBooting] = useState(true);
  const [saveReady, setSaveReady] = useState(false);
  const [foregroundOnly, setForegroundOnly] = useState(true);
  const [showBackgroundExplanation, setShowBackgroundExplanation] = useState(false);
  const [locationStatus, setLocationStatus] = useState("ACQUIRING NAV SIGNAL");
  const [notice, setNotice] = useState("WELCOME, CAPTAIN");
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const campaignsRef = useRef(campaigns);
  const selectedPortIdsRef = useRef(selectedPortIds);
  const campaignSaveQueue = useRef(createLatestWriteQueue<Campaigns>(async (snapshot) => {
    await Promise.all([
      AsyncStorage.setItem(storageKeyForMode("live"), encodeGameState(snapshot.live)),
      AsyncStorage.setItem(storageKeyForMode("training"), encodeGameState(snapshot.training)),
    ]);
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

  function setGame(update: (current: GameState) => GameState) {
    setCampaigns((current) => updateCampaign(current, mode, update));
  }

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

    try {
      // The game must reach durable storage first. A crash before proof
      // acknowledgment leaves an unconsumed coordinator proof that can replay.
      await campaignSaveQueue.current.writeThrough({
        ...campaignsRef.current,
        live: transition.game,
      });
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
    }
  });

  useEffect(() => subscribeToDockingCoordinator((next) => {
    void processLiveCoordinator(next);
  }), []);

  useEffect(() => subscribeToBackgroundLocationSamples((sample) => {
    setPositions((current) => ({
      ...current,
      live: { latitude: sample.latitude, longitude: sample.longitude },
    }));
    setLocationStatus(`BACKGROUND FIX · ±${Math.round(sample.horizontalAccuracyMeters ?? 0)} M`);
  }), []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || booting) return;
      void getBackgroundLocationStatus()
        .then((status) => {
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
      let trainingRaw: string | null = null;
      try {
        const [liveRaw, storedTraining, legacyRaw] = await Promise.all([
          AsyncStorage.getItem(storageKeyForMode("live")),
          AsyncStorage.getItem(storageKeyForMode("training")),
          AsyncStorage.getItem(LEGACY_STORAGE_KEY),
        ]);
        live = decodeGameState(liveRaw ?? legacyRaw);
        trainingRaw = storedTraining;
      } catch {
        // Corrupt or unavailable saves start isolated local campaigns.
      }
      const nextTraining = restoreTrainingGame(trainingRaw);

      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission.status !== "granted") {
        const nextLive = live ?? createGame({ origin: DEMO_ORIGIN, seed: "wayfarer-mobile-live-v2" });
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

        locationSubscription.current = await Location.watchPositionAsync(
          {
            // Foreground-only navigation remains playable without continuous
            // GPS. High accuracy is reserved for the geofence-triggered task.
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 10,
            timeInterval: 10_000,
          },
          (update) => {
            setPositions((positions) => ({
              ...positions,
              live: { latitude: update.coords.latitude, longitude: update.coords.longitude },
            }));
            setLocationStatus(`GPS LOCK · ±${Math.round(update.coords.accuracy ?? 0)} M`);
            void processPersistedForegroundSamples([toLocationSample(update)]);
          },
        );
      } catch {
        const nextLive = live ?? createGame({ origin: DEMO_ORIGIN, seed: "wayfarer-mobile-live-v2" });
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
  }, []);

  useEffect(() => {
    if (!saveReady) return;
    void campaignSaveQueue.current.schedule(campaigns)
      .catch(() => setNotice("SAVE FAILED · CAMPAIGN REMAINS IN MEMORY"));
  }, [campaigns, saveReady]);

  function mutate(action: () => GameState, success: string) {
    try {
      setGame(action);
      setNotice(success);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "COMMAND REJECTED");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function simulateQualification() {
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
        const next = await persistSelectedDockingTarget({ id: port.id, coords: port.position });
        setCoordinators((current) => ({ ...current, live: next }));
        if (!foregroundOnly) {
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

  function executeTrade(quote: MarketQuote, side: "buy" | "sell") {
    mutate(
      () => trade(game, {
        portId: dockedPort?.id ?? "",
        commodityId: quote.commodityId,
        side,
        quantity: 1,
      }),
      `${side === "buy" ? "PURCHASED" : "SOLD"} · ${quote.commodityId.replaceAll("_", " ").toUpperCase()}`,
    );
  }

  function handleEncounter(choice: "run" | "pay" | "fight" | "help") {
    mutate(() => resolveEncounter(game, choice), `CONTACT RESOLVED · ${choice.toUpperCase()}`);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.bootScreen}>
        <StatusBar style="light" />
        <View style={styles.bootMark}><Text style={styles.bootMarkText}>W</Text></View>
        <Text style={styles.bootTitle}>WAYFARER</Text>
        <Text style={styles.bootSubtitle}>TRADE THE CITY · CHART THE UNKNOWN</Text>
        <ActivityIndicator color={COLORS.lime} size="small" style={styles.bootSpinner} />
        <Text style={styles.bootStatus}>{locationStatus}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.appEyebrow}>INDEPENDENT TRADER NETWORK</Text>
          <Text style={styles.appTitle}>WAYFARER</Text>
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
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tab === "chart" && (
          <>
            <SectionHeader eyebrow="NAVIGATOR" title="LOCAL STAR CHART" />
            <View style={styles.testContentNotice}>
              <Text style={styles.testContentNoticeText}>
                SYNTHETIC TEST PORTS · NOT VERIFIED PUBLIC PLACES
              </Text>
            </View>
            <View style={styles.panel}>
              <StarChart
                game={game}
                onSelect={(portId) => { void selectPort(portId); }}
                position={position}
                selectedPortId={selectedPort.id}
                size={radarSize - 34}
              />
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

              <DockingStatusCard
                coordinator={coordinator}
                foregroundOnly={mode === "live" && foregroundOnly}
                onEnableBackground={beginBackgroundPermissionRequest}
              />

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
                  onValueChange={(enabled) => {
                    setMode(enabled ? "training" : "live");
                    setNotice(enabled
                      ? "TRAINING CAMPAIGN ACTIVE · LIVE PROGRESS UNCHANGED"
                      : "LIVE CAMPAIGN ACTIVE");
                  }}
                  thumbColor={mode === "training" ? COLORS.lime : COLORS.muted}
                  trackColor={{ false: COLORS.line, true: COLORS.limeDark }}
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
            <SectionHeader eyebrow="AUTHENTICATED EXCHANGE" title={dockedPort?.name ?? "NO DOCKING LINK"} />
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
                    cargo={game.player.cargo[quote.commodityId] ?? 0}
                    key={quote.commodityId}
                    onBuy={() => executeTrade(quote, "buy")}
                    onSell={() => executeTrade(quote, "sell")}
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

            <SectionHeader eyebrow="SHIPYARD" title="UPGRADES" />
            <View style={styles.upgradeCard}>
              <View style={styles.flexOne}>
                <Text style={styles.upgradeTitle}>EXPANDED CARGO PODS</Text>
                <Text style={styles.upgradeCopy}>+4 cargo capacity · 320 CR</Text>
              </View>
              <Button
                compact
                disabled={game.player.credits < 320}
                label="INSTALL"
                onPress={() => mutate(() => buyUpgrade(game, "cargo"), "CARGO PODS INSTALLED")}
              />
            </View>
            <View style={styles.upgradeCard}>
              <View style={styles.flexOne}>
                <Text style={styles.upgradeTitle}>REACTIVE HULL PLATING</Text>
                <Text style={styles.upgradeCopy}>+1 hull integrity · 380 CR</Text>
              </View>
              <Button
                compact
                disabled={game.player.credits < 380}
                label="INSTALL"
                onPress={() => mutate(() => buyUpgrade(game, "hull"), "HULL PLATING INSTALLED")}
              />
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        {([
          ["chart", "⌖", "CHART"],
          ["market", "⇄", "MARKET"],
          ["ship", "◆", "SHIP"],
        ] as const).map(([key, glyph, label]) => (
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
            <Text style={[styles.tabGlyph, tab === key && styles.tabTextActive]}>{glyph}</Text>
            <Text style={[styles.tabLabel, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

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
  flexOne: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: COLORS.void, paddingTop: Platform.OS === "android" ? 18 : 0 },
  bootScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.void, padding: 28 },
  bootMark: { width: 68, height: 68, borderWidth: 1, borderColor: COLORS.lime, alignItems: "center", justifyContent: "center", transform: [{ rotate: "45deg" }] },
  bootMarkText: { color: COLORS.lime, fontWeight: "900", fontSize: 30, transform: [{ rotate: "-45deg" }] },
  bootTitle: { color: COLORS.cream, fontWeight: "900", fontSize: 40, letterSpacing: -2, marginTop: 36 },
  bootSubtitle: { color: COLORS.muted, fontSize: 10, letterSpacing: 2, marginTop: 8, textAlign: "center" },
  bootSpinner: { marginTop: 54 },
  bootStatus: { color: COLORS.lime, fontSize: 10, letterSpacing: 1.5, marginTop: 16 },
  appHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderColor: COLORS.line },
  appEyebrow: { color: COLORS.lime, fontSize: 8, letterSpacing: 1.4, fontWeight: "700" },
  appTitle: { color: COLORS.cream, fontSize: 34, letterSpacing: -1.8, lineHeight: 36, fontWeight: "900" },
  gpsBadge: { width: 116, minHeight: 36, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 7 },
  signalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.lime },
  signalDotTraining: { backgroundColor: COLORS.amber },
  gpsText: { flex: 1, color: COLORS.muted, fontSize: 8, lineHeight: 11, letterSpacing: .6 },
  statusBar: { flexDirection: "row", borderBottomWidth: 1, borderColor: COLORS.line },
  stat: { flex: 1, paddingHorizontal: 13, paddingVertical: 10, borderRightWidth: 1, borderColor: COLORS.line },
  statLabel: { color: COLORS.muted, fontSize: 8, letterSpacing: 1.1 },
  statValue: { color: COLORS.cream, fontSize: 14, fontWeight: "800", marginTop: 3 },
  warning: { color: COLORS.coral },
  noticeBar: { minHeight: 36, justifyContent: "center", borderLeftWidth: 3, borderLeftColor: COLORS.amber, backgroundColor: "#1b160d", paddingHorizontal: 13, marginHorizontal: 16, marginTop: 10 },
  noticeText: { color: COLORS.amber, fontSize: 9, letterSpacing: .8, fontWeight: "700" },
  testContentNotice: { borderWidth: 1, borderColor: COLORS.amber, backgroundColor: "#1b160d", paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  testContentNoticeText: { color: COLORS.amber, fontSize: 8, lineHeight: 12, letterSpacing: .7, fontWeight: "800" },
  scrollContent: { padding: 16, paddingBottom: 30 },
  sectionHeader: { marginTop: 6, marginBottom: 10 },
  eyebrow: { color: COLORS.lime, fontSize: 8, letterSpacing: 1.3, fontWeight: "800" },
  sectionTitle: { color: COLORS.cream, fontSize: 22, lineHeight: 25, fontWeight: "900", letterSpacing: -.7, marginTop: 2 },
  panel: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 12, marginBottom: 16 },
  radar: { alignSelf: "center", width: "100%", overflow: "hidden", backgroundColor: COLORS.deep, borderWidth: 1, borderColor: COLORS.line },
  radarRing: { position: "absolute", left: "50%", top: "50%", borderRadius: 999, borderWidth: 1, borderColor: "#284332" },
  radarAxisHorizontal: { position: "absolute", top: "50%", left: 12, right: 12, height: 1, backgroundColor: "#203629" },
  radarAxisVertical: { position: "absolute", left: "50%", top: 12, bottom: 12, width: 1, backgroundColor: "#203629" },
  shipMarker: { position: "absolute", left: "50%", top: "50%", width: 46, height: 46, marginLeft: -23, marginTop: -23, alignItems: "center", justifyContent: "center" },
  shipMarkerGlyph: { color: COLORS.cream, fontSize: 19, textShadowColor: COLORS.cream, textShadowRadius: 8 },
  shipMarkerLabel: { color: COLORS.muted, fontSize: 7, letterSpacing: 1 },
  portNode: { position: "absolute", width: 56, minHeight: 46, alignItems: "center", justifyContent: "center" },
  portDiamond: { width: 11, height: 11, borderWidth: 1, borderColor: COLORS.amber, backgroundColor: COLORS.deep, transform: [{ rotate: "45deg" }] },
  portDiamondVisited: { backgroundColor: COLORS.amber },
  portDiamondSelected: { width: 15, height: 15, borderColor: COLORS.lime, backgroundColor: COLORS.lime, shadowColor: COLORS.lime, shadowOpacity: 1, shadowRadius: 8, elevation: 5 },
  portNodeLabel: { color: COLORS.muted, fontSize: 7, marginTop: 5, fontWeight: "700" },
  portNodeLabelSelected: { color: COLORS.cream },
  destinationCard: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 16, marginBottom: 22 },
  destinationTopline: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  destinationName: { color: COLORS.cream, fontSize: 24, fontWeight: "900", letterSpacing: -.7, marginTop: 3 },
  callsign: { color: COLORS.muted, fontSize: 10, letterSpacing: 1.1, marginTop: 4 },
  rangeBox: { minWidth: 74, alignItems: "flex-end" },
  rangeLabel: { color: COLORS.muted, fontSize: 8, letterSpacing: 1 },
  rangeValue: { color: COLORS.amber, fontSize: 15, fontWeight: "900", marginTop: 3 },
  limeText: { color: COLORS.lime },
  rumorGrid: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.line, marginVertical: 15, paddingVertical: 6 },
  rumorRow: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 8 },
  rumorText: { flex: 1, color: COLORS.cream, fontSize: 9, letterSpacing: .4 },
  band: { borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 7, paddingVertical: 4 },
  bandCheap: { borderColor: COLORS.limeDark, backgroundColor: "#17210d" },
  bandExpensive: { borderColor: "#824133", backgroundColor: "#23100c" },
  bandText: { color: COLORS.muted, fontSize: 7, fontWeight: "800", letterSpacing: .6 },
  trainingRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  trainingTitle: { color: COLORS.cream, fontSize: 10, fontWeight: "800", letterSpacing: .6 },
  trainingCopy: { color: COLORS.muted, fontSize: 9, marginTop: 2 },
  button: { minHeight: 46, borderWidth: 1, borderColor: COLORS.lime, backgroundColor: COLORS.lime, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 8 },
  buttonCompact: { minHeight: 32, paddingHorizontal: 10, marginTop: 0 },
  buttonLime: { backgroundColor: COLORS.lime },
  buttonGhost: { backgroundColor: "transparent", borderColor: COLORS.line },
  buttonDanger: { backgroundColor: COLORS.coral, borderColor: COLORS.coral },
  buttonDisabled: { opacity: .28 },
  buttonPressed: { opacity: .72, transform: [{ scale: .985 }] },
  buttonLabel: { color: COLORS.cream, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  buttonLabelDark: { color: COLORS.void },
  newsRow: { minHeight: 61, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line, gap: 11 },
  newsSignal: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.lime },
  newsSignalHot: { backgroundColor: COLORS.coral },
  newsHeadline: { color: COLORS.cream, fontSize: 10, fontWeight: "800", letterSpacing: .4 },
  newsMeta: { color: COLORS.muted, fontSize: 8, letterSpacing: .7, marginTop: 4 },
  chevron: { color: COLORS.muted, fontSize: 24 },
  emptyCard: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 28, alignItems: "center" },
  emptyGlyph: { color: COLORS.amber, fontSize: 42 },
  emptyTitle: { color: COLORS.cream, fontSize: 18, fontWeight: "900", marginTop: 12 },
  emptyCopy: { color: COLORS.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginVertical: 12 },
  marketPanel: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 12 },
  marketBanner: { flexDirection: "row", justifyContent: "space-between", backgroundColor: COLORS.panelLift, borderWidth: 1, borderColor: COLORS.line, padding: 12, marginBottom: 7 },
  marketBannerRight: { alignItems: "flex-end" },
  marketBannerLabel: { color: COLORS.muted, fontSize: 7, letterSpacing: 1.2 },
  marketBannerValue: { color: COLORS.lime, fontSize: 12, fontWeight: "900", marginTop: 3 },
  marketRow: { minHeight: 78, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line, gap: 8, paddingVertical: 9 },
  commodityIdentity: { flex: 1.25, flexDirection: "row", alignItems: "center", gap: 8 },
  commodityBadge: { width: 30, height: 30, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center" },
  commodityBadgeText: { color: COLORS.lime, fontSize: 8, fontWeight: "900" },
  commodityName: { color: COLORS.cream, fontSize: 10, fontWeight: "800" },
  commodityMeta: { color: COLORS.muted, fontSize: 7, marginTop: 4 },
  quoteColumn: { width: 54, alignItems: "flex-end" },
  askPrice: { color: COLORS.amber, fontSize: 11, fontWeight: "900" },
  bidPrice: { color: COLORS.muted, fontSize: 7, marginTop: 4 },
  tradeButtons: { width: 53, gap: 5 },
  spreadNote: { color: COLORS.muted, fontSize: 8, lineHeight: 13, marginTop: 12 },
  shipHero: { height: 220, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.deep, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden" },
  shipSilhouette: { width: 190, height: 92, alignItems: "center", justifyContent: "center" },
  shipNose: { position: "absolute", right: 7, width: 0, height: 0, borderTopWidth: 18, borderBottomWidth: 18, borderLeftWidth: 42, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: COLORS.cream },
  shipBody: { position: "absolute", right: 45, width: 105, height: 34, borderRadius: 18, backgroundColor: "#a6ad9b", borderWidth: 2, borderColor: COLORS.cream },
  shipWingLeft: { position: "absolute", left: 35, top: 11, width: 88, height: 23, backgroundColor: "#657467", transform: [{ skewX: "-28deg" }] },
  shipWingRight: { position: "absolute", left: 35, bottom: 11, width: 88, height: 23, backgroundColor: "#657467", transform: [{ skewX: "28deg" }] },
  engineGlow: { position: "absolute", left: 22, width: 28, height: 20, borderRadius: 10, backgroundColor: COLORS.lime, shadowColor: COLORS.lime, shadowOpacity: 1, shadowRadius: 14, elevation: 8 },
  shipClass: { position: "absolute", bottom: 14, color: COLORS.muted, fontSize: 8, letterSpacing: 1 },
  shipStats: { flexDirection: "row", borderWidth: 1, borderColor: COLORS.line, marginBottom: 20 },
  manifestRow: { minHeight: 45, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: COLORS.line },
  manifestSymbol: { width: 36, color: COLORS.lime, fontSize: 9, fontWeight: "900" },
  manifestName: { flex: 1, color: COLORS.cream, fontSize: 11 },
  manifestQuantity: { color: COLORS.muted, fontSize: 11, fontWeight: "900" },
  upgradeCard: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  upgradeTitle: { color: COLORS.cream, fontSize: 10, fontWeight: "900", letterSpacing: .4 },
  upgradeCopy: { color: COLORS.muted, fontSize: 8, marginTop: 5 },
  tabBar: { height: 67, flexDirection: "row", backgroundColor: COLORS.deep, borderTopWidth: 1, borderColor: COLORS.line, paddingBottom: Platform.OS === "android" ? 6 : 0 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, borderTopWidth: 2, borderTopColor: "transparent" },
  tabActive: { borderTopColor: COLORS.lime, backgroundColor: "#0c1915" },
  tabGlyph: { color: COLORS.muted, fontSize: 18 },
  tabLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  tabTextActive: { color: COLORS.lime },
  modalScrim: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: "rgba(0,0,0,.78)" },
  encounterCard: { borderWidth: 2, borderColor: COLORS.coral, backgroundColor: COLORS.panel, padding: 22 },
  alertCode: { color: COLORS.coral, fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  encounterTitle: { color: COLORS.cream, fontSize: 30, fontWeight: "900", marginTop: 5 },
  encounterCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
  encounterActions: { marginTop: 16 },
});
