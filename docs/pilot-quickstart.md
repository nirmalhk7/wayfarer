# Wayfarer local pilot quickstart

## Apply the handoff

Use a clean checkout of GitHub main at `659f49700a52cd1945520b49387d5b311cd7449f`.

```sh
git switch -c wayfarer-local-pilot
git apply --check /path/to/wayfarer-pilot.patch
git apply /path/to/wayfarer-pilot.patch
```

Install the locked dependencies once using Node.js 22.13 or later. The checks that follow use the installed dependencies.

```sh
npm ci
npm --prefix mobile ci
```

## Verify and play locally

```sh
npm test
npm run typecheck
npm run lint
npm --prefix mobile run check
(cd mobile && CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform android)
```

For the standalone browser smoke test, install Python Playwright and a Chromium runtime once. Run the following from the repository root after `npm test`. Set `WAYFARER_TEST_CHROMIUM` to an existing Chromium executable if using a system binary. The test serves the production route on local port 4197, blocks outbound requests, and disconnects after initial load.

```sh
python tests/pilot-offline.py
```

Set `WAYFARER_SCREENSHOTS_DIR` to save the browser chart, contract and upgraded ship manifest from the synthetic walkthrough.

To play manually, run `npm run start -- --port 4197` and open `http://127.0.0.1:4197/`. For the native Android app, use `npm --prefix mobile run android` with a local Android SDK and emulator or device. The Metro export verifies JavaScript bundling. Installing and running the native app requires the Android tools.

In Training, start at Wayfarer Freeport and accept **Cinder Reserve Run** in the market. On Android, simulate qualification at the freeport and resolve any encounter before accepting. Buy two Ion Fuel, select Cinder Exchange, simulate arrival, qualify or request docking, and deliver for 150 credits. Check the completed receipt after restart. From the ship's local data controls, reset the disposable Training campaign and confirm the offer returns.

The clients display generated test points for simulation. The public preset is unavailable pending the checks in [the desk audit](public-pilot-audit.md). The browser smoke test verifies play after connection loss and reload from loopback. A disconnected cold web launch is outside the test.
