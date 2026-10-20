"""Real CSS-viewport checks with Chromium DevTools; no page JavaScript required."""
import base64
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


def preview_site(root):
    try:
        import websocket
    except ImportError:
        raise SystemExit("site-preview: install Python websocket-client and Chromium.")
    managed = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", root / "artifacts/browsers"))
    candidates = sorted(managed.glob("chromium-*/chrome-linux*/chrome"))
    browser = str(candidates[-1]) if candidates else shutil.which("chromium") or shutil.which("chromium-browser")
    if not browser:
        raise SystemExit("site-preview: install Chromium.")
    output = root / "runtime/site-preview"
    output.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="profile-", dir=output))
    # Unix Chromium socket paths are short; keep them outside the deep profile
    # directory while retaining every test artifact inside the checkout.
    temporary = Path(os.environ.get('UNIBAN_BROWSER_TMPDIR', root / 'artifacts/tmp'))
    temporary.mkdir(parents=True, exist_ok=True)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    command = [browser, "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
               "--disable-background-networking", "--no-first-run", f"--remote-debugging-port={port}",
               f"--user-data-dir={profile}", "about:blank"]
    with (output / "browser.log").open("w") as log:
        process = subprocess.Popen(command, stdout=log, stderr=log, env={**os.environ, 'TMPDIR': str(temporary)})
        connection = None
        try:
            target = None
            deadline = time.monotonic() + 60
            while target is None:
                if process.poll() is not None or time.monotonic() > deadline:
                    raise SystemExit("site-preview: Chromium failed to start; see runtime/site-preview/browser.log.")
                try:
                    with urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as response:
                        target = next((item for item in json.load(response) if item.get('type') == 'page'
                                       and item.get('webSocketDebuggerUrl')), None)
                except (URLError, TimeoutError):
                    pass
                if target is None:
                    time.sleep(0.05)
            connection = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
            sequence = 0

            def call(method, parameters=None):
                nonlocal sequence
                sequence += 1
                connection.send(json.dumps({"id": sequence, "method": method, "params": parameters or {}}))
                while True:
                    message = json.loads(connection.recv())
                    if message.get("id") == sequence:
                        if "error" in message:
                            raise ValueError(message["error"])
                        return message.get("result", {})

            call("Page.enable")
            call("Emulation.setScriptExecutionDisabled", {"value": True})
            failures = []
            for width, height in ((320, 800), (390, 844), (768, 1024), (1440, 1100)):
                call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height,
                     "deviceScaleFactor": 1, "mobile": width < 768})
                call("Page.navigate", {"url": (root / "docs/index.html").as_uri()})
                deadline = time.monotonic() + 10
                while True:
                    state = call("Runtime.evaluate", {"expression": "document.readyState"})
                    if state["result"].get("value") == "complete":
                        break
                    if time.monotonic() > deadline:
                        raise ValueError("Page did not finish loading.")
                evidence = call("Runtime.evaluate", {"returnByValue": True, "expression": """JSON.stringify({
                    width: innerWidth,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    clippedCommands: [...document.querySelectorAll('pre')].some(e => e.scrollWidth > e.clientWidth),
                    installVisible: document.querySelector('#get-started').getBoundingClientRect().top < innerHeight,
                    colors: [['body','body'], ['.intro','body'], ['.install .note','.install'], ['.primary','.primary']].map(([fg,bg]) => ({
                        text: getComputedStyle(document.querySelector(fg)).color,
                        background: getComputedStyle(document.querySelector(bg)).backgroundColor
                    })),
                    commands: document.querySelector('#get-started pre').innerText
                })"""})
                metrics = json.loads(evidence["result"]["value"])
                (output / f"{width}.json").write_text(json.dumps(metrics, indent=2))
                layout = call("Page.getLayoutMetrics")["cssContentSize"]
                screenshot = call("Page.captureScreenshot", {"captureBeyondViewport": True, "clip": {
                    "x": 0, "y": 0, "width": width, "height": layout["height"], "scale": 1}})
                (output / f"{width}.png").write_bytes(base64.b64decode(screenshot["data"]))
                problems = [key for key in ("overflow", "clippedCommands") if metrics[key]]
                if not metrics["installVisible"]:
                    problems.append("installation below first viewport")
                if metrics["width"] != width:
                    problems.append("incorrect CSS viewport")
                print(f"site-preview: {width}px — {', '.join(problems) if problems else 'passed'}")
                for colors in metrics['colors']:
                    if contrast(colors['text'], colors['background']) < 4.5:
                        problems.append('text contrast below 4.5:1')
                failures.extend(problems)
            # Core navigation and shell commands above were checked without JS.
            # Verify the optional copy action against Chromium's real clipboard.
            call("Emulation.setScriptExecutionDisabled", {"value": False})
            call("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
            call("Page.navigate", {"url": (root / "docs/index.html").as_uri()})
            deadline = time.monotonic() + 10
            while True:
                ready = call("Runtime.evaluate", {"expression": "!!document.querySelector('#copy-commands') && !document.querySelector('#copy-commands').hidden"})
                if ready["result"].get("value"):
                    break
                if time.monotonic() > deadline:
                    raise ValueError("Copy action did not become available.")
            # Chromium requires document focus for clipboard access even when
            # permission has been granted; select the page before the operation.
            call("Page.bringToFront")
            position = call("Runtime.evaluate", {"expression": """(() => {
                const button = document.querySelector('#copy-commands');
                button.scrollIntoView({block: 'center'});
                const box = button.getBoundingClientRect();
                return JSON.stringify({x: box.left + box.width / 2, y: box.top + box.height / 2});
            })()"""})
            point = json.loads(position['result']['value'])
            call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'button': 'left', 'clickCount': 1, **point})
            call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'button': 'left', 'clickCount': 1, **point})
            copied = call("Runtime.evaluate", {"awaitPromise": True, "userGesture": True, "expression": """(async () => {
                const deadline = Date.now() + 10000;
                while (document.querySelector('#copy-status').textContent !== 'Copied.') {
                    if (Date.now() > deadline) throw Error('Copy action failed: ' + document.querySelector('#copy-status').textContent);
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                return navigator.clipboard.readText();
            })()"""})
            (output / "clipboard.json").write_text(json.dumps(copied, indent=2))
            if "exceptionDetails" in copied:
                raise ValueError(copied["exceptionDetails"]["exception"].get("description", "Clipboard evaluation failed."))
            if copied["result"].get("value") != metrics["commands"].strip():
                failures.append("clipboard changed the shell commands")
                print("site-preview: clipboard mismatch; see runtime/site-preview/clipboard.json")
            else:
                print("site-preview: clipboard preserves complete shell commands — passed")
            call("Runtime.evaluate", {"expression": "document.querySelector('.skip').focus()"})
            call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
            call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
            focus = call("Runtime.evaluate", {"expression": "document.activeElement.id"})
            if focus['result'].get('value') != 'main':
                failures.append('keyboard skip link did not focus main content')
            else:
                print('site-preview: text contrast and keyboard skip link — passed')
            if failures:
                raise SystemExit("site-preview: failed; evidence and full-page screenshots in runtime/site-preview/.")
        finally:
            if connection:
                connection.close()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            shutil.rmtree(profile)


def contrast(text, background):
    def luminance(color):
        import re
        rgb = [float(value) / 255 for value in re.findall(r"[\d.]+", color)[:3]]
        linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in rgb]
        return sum(value * weight for value, weight in zip(linear, (0.2126, 0.7152, 0.0722)))
    light, dark = sorted((luminance(text), luminance(background)), reverse=True)
    return (light + 0.05) / (dark + 0.05)
