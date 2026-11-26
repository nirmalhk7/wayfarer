import { COCKPIT } from "./cockpitTheme";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  dockingViewModel,
  type DockingCoordinator,
  type DockingViewModel,
} from "./dockingCoordinator.ts";

function countdown(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function DockingStatusCard({
  coordinator,
  foregroundOnly,
  onEnableBackground,
}: {
  coordinator: DockingCoordinator;
  foregroundOnly: boolean;
  onEnableBackground: () => void;
}) {
  const pausedAt = coordinator.session.pausedAt;
  const view = dockingViewModel(coordinator, pausedAt ?? 0, foregroundOnly);
  return view.phase === "paused" && pausedAt !== null
    ? (
        <TickingDockingStatus
          coordinator={coordinator}
          foregroundOnly={foregroundOnly}
          key={pausedAt}
          onEnableBackground={onEnableBackground}
          pausedAt={pausedAt}
        />
      )
    : <DockingStatusContent onEnableBackground={onEnableBackground} view={view} />;
}

function TickingDockingStatus({
  coordinator,
  foregroundOnly,
  onEnableBackground,
  pausedAt,
}: {
  coordinator: DockingCoordinator;
  foregroundOnly: boolean;
  onEnableBackground: () => void;
  pausedAt: number;
}) {
  const expiresAt = pausedAt + 30_000;
  const [observedAt, setObservedAt] = useState(pausedAt);

  useEffect(() => {
    if (observedAt >= expiresAt) return;
    const now = Date.now();
    const timeout = setTimeout(
      () => setObservedAt((current) => Math.min(
        expiresAt,
        Math.max(current + 1_000, Date.now()),
      )),
      Math.min(1_000, Math.max(0, expiresAt - now)),
    );
    return () => clearTimeout(timeout);
  }, [expiresAt, observedAt]);

  return (
    <DockingStatusContent
      onEnableBackground={onEnableBackground}
      view={dockingViewModel(coordinator, observedAt, foregroundOnly)}
    />
  );
}

function DockingStatusContent({
  view,
  onEnableBackground,
}: {
  view: DockingViewModel;
  onEnableBackground: () => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <View style={styles.topline}>
        <Text style={styles.phase}>{view.headline}</Text>
        {(view.phase === "qualifying" || view.phase === "paused" || view.phase === "poor-signal") && (
          <Text style={styles.countdown}>{countdown(view.remainingMs)} REMAINING</Text>
        )}
      </View>
      <Text style={styles.detail}>{view.detail}</Text>
      {view.foregroundOnly && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            FOREGROUND ONLY · Keep Wayfarer open or qualification pauses.
          </Text>
          <Pressable
            accessibilityLabel="Enable background location"
            accessibilityRole="button"
            onPress={onEnableBackground}
            style={styles.action}
          >
            <Text style={styles.actionText}>ENABLE BACKGROUND</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function BackgroundPermissionModal({
  visible,
  onCancel,
  onContinue,
}: {
  visible: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.scrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalEyebrow}>BACKGROUND NAVIGATION</Text>
          <Text style={styles.modalTitle}>KEEP QUALIFYING WHILE AWAY</Text>
          <Text style={styles.modalCopy}>
            Wayfarer uses background location only to reduce your selected port&apos;s docking timer.
            It stores session totals, never your location trail. Android opens system settings next;
            choose “Allow all the time” to continue when the app is not visible.
          </Text>
          <Pressable
            accessibilityLabel="Continue to settings"
            accessibilityRole="button"
            onPress={onContinue}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>CONTINUE TO SETTINGS</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Not now"
            accessibilityRole="button"
            onPress={onCancel}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>NOT NOW</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: COCKPIT.line, backgroundColor: COCKPIT.panel, padding: 13, marginBottom: 12 },
  topline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  phase: { color: COCKPIT.signal, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  countdown: { color: COCKPIT.accent, fontSize: 9, fontWeight: "900", letterSpacing: .7 },
  detail: { color: COCKPIT.muted, fontSize: 9, lineHeight: 14, marginTop: 6 },
  warning: { borderTopWidth: 1, borderColor: COCKPIT.line, marginTop: 10, paddingTop: 9 },
  warningText: { color: COCKPIT.accent, fontSize: 11, lineHeight: 16, letterSpacing: .5 },
  action: { minHeight: 44, borderWidth: 1, borderColor: COCKPIT.accent, alignItems: "center", justifyContent: "center", marginTop: 8 },
  actionText: { color: COCKPIT.accent, fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  scrim: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: "rgba(0,0,0,.82)" },
  modalCard: { borderWidth: 1, borderColor: COCKPIT.signal, backgroundColor: COCKPIT.panel, padding: 22 },
  modalEyebrow: { color: COCKPIT.signal, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  modalTitle: { color: COCKPIT.text, fontSize: 23, lineHeight: 27, fontWeight: "900", marginTop: 5 },
  modalCopy: { color: COCKPIT.muted, fontSize: 11, lineHeight: 18, marginTop: 12 },
  primary: { minHeight: 44, backgroundColor: COCKPIT.signal, alignItems: "center", justifyContent: "center", marginTop: 18 },
  primaryText: { color: COCKPIT.void, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  secondary: { minHeight: 40, borderWidth: 1, borderColor: COCKPIT.line, alignItems: "center", justifyContent: "center", marginTop: 8 },
  secondaryText: { color: COCKPIT.text, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
});
