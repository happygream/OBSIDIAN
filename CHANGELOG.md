# OBSIDIAN Changelog

## [0.1.0] — 2026-06-01

### Initial release

- Scanner tab — 13 integrated tools: masscan, nmap, nikto, nuclei, ffuf, amass, subfinder, wapiti, hydra, whatweb, sqlmap, testssl.sh, curl
- Four scan profiles: Stealth, Standard, Hardcore, Auth Test
- Auth Test mode with wordlist file picker and three attack modes (spray, stuffing, brute force)
- Scope file loader — load multiple targets from a text file
- Live terminal output streamed via WebSocket
- Threat board — finding cards with click-to-open detail modal
- Finding notes — add analyst notes to any finding
- False positive marking — exclude findings from risk score and reports
- Risk score computed from finding severity weights
- Module progress bars with live animation
- Proxy Manager — unlimited proxies, rotation modes, proxychains4 integration
- Export — PDF, HTML, Markdown, shell script
- Report Builder tab — full professional pentest report with executive summary, scope, methodology, client fields
- Scan History tab — saves up to 50 past scans to localStorage
- Tools tab with four sub-tabs:
  - Status — rich tool cards with one-click install
  - Metasploit — interactive msfconsole terminal
  - Burp Suite — launcher with proxy integration guide
  - CVE Lookup — NVD API integration with auto-populated CVEs from scan findings
- Script tab — auto-generated shell script with dependency installer and proxychains config
- Auto-updater — checks GitHub releases on startup and every 4 hours (packaged builds only)
- Cyberpunk intro screen with digital rain, glitch animation, and synthwave audio
- Windows support — full UI on Windows, scan execution requires Linux or WSL
