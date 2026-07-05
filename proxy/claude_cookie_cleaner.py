import json
import sys
from mitmproxy import http

CLAUDE_DOMAINS = (
    "claude.ai",
    "claude.com",
    "anthropic.com",
    "a-api.anthropic.com",
)

COOKIE_NAMES = ("sessionKey", "routingHint")


def emit(event, **payload):
    print("CLAUDE_CLEANER_EVENT " + json.dumps({"event": event, **payload}), flush=True)


def is_claude_host(host: str) -> bool:
    host = (host or "").lower()
    return any(host == domain or host.endswith("." + domain) for domain in CLAUDE_DOMAINS)


def strip_cookie_header(cookie_header: str):
    removed = []
    kept = []

    for item in cookie_header.split(";"):
        item = item.strip()
        if not item:
            continue

        cookie_name = item.split("=", 1)[0]
        if cookie_name in COOKIE_NAMES:
            removed.append(cookie_name)
            continue
        kept.append(item)

    return "; ".join(kept), sorted(set(removed))


def request(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host

    if host == "mitm.it":
        emit("iphone_certificate_page_opened", host=host)
        return

    if not is_claude_host(host):
        return

    emit("claude_request_seen", host=host)

    cookie_header = flow.request.headers.get("cookie")
    if not cookie_header:
        return

    stripped, removed = strip_cookie_header(cookie_header)
    if stripped:
        flow.request.headers["cookie"] = stripped
    else:
        del flow.request.headers["cookie"]

    if removed:
        emit("cookies_removed", host=host, cookies=removed)


def response(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    if not is_claude_host(host):
        return

    for name in COOKIE_NAMES:
        flow.response.headers.add(
            "set-cookie",
            f"{name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
        )

    emit("expire_cookies_sent", host=host, cookies=list(COOKIE_NAMES))


def load(loader):
    emit("addon_loaded", python=sys.version.split()[0])
