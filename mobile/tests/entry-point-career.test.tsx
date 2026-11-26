
import { afterEach, expect, jest, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { registerRootComponent } from "expo";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Share } from "react-native";

import "../index";
import { createGame } from "../src/game/engine";
import { decodeGameState, encodeGameState, LEGACY_STORAGE_KEY, LIVE_RESET_MARKER, storageKeyForMode } from "../src/persistence";
import { createDockingCoordinator } from "../src/ui/dockingCoordinator";
import { DOCKING_SESSION_STORAGE_KEY, persistDockingCoordinator } from "../src/ui/dockingSessionStore";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo", () => ({ ...jest.requireActual<typeof import("expo")>("expo"), registerRootComponent: jest.fn() }));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  hasStartedGeofencingAsync: jest.fn(async () => false),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  stopGeofencingAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  Accuracy: { Balanced: 3 },
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

function tab(name: string) {
  return fireEvent.press(screen.getByRole("tab", { name: new RegExp(name) }));
}

async function order(side: "Buy" | "Sell", commodity: string, quantity: number) {
  await fireEvent.changeText(screen.getByLabelText(`${commodity} units`), String(quantity));
  await press(new RegExp(`^${side} ${commodity},`));
}

async function campaign(mode: "live" | "training") {
  return decodeGameState(await AsyncStorage.getItem(storageKeyForMode(mode)));
}

test("Expo entry point settles a Training shipment, pays for capacity and restores it", async () => {
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const mounted = await render(<RegisteredApp />);
  expect((await screen.findByRole("switch", { name: "Training simulator" })).props.value).toBe(true);
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  await waitFor(async () => expect(await campaign("live")).not.toBeNull());
  const liveBefore = await campaign("live");

  await tab("MARKET");
  expect(screen.getByText("MARKET ENCRYPTED")).toBeTruthy();
  await tab("CHART");
  await press(/SIMULATE 10 MIN QUALIFICATION · WFR-00/);
  await press("PAY");
  await tab("SHIP");
  await press("Install reactive hull plating, 380 credits");
  await tab("MARKET");
  expect(screen.getAllByText("485 CR").length).toBeGreaterThan(0);

  for (const commodity of ["Xeno Relics", "Xeno Relics", "Salvaged Circuits", "Ion Fuel"]) {
    await order("Buy", commodity, 1);
    await order("Sell", commodity, 1);
  }
  await tab("SHIP");
  expect(screen.getByText("4 cr short")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Install expanded cargo pods, 320 credits" }).props.accessibilityState.disabled)
    .toBe(true);
  await tab("MARKET");

  await fireEvent.changeText(screen.getByLabelText("Ion Fuel units"), "9");
  expect(screen.getByRole("button", { name: "Buy Ion Fuel" }).props.accessibilityState.disabled).toBe(true);
  await order("Buy", "Ion Fuel", 8);
  expect(screen.getByText("Paid 296 cr · 37 cr per unit")).toBeTruthy();
  await tab("CHART");
  const target = /^Select Vela Outpost, unvisited/;
  await press("Port list · 1 of 7 visited");
  await press(target);
  expect(screen.getByRole("button", { name: target }).props.accessibilityState.selected).toBe(true);
  await tab("MARKET");
  expect(screen.getByText("Wayfarer Freeport")).toBeTruthy();
  expect(screen.queryByText("Vela Outpost")).toBeNull();
  await tab("CHART");
  await press(/SIMULATE 10 MIN QUALIFICATION · VEL-09/);
  expect(screen.getByRole("button", { name: /^Select Vela Outpost, visited/ })).toBeTruthy();
  expect(screen.getByText("Port list · 2 of 7 visited")).toBeTruthy();

  await tab("MARKET");
  await order("Sell", "Ion Fuel", 8);
  expect(screen.getByText("Sold 8 × Ion Fuel at Vela Outpost")).toBeTruthy();
  expect(screen.getByText("Proceeds 344 cr · 43 cr per unit")).toBeTruthy();
  expect(screen.getByText("Purchase cost 296 cr · Profit 48 cr")).toBeTruthy();
  await press("View ship upgrades");
  await press("Install expanded cargo pods, 320 credits");
  expect(screen.getAllByText("0/12").length).toBeGreaterThan(0);
  expect(screen.getByText("44 CR")).toBeTruthy();
  await waitFor(async () => expect((await campaign("training"))?.player.cargoCapacity).toBe(12));
  expect(await campaign("live")).toEqual(liveBefore);

  await mounted.unmount();
  await render(<RegisteredApp />);
  expect((await screen.findByRole("switch", { name: "Training simulator" })).props.value).toBe(true);
  expect(screen.getByText("44 CR")).toBeTruthy();
  expect(screen.getByText("0/12")).toBeTruthy();
  await tab("MARKET");
  expect(screen.getByText("Purchase cost 296 cr · Profit 48 cr")).toBeTruthy();
  expect(screen.getByText("MARKET ENCRYPTED")).toBeTruthy();
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

  await tab("SHIP");
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
  await tab("CHART");
  await fireEvent(screen.getByRole("switch", { name: "Training simulator" }), "valueChange", false);
  await tab("SHIP");
  await press("Reset Live game data");
  await press("Cancel");
  expect((await campaign("live"))?.origin).toEqual(origin);

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
  await screen.findByRole("button", { name: "Start live navigation" });
  expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  expect(await AsyncStorage.getItem(DOCKING_SESSION_STORAGE_KEY)).toBeNull();
  expect(jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls).toHaveLength(permissionCalls);
  expect(jest.mocked(Location.getCurrentPositionAsync).mock.calls).toHaveLength(gpsCalls);
  expect(jest.mocked(Location.watchPositionAsync).mock.calls).toHaveLength(watchCalls);
  expect(network).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(storageKeyForMode("training"))).toBe(trainingAfter);

  const newOrigin = { latitude: 0, longitude: .03 };
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({
    status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never",
  });
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce({
    coords: { ...newOrigin, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
  });
  jest.mocked(Location.watchPositionAsync).mockResolvedValueOnce({ remove() {} });
  await press("Start live navigation");
  await screen.findByText("GPS LOCK · ±5 M");
  await waitFor(async () => expect((await campaign("live"))?.origin).toEqual(newOrigin));
  expect((await campaign("live"))?.player.credits).toBe(900);
  expect(await AsyncStorage.getItem(storageKeyForMode("training"))).toBe(trainingAfter);
});


test("the registered app fulfils the local contract once across failed save, retry and reload", async () => {
  const network = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline test"));
  const [[RegisteredApp]] = jest.mocked(registerRootComponent).mock.calls;
  const gpsReads = jest.mocked(Location.getCurrentPositionAsync).mock.calls.length;
  const mounted = await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  await tab("CHART");
  expect(screen.getByText(/Public pilot preset unavailable/)).toBeTruthy();
  expect(screen.getByText(/Do not travel to these points/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /enable public pilot/i })).toBeNull();
  await press(/SIMULATE 10 MIN QUALIFICATION · WFR-00/);
  await press("PAY");
  await tab("MARKET");
  expect(screen.getByText("Cinder Reserve Run")).toBeTruthy();
  await press("Accept cargo contract");
  await screen.findByText("0 / 2 Ion Fuel reserved");
  await order("Buy", "Ion Fuel", 2);
  await screen.findByText("2 / 2 Ion Fuel reserved");
  expect(screen.getByRole("button", { name: "Sell Ion Fuel" }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Deliver reserved cargo" }).props.accessibilityState.disabled).toBe(true);
  await waitFor(async () => expect((await campaign("training"))?.delivery?.loaded).toBe(2));
  expect((await campaign("live"))?.delivery).toBeUndefined();

  await mounted.unmount();
  const resumed = await render(<RegisteredApp />);
  await screen.findByRole("switch", { name: "Training simulator" });
  await tab("MARKET");
  expect(screen.getByText("2 / 2 Ion Fuel reserved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Deliver reserved cargo" }).props.accessibilityState.disabled).toBe(true);
  await tab("CHART");
  await press("Port list · 1 of 7 visited");
  await press(/^Select Cinder Exchange, unvisited/);
  await press(/SIMULATE 10 MIN QUALIFICATION · CND-04/);
  await press("PAY");
  await tab("MARKET");
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
  await tab("MARKET");
  expect(screen.getByText("Delivered · 150 cr paid")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Deliver reserved cargo" })).toBeNull();
  expect((await campaign("training"))?.player.credits).toBe(before + 150);
  expect((await campaign("live"))?.delivery).toBeUndefined();
  expect(jest.mocked(Location.getCurrentPositionAsync).mock.calls).toHaveLength(gpsReads);

  await tab("SHIP");
  await press("Reset Training game data");
  await press("Confirm Training reset");
  await screen.findByText("TRAINING GAME DATA RESET");
  await tab("MARKET");
  expect(screen.getByRole("button", { name: "Accept cargo contract" })).toBeTruthy();
  expect(screen.queryByText("Delivered · 150 cr paid")).toBeNull();
  expect(network).not.toHaveBeenCalled();
});
