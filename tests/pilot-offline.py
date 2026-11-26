
"""Run the production Wayfarer Training loop with browser networking disconnected."""
import os
import re
import signal
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:4197/"


def verify(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    external_requests = []

    def local_only(route):
        if urlsplit(route.request.url).netloc == "127.0.0.1:4197":
            route.continue_()
        else:
            external_requests.append(route.request.url)
            route.abort()

    context.route("**/*", local_only)
    page = context.new_page()
    page.add_init_script("""(() => {
      window.pilotLocationCalls = 0;
      const deny = () => { window.pilotLocationCalls++; throw Error("Location disabled in smoke test"); };
      Object.defineProperty(navigator, "geolocation", {
        value: { getCurrentPosition: deny, watchPosition: deny, clearWatch() {} }
      });
    })()""")
    page.goto(URL, wait_until="networkidle")
    button = lambda name: page.get_by_role("button", name=name, exact=True)
    contract = page.get_by_role("region", name="Cargo contract")
    screenshot_dir = os.environ.get("WAYFARER_SCREENSHOTS_DIR")

    def capture(region, filename):
        if screenshot_dir:
            output = Path(screenshot_dir)
            output.mkdir(parents=True, exist_ok=True)
            region.screenshot(path=output / filename, animations="disabled")

    expect(page.get_by_text("Public pilot preset unavailable.", exact=True)).to_be_visible()
    expect(page.get_by_text("Do not travel to these points.", exact=False)).to_be_visible()
    expect(button("Enable public pilot")).to_have_count(0)
    expect(page.get_by_label("Training Simulator")).to_be_enabled()
    assert page.evaluate("window.pilotLocationCalls") == 0

    context.set_offline(True)
    assert page.evaluate("navigator.onLine") is False
    page.get_by_label("Training Simulator").check()
    button("Accept cargo contract").press("Enter")
    page.get_by_role("spinbutton", name="Ion Fuel units").fill("2")
    button("Buy Ion Fuel").press("Enter")
    expect(contract).to_contain_text("2 / 2 Ion Fuel reserved")
    expect(button("Deliver reserved cargo")).to_be_disabled()
    button("Select Cinder Exchange").press("Enter")
    capture(page.get_by_role("region", name="Local Star Chart"), "wayfarer-route.png")
    button("Virtually arrive").press("Enter")
    button("Request docking").press("Enter")
    button("Deliver reserved cargo").press("Enter")
    expect(contract).to_contain_text("Delivered · 150 cr paid")
    expect(page.get_by_role("region", name="Ship status")).to_contain_text("998 cr")
    capture(page.get_by_role("region", name="Port Market"), "wayfarer-contract.png")
    page.get_by_role("button", name=re.compile("Expand cargo bay")).press("Enter")
    expect(page.get_by_role("region", name="Ship status")).to_contain_text("0 / 12 units")
    expect(page.get_by_role("region", name="Ship status")).to_contain_text("748 cr")
    capture(page.get_by_role("region", name="Ship Manifest"), "wayfarer-upgrade.png")
    assert page.evaluate("window.pilotLocationCalls") == 0

    context.set_offline(False)
    page.reload(wait_until="networkidle")
    page.get_by_label("Training Simulator").check()
    expect(contract).to_contain_text("Delivered · 150 cr paid")
    expect(button("Deliver reserved cargo")).to_have_count(0)
    expect(page.get_by_role("region", name="Ship status")).to_contain_text("0 / 12 units")
    context.set_offline(True)
    button("Reset Training game data").press("Enter")
    button("Confirm Training reset").press("Enter")
    expect(button("Accept cargo contract")).to_be_enabled()
    expect(page.get_by_role("region", name="Ship status")).to_contain_text("900 cr")
    assert page.evaluate("window.pilotLocationCalls") == 0
    assert not external_requests, external_requests
    print("PASS: closed public preset, offline delivery and reset, reload without replay, no GPS or outbound network requests")


def main():
    server = subprocess.Popen(["npm", "run", "start", "--", "--port", "4197"], cwd=ROOT, start_new_session=True)
    try:
        for attempt in range(80):
            try:
                with urlopen(URL, timeout=2) as response:
                    assert b"WAYFARER" in response.read()
                break
            except OSError:
                if server.poll() is not None or attempt == 79:
                    raise
                time.sleep(.25)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("WAYFARER_TEST_CHROMIUM"))
            verify(browser)
    finally:
        if server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
            server.wait(timeout=10)


if __name__ == "__main__":
    main()
