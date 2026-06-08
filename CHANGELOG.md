# OBSIDIAN Changelog

## [0.4.2] — 2026-06-08

### Fixed
- Tool detection completely rewritten — bash script written to WSL temp file, checks `command -v`, `/usr/bin`, `/usr/local/bin`, `~/.local/bin`, `~/go/bin`, `~/.cargo/bin`, gem paths
- `proc.on('close')` handler was missing — tool status was never being sent to the renderer after detection
- All tool status now broadcast to all connected WebSocket clients, not a potentially stale single reference
- `testssl` binary renamed from `testssl.sh` to `testssl` — Ubuntu installs it as `/usr/bin/testssl`
- All apt installs now run as `wsl -u root` — no sudo password required
- Install commands now write to unique timestamped temp files — fixes `$T` variable not expanding
- Bash check script now sets explicit PATH including `~/.local/bin`, `~/go/bin`, `~/.cargo/bin`
- `pip_ok` check added for wapiti, arjun, shodan, theHarvester — detects pip packages even if binary not in PATH
- `getent passwd $(id -u)` used to resolve real home directory regardless of WSL username

### Added
- Profile selection now updates module checkboxes immediately with visual notification
- `FAST / STEALTH / STANDARD / HARDCORE / AUTH TEST` each auto-select correct module set
- rustscan installed via prebuilt `.deb` from GitHub releases
- feroxbuster installed via prebuilt `x86_64-linux-feroxbuster.tar.gz` from GitHub releases
- enum4linux installed via direct script download from GitHub
- `github-release:` install handler for prebuilt binary downloads
- `script:` install handler for direct script installs

## [0.4.1] — 2026-06-08

### Fixed
- Tool detection now uses Python `shutil.which` with extended PATH covering `~/.local/bin`, `~/go/bin`, `~/.cargo/bin`, and gem wrapper paths — resolves all false "not installed" states
- All install commands now base64-encoded and written to a timestamped WSL temp script, permanently fixing Windows PATH `(x86)` syntax errors in bash
- apt installs now run as `wsl -u root` — no sudo password required
- Profile selection now automatically sets active modules (Fast/Stealth/Standard/Hardcore/Auth)
- nmap `-Pn` flag added to all scans; stats-every 10s for live streaming progress
- Reachability warning suppressed for IP targets (host may block ICMP but still be scannable)
- sslscan parser: disabled protocols, "not vulnerable" lines, cert blob lines no longer generate false findings
- nikto parser: "requires a value" and noise lines suppressed; `-useragent` invalid flag removed
- ffuf parser: full ANSI/VT100 strip before matching; requires path to start with `/` and non-zero size
- nuclei: switched to `-automatic-scan` flag, removes broken Windows path passed to WSL
- whatweb: switched to `gem-dev` install handler with ruby-dev pre-install
- crackmapexec: switched to pipx with python3-venv pre-install
- theHarvester: switched to `pip3 install theHarvester`
- wpscan: `gem-dev` handler installs ruby-dev first, fixing native extension build failure
- enum4linux: marked as manual install (not in Ubuntu 24 repos)
- Multiple `checkTools` calls debounced to prevent race condition flooding
- Tool refresh status now shown inline on Tools tab header with timestamp

### Added
- Professional dark report: Inter + JetBrains Mono, risk score calculated from findings, full findings table, security headers grid, TLS posture grid, recommendations
- HTML and PDF export both use the new report format
- `fixPipSymlinks()` on every startup silently symlinks all pip/go binaries to `/usr/local/bin`

## [0.4.0] — 2026-06-07

### Added — 14 new tools
- **rustscan** — ultra-fast port scanner (all 65535 ports in seconds), feeds results to nmap
- **wpscan** — WordPress vulnerability scanner, themes, plugins, CVEs, user enumeration
- **gobuster** — directory/DNS/vhost brute-force scanner
- **feroxbuster** — recursive web content discovery with auto-tune
- **arjun** — hidden HTTP parameter discovery
- **enum4linux** — SMB/NetBIOS enumeration for Windows/AD targets
- **snmpwalk** — SNMP enumeration, device info and credential harvesting
- **nbtscan** — NetBIOS scanner for Windows network enumeration
- **medusa** — parallel network brute-force tool
- **crackmapexec** — SMB/Active Directory testing, pass-the-hash, shares
- **sslscan** — fast SSL/TLS scanner with detailed cipher analysis
- **theHarvester** — OSINT, emails/subdomains/IPs from public sources
- **shodan CLI** — query existing Shodan scan data for target
- **dnsrecon** — DNS enumeration, zone transfers, subdomain brute force

### Added — 10 new features (v0.3.0)
- Screenshot capture — saves full app state as PNG
- Scan notes — persistent freeform notes saved with history
- Target reachability check — warns before wasting time on dead hosts
- Module timeout — kills modules that run too long (configurable)
- Multi-target queue — scan all scope targets sequentially
- Finding deduplication — collapses identical findings into one card
- Scheduled scans — run scans automatically on a schedule
- History diff — compare two scans and highlight new/resolved findings
- Plugin system — add custom tool wrappers via plugins/ folder
- Terminal filtering — suppresses noisy progress output from ffuf/sqlmap/nuclei

---

## [0.3.0] — 2026-06-07

### Added
- Screenshot capture — camera button in topbar, saves full app state as PNG
- Scan notes — freeform text area in sidebar, saved with every history entry
- Target reachability check — background ping/curl before scan, warns if unreachable
- Module timeout — configurable per-scan (default 10 min), kills stalled modules
- Multi-target queue — SCAN ALL TARGETS button when scope file loaded
- Finding deduplication — identical findings collapse into one card with count badge
- Scheduled scans — Schedule tab with once/daily/weekly recurrence
- History diff — compare two scans, highlights new and resolved findings
- Plugin system — Plugins tab, drop .js files into plugins/ folder
- Terminal noise filtering — suppresses ffuf banner, config dump, progress lines

### Fixed
- Reachability check made non-blocking so scan starts immediately
- ffuf ASCII banner and config dump no longer flood terminal

---

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
