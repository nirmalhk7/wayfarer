# Wayfarer

Wayfarer is an original space-trading game that combines Space Trader-style
commodity markets with Pokémon GO-style real-world exploration. Real places
become fictional starports. Buy cargo where it is cheap, travel in the real
world, and sell it where demand is higher. The longer-term vision adds more to
discover and collect along the way, plus short narrative encounters that recap
the trip once you've stopped.

## Play the web prototype

The browser prototype runs on [vinext](https://github.com/cloudflare/vinext).
Buy cargo while docked, set a destination on the star chart or port list, and
check in at the destination to sell. The market shows the separate buy and sell
prices, remaining stock, and order totals. Your latest sale receipt shows
proceeds and profit or loss when the purchase cost is known. First visits fill
the discovery list and may trigger a short encounter. A profitable sale links
to ship upgrades. The 250-credit cargo expansion adds four slots, and its button
shows any credit shortfall.

Play only while safely stopped in a public place. Use generated points in
Training and keep off-site navigation to approved public destinations. The
public preset remains disabled pending the [desk audit’s field gates](docs/public-pilot-audit.md).
To try trading locally, turn on **Training Simulator**, buy
Ion Fuel at Wayfarer Freeport, select Cinder Exchange, and set it as your
destination. Choose **Virtually arrive**, request docking, and sell the fuel.
Training has its own saved ship, cargo, and credits.

Choose **Start live check-in** while safely stopped to grant location access and
center a new chart. The browser requests a fresh location reading when you check
in or submit a live trade. Market access expires after one minute, and Training
works without location. Progress is saved in browser storage, including the
starting and generated port coordinates. Recent location readings stay in memory.

This repository also contains an [Android MVP](mobile/README.md).
See the [local pilot quickstart](docs/pilot-quickstart.md) for build and offline
verification commands.

## Roadmap

- Curate starports at safe, publicly accessible places and exclude private-property
  destinations.
- Build shared markets, asynchronous contracts, and cargo routes with multiple
  stops. Keep player locations private and exclude live player tracking.
- Explore a full native client backed by a game server, building on the Android
  MVP.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: run game/RUM tests, build, verify rendered output, and enforce payload budgets
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Performance Monitoring

The client records LCP, INP, and CLS with `web-vitals`. Every measurement emits
a `wayfarer:web-vital` browser event. Set `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` to
also send the bounded metric payload with `navigator.sendBeacon`; raw performance
entries and query strings are not sent.

The post-build test gate caps the sole route at 200 KiB gzip JavaScript, 50 KiB
gzip CSS, and a 300 KiB 1200×630 social preview.

## Worker Image Compatibility

The current app does not call `next/image` or `/_vinext/image`. The Vinext image
optimization branch remains intentionally available for deployment compatibility
and any externally bookmarked optimizer URLs. Check production request logs before
removing that endpoint.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
