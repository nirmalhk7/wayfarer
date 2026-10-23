# Wayfarer performance and unnecessary-code audit

Audit date: 2026-08-14. Scope: tracked Vinext web app and the present, untracked
`mobile/` Expo app. The audit and 5.6 score below describe the pre-fix baseline.
A later implementation pass is recorded in the attempt ledger at the end; the
original auditor score is retained for independent re-audit.

## Executive result

**Pre-fix strict score: 5.6 / 10.** The web MVP has a small initial client payload
and fast local warm responses, but the mobile app performs a full root render every
second, has React-detected cascading state updates, and lacks a reproducible mobile
bundle/runtime profiling baseline. Two large static artifacts also create avoidable
transfer/repository cost. This is not production-ready performance evidence, so the
score is intentionally well below 9.

## Methodology and reproducible baseline

Measure first, then classify findings as either measured/proven, code-backed runtime
risks, or unnecessary code. Static inspection searched all source outside dependency
and generated-output directories for render loops, storage, location APIs, collection
work, timers, dynamic imports, and static asset references. File/line references use
the audited worktree.

| Command | Result |
| --- | --- |
| `node -v; npm -v` | Node `v24.1.0`; npm `11.3.0` |
| `time npm run typecheck` | passed; `3.207 s` wall |
| `time npm run build` | passed; `8.884 s` wall; 219 client-reference modules, 118 client-environment modules |
| `time npm test` | passed: 19 web tests; `7.658 s` wall. Rendered HTML test was `172.259 ms` in that run. |
| `time npm -C mobile run typecheck` | passed; `2.941 s` wall |
| `time npm -C mobile test` | passed: 96 pure + 2 UI tests; `8.958 s` wall |
| `time npm run lint` | **failed:** 10 errors, 1 warning, all under `mobile/`; key render/effect errors listed below |
| production response measurement | after `npm run build`, temporary `npm run start`, then five `curl` requests to `/`: status 200, 21,489 bytes each; TTFB `109.292, 11.546, 9.044, 7.824, 9.873 ms`; total `109.780, 12.821, 9.534, 8.191, 10.123 ms` |
| client output sizes | framework `190,152 B` raw / `58,969 B` gzip; index `176,572 B` / `50,962 B`; GameShell `16,871 B` / `5,893 B`; CSS `14,985 B` / `4,334 B` |
| static assets | `public/og.png` is `1,934,092 B` (`1,921,019 B` gzip); generated `dist/client/og.png` is 2,112 KiB. `mobile/artifacts/Wayfarer-android-mvp.apk` is 66 MiB but ignored by `mobile/.gitignore`. |

The first response is a cold-process sample; the other four are warm. Local loopback
TTFB does **not** establish CDN, mobile-device, cellular, Core Web Vitals, memory, or
battery performance.

## Prioritized runtime/performance findings

### P1 — Full mobile application re-renders every second

- **Confidence:** high (source-proven frequency and render ownership); device-frame
  cost is not yet profiled.
- **Evidence:** [`mobile/App.tsx:395-398`](mobile/App.tsx#L395-L398) starts an
  unconditional `setInterval` that calls `setObservedAt(Date.now())` once per second.
  `observedAt` is root state and therefore rerenders `App`, including chart, market,
  and ship branches. The chart maps every port at [`mobile/App.tsx:208-240`](mobile/App.tsx#L208-L240),
  and each root render recreates summary/render structures such as
  [`mobile/App.tsx:385-389`](mobile/App.tsx#L385-L389) and the map callbacks below.
- **Impact:** continuous main-thread/layout work and allocations while the app is
  open, even when no countdown needs updating. It raises jank and battery risk on
  lower-end devices.
- **Fix:** isolate ticking in `DockingStatusCard` (or a small countdown hook), and
  run it only while a visible grace countdown changes. Keep immutable game, chart,
  and market inputs outside that state boundary. Do not add broad memoization until a
  React Native profiler identifies a remaining expensive subtree.
- **Verify:** React DevTools/Flipper profiler on a representative Android device:
  idle in each tab for 30 seconds; prove `App`/`StarChart` do not commit every
  second when no countdown is active. Add a focused timer-state test.

### P1 — Docking effects synchronously schedule cascading root state updates

- **Confidence:** high (React lint reports it); actual commit count needs profiling.
- **Evidence:** `npm run lint` reports `react-hooks/set-state-in-effect` at
  [`mobile/App.tsx:609-637`](mobile/App.tsx#L609-L637), specifically line 615, and
  [`mobile/App.tsx:639-649`](mobile/App.tsx#L639-L649), specifically lines 644 and
  647. Both effects derive state from `campaigns`/`coordinators` and immediately set
  those same root objects. The same lint run reports render-time ref writes at
  [`mobile/App.tsx:369-370`](mobile/App.tsx#L369-L370).
- **Impact:** state reconciliation can require an extra render/commit for location
  and coordinator changes. It also prevents the performance/correctness lint gate
  from passing.
- **Fix:** centralize coordinator + campaign transitions in one reducer or in the
  location/coordinator subscription before state is committed. Update refs in an
  effect or eliminate them through functional updates; preserve the existing durable
  proof ordering at lines 623-634.
- **Verify:** `npm run lint` exits 0; profiler shows one committed state transition
  per coordinator event in normal cases; run `npm -C mobile test` and add a test for
  a transition that previously needed the effect reconciliation.

### P2 — Repeated rumor derivation in render is redundant work

- **Confidence:** high for duplication; low impact with the current seven ports
  and four commodities.
- **Evidence:** for each of three news ports, [`mobile/App.tsx:903-906`](mobile/App.tsx#L903-L906)
  calls `getRumors(game, port.id)` twice in the no-match path. The selected port also
  derives rumours at [`mobile/App.tsx:866-872`](mobile/App.tsx#L866-L872). Each call
  maps its market and performs a commodity lookup in
  [`mobile/src/game/engine.ts:208-223`](mobile/src/game/engine.ts#L208-L223).
- **Impact:** currently tiny, but it is paid on every root render — including the
  one-second timer above — and scales with ports/commodities.
- **Fix:** calculate each port's rumours once per render (or memoize a small derived
  `rumorsByPort` keyed by `game`) and reuse it; first remove the unconditional root
  ticker, then profile before retaining memoization.
- **Verify:** unit-test equivalent news selection; profiler/JS sampling confirms no
  recurring derivation on idle frames.

### P2 — Location update path deliberately performs frequent asynchronous work; it needs real-device budget evidence

- **Confidence:** high that work occurs; medium that it is user-visible.
- **Evidence:** foreground location requests can arrive every 10 seconds / 10 metres
  at [`mobile/App.tsx:567-583`](mobile/App.tsx#L567-L583). Each is converted,
  updates root position, and calls `processPersistedForegroundSamples`. That path
  serializes every sample and writes storage at most each 15 seconds or immediately
  for state changes ([`mobile/src/ui/dockingSessionStore.ts:78-92`](mobile/src/ui/dockingSessionStore.ts#L78-L92)).
  Background high-accuracy tracking requests 5 m / 3 s samples at
  [`mobile/src/location/runtime.ts:55-68`](mobile/src/location/runtime.ts#L55-L68),
  but is correctly restricted to a selected-port geofence.
- **Impact:** expected location and AsyncStorage I/O may consume battery / delay UI
  under poor GPS. The present throttling and geofence scoping are good safeguards;
  this is not a proven bottleneck.
- **Fix:** instrument sample rate, queue depth, storage write duration, and
  high-accuracy active duration. Retain the existing 15-second persistence
  coalescing unless measurements show it violates recovery requirements. Consider
  pausing foreground UI updates while backgrounded.
- **Verify:** device trace walking into/out of a geofence; record p95 callback,
  persistence duration, write count/minute, and battery drain. Establish explicit
  budgets before changing accuracy/intervals.

### P3 — Web client has no production Web Vitals or bundle-size guard

- **Confidence:** high.
- **Evidence:** root `package.json` contains build/test/typecheck/lint scripts only;
  no Lighthouse, web-vitals, bundle analyzer, or size budget. The sole route is a
  client component from [`app/page.tsx:10-12`](app/page.tsx#L10-L12), so local
  server timing cannot expose client hydration/interaction cost.
- **Impact:** regressions in LCP, INP, CLS, or initial JS can ship undetected.
- **Fix:** add lightweight RUM Web Vitals reporting and a CI bundle budget (initial
  JS target <200 KiB gzip; CSS <50 KiB gzip). Add Lighthouse CI once a deploy URL is
  available.
- **Verify:** CI rejects an over-budget fixture; collect LCP <=2.5 s, INP <=200 ms,
  CLS <=0.1 from real users before claiming a >9 score.

## Unnecessary or avoidable code/assets (separate from runtime bottlenecks)

### U1 — Starter-only public SVGs are deployed but unreferenced

- **Confidence:** high.
- **Evidence:** `git ls-files public` lists `public/file.svg`, `public/globe.svg`,
  and `public/window.svg`; repository-wide reference search finds no use. The build
  copies all three to `dist/client/`. Sizes are small (392 B, 1,011 B, 386 B), so this
  is cleanup, not a material page-speed bottleneck.
- **Fix:** remove the three files after confirming no external URL contract relies on
  them.
- **Verify:** `rg` has no references; build/test pass; deployment manifest no longer
  lists them.

### U2 — Open Graph image is materially oversized

- **Confidence:** high for payload; medium for request frequency (social crawlers,
  not ordinary page loads, fetch it).
- **Evidence:** [`app/layout.tsx:13-23`](app/layout.tsx#L13-L23) publishes
  `/og.png` to Open Graph and Twitter. `public/og.png` is 1,934,092 B and effectively
  incompressible as PNG (1,921,019 B gzip). It is copied into every web deployment.
- **Impact:** roughly 1.9 MB per social preview fetch and 1.9 MB deployment asset;
  violates the audit's 200 KB above-the-fold image reference budget by ~9.7x even
  though it is not an in-page LCP resource.
- **Fix:** re-export at the same 1200×630 dimensions as an efficient social-preview
  image (validate visual quality and platform compatibility), target <=300 KB; use a
  generated OG route only if its cold generation cost is measured.
- **Verify:** byte-size check and an Open Graph/Twitter preview fetch; layout metadata
  still resolves correctly.

### U3 — Image-optimization worker endpoint appears template-only

- **Confidence:** medium.
- **Evidence:** [`worker/index.ts:2-40`](worker/index.ts#L2-L40) imports and exposes
  `vinext/server/image-optimization`; search found no `next/image` / optimized-image
  caller in app source. The worker is a template surface, so external consumers could
  still call `/_vinext/image`.
- **Impact:** avoidable worker code/attack surface and maintenance only; not proven
  to affect current initial client payload.
- **Fix:** make a product decision: retain and document the endpoint if image
  optimization is planned, or remove its imports/branch after checking production
  requests and platform requirements.
- **Verify:** deployment smoke test for normal route and any existing image URLs;
  compare worker bundle/request behavior.

### U4 — Untracked mobile APK is a large local artifact, correctly ignored

- **Confidence:** high.
- **Evidence:** `mobile/artifacts/Wayfarer-android-mvp.apk` is 66 MiB and
  `mobile/.gitignore` ignores `artifacts/*.apk`.
- **Impact:** no Git/deployment payload presently; it can burden local backup and
  accidental archive uploads.
- **Fix:** keep ignored; move release artifacts to CI/release storage and document
  their provenance. Do not delete user artifact as part of a performance patch.
- **Verify:** `git status --short` remains free of APK entries.

## Explicit non-findings

- Web gameplay collections are bounded (seven ports, four commodities); the
  `find`/`map` calls in `app/game/engine.mjs` are not a meaningful bottleneck at this
  scale.
- Mobile persistence rejects oversized raw saves before parsing at
  [`mobile/src/persistence.ts:370-381`](mobile/src/persistence.ts#L370-L381), and
  foreground docking-session persistence is coalesced. No unbounded raw location
  trail was found.
- Root production dependencies are minimal: React, React DOM, and Drizzle. `npm ls`
  reports `@emnapi/runtime` and `tslib` as extraneous installation entries, but this
  is dependency-tree hygiene, not evidence that they ship to clients.

## Attempted measurements and limitations

- Production server initially could not bind under the filesystem sandbox
  (`EPERM`); it was measured using an approved temporary local server and then
  stopped. No source/data was changed.
- Expo native bundle analysis, Android profiling, battery measurement, Lighthouse,
  and real-user Web Vitals were not available in this workspace. Therefore no claim
  is made about mobile APK size composition, FPS, memory, energy, LCP, INP, CLS, CDN
  latency, or production p95.
- The root lint command scans the untracked `mobile/` tree. Its failure is useful
  audit evidence, but it means the web-only lint gate is presently not isolated.

## Strict scoring rubric

| Dimension | Max | Score | Evidence / gap |
| --- | ---: | ---: | --- |
| Reproducible build, tests, type safety | 1.5 | 1.2 | builds and tests pass; lint fails |
| Initial web payload and asset discipline | 1.5 | 0.8 | JS/CSS modest; 1.9 MB OG image and template assets remain |
| Rendering/update efficiency | 2.0 | 0.6 | unconditional mobile root timer and cascading state effects |
| I/O, query, and data-bound discipline | 1.5 | 1.2 | bounded data and coalesced writes; no device I/O budget |
| Measurement, budgets, and regression guards | 2.0 | 0.5 | local baseline only; no RUM/Lighthouse/bundle gate/native profile |
| Maintainability / unnecessary-code control | 1.5 | 1.3 | small codebase; four removable/decision-needed surfaces |
| **Total** | **10.0** | **5.6** | **Insufficient production performance evidence** |

## Required path to a re-audit score above 9

1. Fix P1 timer ownership and P1 cascading state transitions; root lint must pass.
2. Remove U1, optimize U2, and decide/remove or document U3.
3. Capture before/after Android profiler data (idle chart/market/ship, active
   countdown, foreground and geofenced tracking) and verify improvements exceed
   variance.
4. Add web bundle and Web Vitals guards; collect representative deployment evidence.
5. Re-run every baseline command and request a fresh independent audit. A score above
   9 requires passing gates plus measured web/mobile runtime evidence, not static
   confidence alone.

## Implementation attempt ledger (2026-08-14)

This ledger records the fix pass without changing the independent Terra score above.
Measurements use the same workspace and toolchain as the baseline unless stated.

| Attempt | Baseline → result | Verdict | Evidence / qualification |
| --- | --- | --- | --- |
| Move the one-second clock out of mobile `App` | one unconditional root `setInterval` every second → zero root intervals; a chained one-second timeout exists only in the visible paused-grace card and stops at 30 seconds | kept | Focused UI test first failed because 29-second copy never appeared, then passed. A second red/green test proves an expired restored grace jumps to zero rather than replaying 30 ticks. This structurally removes timer-driven chart/market/ship root commits; device commit cost still needs profiling. |
| Resolve coordinator and campaign transitions at event boundaries | two effects synchronously set campaign/coordinator state and root lint reported two `set-state-in-effect` errors → no transition effects and lint exits 0 | kept | New pure transition contract failed first because the resolver did not exist, then passed. Live ordering remains campaign `writeThrough` → persisted proof acknowledgment → published coordinator commit. Mobile suite now has 97 pure tests and 4 UI tests. |
| Remove repeated Galactic News derivation | no-match path called `getRumors(game, port.id)` twice per news port → one call whose result is reused | kept | Source search now finds one call in that loop. Current data is bounded, so this is a small allocation/CPU cleanup rather than a claimed user-visible speedup. |
| Re-export social preview | `public/og.png`: 1,934,092 B, 1731×909, PNG → `public/og.jpg`: 210,351 B, 1200×630, JPEG quality 82 | kept | Saves 1,723,741 B (89.12%, 9.19× smaller). Original and result were visually inspected; metadata and generated `dist/client/og.jpg` both resolve to 1200×630. Post-build test enforces <=300 KiB and exact dimensions. |
| Remove unreferenced starter SVGs | `file.svg` 392 B + `globe.svg` 1,036 B + `window.svg` 386 B → absent | kept | Repository search found no runtime references. Build/render tests pass and the post-build test rejects their return. |
| Add bundle and image budgets | no automated size gate → sole-route total 119,826 B gzip JS / 4,354 B gzip CSS, guarded at 200 KiB / 50 KiB; OG guarded at 300 KiB | kept | Budget test first failed because optimized JPEG was absent, then passed after the asset/metadata change. Web Vitals client chunk is 6,801 B raw / 2,633 B gzip. |
| Add Core Web Vitals RUM surface | no LCP/INP/CLS instrumentation → `web-vitals` publishes bounded metrics as `wayfarer:web-vital` and optionally beacons to `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` | kept | Reporter tests first failed because publisher was absent, then passed. Entries and query strings are not transmitted. Representative production values remain unavailable until an endpoint and deployment traffic exist. |
| Remove Vinext image endpoint | no in-repo `next/image` caller, but production request history unavailable → endpoint retained and documented | retained, not removed | `README.md` records the compatibility reason and requires production request-log evidence before removal. This avoids guessing about externally bookmarked `/_vinext/image` URLs. |
| Export Android JavaScript | first command ran from repository root and Expo reported only `[web]` configured → rerun from `mobile/` succeeded | measurement kept | Expo/Metro exported 614 modules in 5.105 s. Hermes bytecode is 1,619,239 B raw / 721,679 B gzip. No equivalent pre-fix export was captured, so this is a reproducible post-fix baseline, not a claimed bundle-size improvement. |
| Change location accuracy/intervals | no device evidence → unchanged | not attempted | Foreground 10 s / 10 m balanced and geofenced high-accuracy behavior remain intact, per the audit constraint. |

### Post-fix verification

| Command | Result |
| --- | --- |
| `npm test` | passed: 19 pre-build unit/RUM tests, production build, 3 rendered/budget tests; `3.80 s` wall |
| `npm run typecheck` | passed; `1.11 s` wall |
| `npm run lint` | passed with zero errors/warnings; `5.73 s` wall |
| `npm -C mobile run check` | passed: typecheck, 97 pure tests, 4 UI tests; `5.89 s` wall |
| `npm run build` (post-fix measurement run) | passed; `3.34 s` wall; 220 client-reference modules, 121 client-environment modules |
| APK integrity | still 69,229,870 B; SHA-256 `1e57159a9db05cec051cdaf4094c8d39ab6d06f255705a41d62d819ae368bd65` |

### Remaining evidence gaps for independent re-audit

- Android React profiler evidence for root/card commit counts, frame time, memory,
  and battery remains unavailable in this workspace.
- Production LCP, INP, CLS, CDN latency, and distribution percentiles require a
  deployed build plus representative traffic and a configured RUM collector.
- Production request logs are still required before safely deleting the retained
  Vinext image endpoint.
- Therefore this implementation pass does not assign itself a new score or claim
  that the >9 gate is met; an independent Terra re-audit must evaluate current state.
