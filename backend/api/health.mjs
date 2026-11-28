import { createTradeHandlers } from "../.generated/trading-http.mjs";
import { blobStore } from "../blob-store.mjs";

export default createTradeHandlers(blobStore).health;
