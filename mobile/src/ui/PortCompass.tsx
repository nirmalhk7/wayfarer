import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polygon, Text as CompassText } from "react-native-svg";

import { compassRange, type CompassDirection } from "../game/compass";
import { COCKPIT as COLORS } from "./cockpitTheme";

export type PortReading = {
  id: string;
  name: string;
  detail?: string;
  current?: boolean;
  direction?: CompassDirection;
};

const center = 100;
const ticks = Array.from({ length: 24 }, (_, i) => {
  const angle = i * Math.PI / 12;
  const inner = i % 6 ? 65 : 60;
  return {
    x1: center + inner * Math.sin(angle), y1: center - inner * Math.cos(angle),
    x2: center + 72 * Math.sin(angle), y2: center - 72 * Math.cos(angle),
  };
});
const cardinal = [
  { letter: "N", x: 100, y: 20 }, { letter: "E", x: 190, y: 105 },
  { letter: "S", x: 100, y: 190 }, { letter: "W", x: 10, y: 105 },
];

export function PortCompass({
  readings, selectedId, onSelect,
}: {
  readings: PortReading[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const [focusedId, setFocusedId] = useState<string>();
  const focus = readings.find((row) => row.id === (onSelect ? selectedId : focusedId) && row.direction?.bearing != null)
    ?? readings.find((row) => row.direction?.bearing != null);

  const focusedDirection = focus?.direction;

  return (
    <View style={styles.frame} testID="port-compass">
      <View style={styles.rose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Circle cx={center} cy={center} r={77} fill={COLORS.deep} stroke={COLORS.line} />
          {ticks.map((tick, i) => <Line key={i} {...tick} stroke={i % 6 ? COLORS.frame : COLORS.signal} />)}
          {cardinal.map(({ letter, x, y }) => (
            <CompassText key={letter} x={x} y={y} textAnchor="middle" fontSize={13} fill={COLORS.text}>{letter}</CompassText>
          ))}
          {readings.map(({ id, direction }) => {
            if (direction?.bearing == null || id === focus?.id) return null;
            const angle = direction.bearing * Math.PI / 180;
            return <Circle key={id} cx={center + 56 * Math.sin(angle)} cy={center - 56 * Math.cos(angle)} r={2} fill={COLORS.signal} />;
          })}
          {focus?.direction?.bearing != null && (
            <Polygon points="100,42 110,104 100,95 90,104" fill={COLORS.accent}
              rotation={focus.direction.bearing} originX={center} originY={center} />
          )}
          <Circle cx={center} cy={center} r={3} fill={COLORS.text} />
        </Svg>
      </View>
      <Text style={styles.focus}>{focus && focusedDirection ? focus.name + " · " + compassRange(focusedDirection) : "No heading available"}</Text>
      {readings.map((row) => {
        const range = row.current ? "Current port" : row.direction ? compassRange(row.direction) : "Range unavailable";
        const description = [row.detail, range].filter(Boolean).join(" · ");
        const selected = row.id === (onSelect ? selectedId : focus?.id);
        const content = <>
          <Text style={[styles.name, (row.current || selected) && styles.highlight]}>{row.name}</Text>
          <Text style={styles.range}>{description}</Text>
        </>;
        return onSelect || row.direction?.bearing != null ? (
          <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected }}
            accessibilityLabel={[onSelect ? "Select " + row.name : row.name, row.detail, range].filter(Boolean).join(", ")}
            onPress={() => onSelect ? onSelect(row.id) : setFocusedId(row.id)} style={styles.row}>
            {content}
          </Pressable>
        ) : <View key={row.id} style={styles.row}>{content}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { gap: 4 },
  rose: { width: "100%", maxWidth: 220, alignSelf: "center", aspectRatio: 1, marginVertical: 6 },
  focus: { color: COLORS.accent, fontSize: 14, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  row: { minHeight: 48, justifyContent: "center", borderTopWidth: 1, borderColor: COLORS.line, paddingVertical: 9, gap: 4 },
  name: { color: COLORS.text, fontSize: 15, fontWeight: "700" },
  highlight: { color: COLORS.accent },
  range: { color: COLORS.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
});
