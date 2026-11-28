"""Drive a disposable Android emulator through the signed Wayfarer APK."""
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from xml.etree import ElementTree

ADB = Path(os.environ["ANDROID_HOME"]) / "platform-tools/adb"
PACKAGE = "com.nirmalhk7.wayfarer"
EVIDENCE = Path("evidence")
GUEST_DUMP = "/sdcard/wayfarer-smoke.xml"


def adb(*args, timeout=25):
    return subprocess.run([ADB, *args], check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout).stdout


def shell(*args, timeout=25):
    return adb("shell", *args, timeout=timeout).decode().strip()


def ui():
    shell("uiautomator", "dump", GUEST_DUMP)
    xml = adb("exec-out", "cat", GUEST_DUMP)
    return xml, list(ElementTree.fromstring(xml).iter("node"))


def find(predicate, *, before=lambda: None, timeout=60):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        before()
        try:
            xml, nodes = ui()
            for node in nodes:
                if predicate(node.attrib):
                    return xml, node.attrib
        except (subprocess.SubprocessError, ElementTree.ParseError):
            pass
        time.sleep(2)
    raise RuntimeError("Expected screen element did not appear")


def named(label):
    return lambda attrs: label in (attrs.get("text"), attrs.get("content-desc"))


def tap(label, *, control=False, scroll=False):
    def search(attrs):
        return named(label)(attrs) and (not control or attrs.get("clickable") == "true"
                                        or "Switch" in attrs.get("class", ""))

    # Read the initial viewport before scrolling; the tab bar is fixed.
    _, nodes = ui()
    match = next((n.attrib for n in nodes if search(n.attrib)), None)
    if match is None:
        width, height = 1080, 1920
        if scroll:
            width, height = map(int, re.findall(r"(\d+)x(\d+)", shell("wm", "size"))[-1])
        before = ((lambda: shell("input", "swipe", str(width // 2), str(height * 3 // 4),
                                 str(width // 2), str(height // 3), "450")) if scroll else (lambda: None))
        _, match = find(search, before=before)
    x0, y0, x1, y1 = map(int, re.findall(r"\d+", match["bounds"]))
    shell("input", "tap", str((x0 + x1) // 2), str((y0 + y1) // 2))
    print("Tapped", label, flush=True)
    time.sleep(1)


def save_screen(name, xml):
    (EVIDENCE / (name + ".xml")).write_bytes(xml)
    (EVIDENCE / (name + ".png")).write_bytes(adb("exec-out", "screencap", "-p"))


def gps(lon, lat, knots=0):
    result = adb("emu", "geo", "fix", str(lon), str(lat), "10", "8", str(knots))
    if b"KO:" in result:
        raise RuntimeError(result.decode())


def boot():
    adb("wait-for-device", timeout=200)
    end = time.monotonic() + 180
    while time.monotonic() < end:
        if shell("getprop", "sys.boot_completed") == "1":
            return
        time.sleep(3)
    raise RuntimeError("Android boot did not complete")


def main(apk):
    boot()
    shell("input", "keyevent", "KEYCODE_WAKEUP")
    shell("wm", "dismiss-keyguard")
    shell("wm", "size", "768x1366")
    shell("wm", "density", "280")
    shell("settings", "put", "global", "stay_on_while_plugged_in", "7")
    shell("cmd", "connectivity", "airplane-mode", "enable")
    shell("svc", "wifi", "disable")
    shell("svc", "data", "disable")
    shell("cmd", "location", "set-location-enabled", "true")
    assert shell("settings", "get", "global", "airplane_mode_on") == "1"
    assert shell("settings", "get", "global", "wifi_on") == "0"
    for _ in range(20):
        connectivity = shell("dumpsys", "connectivity")
        if re.search(r"^Active default network: (?:none|null) *$", connectivity, re.M):
            break
        time.sleep(1)
    else:
        raise RuntimeError("Android still reports an active default network")
    print("Offline Android API", shell("getprop", "ro.build.version.sdk"), flush=True)
    assert b"Success" in adb("install", apk, timeout=120)
    assert shell("pm", "path", PACKAGE).startswith("package:")
    for permission in ("ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACTIVITY_RECOGNITION"):
        shell("pm", "grant", PACKAGE, "android.permission." + permission)
    launched = shell("am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
    print(launched, flush=True)
    assert "Status: ok" in launched
    assert shell("pidof", PACKAGE)
    xml, _ = find(lambda attrs: PACKAGE == attrs.get("package") and named("WAYFARER")(attrs))
    save_screen("01-offline-launch", xml)
    tap("Training simulator", control=True, scroll=True)
    tap("Start live navigation", control=True, scroll=True)
    mateo = lambda: gps(-122.2711, 37.5585)
    find(named("Arrived in San Mateo"), before=mateo, timeout=95)
    tap("Compass")
    xml, _ = find(named("North up · Straight-line range"), before=mateo)
    assert all(text.encode() in xml for text in ("Current port", "San Mateo", "San Francisco", "Alameda", " km"))
    save_screen("02-offline-compass-san-mateo", xml)
    print("San Mateo offline compass and neighboring county distances verified", flush=True)
    alameda = lambda: gps(-121.80, 37.68, 45)
    xml, _ = find(named("Arrived in Alameda"), before=alameda, timeout=95)
    save_screen("03-offline-crossing-alameda", xml)
    tap("Station")
    xml, _ = find(named("Market encrypted"), before=alameda)
    assert b"Pirate contact" not in xml
    save_screen("04-vehicle-market-locked", xml)
    print("Alameda synthetic vehicle crossing left the market locked", flush=True)


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    finally:
        try:
            pid = shell("pidof", PACKAGE).split()[0]
            (EVIDENCE / "wayfarer-logcat.txt").write_bytes(adb("logcat", "-d", "--pid=" + pid, "-t", "1500"))
            xml, nodes = ui()
            if any(n.get("package") == PACKAGE for n in nodes):
                save_screen("last-wayfarer-screen", xml)
        except (subprocess.SubprocessError, ElementTree.ParseError, IndexError):
            pass
