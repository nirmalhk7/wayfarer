
import { afterEach, expect, jest, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { registerRootComponent } from "expo";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AccessibilityInfo, Animated, Share } from "react-native";

import "../index";
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
const downloaded = jest.requireMock("../src/atlas/download") as ReturnType<typeof import("./atlas-fixture")["atlasFixture"]>;

jest.mock("expo", () => ({ ...jest.requireActual<typeof import("expo")>("expo"), registerRootComponent: jest.fn() }));
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
  expect(screen.getByText("2 of 7 scenarios visited")).toBeTruthy();

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
  await waitFor(async () => expect((await campaign("live"))?.discoveredPortIds).toEqual(["county:06023"]));
  expect((await campaign("live"))?.player.credits).toBe(900);
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
  expect(screen.getByRole("header", { name: "Compass" })).toBeTruthy();
  expect(screen.getByTestId("port-compass")).toBeTruthy();
  expect(screen.getByText("Straight-line range from your simulated ship to each scenario.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Select Cinder Exchange, unvisited, .* km · .* true/ })).toBeTruthy();
  expectPlainPortLanguage();
  expect(screen.getByText(/Do not travel to these points/)).toBeTruthy();
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
  expect(screen.getByText("Port ranges need a fresh, accurate fix and downloaded port data.")).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Bridge");
  expect(jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls).toHaveLength(permissionCalls + 1);
  expect(jest.mocked(Location.getCurrentPositionAsync).mock.calls).toHaveLength(reads);
  await fireEvent(screen.getByRole("switch", { name: "Training simulator" }), "valueChange", true);
  expect(screen.getByTestId("vista-docked")).toBeTruthy();
  await press("Enter station market");
  expect(screen.getByText("Cinder Reserve Run")).toBeTruthy();
  expect(await campaign("live")).toBeNull();
});

test("Live keeps one market within San Mateo, changes across counties, and reuses cached data offline", async () => {
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
  const fix = (point: typeof foster, timestamp = now): Location.LocationObject => ({
    coords: { ...point, accuracy: 5, altitude: null, altitudeAccuracy: null, speed: null, heading: null }, timestamp,
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
  async function move(point: typeof foster, timestamp?: number) {
    await act(async () => listener!(fix(point, timestamp)));
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
  expect(screen.getByText("Port ranges need a fresh, accurate fix and downloaded port data.")).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Bridge");
  allow(foster);
  await press("Start live navigation");
  await screen.findByRole("header", { name: "San Mateo" });
  expect(screen.getByText("Arrived in San Mateo")).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Compass");
  expect(screen.getByText("Current port")).toBeTruthy();
  const beforeRange = screen.getByRole("button", { name: /^San Francisco, .* true$/ }).props.accessibilityLabel;
  await tab("Bridge");
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
  expect(screen.getByRole("header", { name: "San Mateo" })).toBeTruthy();
  expect(await campaign("live")).toEqual(first);
  const saved = await AsyncStorage.getItem(COUNTY_LIVE_STORAGE_KEY);
  expect(saved).not.toContain(String(burlingame.latitude));
  expect(saved).not.toContain(String(burlingame.longitude));
  await tab("Compass");
  expect(screen.getByRole("button", { name: /^San Francisco, .* true$/ }).props.accessibilityLabel).not.toBe(beforeRange);
  await tab("Station");

  for (const latitude of [border.latitude - .00009, border.latitude + .00009]) {
    now += 1000;
    await move({ ...border, latitude });
    expect(screen.getByText("Market encrypted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Buy Ion Fuel/ })).toBeNull();
  }
  expect(await campaign("live")).toEqual(first);
  now += 1000;
  await move(sanFrancisco);
  await screen.findByRole("header", { name: "San Francisco" });
  expect(screen.getByRole("button", { name: /^Buy Ion Fuel/ })).toBeTruthy();
  await waitFor(async () => expect((await campaign("live"))?.discoveredPortIds)
    .toEqual(["county:06081", "county:06075"]));
  await tab("Compass");
  expect(screen.getByText("San Francisco")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^San Mateo, .* true$/ })).toBeTruthy();
  expectPlainPortLanguage();
  await tab("Station");
  const crossingTime = now;
  now += 31_000;
  await move(sanFrancisco, crossingTime + 1);
  expect(screen.getByText("Market encrypted")).toBeTruthy();
  expect(screen.getByText("Location fix expired")).toBeTruthy();
  expect(await AsyncStorage.getItem(storageKeyForMode("live"))).toEqual(archive);
  expect(network).not.toHaveBeenCalled();
  expect(downloaded.paths.every((path) => /^(?:index\.json|tiles\/-?\d+_-?\d+\.json)$/.test(path))).toBe(true);

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
    await press("Start live navigation");
    await screen.findByRole("header", { name: "San Francisco" });
    expect(downloaded.paths).toHaveLength(requests);
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
