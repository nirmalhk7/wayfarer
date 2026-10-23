import { act, fireEvent, render } from "@testing-library/react-native";
import { afterEach, expect, jest, test } from "@jest/globals";

import {
  BackgroundPermissionModal,
  DockingStatusCard,
} from "../src/ui/DockingStatusCard";
import {
  createDockingCoordinator,
} from "../src/ui/dockingCoordinator";

afterEach(() => { jest.useRealTimers(); });

test("status card renders countdown and foreground-only permission action", async () => {
  const onEnableBackground = jest.fn();
  const armed = createDockingCoordinator({
    id: "port-0",
    coords: { latitude: 39.7392, longitude: -104.9903 },
  });
  const view = await render(
    <DockingStatusCard
      coordinator={{
        ...armed,
        session: {
          ...armed.session,
          status: "qualifying",
          qualifiedMs: 475_000,
        },
      }}
      foregroundOnly
      onEnableBackground={onEnableBackground}
    />,
  );

  expect(view.getByText("02:05 REMAINING")).toBeTruthy();
  expect(view.getByText(/foreground only/i)).toBeTruthy();
  fireEvent.press(view.getByRole("button", { name: /enable background/i }));
  expect(onEnableBackground).toHaveBeenCalledTimes(1);
});

test("paused grace countdown advances inside the card and stops at expiry", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000);
  const armed = createDockingCoordinator({
    id: "port-0",
    coords: { latitude: 39.7392, longitude: -104.9903 },
  });
  const coordinator = {
    ...armed,
    session: {
      ...armed.session,
      status: "paused" as const,
      qualifiedMs: 120_000,
      pausedAt: 1_000,
    },
  };
  const view = await render(
    <DockingStatusCard
      coordinator={coordinator}
      foregroundOnly={false}
      onEnableBackground={() => {}}
    />,
  );

  expect(view.getByText(/Signal recovery grace: 30 seconds remaining/i)).toBeTruthy();
  const timersWhileTicking = jest.getTimerCount();
  await act(async () => { jest.advanceTimersByTime(1_000); });
  expect(view.getByText(/Signal recovery grace: 29 seconds remaining/i)).toBeTruthy();
  for (let second = 0; second < 29; second += 1) {
    await act(async () => { jest.advanceTimersByTime(1_000); });
  }
  expect(view.getByText(/Signal recovery grace: 0 seconds remaining/i)).toBeTruthy();
  expect(jest.getTimerCount()).toBeLessThan(timersWhileTicking);
});

test("restored expired grace catches up without replaying thirty seconds", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(31_001);
  const armed = createDockingCoordinator({
    id: "port-0",
    coords: { latitude: 39.7392, longitude: -104.9903 },
  });
  const coordinator = {
    ...armed,
    session: {
      ...armed.session,
      status: "paused" as const,
      pausedAt: 1_000,
    },
  };
  const view = await render(
    <DockingStatusCard
      coordinator={coordinator}
      foregroundOnly={false}
      onEnableBackground={() => {}}
    />,
  );

  await act(async () => { jest.advanceTimersByTime(0); });
  expect(view.getByText(/Signal recovery grace: 0 seconds remaining/i)).toBeTruthy();
  expect(jest.getTimerCount()).toBeLessThanOrEqual(2);
});

test("Android explanation requires an explicit continue before system permission request", async () => {
  const onContinue = jest.fn();
  const onCancel = jest.fn();
  const view = await render(
    <BackgroundPermissionModal
      onCancel={onCancel}
      onContinue={onContinue}
      visible
    />,
  );

  expect(view.getByText(/Android opens system settings/i)).toBeTruthy();
  expect(onContinue).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: /continue to settings/i }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});
