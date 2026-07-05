# Claude iOS Session Cleaner

A local desktop helper for fixing Claude iOS "Something went wrong" login errors by clearing stale session cookies through a local `mitmdump` proxy.

This is an unofficial tool. It is intended for resetting your own broken local Claude iOS session state, not for bypassing account restrictions.

## How It Works

The app starts a proxy on your own Mac or Windows computer. After your iPhone is configured to use that proxy, Claude iOS requests pass through the local proxy. For Claude/Anthropic domains, the proxy removes stale `sessionKey` and `routingHint` cookies and lets Claude rebuild a clean session.

The app does not host a cloud proxy and does not send your traffic to a third-party server.

## What It Does

- Starts `mitmdump` on `0.0.0.0:9091`.
- Loads `proxy/claude_cookie_cleaner.py`.
- Only handles Claude/Anthropic hosts.
- Removes `sessionKey` and `routingHint` from outbound Cookie headers.
- Adds expiring `Set-Cookie` headers for those names on responses.
- Shows a simple step-by-step desktop guide.

## Requirements

Install mitmproxy first, or click "安装 mitmproxy" inside the app:

```bash
# macOS
brew install mitmproxy

# Windows, if Python is installed
py -m pip install mitmproxy
```

## User Workflow

1. Start the desktop app.
2. Click "启动代理".
3. Put iPhone and computer on the same Wi-Fi.
4. Set iPhone Wi-Fi HTTP Proxy to manual.
5. Fill in `Server: 198.18.0.1` and `Port: 9091`.
6. Open `http://mitm.it` on iPhone Safari.
7. Install and fully trust the mitmproxy certificate.
8. Force quit and reopen Claude iOS.

## Run In Development

```bash
npm install
npm start
```

## Package

```bash
npm run dist:win
npm run dist:mac
```

Building a signed/notarized macOS release must be done on macOS with Apple signing credentials. Windows signing is also recommended for public distribution.

## Privacy Notes

This type of tool requires iPhone trust in a local CA certificate. Keep it local, stop the proxy when not needed, and do not route unrelated traffic through untrusted proxy servers.

## Credits

Inspired by [durianh96/fix-claude-ios-session](https://github.com/durianh96/fix-claude-ios-session).

Claude is a trademark of Anthropic. This project is not affiliated with Anthropic.
