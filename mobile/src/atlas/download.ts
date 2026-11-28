import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import bundled from "./bundled.json";
import { createAtlasLoader } from "./loader";

const root = process.env.EXPO_PUBLIC_PORT_ATLAS_URL?.replace(/\/+$/, "");
const directory = FileSystem.documentDirectory && FileSystem.documentDirectory + "port-data/";
const configured = root && (/^https:\/\/[^?#]+$/.test(root)
  || (__DEV__ && /^http:\/\/(?:10\.0\.2\.2|127\.0\.0\.1)(?::\d+)?\/[^?#]+$/.test(root)));

const bundledRoot = FileSystem.bundleDirectory && FileSystem.bundleDirectory + "wayfarer-atlas/";

export const atlas = createAtlasLoader({
  async get(path) {
    if (!configured) {
      if (!bundledRoot) throw new Error("Bundled port data is unavailable");
      return FileSystem.readAsStringAsync(bundledRoot + path);
    }
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
    if (!configured || !directory) return null;
    return FileSystem.readAsStringAsync(directory + key);
  },
  async write(key, data) {
    if (!configured || !directory) return;
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
}, configured ? process.env.EXPO_PUBLIC_PORT_ATLAS_SHA256 ?? "" : bundled.indexSha256);
