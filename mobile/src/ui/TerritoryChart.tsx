import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as MapText } from "react-native-svg";

import type { Coordinates, GameState } from "../game/engine";
import { territories, territoryAt } from "../territories/northCoast";
import { COCKPIT as COLORS } from "./cockpitTheme";

const WIDTH = 320;
const HEIGHT = 360;
const LATITUDE_SCALE = 156;
const LONGITUDE_SCALE = LATITUDE_SCALE * Math.cos(41 * Math.PI / 180);

function project({ latitude, longitude }: Coordinates) {
  // Equirectangular, with longitude scaled at the middle of the atlas (41° N).
  return { x: 154 + (longitude + 123.91) * LONGITUDE_SCALE, y: 22 + (42.01 - latitude) * LATITUDE_SCALE };
}

const atlas = territories.map(({ id, geometry, properties }) => ({
  id,
  label: properties.name.replace(" County", ""),
  labelPosition: project(id === "06015"
    ? { latitude: 41.79, longitude: -123.50 }
    : { latitude: 40.98, longitude: -123.48 }),
  path: geometry.coordinates.map((polygon) => polygon.map((ring) =>
    ring.map(([longitude, latitude], index) => {
      const { x, y } = project({ longitude, latitude });
      return (index === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ") + "Z",
  ).join(" ")).join(" "),
}));

export function TerritoryChart({ ports, ship, selectedPort }: {
  ports: GameState["ports"];
  ship: Coordinates;
  selectedPort: GameState["ports"][number];
}) {
  const here = project(ship);
  const target = project(selectedPort.position);
  const selectedCounty = territoryAt(selectedPort.position);
  const shipCounty = territoryAt(ship);

  return (
    <View style={styles.frame}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.drawing}>
        <Svg width="100%" height="100%" viewBox={"0 0 " + WIDTH + " " + HEIGHT}>
          {[-124.5, -124, -123.5].map((longitude) => {
            const { x } = project({ latitude: 41, longitude });
            return <Line key={longitude} x1={x} y1={10} x2={x} y2={HEIGHT - 9} stroke="#35314a" />;
          })}
          {[40, 40.5, 41, 41.5, 42].map((latitude) => {
            const { y } = project({ latitude, longitude: -124 });
            return <Line key={latitude} x1={10} y1={y} x2={WIDTH - 10} y2={y} stroke="#35314a" />;
          })}
          <MapText x={21} y={205} fontSize={10} fill={COLORS.muted} letterSpacing={1.2}>PACIFIC</MapText>
          {atlas.map(({ id, path }) => (
            <Path key={id} d={path} fillRule="evenodd"
              fill={selectedCounty?.fips === id ? "#474165" : "#22364a"} stroke="#998fac" strokeWidth={1.2} />
          ))}
          <Line x1={here.x} y1={here.y} x2={target.x} y2={target.y}
            stroke={COLORS.accent} strokeDasharray="4 5" strokeWidth={1.5} />
          {ports.map((port) => {
            const point = project(port.position);
            const selected = port.id === selectedPort.id;
            return <Circle key={port.id} cx={point.x} cy={point.y} r={selected ? 5 : 3.5}
              stroke="#151326" strokeWidth={1.25} fill={selected ? COLORS.accent : COLORS.text} />;
          })}
          <Circle cx={here.x} cy={here.y} r={8} stroke={COLORS.signal} strokeWidth={2} fill="none" />
          {atlas.map(({ id, labelPosition, label }) => (
            <MapText key={id} x={labelPosition.x} y={labelPosition.y}
              fontSize={13} fill={COLORS.text}>{label}</MapText>
          ))}
        </Svg>
      </View>
      <Text style={styles.key}>Simulated ship · {shipCounty?.name ?? "Outside mapped counties"}</Text>
      <Text style={styles.key}>Cyan ring marks your ship. Gold marks the selected station.</Text>
      <Text style={styles.key}>U.S. Census Bureau · 2025 · generalized boundaries</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { marginVertical: 12, gap: 6 },
  drawing: {
    width: "100%", maxWidth: 440, alignSelf: "center", aspectRatio: WIDTH / HEIGHT,
    backgroundColor: COLORS.deep, borderWidth: 1, borderColor: COLORS.line, borderRadius: 8, overflow: "hidden",
  },
  key: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
});
