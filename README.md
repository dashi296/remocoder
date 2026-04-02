# RemoCoder

Remotely control Claude Code sessions running on your desktop PC from a mobile device via Tailscale VPN.

[日本語版 README はこちら](./README.ja.md)

---

## Overview

RemoCoder lets you connect to Claude Code sessions on your desktop from your iPhone or Android device. Communication is secured by Tailscale VPN (WireGuard), with UUID token authentication on top.

---

## Architecture

```
Mobile App (React Native / Expo)
        │
        │  WebSocket over Tailscale VPN
        │
Desktop App (Electron)
        │
        │  node-pty
        │
   Claude Code process
```

| Component | Technology |
|-----------|-----------|
| Desktop app | Electron + node-pty + ws |
| Mobile app | React Native (Expo) + WebView + xterm.js |
| Terminal UI | xterm.js (inside WebView) |
| Transport | WebSocket over Tailscale VPN |
| Auth | UUID token |

---

## Repository Structure

```
remocoder/
├── packages/
│   ├── shared/     # Shared type definitions
│   ├── desktop/    # Electron desktop app
│   ├── mobile/     # React Native mobile app (Expo)
│   └── cli/        # CLI tool to register external Claude sessions
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v9+
- [Tailscale](https://tailscale.com/) installed and logged in on both desktop and mobile devices
- [Claude Code](https://claude.ai/code) installed on the desktop

---

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Desktop App

```bash
# Development
pnpm dev

# Build distributable
pnpm --filter @remocoder/desktop dist:mac    # macOS
pnpm --filter @remocoder/desktop dist:win    # Windows
pnpm --filter @remocoder/desktop dist:linux  # Linux
```

The app runs in the system tray and displays your Tailscale IP and the auth token to enter in the mobile app.

### Mobile App

```bash
# Start Expo dev server
pnpm mobile

# Run on iOS
pnpm mobile:ios

# Run on Android
pnpm mobile:android
```

---

## Usage

1. **Start the desktop app** — it appears in the system tray.
2. **Note the Tailscale IP and Auth Token** shown in the tray menu.
3. **Open the mobile app** and enter the IP and token on the Connect screen.
4. **Tap Connect** — a full xterm.js terminal opens, connected to Claude Code on your desktop.

---

## Security

- All traffic runs inside the Tailscale VPN (WireGuard encryption).
- A UUID token is required on each connection (5-second auth timeout).
- The WebSocket port is only exposed within the Tailscale network, not to the public internet.

---

## Running Tests

```bash
pnpm test
```

---

## Tech Stack

| Layer | Package |
|-------|---------|
| Desktop framework | Electron 30 |
| PTY | node-pty |
| WebSocket server | ws |
| Mobile framework | React Native 0.83 + Expo 55 |
| Terminal UI | xterm.js 5 + xterm-addon-fit |
| Navigation | expo-router |
| Build system | Turborepo + pnpm workspaces |

---

## License

MIT
