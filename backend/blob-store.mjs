import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

const namespace = "wayfarer-live-v1/";
const path = (key) => namespace + key + ".json";
const timeout = () => AbortSignal.timeout(6_000);

export const blobStore = {
  async check() {
    const probe = await get(namespace + "health-probe", {
      access: "private", useCache: false, abortSignal: timeout(),
    });
    await probe?.stream?.cancel();
  },
  async read(key) {
    const response = await get(path(key), { access: "private", useCache: false, abortSignal: timeout() });
    if (!response) return null;
    return {
      etag: response.blob.etag,
      state: await new Response(response.stream).json(),
    };
  },
  async write(key, state, etag) {
    try {
      await put(path(key), JSON.stringify(state), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: etag !== undefined,
        ...(etag !== undefined ? { ifMatch: etag } : {}),
        contentType: "application/json",
        abortSignal: timeout(),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      if (etag === undefined && await get(path(key), { access: "private", useCache: false, abortSignal: timeout() })) return false;
      throw error;
    }
  },
};
