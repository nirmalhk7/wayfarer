import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Text as CompassText } from "react-native-svg";

import { compassDistance, compassRange, type CompassDirection } from "../game/compass";
import { COCKPIT as COLORS } from "./cockpitTheme";

export type PortReading = {
  id: string;
  name: string;
  detail?: string;
  current?: boolean;
  direction?: CompassDirection;
};

const center = 50;
const ticks = Array.from({ length: 24 }, (_, i) => {
  const angle = i * Math.PI / 12;
  const inner = i % 6 ? 30 : 27;
  return {
    x1: center + inner * Math.sin(angle), y1: center - inner * Math.cos(angle),
    x2: center + 36 * Math.sin(angle), y2: center - 36 * Math.cos(angle),
  };
});
const cardinal = [
  { letter: "N", x: 50, y: 9 }, { letter: "E", x: 95, y: 53 },
  { letter: "S", x: 50, y: 98 }, { letter: "W", x: 5, y: 53 },
];
const sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const grid = [[7, 0, 1], [6, null, 2], [5, 4, 3]];

export function PortCompass({
  readings, selectedId, onSelect, emptyMessage,
}: {
  readings: PortReading[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  emptyMessage?: string;
}) {
  const nearest = new Map<number, PortReading>();
  const other: PortReading[] = [];
  for (const reading of [...readings].sort((a, b) => (a.direction?.meters ?? Infinity) - (b.direction?.meters ?? Infinity))) {
    if (reading.current) continue;
    const bearing = reading.direction?.bearing;
    if (bearing == null) { other.push(reading); continue; }
    const sector = Math.round(bearing / 45) % sectors.length;
    if (nearest.has(sector)) other.push(reading);
    else nearest.set(sector, reading);
  }

  function portLabel(row: PortReading, compact = false) {
    const range = row.direction ? compassRange(row.direction) : "Range unavailable";
    const selected = row.id === selectedId;
    const label = [onSelect ? "Select " + row.name : row.name, row.detail, range].filter(Boolean).join(", ");
    const content = <>
      <Text style={[styles.name, selected && styles.highlight]}>{row.name}</Text>
      <Text style={styles.range}>{compact && row.direction ? compassDistance(row.direction.meters) : range}</Text>
      {!compact && row.detail && <Text style={styles.range}>{row.detail}</Text>}
    </>;
    const style = compact ? styles.signal : styles.row;
    return onSelect ? (
      <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected }}
        accessibilityLabel={label} onPress={() => onSelect(row.id)} style={style}>{content}</Pressable>
    ) : <View key={row.id} accessible accessibilityLabel={label} style={style}>{content}</View>;
  }

  const current = readings.find((row) => row.current);
  return (
    <View style={styles.frame} testID="port-compass">
      {current && <View style={styles.current}>
        <Text style={styles.range}>Current port</Text>
        <Text style={[styles.name, styles.highlight]}>{current.name}</Text>
      </View>}
      <View style={styles.grid}>
        {grid.map((row, index) => (
          <View key={index} style={styles.gridRow}>
            {row.map((sector) => {
              if (sector === null) return (
                <View key="rose" style={styles.cell}>
                  <View style={styles.rose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Svg width="100%" height="100%" viewBox="0 0 100 100">
                      <Circle cx={center} cy={center} r={38} fill={COLORS.deep} stroke={COLORS.line} />
                      {ticks.map((tick, i) => <Line key={i} {...tick} stroke={i % 6 ? COLORS.frame : COLORS.signal} />)}
                      {cardinal.map(({ letter, x, y }) => (
                        <CompassText key={letter} x={x} y={y} textAnchor="middle" fontSize={9} fill={COLORS.text}>{letter}</CompassText>
                      ))}
                      {readings.map(({ id, direction }) => {
                        if (direction?.bearing == null) return null;
                        const angle = direction.bearing * Math.PI / 180;
                        return <Circle key={id} cx={center + 23 * Math.sin(angle)} cy={center - 23 * Math.cos(angle)}
                          r={id === selectedId ? 3 : 2} fill={id === selectedId ? COLORS.accent : COLORS.signal} />;
                      })}
                      <Circle cx={center} cy={center} r={2} fill={COLORS.text} />
                    </Svg>
                  </View>
                </View>
              );
              const reading = nearest.get(sector);
              return <View key={sector} testID={reading ? "port-signal-" + sectors[sector] : undefined} style={styles.cell}>
                {reading && portLabel(reading, true)}
              </View>;
            })}
          </View>
        ))}
      </View>
      <Text style={styles.legend}>{emptyMessage ?? "North up · Straight-line range"}</Text>
      {other.length > 0 && <View style={styles.more}>{other.map((reading) => portLabel(reading))}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { gap: 6 },
  current: { paddingVertical: 6, alignItems: "center", gap: 2 },
  grid: { gap: 4 },
  gridRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48 },
  cell: { flex: 1, minWidth: 0, justifyContent: "center", alignItems: "stretch" },
  signal: { minHeight: 48, justifyContent: "center", alignItems: "center", padding: 3, gap: 3 },
  rose: { width: "100%", maxWidth: 120, alignSelf: "center", aspectRatio: 1 },
  legend: { color: COLORS.muted, fontSize: 13, textAlign: "center", paddingVertical: 4 },
  more: { paddingTop: 4 },
  row: { minHeight: 48, justifyContent: "center", borderTopWidth: 1, borderColor: COLORS.line, paddingVertical: 9, gap: 4 },
  name: { color: COLORS.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
  highlight: { color: COLORS.accent },
  range: { color: COLORS.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
});
