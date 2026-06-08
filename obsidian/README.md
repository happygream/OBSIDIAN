![OBSIDIAN Banner](assets/banner.svg)

# 0BS1D14N — Open Source Security Scanner

A desktop security scanner for authorised penetration testing. Built with Electron and Node.js, wrapping 13 industry-standard open source tools in a unified cyberpunk GUI with live terminal output, real-time finding classification, and professional report export.

> **Legal:** This tool is for authorised security testing only. Only run against systems you own or have explicit written permission to test.

---

## Features

- **13 integrated tools** — nmap, nikto, nuclei, ffuf, amass, subfinder, wapiti, hydra, whatweb, sqlmap, testssl.sh, masscan, curl
- **5 scan profiles** — Fast, Stealth, Standard, Hardcore, Auth Test
- **WSL integration** — full scan support on Windows via WSL auto-detection
- **Live terminal** — real-time tool output streamed via WebSocket
- **Threat board** — finding cards classified by severity (CRITICAL / HIGH / MEDIUM / LOW / INFO)
- **Finding notes** — add analyst notes and mark false positives
- **Risk score** — computed from finding severity weights
- **Scan history** — saves up to 50 past scans locally
- **Scope file** — load multiple targets from a text file
- **Report builder** — professional pentest reports with cover page, executive summary, and findings table
- **Export** — PDF, HTML, Markdown, Shell Script
- **Proxy manager** — unlimited proxies, rotation modes, proxychains4 integration
- **Metasploit console** — interactive msfconsole terminal
- **Burp Suite launcher** — detect and launch with proxy integration guide
- **CVE lookup** — NVD API integration with auto-populated CVEs from scan findings
- **Auto-updater** — checks GitHub releases on startup (packaged builds)
- **Synthwave intro** — cyberpunk intro screen with digital rain and glitch animation

---

## Screenshots

> Coming soon

---

## Requirements

| Platform | Requirements |
|---|---|
| Linux | Node.js 18+, npm |
| macOS | Node.js 18+, npm |
| Windows | Node.js 18+, npm, WSL (for scanning) |

Go 1.21+ required for nuclei and subfinder. Python 3 + pip for wapiti.

---

## Install

```bash
git clone https://github.com/happygream/OBSIDIAN.git
cd OBSIDIAN
chmod +x install.sh
sudo ./install.sh
```

`install.sh` auto-detects your package manager (apt, dnf, pacman, brew) and installs all tools.

**Windows users:** Install WSL first, then run `install.sh` inside WSL:
```powershell
wsl --install
```
Restart, then open WSL and run `install.sh`. OBSIDIAN will auto-detect WSL and route all scans through it.

---

## Run

```bash
npm install
npm start
```

---

## Build

```bash
# Linux
npm run build:linux

# Windows
npm run build:win

# macOS
npm run build:mac
```

Binaries output to `dist/`. The Windows build works with or without WSL installed — scanning requires WSL, the UI works without it.

---

## Scan Profiles

| Profile | Tools | Speed | Use Case |
|---|---|---|---|
| **FAST** | nmap, headers, ffuf, whatweb | ~3 min | Quick initial recon |
| **STEALTH** | nmap, headers, ssl, amass, subfinder, whatweb | Slow | Avoid IDS/WAF detection |
| **STANDARD** | nmap, nikto, nuclei, headers, ssl, ffuf, amass, whatweb | ~20 min | Balanced coverage |
| **HARDCORE** | All tools | 30+ min | Full coverage, all ports |
| **AUTH TEST** | nmap, headers, ssl, ffuf, nuclei, hydra | Variable | Login and credential testing |

---

## Tool Coverage

| Tool | Purpose |
|---|---|
| nmap | Port scanning and service detection |
| nikto | Web server misconfiguration scanning |
| nuclei | CVE and vulnerability template scanning |
| ffuf | Directory and parameter fuzzing |
| amass | Subdomain enumeration |
| subfinder | Passive subdomain discovery |
| hydra | Network login brute-force |
| whatweb | Web technology fingerprinting |
| sqlmap | SQL injection detection |
| testssl.sh | TLS/SSL configuration testing |
| masscan | High-speed port scanning |
| wapiti | Web application vulnerability scanning |
| curl | HTTP security header analysis |

---

## Releasing

Releases are published to GitHub automatically:

```bash
GH_TOKEN=your_token npm run release
```

This builds platform binaries and publishes them to GitHub Releases. The auto-updater in packaged builds checks this repo for new releases on startup and every 4 hours.

---

## Stack

- **Electron 29** — desktop wrapper
- **Node.js** — backend process management
- **WebSocket (ws)** — real-time output streaming
- **electron-updater** — auto-update from GitHub releases
- **HTML/CSS/JS** — renderer (no framework)
- **proxychains4** — proxy routing

---

## Contributing

Pull requests welcome. Please read [LEGAL.md](LEGAL.md) before contributing.

- Do not add features that facilitate unauthorised access
- Do not remove or weaken legal warnings
- Hardening standards apply regardless of whether the repo is public or private

---

## Legal

OBSIDIAN is for authorised security testing only. See [LEGAL.md](LEGAL.md) for full details.

Applicable law: Computer Misuse Act 1990 (UK), Computer Fraud and Abuse Act (US), EU Directive 2013/40/EU.

---

## License

MIT — see LICENSE
