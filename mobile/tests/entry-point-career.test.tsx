
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { registerRootComponent } from "expo";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AccessibilityInfo, Animated, AppState, Share } from "react-native";

import "../index";
import { resolveLiveContact, type LiveContactChoice } from "../src/game/liveEncounters";
import { createGame } from "../src/game/engine";
import { decodeGameState, encodeGameState, LEGACY_STORAGE_KEY, LIVE_RESET_MARKER, COUNTY_LIVE_STORAGE_KEY, storageKeyForMode } from "../src/persistence";
import { createDockingCoordinator } from "../src/ui/dockingCoordinator";
import { DOCKING_SESSION_STORAGE_KEY, persistDockingCoordinator } from "../src/ui/dockingSessionStore";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("react-native-safe-area-context", () =>
  jest.requireActual<{ default: unknown }>("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../src/atlas/download", () => jest.requireActual<typeof import("./atlas-fixture")>("./atlas-fixture").atlasFixture());
jest.mock("expo-file-system/legacy", () => ({
  bundleDirectory: "asset:///",
  documentDirectory: "file:///test/",
  readAsStringAsync: jest.fn(),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: unknown, value: string) =>
    jest.requireActual<typeof import("./atlas-fixture")>("./atlas-fixture").sha256(value),
}));
const downloaded = jest.requireMock("../src/atlas/download") as ReturnType<typeof import("./atlas-fixture")["atlasFixture"]>;

jest.mock("expo", () => ({ ...jest.requireActual<typeof import("expo")>("expo"), registerRootComponent: jest.fn() }));
const mockMotionGrant = { status: "granted", granted: true, canAskAgain: true, expires: "never" } as const;
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  hasStartedGeofencingAsync: jest.fn(async () => false),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  stopGeofencingAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  Accuracy: { Balanced: 3, High: 4 },
  PermissionStatus: { GRANTED: "granted" },
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  MotionActivityConfidence: { Low: 0, High: 2 },
  requestMotionActivityPermissionsAsync: jest.fn(async () => mockMotionGrant),
  getMotionActivityPermissionsAsync: jest.fn(async () => mockMotionGrant),
  watchMotionActivityAsync: jest.fn(async () => ({ remove: jest.fn() })),
}));
jest.mock("expo-task-manager", () => ({
  isTaskDefined: jest.fn(() => false), defineTask: jest.fn(), isAvailableAsync: jest.fn(async () => false),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Error: "error" },
}));

beforeEach(() => { AppState.currentState = "active"; });

afterEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

function press(name: string | RegExp) {
  return fireEvent.press(screen.getByRole("button", { name }));
}

function expectPlainPortLanguage() {
  const administrative = /\b(?:census|tiger|subdivisions?|geoids?|cousub|fips|ccd|county|counties|chart|map)\b|\b06\d{8}\b/iu;
  expect(screen.queryAllByText(administrative, { includeHiddenElements: true })).toHaveLength(0);
  expect(screen.queryAllByLabelText(administrative, { includeHiddenElements: true })).toHaveLength(0);
  expect(screen.queryByRole("tab", { name: /chart|map/i })).toBeNull();
}

function tab(name: "Bridge" | "Compass" | "Station" | "Hold") {
  return fireEvent.press(screen.getByRole("tab", { name }));
}

async function order(side: "Buy" | "Sell", commodity: string, quantity: number) {
  await press("Open trade counter");
  await fireEvent.changeText(screen.getByLabelText(`${commodity} units`), String(quantity));
  await press(new RegExp(`^${side} ${commodity},`));
}

async function campaign(mode: "live" | "training") {
  return mode === "live"
    ? decodeGameState(await AsyncStorage.getItem(COUNTY_LIVE_STORAGE_KEY), "county-live")
    : decodeGameState(await AsyncStorage.getItem(storageKeyForMode("training")), "training");
}

test("Expo startup replaces old Training coordinates and keeps progress", async () => {
  const old = createGame({
    origin: { latitude: 10.123456, longitude: 20.654321 },
    seed: "legacy-training",
  });
  old.player.credits = 725;
  old.ports[1].market[0].stock = 7;
  const key = storageKeyForMode("training");
  await AsyncStorage.setItem(key, encodeGameState(old));
  const permissionCalls = jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls.length;
  const watchCalls = jest.mocked(Location.watchPositionAsync).mock.calls.length;
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  await waitFor(async () => {
    const migrated = decodeGameState(await AsyncStorage.getItem(key), "training");
    const simulation = createGame({ origin: { latitude: 39.7392, longitude: -104.9903 }, seed: old.seed });
    expect(migrated).toEqual({
      ...old,
      origin: simulation.origin,
      ports: old.ports.map((port, index) => ({ ...port, position: simulation.ports[index].position })),
    });
  });
  expect(jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls).toHaveLength(permissionCalls);
  expect(jest.mocked(Location.watchPositionAsync).mock.calls).toHaveLength(watchCalls);
});

test("Expo entry point settles a Training shipment, pays for capacity and restores it", async () => {
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const mounted = await render(<RegisteredApp />);
  expect((await screen.findByRole("switch", { name: "Training simulator" })).props.value).toBe(true);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(await campaign("live")).toBeNull();

  await tab("Station");
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  await tab("Bridge");
  await press("Simulate approach to Wayfarer Freeport");
  await press("PAY");
  await tab("Hold");
  await press("Install reactive hull plating, 380 credits");
  await tab("Station");
  expect(screen.getAllByText(/485 CR available/).length).toBeGreaterThan(0);

  for (const commodity of ["Xeno Relics", "Xeno Relics", "Salvaged Circuits", "Ion Fuel"]) {
    await order("Buy", commodity, 1);
    await order("Sell", commodity, 1);
  }
  await tab("Hold");
  expect(screen.getByText("4 cr short")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Install expanded cargo pods, 320 credits" }).props.accessibilityState.disabled)
    .toBe(true);
  await tab("Station");

  await press("Open trade counter");
  await fireEvent.changeText(screen.getByLabelText("Ion Fuel units"), "9");
  expect(screen.getByRole("button", { name: "Buy Ion Fuel" }).props.accessibilityState.disabled).toBe(true);
  await order("Buy", "Ion Fuel", 8);
  expect(screen.getByText("Paid 296 cr · 37 cr per unit")).toBeTruthy();
  await tab("Compass");
  const target = /^Select Vela Outpost, unvisited/;
  await press(target);
  expect(screen.getByRole("tab", { name: "Bridge" }).props.accessibilityState.selected).toBe(true);
  expect(screen.getByRole("header", { name: "Vela Outpost" })).toBeTruthy();
  expect(screen.getByTestId("vista-flight")).toBeTruthy();
  await tab("Station");
  expect(screen.getByText("Wayfarer Freeport")).toBeTruthy();
  expect(screen.queryByText("Vela Outpost")).toBeNull();
  await tab("Bridge");
  await press("Simulate approach to Vela Outpost");
  expect(screen.getByTestId("vista-docked")).toBeTruthy();
  await tab("Compass");
  expect(screen.getByRole("button", { name: /^Select Vela Outpost, visited/ })).toBeTruthy();

  await tab("Station");
  await order("Sell", "Ion Fuel", 8);
  expect(screen.getByText("Sold 8 × Ion Fuel at Vela Outpost")).toBeTruthy();
  expect(screen.getByText("Proceeds 344 cr · 43 cr per unit")).toBeTruthy();
  expect(screen.getByText("Purchase cost 296 cr · Profit 48 cr")).toBeTruthy();
  await press("View ship upgrades");
  await press("Install expanded cargo pods, 320 credits");
  expect(screen.getAllByText("0/12").length).toBeGreaterThan(0);
  expect(screen.getByText("44 CR")).toBeTruthy();
  await waitFor(async () => expect((await campaign("training"))?.player.cargoCapacity).toBe(12));
  expect(await campaign("live")).toBeNull();

  await mounted.unmount();
  await render(<RegisteredApp />);
  expect((await screen.findByRole("switch", { name: "Training simulator" })).props.value).toBe(true);
  expect(screen.getByText("44 CR")).toBeTruthy();
  expect(screen.getByText("0/12")).toBeTruthy();
  await tab("Station");
  expect(screen.getByText("Purchase cost 296 cr · Profit 48 cr")).toBeTruthy();
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test("Expo reset cancels safely, isolates campaigns, and keeps Live paused across relaunch", async () => {
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const origin = { latitude: 0, longitude: .02 };
  const live = createGame({ origin, seed: "synthetic-reset-live" });
  live.player.credits = 777;
  const training = createGame({ origin: { latitude: 0, longitude: 0 }, seed: "synthetic-reset-training" });
  training.player.credits = 321;
  await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(live));
  await AsyncStorage.setItem(storageKeyForMode("live"), encodeGameState(live));
  await AsyncStorage.setItem(storageKeyForMode("training"), encodeGameState(training));
  await persistDockingCoordinator(createDockingCoordinator({ id: live.ports[0].id, coords: origin }));
  const before = await AsyncStorage.multiGet([
    storageKeyForMode("live"), LEGACY_STORAGE_KEY, DOCKING_SESSION_STORAGE_KEY,
  ]);

  const mounted = await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  const gpsCalls = jest.mocked(Location.getCurrentPositionAsync).mock.calls.length;
  const permissionCalls = jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls.length;
  const watchCalls = jest.mocked(Location.watchPositionAsync).mock.calls.length;
  const network = jest.spyOn(globalThis, "fetch");
  const share = jest.spyOn(Share, "share");

  await tab("Hold");
  expect(screen.getByText(/Live and Training have separate local saves/)).toBeTruthy();
  await press("Reset Training game data");
  await press("Cancel");
  expect((await campaign("training"))?.player.credits).toBe(321);
  await press("Reset Training game data");
  await press("Confirm Training reset");
  await screen.findByText("TRAINING GAME DATA RESET");
  expect(await AsyncStorage.getItem(storageKeyForMode("training"))).toBeNull();
  expect(await AsyncStorage.multiGet(before.map(([key]) => key))).toEqual(before);
  await press("Install expanded cargo pods, 320 credits");
  await waitFor(async () => expect((await campaign("training"))?.player.cargoCapacity).toBe(12));
  const trainingAfter = await AsyncStorage.getItem(storageKeyForMode("training"));
  await tab("Bridge");
  await fireEvent(screen.getByRole("switch", { name: "Training simulator" }), "valueChange", false);
  await tab("Hold");
  await press("Reset Live game data");
  await press("Cancel");
  expect(decodeGameState(await AsyncStorage.getItem(storageKeyForMode("live")), "live")?.origin).toEqual(origin);

  jest.mocked(TaskManager.isAvailableAsync).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  jest.mocked(Location.hasStartedGeofencingAsync).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  await press("Reset Live game data");
  await press("Confirm Live reset");
  await screen.findByText("LIVE GAME DATA RESET");
  expect(await AsyncStorage.getItem(storageKeyForMode("live"))).toBe(LIVE_RESET_MARKER);
  expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(DOCKING_SESSION_STORAGE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(storageKeyForMode("training"))).toBe(trainingAfter);
  expect(Location.stopGeofencingAsync).toHaveBeenCalledTimes(1);
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  await mounted.unmount();

  // Model a process interrupted just after persisting the reset marker.
  await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(live));
  await persistDockingCoordinator(createDockingCoordinator({ id: live.ports[0].id, coords: origin }));
  await render(<RegisteredApp />);
  const trainingToggle = await screen.findByRole("switch", { name: "Training simulator" });
  expect(trainingToggle.props.value).toBe(true);
  await fireEvent(trainingToggle, "valueChange", false);
  await screen.findByRole("button", { name: "Start live navigation" });
  expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(DOCKING_SESSION_STORAGE_KEY)).toBeNull();
  expect(jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls).toHaveLength(permissionCalls);
  expect(jest.mocked(Location.getCurrentPositionAsync).mock.calls).toHaveLength(gpsCalls);
  expect(jest.mocked(Location.watchPositionAsync).mock.calls).toHaveLength(watchCalls);
  expect(network).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(storageKeyForMode("training"))).toBe(trainingAfter);

  const newOrigin = { latitude: 40.7143559, longitude: -124.0990456 };
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({
    status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never",
  });
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce({
    coords: { ...newOrigin, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
  });
  jest.mocked(Location.watchPositionAsync).mockResolvedValueOnce({ remove() {} });
  await press("Start live navigation");
  await screen.findByRole("header", { name: "Humboldt" });
  expect(screen.queryByRole("button", { name: "Enter station market" })).toBeNull();
  expect(await campaign("live")).toBeNull();
  expect(await AsyncStorage.getItem(storageKeyForMode("training"))).toBe(trainingAfter);
});


test("the registered app fulfils the local contract once across failed save, retry and reload", async () => {
  const network = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline test"));
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  const animated = jest.spyOn(Animated, "timing");
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const gpsReads = jest.mocked(Location.getCurrentPositionAsync).mock.calls.length;
  const mounted = await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  await tab("Compass");
  expect(screen.queryByRole("header", { name: "Compass" })).toBeNull();
  expect(screen.getByTestId("port-compass")).toBeTruthy();
  expect(screen.getByText("North up · Straight-line range")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Select Cinder Exchange, unvisited, .* km · .* true/ })).toBeTruthy();
  expectPlainPortLanguage();
  expect(screen.queryByRole("button", { name: /enable public pilot/i })).toBeNull();
  await tab("Bridge");
  expect(screen.getByTestId("vista-flight")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enter station market" })).toBeNull();
  await press("Simulate approach to Wayfarer Freeport");
  await press("PAY");
  expect(screen.getByTestId("vista-docked")).toBeTruthy();
  await press("Enter station market");
  expect(screen.getByTestId("vista-market")).toBeTruthy();
  expect(screen.getByText("Cinder Reserve Run")).toBeTruthy();
  await press("Accept cargo contract");
  await screen.findByText("0 / 2 Ion Fuel reserved");
  await order("Buy", "Ion Fuel", 2);
  expect(screen.getByRole("button", { name: "Sell Ion Fuel" }).props.accessibilityState.disabled).toBe(true);
  await press("Open contract desk");
  await screen.findByText("2 / 2 Ion Fuel reserved");
  expect(screen.getByRole("button", { name: "Deliver reserved cargo" }).props.accessibilityState.disabled).toBe(true);
  await waitFor(async () => expect((await campaign("training"))?.delivery?.loaded).toBe(2));
  expect((await campaign("live"))?.delivery).toBeUndefined();

  await mounted.unmount();
  const resumed = await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  await tab("Station");
  expect(screen.getByText("2 / 2 Ion Fuel reserved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Deliver reserved cargo" }).props.accessibilityState.disabled).toBe(true);
  await tab("Compass");
  await press(/^Select Cinder Exchange, unvisited, .* (m|km) · .* true/);
  expect(screen.getByTestId("vista-flight")).toBeTruthy();
  expect(screen.getByText(/CND-04 · .* · Approach/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enter station market" })).toBeNull();
  expect(screen.getByRole("header", { name: "Cinder Exchange" })).toBeTruthy();
  await press("Simulate approach to Cinder Exchange");
  await press("PAY");
  expect(screen.getByTestId("vista-docked")).toBeTruthy();
  await press("Enter station market");
  await waitFor(async () => expect((await campaign("training"))?.dockedPortId).toBe("port-1"));
  const before = (await campaign("training"))!.player.credits;

  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("Test storage failure"));
  await press("Deliver reserved cargo");
  await screen.findByText("Test storage failure");
  expect((await campaign("training"))?.player.credits).toBe(before);
  expect(screen.getByText("2 / 2 Ion Fuel reserved")).toBeTruthy();

  await press("Deliver reserved cargo");
  await screen.findByText("Delivered · 150 cr paid");
  expect((await campaign("training"))?.player.credits).toBe(before + 150);
  expect((await campaign("training"))?.player.cargo.ion_fuel).toBeUndefined();
  expect(screen.queryByRole("button", { name: "Deliver reserved cargo" })).toBeNull();
  await resumed.unmount();

  await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  await tab("Station");
  expect(screen.getByText("Delivered · 150 cr paid")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Deliver reserved cargo" })).toBeNull();
  expect((await campaign("training"))?.player.credits).toBe(before + 150);
  expect((await campaign("live"))?.delivery).toBeUndefined();
  expect(jest.mocked(Location.getCurrentPositionAsync).mock.calls).toHaveLength(gpsReads);

  await tab("Hold");
  expect(screen.getByTestId("vista-cargo")).toBeTruthy();
  await press("Reset Training game data");
  await press("Confirm Training reset");
  await screen.findByText("TRAINING GAME DATA RESET");
  await tab("Station");
  expect(screen.getByRole("button", { name: "Accept cargo contract" })).toBeTruthy();
  expect(screen.queryByText("Delivered · 150 cr paid")).toBeNull();
  expect(network).not.toHaveBeenCalled();
  expect(animated.mock.calls.some(([, config]) => config.duration === 270)).toBe(false);
});

test("Training starts without permission and an explicit denied Live start preserves a Training berth", async () => {
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const permissionCalls = jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls.length;
  const reads = jest.mocked(Location.getCurrentPositionAsync).mock.calls.length;
  const motionRequests = jest.mocked(Location.requestMotionActivityPermissionsAsync).mock.calls.length;
  const motionWatches = jest.mocked(Location.watchMotionActivityAsync).mock.calls.length;
  await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  expect(screen.getByText(/WFR-00 · Humboldt · Approach/)).toBeTruthy();
  await press("Simulate approach to Wayfarer Freeport");
  await press("PAY");
  expect(screen.getByText(/WFR-00 · Humboldt · Docked/)).toBeTruthy();
  await fireEvent(screen.getByRole("switch", { name: "Training simulator" }), "valueChange", false);
  expect(jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls).toHaveLength(permissionCalls);
  await press("Start live navigation");
  await screen.findByText("Location permission denied");
  await tab("Compass");
  expect(screen.getByText("Port ranges unavailable")).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Bridge");
  expect(jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls).toHaveLength(permissionCalls + 1);
  expect(jest.mocked(Location.getCurrentPositionAsync).mock.calls).toHaveLength(reads);
  expect(jest.mocked(Location.requestMotionActivityPermissionsAsync).mock.calls).toHaveLength(motionRequests);
  expect(jest.mocked(Location.watchMotionActivityAsync).mock.calls).toHaveLength(motionWatches);
  await fireEvent(screen.getByRole("switch", { name: "Training simulator" }), "valueChange", true);
  expect(screen.getByTestId("vista-docked")).toBeTruthy();
  await press("Enter station market");
  expect(screen.getByText("Cinder Reserve Run")).toBeTruthy();
  expect(await campaign("live")).toBeNull();
});

test("Live reports drive-throughs, credits walking only and restores visits offline", async () => {
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const foster = { latitude: 37.5585, longitude: -122.2711 };
  const burlingame = { latitude: 37.5841, longitude: -122.3661 };
  const sanFrancisco = { latitude: 37.7599, longitude: -122.4384 };
  const border = { latitude: 37.708333, longitude: -122.45 };
  const grant = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" } as const;
  const network = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline test"));
  const time = jest.spyOn(Date, "now");
  let now = 2_000_000;
  time.mockImplementation(() => now);
  const fix = (point: typeof foster, timestamp = now, speed = 0): Location.LocationObject => ({
    coords: { ...point, accuracy: 5, altitude: null, altitudeAccuracy: null, speed, heading: null }, timestamp,
  });
  let listener: Location.LocationCallback | undefined;
  const remove = jest.fn();
  function allow(fixture: typeof foster) {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce(grant);
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce(fix(fixture));
    jest.mocked(Location.watchPositionAsync).mockImplementationOnce(async (_options, callback) => {
      listener = callback;
      return { remove };
    });
  }
  async function move(point: typeof foster, timestamp?: number, speed?: number) {
    await act(async () => listener!(fix(point, timestamp, speed)));
  }
  async function activity(kind: Location.MotionActivityType) {
    const motion = jest.mocked(Location.watchMotionActivityAsync).mock.calls.at(-1)![0];
    const activities = Object.fromEntries(["automotive", "cycling", "running", "walking", "stationary", "unknown"]
      .map((name) => [name, { detected: kind === name, confidence: kind === name ? 2 : 0 }])) as Location.MotionActivityObject["activities"];
    await act(async () => motion({ activities, timestamp: now }));
  }
  async function walk(point: typeof foster) {
    await activity("walking" as Location.MotionActivityType);
    await move(point, undefined, 1.5);
    for (let segment = 1; segment <= 4; segment++) {
      now += 5_000;
      await activity("walking" as Location.MotionActivityType);
      await move({ ...point, latitude: point.latitude + segment * 0.000068 }, undefined, 1.5);
    }
  }
  const old = createGame({ origin: { latitude: 0, longitude: 0 } });
  old.player.credits = 1042;
  const archive = encodeGameState(old);
  await AsyncStorage.setItem(storageKeyForMode("live"), archive);
  downloaded.restart();
  downloaded.offline(false);
  const mounted = await render(<RegisteredApp />);
  const training = await screen.findByRole("switch", { name: "Training simulator" });
  await fireEvent(training, "valueChange", false);
  await tab("Compass");
  expect(screen.getByTestId("port-compass")).toBeTruthy();
  expect(screen.getByText("Port ranges unavailable")).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Bridge");
  allow(foster);
  await press("Start live navigation");
  await screen.findByRole("header", { name: "San Mateo" });
  expect(screen.getByText("Arrived in San Mateo")).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Compass");
  expect(screen.getByText("Current port")).toBeTruthy();
  const beforeRange = screen.getByLabelText(/^San Francisco, .* true$/).props.accessibilityLabel;
  await tab("Bridge");
  await screen.findByText("Walk inside this port to log a visit and unlock its market");
  expect(await campaign("live")).toBeNull();
  now += 1_000;
  await walk(foster);
  await press("Enter station market");
  await order("Buy", "Ion Fuel", 1);
  await waitFor(async () => expect((await campaign("live"))?.player.cargo.ion_fuel).toBe(1));
  const first = (await campaign("live"))!;
  expect(first.player.credits).toBeLessThan(1042);
  expect(first.discoveredPortIds).toEqual(["county:06081"]);
  expect(first.dockedPortId).toBeNull();
  expect(screen.getByText("Bought 1 × Ion Fuel at San Mateo")).toBeTruthy();

  await move(foster); // Duplicate timestamp.
  now += 1000;
  await move(burlingame);
  expect(screen.getByText("Arrived in San Mateo")).toBeTruthy();
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  expect(await campaign("live")).toEqual(first);
  const saved = await AsyncStorage.getItem(COUNTY_LIVE_STORAGE_KEY);
  expect(saved).not.toContain(String(burlingame.latitude));
  expect(saved).not.toContain(String(burlingame.longitude));
  await tab("Compass");
  expect(screen.getByLabelText(/^San Francisco, .* true$/).props.accessibilityLabel).not.toBe(beforeRange);
  await tab("Station");

  for (const latitude of [border.latitude - .00009, border.latitude + .00009]) {
    now += 1000;
    await move({ ...border, latitude });
    expect(screen.getByText("Market encrypted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Buy Ion Fuel/ })).toBeNull();
  }
  expect(await campaign("live")).toEqual(first);
  now += 1000;
  await activity("automotive" as Location.MotionActivityType);
  await move(sanFrancisco, undefined, 22);
  await screen.findByText("Arrived in San Francisco");
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  for (const speed of [0, 1.2, 0, 3.5, 0]) {
    now += 5_000;
    await activity((speed > 0 ? "automotive" : "stationary") as Location.MotionActivityType);
    await move(sanFrancisco, undefined, speed);
    expect(await campaign("live")).toEqual(first);
  }
  now += 31_000;
  await walk(sanFrancisco);
  expect(screen.getByRole("button", { name: /^Buy Ion Fuel/ })).toBeTruthy();
  await waitFor(async () => expect((await campaign("live"))?.discoveredPortIds)
    .toEqual(["county:06081", "county:06075"]));
  await tab("Compass");
  expect(screen.getByText("San Francisco")).toBeTruthy();
  expect(screen.getByLabelText(/^San Mateo, .* true$/)).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Station");
  for (let i = 0; i < 25; i++) {
    now += 5_000;
    await move({ ...sanFrancisco, latitude: sanFrancisco.latitude + 4 * 0.000068 });
  }
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  expect((await campaign("live"))?.discoveredPortIds).toEqual(["county:06081", "county:06075"]);
  const crossingTime = now;
  now += 31_000;
  await move(sanFrancisco, crossingTime + 1);
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  expect(screen.getByText("Location fix expired")).toBeTruthy();
  expect(await AsyncStorage.getItem(storageKeyForMode("live"))).toEqual(archive);
  expect(network).not.toHaveBeenCalled();
  expect(downloaded.paths.every((path) => /^(?:(?:index|counties)\.json|tiles\/-?\d+_-?\d+\.json)$/.test(path))).toBe(true);

  await mounted.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  downloaded.restart();
  downloaded.offline(true);
  try {
    const requests = downloaded.paths.length;
    await render(<RegisteredApp />);
    const switchAgain = await screen.findByRole("switch", { name: "Training simulator" });
    await fireEvent(switchAgain, "valueChange", false);
    await tab("Station");
    expect(screen.getByText("Market encrypted")).toBeTruthy();
    await tab("Bridge");
    allow(sanFrancisco);
    jest.mocked(Location.requestMotionActivityPermissionsAsync).mockResolvedValueOnce({
      ...mockMotionGrant, granted: false, status: Location.PermissionStatus.DENIED,
    });
    await press("Start live navigation");
    await screen.findByRole("header", { name: "San Francisco" });
    expect(downloaded.paths).toHaveLength(requests);
    await screen.findByText("Allow Physical activity to log visits and trade");
    expect(screen.queryByRole("button", { name: "Enter station market" })).toBeNull();
    expect((await campaign("live"))?.discoveredPortIds).toEqual(["county:06081", "county:06075"]);
    expect((await campaign("live"))?.player.cargo.ion_fuel).toBe(1);
    now += 1000;
    await move({ latitude: 38.9072, longitude: -77.0369 });
    await waitFor(() => expect(screen.queryByText("Arrived in San Francisco")).toBeNull());
    await tab("Station");
    expect(screen.getByText("Market encrypted")).toBeTruthy();
  } finally {
    downloaded.offline(false);
  }
});

const contacts = [
  { type: "pirates", portId: "county:06001", name: "Alameda", title: "Pirate contact",
    point: { latitude: 37.68, longitude: -121.80 }, ranks: { crime: 6, patrol: 6 } },
  { type: "customs", portId: "county:06075", name: "San Francisco", title: "Customs patrol",
    point: { latitude: 37.7599, longitude: -122.4384 }, ranks: { crime: 6, patrol: 7 } },
] as const;

test.each(contacts.flatMap((contact) => (["Evade", "Stop", "Surrender", "Fight"] as const)
  .map((choice) => ({ ...contact, choice }))))("$title: $choice is accepted once after walking", async (fixture) => {
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const rankReads = jest.spyOn(downloaded.atlas, "ranksFor").mockResolvedValue(fixture.ranks);
  downloaded.restart();
  downloaded.offline(false);
  let now = 2_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  const gps = (point: { latitude: number; longitude: number } = fixture.point, speed = 0): Location.LocationObject => ({
    coords: { ...point, accuracy: 5, speed, altitude: null, altitudeAccuracy: null, heading: null },
    timestamp: now,
  });
  let location: Location.LocationCallback;
  let motion: Location.MotionActivityCallback;
  const pushMotion = async (kind: string, timestamp = now) => {
    const activities = Object.fromEntries(["automotive", "cycling", "running", "walking", "stationary", "unknown"]
      .map((key) => [key, { detected: key === kind, confidence: key === kind ? 2 : 0 }])) as Location.MotionActivityObject["activities"];
    await act(async () => motion({ activities, timestamp }));
  };
  function allow(request = true) {
    if (request) jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({
      ...mockMotionGrant, status: Location.PermissionStatus.GRANTED,
    });
    jest.mocked(Location.watchPositionAsync).mockImplementationOnce(async (_options, callback) => {
      location = callback;
      return { remove() {} };
    });
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce(gps(fixture.point, 20));
    jest.mocked(Location.watchMotionActivityAsync).mockImplementationOnce(async (callback) => {
      motion = callback;
      return { remove() {} };
    });
  }
  async function open() {
    const mounted = await render(<RegisteredApp />);
    await fireEvent(await screen.findByRole("switch", { name: "Training simulator" }), "valueChange", false);
    allow();
    await press("Start live navigation");
    await screen.findByRole("header", { name: fixture.name });
    await screen.findByText("Walk inside this port to log a visit and unlock its market");
    return mounted;
  }
  async function qualify() {
    now += 31_000;
    for (let sample = 0; sample <= 4; sample++) {
      now += 5_000;
      await pushMotion("walking");
      await act(async () => location(gps({ ...fixture.point, latitude: fixture.point.latitude + sample * .000068 }, 1.5)));
    }
  }

  let appStateListener: ((state: typeof AppState.currentState) => void) | undefined;
  if (fixture.type === "pirates" && fixture.choice === "Stop") {
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, listener) => {
      if (event === "change") appStateListener = listener;
      return { remove() {} };
    });
  }
  const mounted = await open();
  await pushMotion("automotive");
  expect(screen.queryByRole("header", { name: fixture.title })).toBeNull();
  expect(await campaign("live")).toBeNull();
  await qualify();
  await screen.findByRole("header", { name: fixture.title });
  await waitFor(async () => expect((await campaign("live"))?.pendingLiveEncounter?.type).toBe(fixture.type));
  const pending = (await campaign("live"))!;
  expect(rankReads).toHaveBeenCalledTimes(1);
  await act(async () => location(gps()));
  expect(rankReads).toHaveBeenCalledTimes(1);
  await press("Later");
  expect(screen.queryByRole("header", { name: fixture.title })).toBeNull();
  await press("Open encounter alert");
  if (appStateListener) {
    await act(async () => {
      AppState.currentState = "background";
      appStateListener!("background");
    });
    expect(screen.queryByRole("header", { name: fixture.title })).toBeNull();
    expect((await campaign("live"))?.pendingLiveEncounter).toEqual(pending.pendingLiveEncounter);
    now += 1_000;
    allow(false);
    await act(async () => {
      AppState.currentState = "active";
      appStateListener!("active");
    });
    expect(screen.queryByRole("header", { name: fixture.title })).toBeNull();
    await qualify();
    await screen.findByRole("header", { name: fixture.title });
    expect(rankReads).toHaveBeenCalledTimes(1);
  }

  now += 1_000;
  await pushMotion("automotive");
  await act(async () => location(gps(fixture.point, 18)));
  expect(screen.queryByRole("button", { name: fixture.choice })).toBeNull();
  expect((await campaign("live"))?.pendingLiveEncounter).toEqual(pending.pendingLiveEncounter);
  await mounted.unmount();

  await open();
  expect(screen.queryByRole("header", { name: fixture.title })).toBeNull();
  await qualify();
  await screen.findByRole("header", { name: fixture.title });
  const setItem = jest.mocked(AsyncStorage.setItem);
  const save = setItem.getMockImplementation()!;
  let finishSave!: () => void;
  setItem.mockImplementationOnce(async (key, value) => {
    await new Promise<void>((resolve) => { finishSave = resolve; });
    return save(key, value);
  });
  const selected = screen.getByRole("button", { name: fixture.choice });
  await fireEvent.press(selected);
  expect(screen.getByRole("button", { name: fixture.choice }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(selected);
  await act(async () => { finishSave(); });
  const writes = setItem.mock.calls.filter(([key]) => key === COUNTY_LIVE_STORAGE_KEY);
  expect(writes.some(([, value]) => decodeGameState(value, "county-live")?.pendingLiveEncounter)).toBe(true);
  await screen.findByText("CONTACT RESOLVED · " + fixture.choice.toUpperCase());
  const expected = resolveLiveContact(pending, fixture.portId, fixture.choice.toLowerCase() as LiveContactChoice);
  await waitFor(async () => expect(await campaign("live")).toEqual(expected));
  expect(screen.queryByRole("header", { name: fixture.title })).toBeNull();
  expect(rankReads).toHaveBeenCalledTimes(1);
});


const nationalAtlas = process.env.WAYFARER_ATLAS_TEST_DATA;
(nationalAtlas ? test : test.skip)("registered Live Compass opens a real bundled port on first launch offline", async () => {
  const network = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline test"));
  const fileRead = jest.mocked(FileSystem.readAsStringAsync);
  fileRead.mockImplementation(async (uri) => {
    const root = "asset:///wayfarer-atlas/";
    if (!uri.startsWith(root)) throw new Error("Not an APK asset");
    const path = uri.slice(root.length);
    return path.startsWith("tiles/")
      ? gunzipSync(readFileSync(join(nationalAtlas!, path + ".gz"))).toString()
      : readFileSync(join(nationalAtlas!, path), "utf8");
  });
  const actual = jest.requireActual<typeof import("../src/atlas/download")>("../src/atlas/download").atlas;
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const grant = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" } as const;
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce(grant);
  jest.mocked(Location.watchPositionAsync).mockResolvedValueOnce({ remove: jest.fn() });
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce({
    timestamp: Date.now(),
    coords: { latitude: 37.5585, longitude: -122.2711, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: 0 },
  });
  downloaded.use(actual);
  try {
    await render(<RegisteredApp />);
    await fireEvent(await screen.findByRole("switch", { name: "Training simulator" }), "valueChange", false);
    await press("Start live navigation");
    await screen.findByText("Arrived in San Mateo");
    await tab("Compass");
    expect(screen.getByText("Current port")).toBeTruthy();
    const compass = screen.getByTestId("port-compass");
    expect(within(compass).getByText("San Mateo")).toBeTruthy();
    expect(screen.getByLabelText(/^San Francisco, .* true$/)).toBeTruthy();
    expect(within(screen.getByTestId("port-signal-NE")).getByText("Alameda")).toBeTruthy();
    expect(screen.getByText("North up · Straight-line range")).toBeTruthy();
    expect(screen.queryByText("No heading available")).toBeNull();
    expect(await actual.ranksFor("county:06081")).toEqual({ crime: expect.any(Number), patrol: expect.any(Number) });
    expect(fileRead).toHaveBeenCalledWith("asset:///wayfarer-atlas/counties.json");
    expect(network).not.toHaveBeenCalled();
  } finally {
    downloaded.restart();
    fileRead.mockReset();
  }
});
