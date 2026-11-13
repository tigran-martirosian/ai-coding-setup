r"""Sign in to a website once in a visible window, then reuse the login headless.

    python login.py <name> <url> <signed-in-url-prefix>     # visible window; closes itself once signed in
    python login.py <name> <url> <signed-in-url-prefix> --check # headless; prints SIGNED_IN or SIGNED_OUT

The login lives in ~/.claude/browser-profiles/<name> (a Playwright persistent profile). Scripts reuse it with
playwright's launch_persistent_context(that folder, headless=True). The Nimbalyst browser tool's
headless:false tab opens no window the user can see, so sign-ins go through this.
Needs Python with Playwright: pip install playwright, then playwright install chromium.
Signed in means a page address starts with <signed-in-url-prefix> (a plain prefix, not a regex: Git Bash
rewrites backslashes in arguments, which breaks a regex).
Exit codes: 0 signed in, 1 signed out (--check), 2 timed out, 3 window closed before sign-in,
4 profile in use (another run holds it; wait for that one, don't open a second window).
"""
import ctypes
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

TIMEOUT_S = 600


def raise_window(title_part: str) -> bool:
    """Bring the Chromium window to the front of the desktop. bring_to_front() only switches the tab, and a
    window started from a background shell opens behind the active app under Windows' foreground lock."""
    if sys.platform != "win32" or not title_part:
        return False
    u = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _):
        n = u.GetWindowTextLengthW(hwnd)
        if n and u.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(hwnd, buf, n + 1)
            if title_part.lower() in buf.value.lower():
                found.append(hwnd)
        return True

    u.EnumWindows(each, 0)
    for hwnd in found:
        u.ShowWindow(hwnd, 9)  # SW_RESTORE
        u.keybd_event(0x12, 0, 0, 0)  # a tap of Alt lifts the foreground lock
        u.keybd_event(0x12, 0, 2, 0)
        u.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x3)  # topmost for a moment, then back to normal
        u.SetWindowPos(hwnd, -2, 0, 0, 0, 0, 0x3)
        if u.SetForegroundWindow(hwnd) and u.GetForegroundWindow() == hwnd:
            return True
    return False


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--check"]
    check = "--check" in sys.argv
    if len(args) != 3:
        raise SystemExit(__doc__)
    name, url, prefix = args
    profile = Path(name) if Path(name).is_absolute() else Path.home() / ".claude" / "browser-profiles" / name
    profile.mkdir(parents=True, exist_ok=True)
    if (profile / "lockfile").exists() or (profile / "SingletonLock").exists():
        try:
            (profile / "lockfile").unlink(missing_ok=True)  # fails while a running Chromium holds it
        except OSError:
            print(f"PROFILE_IN_USE {profile}")
            return 4
    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(
                str(profile), headless=check, viewport=None if not check else {"width": 1300, "height": 1000},
                args=[] if check else ["--window-size=1100,900", "--window-position=80,40"])
        except Exception as err:  # a held profile makes Chromium exit at once
            print(f"PROFILE_IN_USE {profile}: {str(err).splitlines()[0]}")
            return 4
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(url, wait_until="domcontentloaded")
        if check:
            page.wait_for_timeout(3000)
            ok = bool(page.url.startswith(prefix))
            print(("SIGNED_IN " if ok else "SIGNED_OUT ") + page.url)
            ctx.close()
            return 0 if ok else 1
        page.wait_for_timeout(3000)  # a script redirect to the login page lands before the first look
        page.bring_to_front()
        front = any(raise_window(t) for t in (page.title(), "Chromium") if t)
        print(f"WINDOW_OPEN {url} {'IN_FRONT' if front else 'NOT_IN_FRONT (tell the user to look at the taskbar)'}", flush=True)
        end = time.time() + TIMEOUT_S
        last_seen = ""
        while time.time() < end:
            seen = " ".join(pg.url for pg in ctx.pages)
            if seen != last_seen:  # where the user is, so a sign-in that lands on an unexpected page shows in the log
                print("AT " + seen, flush=True)
                last_seen = seen
            if not ctx.pages:
                print("WINDOW_CLOSED before sign-in")
                return 3
            for pg in ctx.pages:
                if pg.url.startswith(prefix):
                    time.sleep(3)  # let the session cookies settle
                    print("SIGNED_IN " + pg.url)
                    ctx.close()
                    return 0
            time.sleep(1)
        print("TIMEOUT no sign-in within 10 minutes")
        ctx.close()
        return 2


if __name__ == "__main__":
    sys.exit(main())
