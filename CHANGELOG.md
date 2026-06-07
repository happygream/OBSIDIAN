# OBSIDIAN Changelog

## [0.2.0] — 2026-06-07

### Added
- IP address scanning — accepts bare IPs (192.168.1.1), CIDR ranges (10.0.0.0/24), IP ranges (x.x.x.x-y.y.y.y), and plain domains in addition to URLs
- FAST scan profile — nmap + headers + ffuf + whatweb, completes in under 5 minutes
- Scope file loader — load multiple targets from a .txt file, click any to set as active target
- Finding detail modal — click any finding card to view full detail, add analyst notes, mark as false positive
- Scan history — completed scans saved to localStorage, reload findings for reporting
- Report builder tab — professional pentest report with cover page, executive summary, scope, methodology, client fields
- Threat board scroll — stops auto-scrolling when user manually browses findings
- Animated SVG banner for GitHub README

### Improved
- sqlmap — added --random-agent, --delay=2, --retries=2, --crawl=2 --forms, stacked tampers (space2comment,between,randomcase), profile-aware level/risk
- nuclei — rate scales per profile, added retries, headless mode on Hardcore
- nmap — profile-aware script categories (banner / default,http-headers / vuln,exploit)
- nikto — user agent rotation, time limits, pause on Stealth
- ffuf — auto-calibration (-ac), recursion, profile-aware wordlist and rate, user agent rotation
- whatweb — aggression level 4 on Hardcore
- headers — retry, proper Accept header, user agent rotation
- WSL integration — auto-detects WSL distro on Windows, routes all tool execution through wsl.exe
- Tool install — one-click install from the Tools tab with live output streaming
- Export — README.md, HTML Report, Shell Script now use native Electron save dialog
- Findings — false positive marking greys out cards and excludes from risk score and reports
- Proxy drawer — wider (420px), fully opaque, status badge on its own row

### Fixed
- ffuf wordlist path corrected for Ubuntu (/usr/share/dirb/wordlists/big.txt)
- ffuf finding parser no longer matches progress lines as findings
- Mute button now resumes audio playback when unmuted
- Severity count overflow for large finding counts
- Body gradient removed — panels now fully solid, no right-side fade
- Audio loaded via IPC-resolved absolute file path

---

## [0.1.0] — 2026-06-01

### Initial release
- Scanner tab with 13 integrated tools
- Four scan profiles: Stealth, Standard, Hardcore, Auth Test
- Live terminal output via WebSocket
- Threat board with severity-classified finding cards
- Risk score, module progress bars
- Proxy manager with proxychains4 integration
- Export: PDF, HTML, Markdown, Shell Script
- Metasploit console, Burp Suite launcher, CVE lookup
- Auto-updater via GitHub releases
- Cyberpunk intro screen with digital rain and synthwave audio
- Windows support — full UI, scanning via WSL
