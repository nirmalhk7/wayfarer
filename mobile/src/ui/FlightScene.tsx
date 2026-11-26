import { useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ImageBackground,
  StyleSheet,
  Text,
  useAnimatedValue,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from "react-native";

import { COCKPIT as COLORS } from "./cockpitTheme";

const HANGAR: ImageSourcePropType = require("../../assets/vistas/hangar.png");
const MARKET: ImageSourcePropType = require("../../assets/vistas/market.png");
const CARGO: ImageSourcePropType = require("../../assets/vistas/cargo.png");
const DESTINATIONS: Record<string, ImageSourcePropType> = {
  "WFR-00": require("../../assets/vistas/wfr.png"),
  "CND-04": require("../../assets/vistas/cnd.png"),
  "LMN-17": require("../../assets/vistas/lmn.png"),
  "VEL-09": require("../../assets/vistas/vel.png"),
  "MRW-31": require("../../assets/vistas/mrw.png"),
  "ORC-22": require("../../assets/vistas/orc.png"),
  "KPL-08": require("../../assets/vistas/kpl.png"),
};

type Vista = "flight" | "docked" | "market" | "cargo";

export function FlightScene({ vista, callsign, title, status, children }: {
  vista: Vista;
  callsign?: string;
  title: string;
  status: string;
  children?: ReactNode;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const fade = useAnimatedValue(1);
  // Until Android reports the preference, use a static cut.
  const [animate, setAnimate] = useState(false);
  const source = vista === "flight" ? DESTINATIONS[callsign ?? ""] ?? DESTINATIONS["WFR-00"]
    : vista === "cargo" ? CARGO : vista === "market" ? MARKET : HANGAR;
  const interior = vista === "market" || vista === "cargo";
  const sceneHeight = interior ? Math.min(310, Math.max(190, height * 0.31))
    : Math.min(550, Math.max(235, height * 0.54));
  const titleSize = Math.min(48, Math.max(29, width * 0.106));

  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      if (active) setAnimate(!reduced);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => { if (active) setAnimate(!reduced); })
      .catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!animate) {
      fade.setValue(1);
      return;
    }
    // Fade in the picture only. The current port and controls remain readable.
    fade.setValue(0.6);
    const transition = Animated.timing(fade, {
      toValue: 1,
      duration: 270,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    transition.start();
    return () => transition.stop();
  }, [animate, fade, source, vista]);

  return (
    <View testID={"vista-" + vista} style={styles.scene}>
      <View style={[styles.artWindow, { height: sceneHeight }]}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <ImageBackground resizeMode="cover" source={source} style={styles.art} />
        </Animated.View>
        <View style={[styles.corner, styles.upperLeft]} />
        <View style={[styles.corner, styles.upperRight]} />
      </View>
      <View style={[styles.caption, fontScale <= 1.3 && styles.captionOverlap]}>
        <Text accessibilityRole="header" style={[styles.title, { fontSize: titleSize }]}>{title}</Text>
        <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: COLORS.void },
  artWindow: { overflow: "hidden" },
  art: { flex: 1, alignSelf: "stretch" },
  corner: { position: "absolute", top: 20, width: 18, height: 18, borderTopWidth: 1, borderColor: "#c4b8b580" },
  upperLeft: { left: 20, borderLeftWidth: 1 },
  upperRight: { right: 20, borderRightWidth: 1 },
  caption: { paddingTop: 9, paddingHorizontal: 21, paddingBottom: 14, gap: 6, backgroundColor: COLORS.void },
  captionOverlap: { marginTop: -40 },
  title: { color: COLORS.text, fontFamily: "serif", fontWeight: "700", letterSpacing: -0.9 },
  status: { color: COLORS.accent, fontSize: 13, fontWeight: "700", lineHeight: 19 },
});
