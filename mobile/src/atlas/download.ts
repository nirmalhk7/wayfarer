import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import { createAtlasLoader } from "./loader";

const root = process.env.EXPO_PUBLIC_PORT_ATLAS_URL?.replace(/\/+$/, "");
const directory = FileSystem.documentDirectory && FileSystem.documentDirectory + "port-data/";
const configured = root && (/^https:\/\/[^?#]+$/.test(root)
  || (__DEV__ && /^http:\/\/(?:10\.0\.2\.2|127\.0\.0\.1)(?::\d+)?\/[^?#]+$/.test(root)));

export const atlas = createAtlasLoader({
  async get(path) {
    if (!configured) throw new Error("Port download service is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(root + "/" + path, { signal: controller.signal });
      if (!response.ok) throw new Error("Port download unavailable");
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  },
  async read(key) {
    if (!directory) return null;
    return FileSystem.readAsStringAsync(directory + key);
  },
  async write(key, data) {
    if (!directory) return;
    const file = directory + key;
    const temporary = file + ".part";
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    try {
      await FileSystem.writeAsStringAsync(temporary, data);
      await FileSystem.deleteAsync(file, { idempotent: true });
      await FileSystem.moveAsync({ from: temporary, to: file });
    } finally {
      await FileSystem.deleteAsync(temporary, { idempotent: true });
    }
  },
  hash(value) {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  },
}, process.env.EXPO_PUBLIC_PORT_ATLAS_SHA256 ?? "");
