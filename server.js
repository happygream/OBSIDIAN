'use strict';

const { WebSocketServer } = require('ws');
const { spawn, execSync } = require('child_process');
const { writeFileSync } = require('fs');
const path = require('path');
const os = require('os');
const treeKill = require('tree-kill');

let wss = null;
let activeProcesses = [];
let activeScan = null;

// ============================================================
// WSL DETECTION (Windows only)
// When running on Windows with WSL available, all tool
// execution is routed through wsl.exe so the full Linux
// toolchain works without any changes to the rest of the code.
// ============================================================

const IS_WIN = process.platform === 'win32';
let WSL_AVAILABLE = false;
let WSL_DISTRO = null;

function debugFindTool(toolName) {
  if (!IS_WIN || !WSL_AVAILABLE) return;
  const proc = spawn('wsl.exe', ['-d', WSL_DISTRO, 'bash', '-c',
    `echo "USER=$(whoami) HOME=$HOME"; find / -name "${toolName}" -type f 2>/dev/null | head -5; echo "LOCAL_BIN:"; ls ~/.local/bin/ 2>/dev/null | head -10`
  ], { stdio: ['ignore','pipe','ignore'], shell: false });
  let out = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', d => { out += d; });
  proc.on('close', () => {
    out.split('\n').forEach(line => {
      if (line.trim()) broadcast('log', { module: 'system', logType: 'info', text: 'DEBUG: ' + line.trim() });
    });
  });
}

// ============================================================
// SUDOERS SETUP — enables passwordless apt-get and ln for OBSIDIAN
// Runs once on startup, makes all subsequent installs work silently
// ============================================================

function setupSudoers() {
  if (!IS_WIN || !WSL_AVAILABLE) {
    fixPipSymlinks();
    autoInstallTools();
    return;
  }
  const sudoersLine = `${process.env.USER || 'zerodark'} ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /bin/ln, /usr/bin/ln, /usr/local/bin/apt-get`;
  // Try to add to sudoers.d — if it fails, try running as root via wsl -u root
  // No longer needed - we use wsl -u root directly
  fixPipSymlinks();
  autoInstallTools();
  return;
  const setupCmd = [
    `USER=$(whoami)`,
    `echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /bin/ln, /usr/bin/ln" | sudo -n tee /etc/sudoers.d/obsidian-nopasswd > /dev/null 2>&1`,
    // If that failed, try via wsl -u root
    `[ $? -ne 0 ] && true || true`,
    // Add ~/.local/bin to PATH in profile
    `grep -q '.local/bin' ~/.profile 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$HOME/go/bin:$PATH"' >> ~/.profile`,
    // Symlink everything in ~/.local/bin
    `for f in ~/.local/bin/*; do [ -f "$f" ] && sudo -n ln -sf "$f" /usr/local/bin/$(basename "$f") 2>/dev/null || true; done`,
    // Symlink go bins
    `for f in ~/go/bin/*; do [ -f "$f" ] && sudo -n ln -sf "$f" /usr/local/bin/$(basename "$f") 2>/dev/null || true; done`,
    `echo SETUP_DONE`,
  ].join('; ');

  let out = '';
  const proc = spawn('wsl.exe', ['-d', WSL_DISTRO, 'bash', '-lc', setupCmd], {
    stdio: ['ignore','pipe','pipe'], shell: false
  });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', d => { out += d; });
  proc.on('close', () => {
    console.log('[OBSIDIAN] Sudoers setup:', out.includes('SETUP_DONE') ? 'OK' : 'partial');
    // Now try via root if sudo failed
    if (!out.includes('SETUP_DONE') || out.includes('failed')) {
      // Try wsl -u root to set up sudoers
      const rootCmd = `USER=$(getent passwd 1000 | cut -d: -f1); echo "$USER ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/obsidian-nopasswd && chmod 440 /etc/sudoers.d/obsidian-nopasswd && echo ROOT_OK`;
      const rootProc = spawn('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', 'bash', '-c', rootCmd], {
        stdio: ['ignore','pipe','ignore'], shell: false
      });
      rootProc.on('close', () => {
        fixPipSymlinks();
        autoInstallTools();
      });
    } else {
      fixPipSymlinks();
      autoInstallTools();
    }
  });
  proc.on('error', () => { fixPipSymlinks(); autoInstallTools(); });
}

// ============================================================
// FIX SYMLINKS — runs silently on every startup
// Ensures pip/go installed tools are accessible in PATH
// ============================================================

function fixPipSymlinks() {
  if (!IS_WIN || !WSL_AVAILABLE) return;

  // Use Python to find pip script locations (handles any Python version)
  // Also symlink go binaries
  // Instead of sudo symlinks, just ensure ~/.local/bin and ~/go/bin
  // are in PATH by writing to .bashrc — no sudo needed
  // Also create symlinks in ~/bin which user owns
  const fixScript = `
import os, glob, stat

home = os.path.expanduser('~')
user_bin = os.path.join(home, '.local', 'bin')
go_bin = os.path.join(home, 'go', 'bin')

# Ensure ~/.local/bin exists
os.makedirs(user_bin, exist_ok=True)

# Add PATH entries to .profile if not already there
profile = os.path.join(home, '.profile')
path_line = 'export PATH="$HOME/.local/bin:$HOME/go/bin:$PATH"'
try:
    txt = open(profile).read() if os.path.exists(profile) else ''
    if '.local/bin' not in txt:
        with open(profile, 'a') as f:
            f.write('\n' + path_line + '\n')
except:
    pass

# Also write to .bashrc
bashrc = os.path.join(home, '.bashrc')
try:
    txt = open(bashrc).read() if os.path.exists(bashrc) else ''
    if '.local/bin' not in txt:
        with open(bashrc, 'a') as f:
            f.write('\n' + path_line + '\n')
except:
    pass

# Try sudo symlinks but don't fail if sudo needs password
all_bins = list(glob.glob(os.path.join(user_bin, '*')))
all_bins += list(glob.glob(os.path.join(go_bin, '*')))
for src in all_bins:
    if os.path.isfile(src):
        name = os.path.basename(src)
        dst = f'/usr/local/bin/{name}'
        if not os.path.exists(dst):
            ret = os.system(f'sudo -n ln -sf {src} {dst} 2>/dev/null')
            if ret != 0:
                # sudo failed — create in user bin instead
                pass

print('path fix done')
print('user_bin:', user_bin)
print('files:', ','.join(os.path.basename(f) for f in all_bins[:20]))
`;

  const b64 = Buffer.from(fixScript.trim()).toString('base64');
  const proc = spawn('wsl.exe', ['-d', WSL_DISTRO, 'bash', '-lc', `echo '${b64}' | base64 -d | python3`], {
    stdio: 'ignore', shell: false
  });
  proc.on('error', () => {});
  proc.on('close', () => { console.log('[OBSIDIAN] Symlink fix complete'); });
}

// ============================================================
// AUTO-INSTALL — runs install.sh inside WSL on first launch
// ============================================================

const { existsSync } = require('fs');
const INSTALL_FLAG = path.join(os.tmpdir(), 'obsidian_installed.flag');

function autoInstallTools() {
  if (!IS_WIN || !WSL_AVAILABLE) {
    // On Linux/Mac — run install.sh directly if not already done
    if (existsSync(INSTALL_FLAG)) return;
    const scriptPath = path.join(__dirname, 'install.sh');
    if (!existsSync(scriptPath)) return;
    broadcast('log', { module: 'system', logType: 'info', text: 'First launch — auto-installing tools (this may take a few minutes)...' });
    broadcast('log', { module: 'system', logType: 'info', text: 'Check the Tools tab for progress.' });
    const proc = spawn('bash', [scriptPath], { stdio: ['ignore','pipe','pipe'], shell: false });
    proc.stdout.on('data', d => {
      const t = d.toString().trim();
      if (t) broadcast('log', { module: 'installer', logType: 'info', text: t });
    });
    proc.stderr.on('data', d => {
      const t = d.toString().trim();
      if (t) broadcast('log', { module: 'installer', logType: 'warn', text: t });
    });
    proc.on('close', () => {
      try { writeFileSync(INSTALL_FLAG, new Date().toISOString()); } catch {}
      broadcast('log', { module: 'installer', logType: 'ok', text: 'Auto-install complete — click REFRESH in Tools tab' });
      if (wss) wss.clients.forEach(ws => { if (ws.readyState === 1) checkTools(ws); });
    });
    return;
  }

  // Windows + WSL — run install.sh inside WSL
  if (existsSync(INSTALL_FLAG)) return;
  const scriptPath = path.join(__dirname, 'install.sh');
  if (!existsSync(scriptPath)) return;

  broadcast('log', { module: 'system', logType: 'sec',  text: '=== OBSIDIAN — FIRST LAUNCH AUTO-INSTALL ===' });
  broadcast('log', { module: 'system', logType: 'info', text: 'Installing tools inside WSL (' + WSL_DISTRO + ')...' });
  broadcast('log', { module: 'system', logType: 'info', text: 'Stage 1/3: apt packages (nmap, nikto, ffuf, gobuster, rustscan...)' });

  // Fast-install tools: apt packages only, skip heavy pip tools (wapiti, etc)
  // These install quickly and cover 90% of scan capability
  const fastTools = [
    'nmap', 'nikto', 'masscan', 'hydra', 'whatweb', 'sqlmap',
    'proxychains4', 'curl', 'ffuf', 'testssl.sh', 'sslscan',
    'rustscan', 'wpscan', 'gobuster', 'feroxbuster',
    'amass', 'dnsrecon', 'nbtscan', 'snmp', 'theharvester',
    'enum4linux', 'medusa', 'crackmapexec',
  ];

  // Run apt-get install for all fast tools in one shot
  const aptCmd = 'DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y ' + fastTools.join(' ') + ' 2>/dev/null || true';

  const aptB64 = Buffer.from(aptCmd).toString('base64');
  const aptRunCmd = `echo '${aptB64}' | base64 -d | bash`;
  const proc = spawn('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', 'bash', '--norc', '--noprofile', '-c', aptRunCmd], {
    stdio: ['ignore', 'pipe', 'pipe'], shell: false
  });

  let lastPkg = '';
  proc.stdout.on('data', d => {
    d.toString().split('\n').forEach(line => {
      const t = line.trim();
      if (!t) return;
      // Show what's being installed/downloaded
      if (/^Get:|^Fetched|^Downloaded/.test(t)) {
        broadcast('log', { module: 'installer', logType: 'cmd', text: t });
      } else if (/^Setting up (\S+)/.test(t)) {
        const pkg = t.match(/^Setting up (\S+)/)[1];
        if (pkg !== lastPkg) {
          lastPkg = pkg;
          broadcast('log', { module: 'installer', logType: 'ok', text: '[+] Installed: ' + pkg });
        }
      } else if (/^(nmap|nikto|masscan|nuclei|ffuf|hydra|amass|wpscan|gobuster|feroxbuster|rustscan|sslscan|sqlmap|testssl|enum4linux|medusa|dnsrecon|snmp|nbtscan|crackmapexec|theharvester|proxychains|curl|whatweb)/.test(t.toLowerCase())) {
        broadcast('log', { module: 'installer', logType: 'info', text: t });
      }
    });
  });
  proc.stderr.on('data', d => {
    const t = d.toString().trim();
    if (t && !/^WARNING|^debconf|^update-alternatives|^Processing/.test(t))
      broadcast('log', { module: 'installer', logType: 'warn', text: t });
  });
  proc.on('close', () => {
    // Install go-based tools (nuclei, subfinder) separately
    const goCmd = 'export PATH=$PATH:$(go env GOPATH)/bin 2>/dev/null; '
      + 'go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest 2>/dev/null && sudo ln -sf ~/go/bin/nuclei /usr/local/bin/nuclei 2>/dev/null; '
      + 'go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest 2>/dev/null && sudo ln -sf ~/go/bin/subfinder /usr/local/bin/subfinder 2>/dev/null; '
      + 'true';

    broadcast('log', { module: 'installer', logType: 'sec', text: '=== Stage 2/3: Go tools (nuclei, subfinder) ===' });
    const goProc = spawn('wsl.exe', ['-d', WSL_DISTRO, 'bash', '-c', goCmd], {
      stdio: ['ignore', 'pipe', 'ignore'], shell: false
    });
    goProc.stdout.on('data', d => {
      d.toString().split('\n').forEach(line => {
        const t = line.trim();
        if (!t) return;
        if (/downloading|go: found/i.test(t))
          broadcast('log', { module: 'installer', logType: 'cmd', text: t });
        else if (t)
          broadcast('log', { module: 'installer', logType: 'info', text: t });
      });
    });
    goProc.on('close', () => {
      // Install pip tools (arjun, shodan) — skip wapiti (too heavy for auto-install)
      const pipCmd = 'pip3 install arjun shodan --break-system-packages 2>/dev/null; '
        + 'for b in arjun shodan; do [ -f ~/.local/bin/$b ] && sudo ln -sf ~/.local/bin/$b /usr/local/bin/$b 2>/dev/null; done; '
        + 'true';

      broadcast('log', { module: 'installer', logType: 'sec', text: '=== Stage 3/3: Python tools (arjun, shodan) ===' });
      const pipProc = spawn('wsl.exe', ['-d', WSL_DISTRO, 'bash', '-c', pipCmd], {
        stdio: ['ignore', 'pipe', 'pipe'], shell: false
      });
      pipProc.stdout.on('data', d => {
        d.toString().split('\n').forEach(line => {
          const t = line.trim();
          if (!t) return;
          if (/^Collecting|^Downloading|^Installing|^Successfully/i.test(t))
            broadcast('log', { module: 'installer', logType: t.startsWith('Successfully') ? 'ok' : 'cmd', text: t });
        });
      });
      pipProc.stderr.on('data', d => {
        d.toString().split('\n').forEach(line => {
          const t = line.trim();
          if (t && !/^WARNING|DEPRECAT/.test(t))
            broadcast('log', { module: 'installer', logType: 'warn', text: t });
        });
      });
      pipProc.on('close', () => {
        try { writeFileSync(INSTALL_FLAG, new Date().toISOString()); } catch {}
        broadcast('log', { module: 'installer', logType: 'ok', text: 'Auto-install complete — refreshing tool status...' });
        setTimeout(() => {
          wss && wss.clients.forEach(ws => { if (ws.readyState === 1) checkTools(ws); });
        }, 1000);
      });
    });
  });
  proc.on('error', (err) => {
    broadcast('log', { module: 'installer', logType: 'warn', text: 'Auto-install error: ' + err.message });
  });
}

// WSL detection runs async so the window doesn't freeze on startup
let wslDetectionDone = false;

function detectWSL() {
  if (!IS_WIN) { wslDetectionDone = true; return Promise.resolve(); }
  return new Promise((resolve) => {
    const proc = spawn('wsl.exe', ['--list', '--quiet'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      const distros = out.split(/\r?\n/).map(l => l.replace(/\x00/g, '').trim()).filter(Boolean);
      if (distros.length) {
        WSL_AVAILABLE = true;
        WSL_DISTRO = distros.find(d => /ubuntu/i.test(d)) || distros[0];
        console.log(`[OBSIDIAN] WSL detected — ${WSL_DISTRO}`);
        // Notify any connected clients that WSL is now available
        broadcast('wslReady', { distro: WSL_DISTRO });
      } else {
        WSL_AVAILABLE = false;
        console.log('[OBSIDIAN] WSL not found');
      }
      wslDetectionDone = true;
      resolve();
    });
    proc.on('error', () => { WSL_AVAILABLE = false; wslDetectionDone = true; resolve(); });
    // Hard timeout — never block more than 8s
    setTimeout(() => { try { proc.kill(); } catch {} wslDetectionDone = true; resolve(); }, 8000);
  });
}

// Start detection async — don't block server startup
detectWSL();

// Wrap a spawn call to route through WSL on Windows
function wslSpawn(bin, args) {
  if (IS_WIN && WSL_AVAILABLE) {
    // wsl.exe -d <distro> -- <bin> <args...>
    return { bin: 'wsl.exe', args: ['-d', WSL_DISTRO, '--', bin, ...args] };
  }
  return { bin, args };
}

// Check if a binary is available — on Windows checks inside WSL
function toolInstalled(binary) {
  if (IS_WIN && WSL_AVAILABLE) {
    try {
      const result = execSync(
        `wsl.exe -d ${WSL_DISTRO} bash -c "command -v ${binary} 2>/dev/null || test -f /usr/bin/${binary} && echo /usr/bin/${binary} || test -f /usr/local/bin/${binary} && echo /usr/local/bin/${binary} || test -f /root/.local/bin/${binary} && echo found || test -f /home/zerodark/.local/bin/${binary} && echo found"`,
        { encoding: 'utf8', timeout: 8000 }
      );
      return result.trim().length > 0;
    } catch { return false; }
  }
  try { execSync(`which ${binary}`, { stdio: 'ignore', shell: false }); return true; }
  catch { return false; }
}

// ============================================================
// INPUT SANITISATION
// All user-supplied values pass through here before touching
// any shell command. Nothing is ever passed via shell string
// interpolation — tools are spawned with argument arrays.
// ============================================================

const ALLOWED_URL_RE   = /^https?:\/\/[a-zA-Z0-9.\-_~:/?#[\]@!$&'()*+,;=%]+$/;
const ALLOWED_DOMAIN_RE = /^[a-zA-Z0-9.\-]+$/;
const ALLOWED_PATH_RE  = /^[a-zA-Z0-9.\-_/]+$/;
const ALLOWED_PARAM_RE = /^[a-zA-Z0-9_\-]+$/;
const ALLOWED_FILE_RE  = /^[a-zA-Z0-9.\-_/]+\.txt$/;
const ALLOWED_INT_RE   = /^\d{1,5}$/;

// Extended regexes for IP/range/domain targets
const ALLOWED_IP_RE    = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const ALLOWED_RANGE_RE = /^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/;

function classifyTarget(t) {
  if (ALLOWED_URL_RE.test(t))    return 'url';
  if (ALLOWED_RANGE_RE.test(t))  return 'range';
  if (ALLOWED_IP_RE.test(t))     return 'ip';
  if (ALLOWED_DOMAIN_RE.test(t)) return 'domain';
  return null;
}

function sanitiseTarget(raw) {
  const t = (raw || '').trim();
  const type = classifyTarget(t);

  if (!type) throw new Error(
    `Invalid target: "${t}" — enter a URL (https://example.com), IP (192.168.1.1), CIDR (10.0.0.0/24), range (10.0.0.1-10.0.0.254), or domain`
  );

  let url, host;
  if (type === 'url') {
    url  = t;
    host = new URL(t).hostname;
  } else if (type === 'ip') {
    host = t.split('/')[0];   // strip CIDR for URL building
    url  = 'http://' + host;
  } else if (type === 'range') {
    host = t;
    url  = t;                 // ranges are used directly by nmap/masscan
  } else {
    // plain domain
    host = t;
    url  = 'http://' + t;
  }

  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
  return { url, host, raw: t, type, isLocal };
}

function sanitiseDomain(raw) {
  const d = (raw || '').trim().toLowerCase();
  if (!ALLOWED_DOMAIN_RE.test(d)) throw new Error(`Invalid domain: ${d}`);
  return d;
}

function sanitiseFilePath(raw) {
  if (!raw) return null;
  const p = (raw || '').trim();
  if (!ALLOWED_FILE_RE.test(p)) throw new Error(`Invalid file path: ${p}`);
  // Prevent path traversal
  if (p.includes('..')) throw new Error('Path traversal not allowed');
  return p;
}

function sanitiseParam(raw, name) {
  const p = (raw || '').trim();
  if (!ALLOWED_PARAM_RE.test(p)) throw new Error(`Invalid ${name}: ${p}`);
  return p;
}

function sanitiseInt(raw, min, max) {
  const n = parseInt((raw || '').toString(), 10);
  if (isNaN(n) || n < min || n > max) throw new Error(`Value out of range: ${raw}`);
  return n;
}

// Fail string used in hydra form — strip shell metacharacters
function sanitiseFailString(raw) {
  return (raw || '').replace(/[`$\\|;&<>(){}]/g, '').slice(0, 100);
}

// ============================================================
// TOOL COMMAND BUILDERS
// Each tool is spawned with spawn(binary, [arg, arg, ...])
// Never via shell string interpolation.
// ============================================================

function buildArgs(module, target, domain, profile, auth, proxyArgs) {
  const pf = profile || 'standard';

  const timingMap = { fast: '4', stealth: '1', standard: '4', hardcore: '5', auth: '4' };
  const timing = timingMap[pf] || '4';

  const nmapFlagsMap = {
    fast:     ['-sV', `-T${timing}`, '--open', '--top-ports', '1000', '--script', 'banner', '--stats-every', '10s'],
    stealth:  ['-sS', '-T1', '-f', '--data-length', '25', '--open'],
    standard: ['-sV', '-sC', `-T${timing}`, '--open', '--script', 'default,http-headers,http-title', '--stats-every', '10s'],
    hardcore: ['-sV', '-sC', '-A', `-T${timing}`, '-p-', '--script', 'default,vuln,exploit', '--stats-every', '15s'],
    auth:     ['-sV', `-T${timing}`, '--open', '-p', '80,443,8080,8443'],
  };

  // Extract the right host/target for each tool type
  // target = URL or raw IP/range/domain passed from sanitiseTarget
  let host, webTarget;
  try {
    // If it's a proper URL extract hostname
    host = new URL(target).hostname;
    webTarget = target;
  } catch {
    // Raw IP, range, or domain — use directly for network tools
    host = target;
    // For web tools prepend http:// if no scheme
    webTarget = target.match(/^https?:\/\//) ? target : 'http://' + target.split('/')[0];
  }

  const map = {
    masscan:  { bin: 'masscan', args: ['-p1-65535', host, '--rate=5000', '--wait=3'] },
    nmap:     { bin: 'nmap',    args: [...(nmapFlagsMap[pf]||nmapFlagsMap.standard), '-Pn', host] },
    nikto:    { bin: 'nikto',   args: [
      '-h', webTarget,
      '-ssl',
      '-Tuning', pf === 'hardcore' ? '1234567890abc' : '123bde',  // more checks on hardcore
      '-maxtime', pf === 'stealth' ? '300s' : '180s',             // time limit,
      ...(pf === 'stealth' ? ['-pause', '2'] : []),               // pause between requests
    ] },
    nuclei:   { bin: 'nuclei',  args: [
      '-u', webTarget,
      '-automatic-scan',
      '-severity', pf === 'stealth' ? 'critical,high' : 'critical,high,medium',
      '-rate-limit', pf === 'stealth' ? '5' : pf === 'hardcore' ? '300' : '100',
      '-timeout', '10',
      '-retries', '2',
      '-no-color',
      '-stats',                                  // show progress
      ...(pf === 'hardcore' ? ['-headless'] : []), // headless browser checks on hardcore
    ] },
    headers:  { bin: 'curl',    args: [
      '-sIL',
      '--max-time', '15',
      '--retry', '2',
      '--retry-delay', '2',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml',
      webTarget,
    ] },
    ssl:      { bin: 'testssl', args: ['--quiet', '--color', '0', target] },
    ffuf:     { bin: 'ffuf',    args: [
      '-u', `${webTarget}/FUZZ`,
      '-w', pf === 'hardcore'
        ? '/usr/share/dirb/wordlists/big.txt'
        : '/usr/share/dirb/wordlists/common.txt',  // smaller list for fast/standard
      '-mc', '200,201,204,301,302,307,401,403,405',
      '-fc', '404',
      '-ac',                                        // auto-calibrate catch-all
      '-rate', pf === 'stealth' ? '10' : pf === 'hardcore' ? '200' : '80',
      '-timeout', '10',
      '-recursion',                                 // recurse into found dirs
      '-recursion-depth', pf === 'hardcore' ? '3' : '1',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ] },
    amass:    { bin: 'amass',   args: ['enum', '-passive', '-d', domain] },
    subfinder:{ bin: 'subfinder', args: ['-d', domain, '-silent'] },
    wapiti:   { bin: 'wapiti3', args: ['-u', target, '-m', 'xss,csrf,sql,ssrf', '--level', '2', '-f', 'txt', '-o', path.join(os.tmpdir(), 'obsidian_wapiti')] },
    whatweb:  { bin: 'whatweb', args: ['-a', pf === 'hardcore' ? '4' : '3', '--color=never', '--no-errors', webTarget] },
    sqlmap:   { bin: 'sqlmap',  args: [
      '-u', `${webTarget}/?id=1`,
      // Evasion
      '--random-agent',                          // rotate user agents
      '--delay=2',                               // 2s between requests
      '--retries=2',                             // don't hammer on timeout
      '--timeout=20',                            // give target time to respond
      '--tamper=space2comment,between,randomcase', // stack multiple tampers
      // Crawl the target to find real injectable params
      '--crawl=2',                               // crawl 2 levels deep
      '--forms',                                 // test forms not just ?id=1
      // Detection tuning per profile
      ...(pf === 'hardcore' ? ['--level=5', '--risk=3', '--dbs', '--tables'] :
          pf === 'stealth'  ? ['--level=1', '--risk=1'] :
                              ['--level=3', '--risk=2']),
      '--batch',                                 // no interactive prompts
      '--output-dir', path.join(os.tmpdir(), 'obsidian_sqlmap'),
      '--flush-session',                         // fresh session each run
    ] },
  };

  // Hydra — built from sanitised auth config
  if (module === 'hydra' && auth) {
    const ep  = auth.endpoint  || '/login';
    const up  = auth.userParam || 'username';
    const pp  = auth.passParam || 'password';
    const fs  = sanitiseFailString(auth.failString || 'Invalid credentials');
    const ul  = sanitiseFilePath(auth.userlist) || '/usr/share/wordlists/metasploit/unix_users.txt';
    const pl  = sanitiseFilePath(auth.passlist)  || '/usr/share/wordlists/rockyou.txt';
    const thr = sanitiseInt(auth.threads, 1, 64).toString();
    const dly = sanitiseInt(auth.delay, 0, 60000);
    const w   = Math.max(1, Math.round(dly / 1000)).toString();
    const mode = auth.mode || 'spray';
    const form = `${ep}:${up}=^USER^&${pp}=^PASS^:${fs}`;

    let hydraArgs = [];
    if (mode === 'stuffing') {
      hydraArgs = ['-C', ul];
    } else if (mode === 'brute') {
      hydraArgs = ['-L', ul, '-P', pl];
    } else {
      // spray — use only first password from list
      // Spray mode — use top 5 most common passwords to stay under lockout
      const commonPasswords = ['Password123', 'password', 'Password1', '123456789', 'Welcome1'];
      hydraArgs = ['-L', ul, '-p', commonPasswords[0]];
    }

    map.hydra = {
      bin: 'hydra',
      args: [...hydraArgs, '-t', thr, '-W', w, host, 'https-post-form', form],
    };
  }

  // ---- New tools v0.3.0 ----
  // rustscan — ultra-fast port scan feeding into nmap
  map.rustscan = { bin: 'rustscan', args: [
    '-a', host,
    '--ulimit', '5000',
    '--range', pf === 'hardcore' ? '1-65535' : '1-10000',
    '--', '-sV', '-sC',
  ] };

  // wpscan — WordPress scanner
  map.wpscan = { bin: 'wpscan', args: [
    '--url', webTarget,
    '--no-banner',
    '--enumerate', pf === 'hardcore' ? 'ap,at,cb,dbe,u' : 'vp,vt,u',
    '--random-user-agent',
    ...(pf === 'stealth' ? ['--throttle', '200'] : []),
  ] };

  // gobuster — dir/DNS/vhost brute force
  map.gobuster = { bin: 'gobuster', args: [
    'dir',
    '-u', webTarget,
    '-w', '/usr/share/dirb/wordlists/' + (pf === 'hardcore' ? 'big.txt' : 'common.txt'),
    '-t', pf === 'stealth' ? '5' : '20',
    '-q',
    '--no-error',
    '-r',
  ] };

  // feroxbuster — recursive content discovery
  map.feroxbuster = { bin: 'feroxbuster', args: [
    '--url', webTarget,
    '--wordlist', '/usr/share/dirb/wordlists/common.txt',
    '--threads', pf === 'stealth' ? '5' : '20',
    '--depth', pf === 'hardcore' ? '4' : '2',
    '--quiet',
    '--no-recursion',
    '--filter-status', '404,429,500,503',
    '--auto-tune',
  ] };

  // arjun — HTTP parameter discovery
  map.arjun = { bin: 'arjun', args: [
    '-u', webTarget,
    '--stable',
    '-t', '5',
    '-oT', path.join(os.tmpdir(), 'obsidian_arjun.txt'),
  ] };

  // enum4linux — SMB/NetBIOS enumeration
  map.enum4linux = { bin: 'enum4linux', args: [
    '-a', host,
  ] };

  // snmpwalk — SNMP enumeration
  map.snmpwalk = { bin: 'snmpwalk', args: [
    '-v', '2c',
    '-c', 'public',
    host,
  ] };

  // nbtscan — NetBIOS scanner
  map.nbtscan = { bin: 'nbtscan', args: [
    '-r', host.includes('/') ? host : host + '/24',
  ] };

  // medusa — parallel brute force
  map.medusa = { bin: 'medusa', args: [
    '-h', host,
    '-u', auth?.userlist || 'admin',
    '-P', auth?.passlist || '/usr/share/wordlists/rockyou.txt',
    '-M', 'http',
    '-t', '4',
    '-f',
  ] };

  // crackmapexec — SMB/AD
  map.crackmapexec = { bin: 'crackmapexec', args: [
    'smb', host,
    '--shares',
    '-u', '',
    '-p', '',
  ] };

  // sslscan — SSL/TLS analysis
  map.sslscan = { bin: 'sslscan', args: [
    '--no-colour',
    '--show-certificate',
    host,
  ] };

  // theHarvester — OSINT
  map.theharvester = { bin: 'theHarvester', args: [
    '-d', domain,
    '-l', '200',
    '-b', 'bing,google,crtsh,dnsdumpster,hackertarget',
  ] };

  // shodan CLI — existing scan data
  map.shodan = { bin: 'shodan', args: [
    'host', host,
  ] };

  // dnsrecon — DNS enumeration
  map.dnsrecon = { bin: 'dnsrecon', args: [
    '-d', domain,
    '-t', 'std,brt,srv',
    '--xml', path.join(os.tmpdir(), 'obsidian_dnsrecon.xml'),
  ] };

  // ---- End new tools ----

  // Wrap with proxychains if configured
  const entry = map[module];
  if (!entry) return null;

  if (proxyArgs && proxyArgs.length) {
    return { bin: 'proxychains4', args: [...proxyArgs, entry.bin, ...entry.args] };
  }

  return { bin: entry.bin, args: entry.args };
}

// ============================================================
// PROXYCHAINS CONFIG
// ============================================================

function writeProxychainsConf(proxies, rotMode) {
  const chain = rotMode === 'random' ? 'random_chain' : 'strict_chain';
  const lines = [chain, 'proxy_dns', 'remote_dns_subnet 224', 'tcp_read_time_out 15000', 'tcp_connect_time_out 8000', '[ProxyList]'];

  proxies.forEach(p => {
    if (!p.host || !p.port) return;
    // Sanitise proxy host and port
    try {
      const host = sanitiseDomain(p.host);
      const port = sanitiseInt(p.port, 1, 65535);
      const type = ['http','socks4','socks5'].includes(p.type.toLowerCase()) ? p.type.toLowerCase() : 'http';
      const auth = p.user && p.pass && ALLOWED_PARAM_RE.test(p.user) ? ` ${p.user} ${p.pass}` : '';
      lines.push(`${type} ${host} ${port}${auth}`);
    } catch (e) {
      broadcast('log', { module: 'system', logType: 'warn', text: `Skipping invalid proxy: ${e.message}` });
    }
  });

  const confPath = path.join(os.tmpdir(), 'obsidian-proxychains.conf');
  writeFileSync(confPath, lines.join('\n'), { mode: 0o600 });
  return confPath;
}

// ============================================================
// BROADCAST + LOGGING
// ============================================================

function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, ...data });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ============================================================
// TOOL RUNNER — spawns with arg array, never shell string
// ============================================================

function runTool(module, bin, args, outputDir) {
  return new Promise((resolve) => {
    const displayCmd = `${bin} ${args.join(' ')}`;
    broadcast('log', { module, logType: 'cmd', text: displayCmd });

    // Route through WSL on Windows if available
  const wrapped = wslSpawn(bin, args);
  const proc = spawn(wrapped.bin, wrapped.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: false, // Never use shell
    });

    activeProcesses.push(proc);

    const handleData = (data) => {
      data.toString().split('\n').forEach(line => {
        const t = line.trim();
        if (!t) return;

        // Show nmap progress stats
        if (module === 'nmap' && /Stats:|Timing:|SYN Stealth Scan|Service scan/i.test(t)) {
          broadcast('log', { module, logType: 'info', text: t });
          return;
        }

        // Suppress noisy ffuf output — only show actual results and errors
        if (module === 'ffuf') {
          // Skip: progress counters, ANSI codes, banner art, config dump, rate stats
          if (/Progress:.*Job/.test(t))       return;
          if (/D\[2K/.test(t))               return;
          if (/^\[!\].*Errors:/.test(t))     return;
          if (/req\/sec.*Duration/.test(t))   return;
          if (/^\s*[\\/|_\\s]{2,}/.test(t)) return; // ASCII art banner lines
          if (/^\[\-\]\s*:+\s+(Method|URL|Wordlist|Header|Follow|Calibration|Timeout|Threads|Matcher|Filter|Auto-calibration|v\d)/.test(t)) return; // config dump
          if (/^\[\-\]\s*_{10,}/.test(t))   return; // separator lines
          if (/^\/\//.test(t) && !/found|status/i.test(t)) return; // comment lines
        }

        // Suppress sqlmap progress noise
        if (module === 'sqlmap' && /\[INFO\].*testing|\[INFO\].*heuristic|\[INFO\].*checking/.test(t)) return;

        // Suppress nuclei stats lines
        if (module === 'nuclei' && /^\[INF\]/.test(t) && /templates|nuclei-templates/.test(t)) return;

        let logType = 'info';
        const l = t.toLowerCase();
        if (/critical|cve-|exploit/i.test(t))          logType = 'crit';
        else if (/\[high\]|\[!!\]/i.test(t))            logType = 'crit';
        else if (/error|fail|denied|refused/i.test(l))  logType = 'warn';
        else if (/open|\[\+\]|found|success/i.test(l))  logType = 'ok';
        else if (/warn|\[!\]|missing/i.test(l))         logType = 'warn';
        broadcast('log', { module, logType, text: t });
        const finding = parseFinding(module, t);
        if (finding) broadcast('finding', { module, ...finding });
      });
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);

    proc.on('close', code => {
      activeProcesses = activeProcesses.filter(p => p !== proc);
      broadcast('log', { module, logType: 'ok', text: `${module} finished (exit ${code ?? 0})` });
      broadcast('moduleComplete', { module });
      resolve(code ?? 0);
    });

    proc.on('error', err => {
      activeProcesses = activeProcesses.filter(p => p !== proc);
      broadcast('log', { module, logType: 'warn', text: `${module}: ${err.message} — is the tool installed? Run install.sh` });
      broadcast('moduleComplete', { module });
      resolve(1);
    });
  });
}

// ============================================================
// FINDING PARSER
// ============================================================

function parseFinding(module, line) {
  const l = line.toLowerCase();
  if (module === 'nuclei') {
    const m = line.match(/\[(critical|high|medium|low|info)\]\s+(.+)/i);
    if (m) return { sev: m[1].toUpperCase(), title: m[2].trim().split(/\s+/)[0] || 'Finding', detail: line.trim() };
  }
  if (module === 'nmap' && /\d+\/tcp\s+open/.test(line)) {
    const sev = /22\/tcp/.test(line) ? 'MEDIUM' : 'INFO';
    return { sev, title: 'Open Port', detail: line.trim() };
  }
  if (module === 'nikto' && /^\+/.test(line.trim())) {
    const sev = /osvdb|cve|xss|sql|inject/i.test(line) ? 'HIGH' : 'MEDIUM';
    return { sev, title: 'Nikto Finding', detail: line.replace(/^\+\s*/, '').trim() };
  }
  if (module === 'ffuf') {
    // Only match actual result lines — must have a path and status, not a progress line
    const ffufMatch = line.match(/^(\S+)\s+\[Status:\s*(200|301|302|403)/);
    if (ffufMatch && !line.includes('Progress:') && !line.includes('D[2K')) {
      const status = ffufMatch[2];
      const sev = status === '200' ? 'LOW' : 'INFO';
      return { sev, title: 'Path Found', detail: ffufMatch[1] + ' [' + status + ']' };
    }
  }
  if (module === 'sqlmap' && /parameter .+ is vulnerable/i.test(line)) {
    return { sev: 'CRITICAL', title: 'SQL Injection Found', detail: line.trim() };
  }
  if (module === 'hydra' && /host:.+login:.+password:/i.test(line)) {
    return { sev: 'CRITICAL', title: 'Valid Credentials Found', detail: line.trim() };
  }
  if (module === 'hydra' && /account locked/i.test(line)) {
    return { sev: 'INFO', title: 'Account Lockout Triggered', detail: line.trim() };
  }
  if (module === 'ssl' && /not ok|vulnerable|warn/i.test(line)) {
    const sev = /critical|poodle|heartbleed|drown/i.test(line) ? 'CRITICAL' : 'MEDIUM';
    return { sev, title: 'TLS Issue', detail: line.trim() };
  }
  if (module === 'headers' && /content-security-policy/i.test(line) && !/:\s*\S/.test(line.split('content-security')[1] || '')) {
    return { sev: 'HIGH', title: 'Missing CSP Header', detail: 'Content-Security-Policy not set' };
  }
  if (module === 'wapiti' && /\[!\]/i.test(line)) {
    return { sev: 'HIGH', title: 'Wapiti Finding', detail: line.replace(/\[!\]\s*/i, '').trim() };
  }
  if (module === 'masscan' && /open.*port\s+\d+/i.test(line)) {
    return { sev: 'INFO', title: 'Open Port (masscan)', detail: line.trim() };
  }
  if ((module === 'amass' || module === 'subfinder') && /\.[a-z]{2,}$/.test(line.trim())) {
    return { sev: 'INFO', title: 'Subdomain Found', detail: line.trim() };
  }

  // rustscan — open port
  if (module === 'rustscan' && /Open \d+\.\d+/.test(line)) {
    return { sev: 'INFO', title: 'Open Port (rustscan)', detail: line.trim() };
  }

  // wpscan
  if (module === 'wpscan') {
    if (/\[!\].*vulnerability|CVE-/i.test(line))
      return { sev: 'HIGH', title: 'WordPress Vulnerability', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\+\].*WordPress.*identified|version/i.test(line))
      return { sev: 'INFO', title: 'WordPress Version', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\+\].*plugin|theme.*found/i.test(line))
      return { sev: 'INFO', title: 'WP Plugin/Theme', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\+\].*user.*found|username/i.test(line))
      return { sev: 'MEDIUM', title: 'WordPress User Found', detail: line.replace(/\[.\]\s*/,'').trim() };
  }

  // gobuster
  if (module === 'gobuster' && /^\/(\S+).*\(Status:\s*(200|301|302|401|403)/.test(line)) {
    const m = line.match(/^(\S+).*Status:\s*(\d+)/);
    const sev = m && m[2] === '401' ? 'MEDIUM' : 'LOW';
    return { sev, title: 'Path Found', detail: line.trim() };
  }

  // feroxbuster
  if (module === 'feroxbuster' && /^(200|301|302|401|403)\s+/.test(line)) {
    const sev = /^401/.test(line) ? 'MEDIUM' : 'LOW';
    return { sev, title: 'Path Found', detail: line.trim() };
  }

  // arjun — parameter found
  if (module === 'arjun' && /\[\+\]|Parameters found/i.test(line)) {
    return { sev: 'MEDIUM', title: 'Hidden Parameter Found', detail: line.trim() };
  }

  // enum4linux
  if (module === 'enum4linux') {
    if (/\[\+\].*share|Share/i.test(line))
      return { sev: 'MEDIUM', title: 'SMB Share Found', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\+\].*user|username/i.test(line))
      return { sev: 'MEDIUM', title: 'SMB User Found', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\+\].*password|pass/i.test(line))
      return { sev: 'HIGH', title: 'SMB Credential', detail: line.replace(/\[.\]\s*/,'').trim() };
  }

  // snmpwalk — anything returned is worth noting
  if (module === 'snmpwalk' && /SNMPv2-MIB|sysDescr|STRING:/i.test(line)) {
    return { sev: 'MEDIUM', title: 'SNMP Response', detail: line.trim() };
  }

  // nbtscan
  if (module === 'nbtscan' && /\d+\.\d+\.\d+\.\d+\s+\S+/.test(line)) {
    return { sev: 'INFO', title: 'NetBIOS Host', detail: line.trim() };
  }

  // medusa — credential found
  if (module === 'medusa' && /ACCOUNT FOUND/i.test(line)) {
    return { sev: 'CRITICAL', title: 'Valid Credentials (medusa)', detail: line.trim() };
  }

  // crackmapexec
  if (module === 'crackmapexec') {
    if (/\[\+\].*pwn3d|Pwn3d/i.test(line))
      return { sev: 'CRITICAL', title: 'Admin Access (CME)', detail: line.trim() };
    if (/READ|WRITE/i.test(line) && /share/i.test(line))
      return { sev: 'HIGH', title: 'SMB Share Access', detail: line.trim() };
    if (/\+.*Windows|\+.*SMBv/i.test(line))
      return { sev: 'INFO', title: 'SMB Host Info', detail: line.trim() };
  }

  // sslscan — only flag actual vulnerabilities, not disabled/safe items
  if (module === 'sslscan') {
    const lt = line.trim();
    // Skip lines that show protocols are disabled (good) or "not vulnerable" (good)
    if (/disabled/i.test(lt)) return null;
    if (/not vulnerable/i.test(lt)) return null;
    if (/NULL/i.test(lt) && /Algorithm/i.test(lt)) return null; // sslscan formatting artifact
    // Suppress cert date lines (just informational)
    if (/Not valid before|Not valid after/i.test(lt)) return null;
    // Suppress cert blob/signature lines
    if (/BEGIN CERTIFICATE|END CERTIFICATE|Serial Number|Signature|Issuer|Subject:/i.test(lt)) return null;
    // Actual weak protocols enabled
    if (/TLSv1\.0.*enabled|TLSv1\.1.*enabled|SSLv.*enabled/i.test(lt))
      return { sev: 'HIGH', title: 'Weak Protocol Enabled', detail: lt };
    // Weak ciphers
    if (/RC4|DES\b|EXPORT|\bNULL\b.*cipher/i.test(lt))
      return { sev: 'HIGH', title: 'Weak Cipher', detail: lt };
    // Actual heartbleed vulnerability (not "not vulnerable")
    if (/vulnerable to heartbleed/i.test(lt) && !/not vulnerable/i.test(lt))
      return { sev: 'CRITICAL', title: 'Heartbleed Vulnerable', detail: lt };
    // Certificate issues — only real problems
    if (/Self-Signed/i.test(lt))
      return { sev: 'MEDIUM', title: 'Self-Signed Certificate', detail: lt };
    if (/expired/i.test(lt))
      return { sev: 'HIGH', title: 'Expired Certificate', detail: lt };
  }

  // theHarvester
  if (module === 'theharvester') {
    if (/\[\*\].*@.*\./.test(line))
      return { sev: 'INFO', title: 'Email Found (OSINT)', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\*\].*IP:|\d+\.\d+\.\d+\.\d+/.test(line) && module === 'theharvester')
      return { sev: 'INFO', title: 'IP Found (OSINT)', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/\[\*\].*[a-z0-9]\.[a-z]{2,}/.test(line))
      return { sev: 'INFO', title: 'Subdomain (OSINT)', detail: line.replace(/\[.\]\s*/,'').trim() };
  }

  // shodan
  if (module === 'shodan') {
    if (/Ports:|Open ports/i.test(line))
      return { sev: 'INFO', title: 'Shodan: Open Ports', detail: line.trim() };
    if (/Vulnerabilities:|CVE-/i.test(line))
      return { sev: 'HIGH', title: 'Shodan: Known Vulnerability', detail: line.trim() };
    if (/Organization:|City:|Country:/i.test(line))
      return { sev: 'INFO', title: 'Shodan: Host Info', detail: line.trim() };
  }

  // dnsrecon
  if (module === 'dnsrecon') {
    if (/\[\+\].*A\s+|\[\+\].*CNAME|\[\+\].*MX|\[\+\].*NS/i.test(line))
      return { sev: 'INFO', title: 'DNS Record', detail: line.replace(/\[.\]\s*/,'').trim() };
    if (/Zone Transfer/i.test(line) && /\[\+\]/.test(line))
      return { sev: 'CRITICAL', title: 'DNS Zone Transfer', detail: line.replace(/\[.\]\s*/,'').trim() };
  }

  return null;
}

// ============================================================
// TOOL AVAILABILITY CHECK
// ============================================================

// toolInstalled defined above in WSL section

const TOOL_META = {
  nmap:        { binary:'nmap',        name:'nmap',         desc:'Network mapper — port scanning and service detection',    install:'apt:nmap' },
  nikto:       { binary:'nikto',       name:'nikto',        desc:'Web server scanner — misconfigs, outdated software',     install:'apt:nikto' },
  masscan:     { binary:'masscan',     name:'masscan',      desc:'High-speed TCP port scanner',                            install:'apt:masscan' },
  nuclei:      { binary:'nuclei',      name:'nuclei',       desc:'Template-based vulnerability scanner',                   install:'go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest' },
  ffuf:        { binary:'ffuf',        name:'ffuf',         desc:'Fast web fuzzer — directory and parameter discovery',    install:'apt:ffuf' },
  amass:       { binary:'amass',       name:'amass',        desc:'Subdomain enumeration and asset discovery',              install:'go install:github.com/owasp-amass/amass/v4/...@latest:amass' },
  subfinder:   { binary:'subfinder',   name:'subfinder',    desc:'Passive subdomain discovery',                            install:'go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest' },
  wapiti:      { binary:'wapiti3',     name:'wapiti',       desc:'Web application vulnerability scanner',                  install:'pip3 install wapiti3', pipPkg:'wapiti3' },
  hydra:       { binary:'hydra',       name:'hydra',        desc:'Network login brute-force tool',                         install:'apt:hydra' },
  whatweb:     { binary:'whatweb',     name:'whatweb',      desc:'Web technology fingerprinter',                           install:'apt:whatweb' },
  sqlmap:      { binary:'sqlmap',      name:'sqlmap',       desc:'Automatic SQL injection detection and exploitation',     install:'apt:sqlmap' },
  testssl:     { binary:'testssl',     name:'testssl.sh',   desc:'TLS/SSL configuration tester',                          install:'apt:testssl.sh' },
  proxychains: { binary:'proxychains4',name:'proxychains4', desc:'Route tool traffic through proxy chains',               install:'apt:proxychains4' },
  curl:        { binary:'curl',        name:'curl',         desc:'HTTP request tool — header analysis',                    install:'apt:curl' },
  msfconsole:  { binary:'msfconsole',  name:'metasploit',   desc:'Exploitation framework — post-exploitation and modules', install:'https://docs.metasploit.com/docs/using-metasploit/getting-started/nightly-installers.html' },
  burpsuite:   { binary:'burpsuite',   name:'Burp Suite',   desc:'Web application security testing proxy',                install:'https://portswigger.net/burp/releases' },
  // New tools v0.3.0
  rustscan:    { binary:'rustscan',    name:'rustscan',     desc:'Ultra-fast port scanner — feeds results to nmap',       install:'github-release:RustScan/RustScan:rustscan:x86_64-unknown-linux-musl.tar.gz' },
  wpscan:      { binary:'wpscan',      name:'wpscan',       desc:'WordPress vulnerability scanner — themes, plugins, CVEs', install:'gem-dev:wpscan' },
  gobuster:    { binary:'gobuster',    name:'gobuster',     desc:'Directory/DNS/vhost brute-force scanner',               install:'apt:gobuster' },
  feroxbuster: { binary:'feroxbuster', name:'feroxbuster',  desc:'Recursive web content discovery',                      install:'github-release:epi052/feroxbuster:feroxbuster:x86_64-linux.tar.gz' },
  arjun:       { binary:'arjun',       name:'arjun',        desc:'HTTP parameter discovery tool',                         install:'pip3 install arjun', pipPkg:'arjun' },
  enum4linux:  { binary:'enum4linux',  name:'enum4linux',   desc:'SMB/NetBIOS enumeration for Windows targets',          install:'script:https://raw.githubusercontent.com/CiscoCXSecurity/enum4linux/master/enum4linux.pl' },
  snmpwalk:    { binary:'snmpwalk',    name:'snmpwalk',     desc:'SNMP enumeration — device info and credentials',       install:'apt:snmp' },
  nbtscan:     { binary:'nbtscan',     name:'nbtscan',      desc:'NetBIOS scanner for Windows network enumeration',      install:'apt:nbtscan' },
  medusa:      { binary:'medusa',      name:'medusa',       desc:'Parallel network brute-force tool',                    install:'apt:medusa' },
  crackmapexec:{ binary:'crackmapexec',name:'crackmapexec', desc:'SMB/AD testing — pass-the-hash, shares enumeration',   install:'https://github.com/Pennyw0rth/NetExec' },
  sslscan:     { binary:'sslscan',     name:'sslscan',      desc:'Fast SSL/TLS scanner with detailed cipher analysis',   install:'apt:sslscan' },
  theharvester:{ binary:'theHarvester',name:'theHarvester', desc:'OSINT — emails, subdomains, IPs from public sources',  install:'pip3 install theHarvester', pipPkg:'theHarvester' },
  shodan:      { binary:'shodan',      name:'shodan CLI',   desc:'Query Shodan for existing scan data on target',        install:'pip3 install shodan', pipPkg:'shodan' },
  dnsrecon:    { binary:'dnsrecon',    name:'dnsrecon',     desc:'DNS enumeration — zone transfers, subdomain brute',    install:'apt:dnsrecon' },
};

function checkTools(ws, manual) {
  // Run all binary checks in one WSL call to avoid 28 separate execSync calls
  if (IS_WIN && WSL_AVAILABLE) {
    const entries = Object.entries(TOOL_META);

    // Build a simple bash check — one line per tool, no Python overhead
    // Uses 'command -v' with explicit path fallbacks
    const bashLines = [
      '#!/bin/bash',
      'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'H=$(getent passwd $(id -u) | cut -d: -f6)',
      'export PATH=$PATH:$H/.local/bin:$H/go/bin:$H/.cargo/bin:/var/lib/gems/3.3.0/bin:/var/lib/gems/3.3.0/wrappers',
      // Debug testssl specifically
      'echo "DEBUG_testssl_path=$(dpkg -L testssl.sh 2>/dev/null | grep -v ^$ | tr \\n , )"',
      'echo "DEBUG_testssl_pkg=$(dpkg -l testssl.sh 2>/dev/null | grep ^ii | head -1 || echo NO_PKG)"',
    ];
    entries.forEach(([k, m]) => {
      const bin = m.binary.replace(/[^a-zA-Z0-9._-]/g, '');
      const pipPkg = m.pipPkg || null;
      // Use a function — cleanest way to OR multiple checks
      const checks = [
        `command -v ${bin} >/dev/null 2>&1`,
        `[ -f /usr/bin/${bin} ]`,
        `[ -f /usr/local/bin/${bin} ]`,
        `[ -f $H/.local/bin/${bin} ]`,
        `[ -f /var/lib/gems/3.3.0/bin/${bin} ]`,
        `[ -f /var/lib/gems/3.3.0/wrappers/${bin} ]`,
        `[ -f $H/.cargo/bin/${bin} ]`,
        `[ -f /root/.cargo/bin/${bin} ]`,
      ];
      if (pipPkg) checks.push(`pip3 show ${pipPkg} >/dev/null 2>&1`);
      // Write as function so || chain works correctly
      bashLines.push(`check_${k}() {`);
      checks.forEach(c => bashLines.push(`  ${c} && return 0`));
      bashLines.push(`  return 1`);
      bashLines.push(`}`);
      bashLines.push(`check_${k} && echo "${k}=1" || echo "${k}=0"`);
    });

    const bashScript = bashLines.join('\n');
    const b64 = Buffer.from(bashScript).toString('base64');
    const tmpPath = '/tmp/obs_chk_' + Date.now() + '.sh';
    const runCmd = 'echo ' + b64 + ' | base64 -d > ' + tmpPath + ' && chmod +x ' + tmpPath + ' && bash ' + tmpPath + '; rm -f ' + tmpPath;

    let out = '', err = '';
    const proc = spawn('wsl.exe', ['-d', WSL_DISTRO, 'bash', '-c', runCmd],
      { stdio: ['ignore','pipe','pipe'], shell: false });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });

    const checkTimeout = setTimeout(() => {
      try { proc.kill(); } catch {}
      broadcast('log', { module: 'system', logType: 'warn', text: 'Tool check timed out' });
      const results = {};
      entries.forEach(([k, meta]) => { results[k] = { installed: false, ...meta }; });
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'toolStatus', results, wsl: { available: WSL_AVAILABLE, distro: WSL_DISTRO }, isWin: IS_WIN }));
    }, 30000);

    proc.on('error', () => {
      clearTimeout(checkTimeout);
      const results = {};
      entries.forEach(([k, meta]) => { results[k] = { installed: false, ...meta }; });
      if (ws && ws.readyState === 1)
        ws.send(JSON.stringify({ type: 'toolStatus', results, wsl: { available: WSL_AVAILABLE, distro: WSL_DISTRO }, isWin: IS_WIN }));
    });

    proc.on('close', () => {
      clearTimeout(checkTimeout);
      if (err.trim()) broadcast('log', { module: 'system', logType: 'info', text: 'CHECK_ERR: ' + err.slice(0,200) });
      const installed = {};
      out.split('\n').forEach(line => {
        const t = line.trim();
        const m = t.match(/^([a-z0-9_]+)=([01])$/);
        if (m) installed[m[1]] = m[2] === '1';
      });
      const results = {};
      entries.forEach(([k, meta]) => {
        results[k] = { installed: !!installed[k], ...meta };
      });
      const cnt = Object.values(results).filter(r => r.installed).length;
      const statusMsg = JSON.stringify({ type: 'toolStatus', results, wsl: { available: WSL_AVAILABLE, distro: WSL_DISTRO }, isWin: IS_WIN, fromRefresh: !!manual });
      const logMsg = JSON.stringify({ type: 'log', module: 'system', logType: 'ok', text: '[+] Tool status refreshed — ' + cnt + '/' + entries.length + ' tools installed' });
      // Broadcast to all connected clients — ws reference may be stale
      if (wss) {
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(statusMsg);
            client.send(logMsg);
          }
        });
      } else if (ws && ws.readyState === 1) {
        ws.send(statusMsg);
        ws.send(logMsg);
      }
    });
  } else {
    // Linux/Mac — sync is fine
    const results = {};
    Object.entries(TOOL_META).forEach(([k, m]) => {
      results[k] = { installed: toolInstalled(m.binary), ...m };
    });
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'toolStatus', results, wsl: { available: WSL_AVAILABLE, distro: WSL_DISTRO }, isWin: IS_WIN }));
    }
  }
}

function installTool(key, ws) {
  const meta = TOOL_META[key];
  if (!meta) { ws.send(JSON.stringify({ type: 'installResult', key, success: false, msg: 'Unknown tool' })); return; }
  if (IS_WIN && !WSL_AVAILABLE) {
    ws.send(JSON.stringify({ type: 'installResult', key, success: false, msg: 'WSL not found — install WSL first (wsl --install), then retry' }));
    return;
  }
  ws.send(JSON.stringify({ type: 'log', module: 'installer', logType: 'info', text: 'Installing ' + meta.name + '...' }));
  const inst = meta.install;

  // Build install shell command — always runs inside bash (WSL on Windows, native on Linux)
  let shellCmd = null;

  if (inst.startsWith('http')) {
    ws.send(JSON.stringify({ type: 'installResult', key, success: false, msg: 'Manual install required — visit: ' + inst }));
    return;
  } else if (inst.startsWith('github-release:')) {
    const bin2 = meta.binary;
    // Hardcoded stable release URLs — no API calls, no quoting issues
    const releaseUrls = {
      rustscan: 'https://github.com/bee-san/RustScan/releases/download/2.3.0/rustscan_2.3.0_amd64.deb',
      feroxbuster: 'https://github.com/epi052/feroxbuster/releases/latest/download/x86_64-linux-feroxbuster.tar.gz',
    };
    const url = releaseUrls[bin2] || '';
    if (!url) {
      shellCmd = 'echo "No release URL for ' + bin2 + '" && exit 1';
    } else if (url.endsWith('.deb')) {
      shellCmd = 'cd /tmp && curl -sL -A Mozilla/5.0 ' + url + ' -o obs_pkg.deb && dpkg -i obs_pkg.deb && rm -f obs_pkg.deb && command -v ' + bin2;
    } else {
      shellCmd = 'mkdir -p /tmp/obs_extract && cd /tmp/obs_extract && curl -sL ' + url + ' -o obs_rel.tar.gz && tar -xzf obs_rel.tar.gz 2>/dev/null; '
        + 'find /tmp/obs_extract -name ' + bin2 + ' -type f 2>/dev/null | head -1 | xargs -I{} install -m755 {} /usr/local/bin/' + bin2 + '; '
        + 'rm -rf /tmp/obs_extract; '
        + '[ -f /usr/local/bin/' + bin2 + ' ] && echo done || (echo NOTFOUND && exit 1)';
    }
  } else if (inst.startsWith('script:')) {
    const scriptUrl = inst.replace('script:', '');
    shellCmd = 'curl -sL "' + scriptUrl + '" -o /usr/local/bin/' + meta.binary
      + ' && chmod +x /usr/local/bin/' + meta.binary;
  } else if (inst.startsWith('pipx:')) {
    const pipxPkg = inst.replace('pipx:', '').trim();
    shellCmd = 'apt-get install -y python3-venv 2>/dev/null; pip3 install pipx --break-system-packages 2>/dev/null; pipx install ' + pipxPkg + ' 2>/dev/null && ln -sf $HOME/.local/bin/' + meta.binary + ' /usr/local/bin/' + meta.binary + ' 2>/dev/null || true';
  } else if (inst.startsWith('pip3')) {
    const pkg = inst.replace('pip3 install ', '').trim();
    // pip3 with break-system-packages is needed on Ubuntu 24+
    shellCmd = 'pip3 install "' + pkg + '" --break-system-packages 2>/dev/null'
      + ' || pip3 install "' + pkg + '" 2>/dev/null'
      + ' || pipx install "' + pkg + '" 2>/dev/null'
      + ' || echo "pip install failed for ' + pkg + '"';
  } else if (inst.startsWith('go install:')) {
    const [, goPkg, goBin] = inst.split(':');
    shellCmd = 'export PATH=$HOME/go/bin:/usr/local/go/bin:$PATH; go install ' + goPkg + ':' + goBin + ' && ln -sf $HOME/go/bin/' + meta.binary + ' /usr/local/bin/' + meta.binary + ' 2>/dev/null || true';
  } else if (inst.startsWith('go install')) {
    shellCmd = 'export PATH=$HOME/go/bin:/usr/local/go/bin:$PATH; ' + inst
      + ' && ln -sf $HOME/go/bin/' + meta.binary + ' /usr/local/bin/' + meta.binary + ' 2>/dev/null || true';
  } else if (inst.startsWith('cargo-direct:')) {
    const cargoPkg = inst.replace('cargo-direct:', '').trim();
    const bin = meta.binary;
    // Source cargo env — handles any install location
    // apt cargo is available on Ubuntu 26.04
    shellCmd = 'apt-get install -y cargo 2>/dev/null && cargo install ' + cargoPkg
      + ' 2>/dev/null && (cp /root/.cargo/bin/' + bin + ' /usr/local/bin/' + bin
      + ' 2>/dev/null; cp $HOME/.cargo/bin/' + bin + ' /usr/local/bin/' + bin + ' 2>/dev/null); true';
  } else if (inst.startsWith('cargo:')) {
    const cargoPkg = inst.replace('cargo:', '').trim();
    const bin = meta.binary;
    shellCmd = 'export PATH=$HOME/.cargo/bin:$PATH; cargo install ' + cargoPkg
      + ' && ln -sf $HOME/.cargo/bin/' + bin + ' /usr/local/bin/' + bin + ' 2>/dev/null || true';
  } else if (inst.startsWith('gem-dev:')) {
    const gemPkg = inst.replace('gem-dev:', '').trim();
    // Install ruby-dev first, then gem
    shellCmd = 'apt-get install -y ruby-dev ruby-rubygems build-essential 2>/dev/null; gem install ' + gemPkg;
  } else if (inst.startsWith('gem:')) {
    const gemPkg = inst.replace('gem:', '').trim();
    shellCmd = 'gem install ' + gemPkg;
  } else if (inst.startsWith('apt:')) {
    const aptPkg = inst.replace('apt:', '').trim();
    // No sudo — apt runs as root via wsl -u root
    shellCmd = 'apt-get install -y ' + aptPkg + ' 2>/dev/null || (apt-get update -qq && apt-get install -y ' + aptPkg + ')';
  } else {
    shellCmd = 'apt-get install -y ' + meta.binary + ' 2>/dev/null || (' + inst + ')';
  }

  const isApt = shellCmd.startsWith('apt-get') || shellCmd.includes('apt-get install');
  const aptPrefix = isApt ? 'DEBIAN_FRONTEND=noninteractive ' : '';
  const wrappedCmd = 'echo "[*] Starting install..." && ' + aptPrefix + shellCmd + ' && echo "[+] Done." || echo "[!] Install failed."';
  let wCmd;
  if (IS_WIN && WSL_AVAILABLE) {
    // Write command to temp script to avoid Windows PATH (x86) breaking bash
    const scriptB64 = Buffer.from('#!/bin/bash\n' + wrappedCmd).toString('base64');
    const isCargoInstall = inst.startsWith('cargo-direct:') || inst.startsWith('cargo:');
    const isScriptInstall = inst.startsWith('script:');
    const isGithubRelease = inst.startsWith('github-release:');
    const needsRoot = !isCargoInstall && (isApt || isGithubRelease || shellCmd.startsWith('gem install') || shellCmd.startsWith('apt-get install -y python3-venv'));
    const user = needsRoot ? ['-u', 'root'] : [];
    // Use a fixed path — no shell variable expansion needed
    const tmpPath = '/tmp/obs_' + Date.now() + '.sh';
    const runCmd = 'echo ' + JSON.stringify(scriptB64) + ' | base64 -d > ' + tmpPath + ' && chmod 777 ' + tmpPath + ' && bash ' + tmpPath + '; rm -f ' + tmpPath + ' 2>/dev/null';
    wCmd = { bin: 'wsl.exe', args: ['-d', WSL_DISTRO, ...user, 'bash', '--norc', '--noprofile', '-c', runCmd] };
  } else {
    wCmd = { bin: 'bash', args: ['-c', 'sudo ' + wrappedCmd] };
  }
  const proc = spawn(wCmd.bin, wCmd.args, { stdio: ['ignore','pipe','pipe'], shell: false });
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');

  const streamInstallOutput = (data, isErr) => {
    data.toString().split('\n').forEach(line => {
      const t = line.trim();
      if (!t) return;
      // Skip noisy pip/apt lines that add no value
      if (/^Requirement already satisfied/.test(t)) return;
      if (/^(Reading|Building|Calculating|Scanning|Selecting|Preparing|Unpacking|Processing|debconf)/.test(t)) return;
      if (/^\s*(From|using|  )/.test(t) && !/error/i.test(t)) return; // pip dep tree lines
      // Classify meaningful lines
      let logType = isErr ? 'warn' : 'info';
      if (/^Get:/i.test(t))                                    logType = 'cmd';
      else if (/^Fetched|Downloaded/i.test(t))                 logType = 'cmd';
      else if (/^Setting up/i.test(t))                         logType = 'ok';
      else if (/^Successfully installed/i.test(t))             logType = 'ok';
      else if (/^Collecting/i.test(t))                         logType = 'cmd';
      else if (/^Downloading/i.test(t))                        logType = 'cmd';
      else if (/^Installing collected/i.test(t))               logType = 'ok';
      else if (/^\[\+\]|Done\./i.test(t))                   logType = 'ok';
      else if (/^Err:|error|failed|\[!\]/i.test(t))           logType = 'warn';
      broadcast('log', { module: 'installer', logType, text: t });
    });
  };

  broadcast('log', { module: 'installer', logType: 'cmd', text: '$ ' + wCmd.args.slice(-1)[0].slice(0, 120) });
  proc.stdout.on('data', d => streamInstallOutput(d, false));
  proc.stderr.on('data', d => streamInstallOutput(d, true));
  proc.on('close', code => {
    // After any install, run a single WSL call to symlink and verify
    const bin = meta.binary;
    const symlinkAndVerifyCmd = `for d in ~/.local/bin ~/go/bin /usr/bin; do [ -f $d/${bin} ] && sudo ln -sf $d/${bin} /usr/local/bin/${bin} 2>/dev/null; [ -f $d/${bin}3 ] && sudo ln -sf $d/${bin}3 /usr/local/bin/${bin}3 2>/dev/null; done; which ${bin} 2>/dev/null && echo OK || echo MISSING`;

    let verifyOut = '';
    const verifyArgs = IS_WIN && WSL_AVAILABLE
      ? ['wsl.exe', ['-d', WSL_DISTRO, 'bash', '-c', symlinkAndVerifyCmd]]
      : ['bash', ['-c', symlinkAndVerifyCmd]];
    const verify = spawn(verifyArgs[0], verifyArgs[1], { stdio: ['ignore','pipe','ignore'], shell: false });
    verify.stdout && verify.stdout.setEncoding('utf8');
    verify.stdout && verify.stdout.on('data', d => { verifyOut += d; });
    verify.on('error', () => {
      // spawn failed — fall back to simple check
      finishInstall(code === 0, ws, key, meta, inst);
    });
    verify.on('close', () => {
      const inPath = verifyOut.includes('OK') || verifyOut.trim().startsWith('/');
      // code===0 means install succeeded even if binary not yet in PATH (symlink pending)
      const installOk = code === 0 || inPath;
      broadcast('log', { module: 'installer', logType: inPath ? 'ok' : (installOk ? 'info' : 'warn'),
        text: inPath
          ? '[+] ' + bin + ' installed and ready'
          : installOk
            ? '[+] ' + bin + ' installed — refreshing status...'
            : '[!] ' + bin + ' installation failed' });
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'installResult', key, success: installOk,
          msg: inPath
            ? meta.name + ' installed successfully'
            : installOk
              ? meta.name + ' installed — click REFRESH to update status'
              : 'Installation failed — try: ' + meta.install }));
      }
      checkTools(ws);
    });
  });
}

function finishInstall(ok, ws, key, meta, inst) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'installResult', key, success: ok,
      msg: ok ? meta.name + ' installed successfully' : 'Installation failed — try: ' + inst }));
  }
  checkTools(ws);
}

let msfProc = null;

function launchMsf(ws) {
  if (IS_WIN && !WSL_AVAILABLE) { ws.send(JSON.stringify({ type: 'msfOutput', text: '[!!] WSL not found — install WSL first, then install Metasploit inside it' })); return; }
  if (!toolInstalled('msfconsole')) { ws.send(JSON.stringify({ type: 'msfOutput', text: '[!!] msfconsole not found — install Metasploit first' })); return; }
  if (msfProc) { ws.send(JSON.stringify({ type: 'msfOutput', text: '[!] Metasploit already running' })); return; }
  ws.send(JSON.stringify({ type: 'msfOutput', text: '[*] Starting msfconsole...' }));
  const msfCmd = wslSpawn('msfconsole', ['-q']);
  msfProc = spawn(msfCmd.bin, msfCmd.args, { stdio: ['pipe','pipe','pipe'], shell: false });
  msfProc.stdout.on('data', d => ws.send(JSON.stringify({ type: 'msfOutput', text: d.toString() })));
  msfProc.stderr.on('data', d => ws.send(JSON.stringify({ type: 'msfOutput', text: d.toString() })));
  msfProc.on('close', () => { msfProc = null; ws.send(JSON.stringify({ type: 'msfOutput', text: '[*] msfconsole exited' })); });
}

function sendMsfCmd(cmd, ws) {
  if (!msfProc) { ws.send(JSON.stringify({ type: 'msfOutput', text: '[!!] Metasploit not running — click Launch first' })); return; }
  const safe = cmd.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  msfProc.stdin.write(safe + '\n');
}

function stopMsf() {
  if (msfProc) { try { treeKill(msfProc.pid); } catch {} msfProc = null; }
}

function launchBurp(ws) {
  if (process.platform === 'win32') {
    ws.send(JSON.stringify({ type: 'burpResult', msg: 'On Windows, launch Burp Suite manually from your Start menu or installation folder.' }));
    return;
  }
  const paths = ['/usr/bin/burpsuite', '/opt/burpsuite/burpsuite', '/usr/local/bin/burpsuite',
    process.env.HOME + '/BurpSuitePro/burpsuite', process.env.HOME + '/BurpSuiteCommunity/burpsuite'];
  const found = paths.find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } });
  if (!found) { ws.send(JSON.stringify({ type: 'burpResult', msg: 'Burp Suite not found in common locations. Launch it manually.' })); return; }
  spawn(found, [], { detached: true, stdio: 'ignore', shell: false }).unref();
  ws.send(JSON.stringify({ type: 'burpResult', msg: 'Burp Suite launched.' }));
}

// ============================================================
// SCAN RUNNER
// ============================================================

// ============================================================
// REACHABILITY CHECK
// ============================================================
async function checkReachability(target, host) {
  return new Promise((resolve) => {
    // Try curl first (works for URLs and IPs with HTTP)
    const curlCmd = wslSpawn('curl', ['-s', '--max-time', '3', '--head', '-o', '/dev/null', '-w', '%{http_code}', target.startsWith('http') ? target : 'http://' + host]);
    const proc = spawn(curlCmd.bin, curlCmd.args, { stdio: ['ignore','pipe','pipe'], shell: false });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', code => {
      if (code === 0 && out.trim() !== '000') { resolve(true); return; }
      // Fallback: ping
      const pingBin = IS_WIN && WSL_AVAILABLE ? 'wsl.exe' : 'ping';
      const pingArgs = IS_WIN && WSL_AVAILABLE
        ? ['-d', WSL_DISTRO, '--', 'ping', '-c', '1', '-W', '2', host.split('/')[0]]
        : ['-c', '1', '-W', '2', host.split('/')[0]];
      const ping = spawn(pingBin, pingArgs, { stdio: 'ignore', shell: false });
      ping.on('close', c => resolve(c === 0));
    });
    proc.on('error', () => resolve(false));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(false); }, 4000);
  });
}

async function runScan(rawConfig, ws) {
  if (IS_WIN && !WSL_AVAILABLE) {
    ws.send(JSON.stringify({ type: 'windowsUnsupported' }));
    return;
  }
  if (IS_WIN && WSL_AVAILABLE) {
    broadcast('log', { module: 'system', logType: 'ok', text: `Running via WSL (${WSL_DISTRO}) — full scan support enabled` });
  }

  if (activeScan) { ws.send(JSON.stringify({ type: 'error', text: 'A scan is already running' })); return; }

  // Validate + sanitise all inputs upfront
  let target, domain;
  try {
    const t = sanitiseTarget(rawConfig.target);
    target = t.url;
    // For IPs and ranges, use host directly — no domain sanitisation needed
    domain = (t.type === 'url' || t.type === 'domain')
      ? sanitiseDomain(t.host)
      : t.host;
    if (t.isLocal) broadcast('log', { module: 'system', logType: 'warn', text: 'Target is a local/private address — ensure you have authorisation' });
    broadcast('log', { module: 'system', logType: 'info', text: `Target type: ${t.type.toUpperCase()} — ${t.raw}` });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', text: `Invalid target: ${e.message}` }));
    return;
  }

  const modules  = (rawConfig.modules || []).filter(m => /^[a-z0-9_]+$/.test(m));
  const profile  = /^(stealth|standard|hardcore|auth)$/.test(rawConfig.profile) ? rawConfig.profile : 'standard';
  const proxies  = rawConfig.proxies || [];
  const rotMode  = /^(round-robin|random|single)$/.test(rawConfig.rotMode) ? rawConfig.rotMode : 'round-robin';
  const auth     = rawConfig.auth || {};

  if (!modules.length) { ws.send(JSON.stringify({ type: 'error', text: 'No modules selected' })); return; }

  activeScan = { target, modules };

  // 3. REACHABILITY CHECK — only warn for URL/domain targets, not IPs
  // IP targets often block ICMP/HTTP but are still scannable with -Pn
  const rawTarget = rawConfig.target || '';
  const isIPTarget = /^\d+\.\d+\.\d+\.\d+/.test(rawTarget);
  if (!isIPTarget) {
    checkReachability(target, domain).then(reachable => {
      if (!reachable) {
        broadcast('log', { module: 'system', logType: 'warn', text: `Warning: ${target} may be unreachable — check target is up` });
      }
    }).catch(() => {});
  }

  broadcast('scanStart', { target, modules, profile });

  // Proxychains setup
  let proxyArgs = [];
  if (proxies.length) {
    try {
      const confPath = writeProxychainsConf(proxies, rotMode);
      proxyArgs = ['-f', confPath];
      broadcast('log', { module: 'system', logType: 'info', text: `Proxychains: ${proxies.length} proxy/proxies configured (${rotMode})` });
    } catch (e) {
      broadcast('log', { module: 'system', logType: 'warn', text: `Proxy config error: ${e.message}` });
    }
  }

  const outputDir = path.join(os.tmpdir(), `obsidian_${Date.now()}`);

  // Run each module
  for (const mod of modules) {
    if (!activeScan) break;

    broadcast('moduleStart', { module: mod });
    broadcast('log', { module: mod, logType: 'sec', text: `=== MODULE: ${mod.toUpperCase()} ===` });

    const cmd = buildArgs(mod, target, domain, profile, auth, proxyArgs);
    if (!cmd) {
      broadcast('log', { module: mod, logType: 'warn', text: `No command defined for module: ${mod}` });
      broadcast('moduleComplete', { module: mod });
      continue;
    }

    if (!toolInstalled(cmd.bin)) {
      broadcast('log', { module: mod, logType: 'warn', text: `${cmd.bin} not found — run install.sh` });
      broadcast('moduleComplete', { module: mod });
      continue;
    }

    await runTool(mod, cmd.bin, cmd.args, outputDir);
  }

  broadcast('scanComplete', { modules, outputDir });
  activeScan = null;
}

function stopScan() {
  activeScan = null;
  activeProcesses.forEach(p => { try { treeKill(p.pid, 'SIGTERM'); } catch {} });
  activeProcesses = [];
  broadcast('scanStopped', {});
}

// ============================================================
// SCRIPT GENERATOR — produces the shell script for export
// ============================================================

function generateScript(rawConfig, ws) {
  let target, domain;
  try {
    const t = sanitiseTarget(rawConfig.target);
    target = t.url;
    domain = (t.type === 'url' || t.type === 'domain')
      ? sanitiseDomain(t.host)
      : t.host;
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', text: `Invalid target: ${e.message}` })); return;
  }

  const modules = (rawConfig.modules || []).filter(m => /^[a-z0-9_]+$/.test(m));
  const profile = /^(fast|stealth|standard|hardcore|auth)$/.test(rawConfig.profile) ? rawConfig.profile : 'fast';
  const proxies = rawConfig.proxies || [];
  const rotMode = rawConfig.rotMode || 'round-robin';
  const auth    = rawConfig.auth || {};

  const proxyConf = proxies
    .filter(p => p.host && p.port)
    .map(p => {
      try {
        const h = sanitiseDomain(p.host);
        const port = sanitiseInt(p.port, 1, 65535);
        const type = ['http','socks4','socks5'].includes(p.type.toLowerCase()) ? p.type.toLowerCase() : 'http';
        return `${type} ${h} ${port}`;
      } catch { return null; }
    })
    .filter(Boolean)
    .join('\n');

  const ep  = sanitiseFailString(auth.endpoint   || '/login');
  const up  = sanitiseParam(auth.userParam || 'username', 'userParam');
  const pp  = sanitiseParam(auth.passParam || 'password', 'passParam');
  const fs  = sanitiseFailString(auth.failString  || 'Invalid credentials');
  const ul  = sanitiseFilePath(auth.userlist) || '/usr/share/wordlists/metasploit/unix_users.txt';
  const pl  = sanitiseFilePath(auth.passlist)  || '/usr/share/wordlists/rockyou.txt';
  const thr = sanitiseInt(auth.threads || '4', 1, 64);
  const dly = Math.max(1, Math.round(sanitiseInt(auth.delay || '500', 0, 60000) / 1000));

  const hydraMode = { spray: `-L "${ul}" -p "$(head -1 '${pl}')"`, stuffing: `-C "${ul}"`, brute: `-L "${ul}" -P "${pl}"` }[auth.mode||'spray'];

  const nmapFlags = { stealth: '-sS -T1 -f --data-length 25 --open', standard: '-sV -sC -T4 --open', hardcore: '-sV -sC -A -T5 -p-', auth: '-sV -T4 --open' }[profile] || '-sV -sC -T4 --open';

  const cmdMap = {
    masscan:   `$PROXY masscan -p1-65535 ${domain} --rate=5000`,
    nmap:      `$PROXY nmap ${nmapFlags} ${domain}`,
    nikto:     `$PROXY nikto -h ${target} -ssl -Tuning 123bde`,
    nuclei:    `$PROXY nuclei -u ${target} -t ~/nuclei-templates/ -severity critical,high,medium -no-color`,
    headers:   `curl -sIL --max-time 15 ${target}`,
    ssl:       `testssl.sh --quiet --color 0 ${target}`,
    ffuf:      `$PROXY ffuf -u ${target}/FUZZ -w /usr/share/dirb/wordlists/big.txt -mc 200,301,302,403`,
    amass:     `$PROXY amass enum -passive -d ${domain}`,
    subfinder: `$PROXY subfinder -d ${domain} -silent`,
    wapiti:    `$PROXY wapiti3 -u ${target} -m xss,csrf,sql,ssrf --level 2`,
    whatweb:   `$PROXY whatweb -a 3 --color=never ${target}`,
    sqlmap:    `$PROXY sqlmap -u "${target}/?id=1" --random-agent --delay=2 --retries=2 --timeout=20 --tamper=space2comment,between,randomcase --crawl=2 --forms --level=3 --risk=2 --batch --flush-session`,
    hydra:     `$PROXY hydra ${hydraMode} -t ${thr} -W ${dly} ${domain} https-post-form "${ep}:${up}=^USER^&${pp}=^PASS^:${fs}"`,
  };

  const lines = [
    '#!/usr/bin/env bash',
    '# ============================================================',
    '# OBSIDIAN — Open Source Security Scanner',
    '# https://github.com/YOUR_USERNAME/obsidian',
    '# ------------------------------------------------------------',
    '# LEGAL NOTICE: This tool is for authorised security testing',
    '# only. Only run against systems you own or have explicit',
    '# written permission to test. Unauthorised use is illegal.',
    '# ============================================================',
    `# Target: ${target}`,
    `# Profile: ${profile}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    'set -euo pipefail',
    '',
    `TARGET="${target}"`,
    `DOMAIN="${domain}"`,
    'OUTPUT="./obsidian_$(date +%Y%m%d_%H%M%S)"',
    'mkdir -p "$OUTPUT"',
    '',
    '# ---- Dependency check + auto-install ----',
    'chk() {',
    '  command -v "$1" &>/dev/null && return',
    '  echo "[*] Installing $1..."',
    '  if command -v apt-get &>/dev/null; then',
    '    sudo apt-get install -y "$1" 2>/dev/null && return',
    '  elif command -v brew &>/dev/null; then',
    '    brew install "$1" 2>/dev/null && return',
    '  fi',
    '  echo "[!] Could not auto-install $1 — please install manually"',
    '}',
    '',
    '# Go-based tools',
    'chk_go() {',
    '  command -v "$1" &>/dev/null && return',
    '  echo "[*] Installing $1 via go..."',
    '  go install "$2" 2>/dev/null || echo "[!] go install failed for $1"',
    '}',
    '',
  ];

  modules.forEach(m => {
    const bins = { nuclei:'nuclei', subfinder:'subfinder', nmap:'nmap', nikto:'nikto', ffuf:'ffuf', amass:'amass', hydra:'hydra', whatweb:'whatweb', sqlmap:'sqlmap', masscan:'masscan', wapiti:'wapiti3', ssl:'testssl.sh' };
    const goInstalls = {
      nuclei: 'github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest',
      subfinder: 'github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
    };
    if (goInstalls[m]) lines.push(`chk_go ${bins[m] || m} ${goInstalls[m]}`);
    else lines.push(`chk ${bins[m] || m}`);
  });

  lines.push('');

  if (proxyConf) {
    const chainType = rotMode === 'random' ? 'random_chain' : 'strict_chain';
    lines.push('# ---- Proxychains config ----', 'chk proxychains4');
    lines.push(`cat > /tmp/obsidian-pc.conf << 'PCEOF'\n${chainType}\nproxy_dns\n[ProxyList]\n${proxyConf}\nPCEOF`);
    lines.push('PROXY="proxychains4 -f /tmp/obsidian-pc.conf"', '');
  } else {
    lines.push('PROXY=""', '');
  }

  lines.push('echo "[OBSIDIAN] Scan started: $TARGET"', '');

  modules.forEach(m => {
    lines.push(`# ---- ${m.toUpperCase()} ----`, `echo "[*] Running ${m}..."`, `${cmdMap[m] || `echo "No command for ${m}"`} 2>&1 | tee "$OUTPUT/${m}.txt"`, '');
  });

  lines.push('echo "[OBSIDIAN] Complete — results in $OUTPUT"');

  ws.send(JSON.stringify({ type: 'script', content: lines.join('\n') }));
}

// ============================================================
// WEBSOCKET SERVER
// ============================================================

function startServer(port) {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port, host: '127.0.0.1' }); // localhost only

    wss.on('connection', (ws, req) => {
      // Only accept connections from localhost
      const ip = req.socket.remoteAddress;
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        ws.close(); return;
      }

      ws.send(JSON.stringify({ type: 'connected', version: '0.4.2' }));
      // Send WSL status immediately to this client
      if (wslDetectionDone) {
        if (WSL_AVAILABLE) {
          ws.send(JSON.stringify({ type: 'wslReady', distro: WSL_DISTRO }));
        } else if (IS_WIN) {
          ws.send(JSON.stringify({ type: 'windowsUnsupported' }));
        }
        // Check tools for this client
        setTimeout(() => checkTools(ws), 500);
      }

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        switch (msg.action) {
          case 'startScan':      runScan(msg.config, ws);       break;
          case 'stopScan':       stopScan();                     break;
          case 'checkTools':     checkTools(ws);                 break;
          case 'generateScript': generateScript(msg.config, ws); break;
          case 'installTool':    installTool(msg.key, ws);       break;
          case 'launchMsf':      launchMsf(ws);                  break;
          case 'msfCmd':         sendMsfCmd(msg.cmd, ws);         break;
          case 'stopMsf':        stopMsf();                      break;
          case 'launchBurp':     launchBurp(ws);                 break;
        }
      });

      ws.on('error', () => {});
    });

    wss.on('listening', () => {
      console.log(`[OBSIDIAN] WS server listening on 127.0.0.1:${port}`);
      resolve();
    });
  });
}

function stopServer() {
  stopScan();
  stopMsf();
  if (wss) { wss.close(); wss = null; }
}

module.exports = { startServer, stopServer };
