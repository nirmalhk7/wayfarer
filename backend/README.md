# Wayfarer trading backend

Use a dedicated Vercel project linked to `nirmalhk7/wayfarer`, with `main` as
the production branch and `backend` as the root directory. Enable inclusion
of source files outside the root directory so the functions can import the
shared economy and pinned ranks. Use Node.js 24 and install from
`backend/package-lock.json`.

Connect a dedicated **private** Blob store from the same Vercel team, within its
verified free allowance. The Blob SDK uses the linked store ID and Vercel OIDC.
It can also use a server-only `BLOB_READ_WRITE_TOKEN`. Neither credential
belongs in Git, GitHub CI, the APK, or client logs.

- `GET /health` returns a small JSON report and HTTP 200 when it can reach the
  private store. It returns HTTP 503 when the required store is unavailable.
- `GET /v1/live` reads the calling installation's campaign and current quotes.
- `POST /v1/live` applies a visit, buy, sell, upgrade, contact choice, or reset.
  The server checks the market, inventory, credits, and command revision. It
  writes game state and the command receipt together using a Blob ETag
  precondition. A conflicting write returns HTTP 409. A retried command never
  applies against a higher revision. Reset clears the campaign and its prior
  command history.
- Market stock is per campaign, as it was in the locally saved game.

Only the Android build needs the public endpoint origin, such as the verified
production URL of the Vercel project. Set GitHub Actions repository variable
`WAYFARER_TRADE_URL` to that origin for the main preview build, or set
`EXPO_PUBLIC_WAYFARER_TRADE_URL` for a local Android build. A configured
client leaves Live trading pending if it cannot confirm the transaction.
Training and the built-in Compass work offline. Existing offline Live saves
remain separate from a newly connected campaign.

The app checks foreground location and walking locally before sending a port
ID. The server validates that the ID identifies a real game port. It receives
the port ID, game commands, and a randomly generated install credential.
It receives no measured coordinates. The credential is stored in the Android
app's private storage and is hashed before it becomes a Blob key. Uninstalling
the app clears access to the anonymous account.

Run `npm run test:backend` from the repository root for HTTP replay. Run
`npm ci --prefix backend` to install the configured Blob adapter. Without
storage credentials the local server reports unavailable on `/health`;
`/healthz` remains its existing process-only check.
