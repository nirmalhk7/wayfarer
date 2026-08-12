export function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return "Range unknown";
  if (meters === 0) return "At your position";
  if (meters < 1_000) return `${Math.round(meters)} m`;

  const kilometers = meters / 1_000;
  if (kilometers < 100) return `${kilometers.toFixed(1)} km`;
  return `${Math.round(kilometers)} km`;
}

export function formatRumor(rumor) {
  const port = rumor.port ?? rumor.portName ?? "Unknown port";

  if (rumor.commodityName && ["cheap", "fair", "expensive"].includes(rumor.price)) {
    const isCheap = rumor.price === "cheap";
    const isExpensive = rumor.price === "expensive";
    return {
      id: rumor.id ?? `${port}-${rumor.commodityId ?? rumor.commodityName}`,
      headline: `${rumor.commodityName} is ${rumor.price} at ${port}`,
      detail: isCheap
        ? "Worth a look before the market turns."
        : isExpensive
          ? "Sell only if the margin covers the trip."
          : "Prices are holding near the sector average.",
      tone: isCheap || isExpensive ? "opportunity" : "neutral",
    };
  }

  if (rumor.kind === "market") {
    const buying = rumor.signal === "buy";
    const percent = Number.isFinite(rumor.change)
      ? ` (${rumor.change > 0 ? "+" : ""}${rumor.change}%)`
      : "";

    return {
      id: rumor.id ?? `${port}-${rumor.commodity ?? "market"}`,
      headline: buying
        ? `${port} wants ${rumor.commodity}`
        : `${port} is flush with ${rumor.commodity}`,
      detail: buying
        ? `Buying at a premium${percent}.`
        : `Selling below baseline${percent}.`,
      tone: "opportunity",
    };
  }

  if (rumor.kind === "customs") {
    return {
      id: rumor.id ?? `${port}-customs`,
      headline: `Customs watch: ${port}`,
      detail: rumor.detail ?? "Patrols are inspecting inbound freight.",
      tone: "warning",
    };
  }

  return {
    id: rumor.id ?? `${port}-signal`,
    headline: rumor.headline ?? `Signal from ${port}`,
    detail: rumor.detail ?? "No additional intelligence available.",
    tone: rumor.tone ?? "neutral",
  };
}

export function cargoTotals(cargo) {
  const quantities = Array.isArray(cargo)
    ? cargo.map((row) => row?.quantity ?? row?.amount ?? 0)
    : Object.values(cargo ?? {});
  const filled = quantities.filter((quantity) => Number.isFinite(quantity) && quantity > 0);

  return {
    units: filled.reduce((sum, quantity) => sum + quantity, 0),
    types: filled.length,
  };
}

export function portStatusCopy({ portName, distanceMeters, dockable, docked }) {
  if (docked) return `Docked at ${portName}. Market access granted.`;
  if (dockable) return `${portName} is in docking range. Request clearance.`;
  return `${portName} is ${formatDistance(distanceMeters)} away. Move within docking range.`;
}
