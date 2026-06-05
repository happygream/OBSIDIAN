# OBSIDIAN — Test Checklist

Run through this before any release. Each item should be tested on Linux (primary) and Windows (UI only).

---

## 1. Launch + Intro
- [ ] App opens without errors in console
- [ ] Digital rain animation renders and moves
- [ ] `0BS1D14N` logo displays with Orbitron font
- [ ] Glitch animation fires every ~5 seconds
- [ ] Progress bar fills over 7 seconds
- [ ] Audio plays on launch (mute button works)
- [ ] SKIP button advances to main app immediately
- [ ] Countdown auto-advances to main app after 7s
- [ ] Fade transition from intro to app is smooth
- [ ] Menu bar is hidden (no File/Edit/View/Window/Help)
- [ ] Window title shows `0BS1D14N`

## 2. Scanner Tab — Target + Profile
- [ ] Typing in target field updates correctly
- [ ] All four profile cards are selectable and highlight correctly
- [ ] Auth config block appears only when AUTH TEST selected
- [ ] Module checkboxes toggle on/off
- [ ] Scope file browse opens file picker
- [ ] Scope file loads and displays targets
- [ ] Clicking a scope target populates the target field
- [ ] Target bar updates when scan launches

## 3. Auth Config
- [ ] Login endpoint field editable
- [ ] User/pass param fields editable
- [ ] Failure string field editable
- [ ] Username wordlist browse works
- [ ] Password wordlist browse works
- [ ] Attack mode selection highlights correctly (spray/stuffing/brute)
- [ ] Threads and delay fields accept numbers

## 4. Proxy Manager
- [ ] Proxy button opens drawer
- [ ] Overlay click closes drawer
- [ ] X button closes drawer
- [ ] Add Proxy creates a new entry
- [ ] Type dropdown (HTTP/HTTPS/SOCKS4/SOCKS5) works
- [ ] Host, port, user, pass fields editable
- [ ] Delete button removes proxy entry
- [ ] Rotation mode buttons (Round Robin/Random/Single) toggle
- [ ] Proxy count updates in target bar button
- [ ] No content bleeds through behind the drawer

## 5. Scan Execution (Linux only)
- [ ] LAUNCH SCAN with no target shows error notification
- [ ] LAUNCH SCAN with no modules shows error notification
- [ ] Valid target starts scan — terminal shows output
- [ ] Module progress bars animate
- [ ] Timer counts up in terminal header
- [ ] Finding cards appear on threat board as findings come in
- [ ] Severity counts update in stats panel
- [ ] STOP button halts scan and kills subprocesses
- [ ] Scan complete banner appears on finish
- [ ] Risk score computed and displayed with correct colour
- [ ] Export buttons enable after scan completes
- [ ] Scan saved to history automatically

## 6. Windows — Scan Attempted
- [ ] Clicking LAUNCH SCAN shows Windows modal
- [ ] Modal explains WSL requirement
- [ ] Dismiss button closes modal
- [ ] Everything else in the UI still works

## 7. Finding Detail Modal
- [ ] Clicking a finding card opens modal
- [ ] Severity, title, module, detail all display correctly
- [ ] Analyst notes textarea is editable
- [ ] SAVE NOTE persists the note (reopen card to verify)
- [ ] MARK FALSE POSITIVE greys out the card
- [ ] False positive reduces the severity count
- [ ] Risk score recalculates after false positive
- [ ] CLOSE button dismisses modal
- [ ] ESC key or clicking outside closes modal (nice to have)

## 8. Export
- [ ] PDF Report opens print dialog with formatted report
- [ ] README.md downloads with correct content
- [ ] HTML Report downloads and renders correctly in browser
- [ ] Shell Script downloads as .sh file
- [ ] All exports include findings with notes
- [ ] All exports reflect false positive state

## 9. Tools Tab
- [ ] STATUS sub-tab shows all tools with correct installed/missing status
- [ ] REFRESH button re-checks tools
- [ ] INSTALL button on missing tool triggers install and streams output
- [ ] METASPLOIT sub-tab renders terminal
- [ ] LAUNCH starts msfconsole (Linux only)
- [ ] Command input sends commands, output streams
- [ ] STOP kills msfconsole process
- [ ] BURP SUITE sub-tab shows launch + proxy instructions
- [ ] CVE LOOKUP fetches results from NVD for a valid CVE (e.g. CVE-2021-44228)
- [ ] CVE LOOKUP keyword search returns results
- [ ] CVEs from scan findings auto-populate as quick-click buttons

## 10. History Tab
- [ ] Completed scan appears in history list
- [ ] History shows target, date, profile, severity counts
- [ ] Clicking a history entry loads findings
- [ ] CLEAR HISTORY removes all entries

## 11. Report Builder Tab
- [ ] All fields (title, client, assessor, classification) editable
- [ ] Executive summary textarea works
- [ ] Scope and methodology fields work
- [ ] EXPORT HTML REPORT generates a complete professional report
- [ ] Report includes cover page with risk rating
- [ ] Report includes all findings with notes
- [ ] False positives excluded when checkbox is checked
- [ ] EXPORT PDF opens print dialog
- [ ] EXPORT MARKDOWN downloads .md file

## 12. Script Tab
- [ ] GENERATE produces a shell script in the preview
- [ ] Script includes correct target, profile, modules
- [ ] Script includes proxychains config if proxies configured
- [ ] DOWNLOAD .SH downloads the file
- [ ] Downloaded script is executable on Linux

## 13. Auto-Updater (packaged build only)
- [ ] Update pill appears in topbar on launch
- [ ] Shows current version or "up to date"
- [ ] Clicking pill triggers update check
- [ ] If update available, download starts automatically
- [ ] Dialog appears when update is downloaded
- [ ] Restart Now installs the update

## 14. Performance
- [ ] App launch to intro: under 3 seconds
- [ ] Intro to main app: under 1 second
- [ ] Terminal doesn't lag with high-volume output
- [ ] No memory leak during long scans (check Task Manager)
- [ ] Window resize doesn't break layout

## 15. Regression — Things That Broke Before
- [ ] No ghost text visible in main UI (Windows modal not leaking)
- [ ] All fonts loaded (Orbitron, Share Tech Mono, Exo 2)
- [ ] Menu bar hidden on Windows
- [ ] Audio plays (not 404)
- [ ] SKIP button responds to clicks
- [ ] All five tabs switch correctly
- [ ] No inline script CSP errors in console

---

## Known Limitations
- Scan tools require Linux or WSL — Windows shows informational modal
- MSF integration requires msfconsole installed and accessible in PATH
- CVE lookup requires internet access
- Burp Suite auto-detect covers common Linux install paths only
- Auto-updater only active in packaged builds (not `npm start`)
