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

function detectWSL() {
  if (!IS_WIN) return;
  try {
    const out = execSync('wsl.exe --list --quiet 2>nul', { encoding: 'utf8', timeout: 5000 });
    const distros = out.split(/\r?\n/).map(l => l.replace(/\x00/g, '').trim()).filter(Boolean);
    if (distros.length) {
      WSL_AVAILABLE = true;
      // Prefer Ubuntu if present, otherwise first distro
      WSL_DISTRO = distros.find(d => /ubuntu/i.test(d)) || distros[0];
      console.log(`[OBSIDIAN] WSL detected — using distro: ${WSL_DISTRO}`);
    }
  } catch {
    WSL_AVAILABLE = false;
    console.log('[OBSIDIAN] WSL not available — scan tools will not work on Windows');
  }
}

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
      execSync(`wsl.exe -d ${WSL_DISTRO} -- which ${binary}`, { stdio: 'ignore', timeout: 5000 });
      return true;
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

function sanitiseTarget(raw) {
  const t = (raw || '').trim();
  if (!ALLOWED_URL_RE.test(t)) throw new Error(`Invalid target URL: ${t}`);
  // Reject private/loopback ranges to avoid SSRF-style misuse
  const host = new URL(t).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)) {
    // Still allow — operator may be testing their own local stack
    // but log a warning
    return { url: t, host, isLocal: true };
  }
  return { url: t, host, isLocal: false };
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
    fast:     ['-sV', `-T${timing}`, '--open', '--top-ports', '1000', '--script', 'banner'],
    stealth:  ['-sS', '-T1', '-f', '--data-length', '25', '--open'],
    standard: ['-sV', '-sC', `-T${timing}`, '--open', '--script', 'default,http-headers,http-title'],
    hardcore: ['-sV', '-sC', '-A', `-T${timing}`, '-p-', '--script', 'default,vuln,exploit'],
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
    nmap:     { bin: 'nmap',    args: [...(nmapFlagsMap[pf]||nmapFlagsMap.standard), host] },
    nikto:    { bin: 'nikto',   args: [
      '-h', webTarget,
      '-ssl',
      '-Tuning', pf === 'hardcore' ? '1234567890abc' : '123bde',  // more checks on hardcore
      '-maxtime', pf === 'stealth' ? '300s' : '180s',             // time limit
      '-useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(pf === 'stealth' ? ['-pause', '2'] : []),               // pause between requests
    ] },
    nuclei:   { bin: 'nuclei',  args: [
      '-u', webTarget,
      '-t', `${os.homedir()}/nuclei-templates/`,
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
    ssl:      { bin: 'testssl.sh', args: ['--quiet', '--color', '0', target] },
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
  return null;
}

// ============================================================
// TOOL AVAILABILITY CHECK
// ============================================================

// toolInstalled defined above in WSL section

const TOOL_META = {
  nmap:        { binary:'nmap',        name:'nmap',         desc:'Network mapper — port scanning and service detection',    install:'apt:nmap / brew:nmap' },
  nikto:       { binary:'nikto',       name:'nikto',        desc:'Web server scanner — misconfigs, outdated software',     install:'apt:nikto / brew:nikto' },
  masscan:     { binary:'masscan',     name:'masscan',      desc:'High-speed TCP port scanner',                            install:'apt:masscan' },
  nuclei:      { binary:'nuclei',      name:'nuclei',       desc:'Template-based vulnerability scanner',                   install:'go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest' },
  ffuf:        { binary:'ffuf',        name:'ffuf',         desc:'Fast web fuzzer — directory and parameter discovery',    install:'apt:ffuf / go install github.com/ffuf/ffuf/v2@latest' },
  amass:       { binary:'amass',       name:'amass',        desc:'Subdomain enumeration and asset discovery',              install:'apt:amass' },
  subfinder:   { binary:'subfinder',   name:'subfinder',    desc:'Passive subdomain discovery',                            install:'go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest' },
  wapiti:      { binary:'wapiti3',     name:'wapiti',       desc:'Web application vulnerability scanner',                  install:'pip3 install wapiti3' },
  hydra:       { binary:'hydra',       name:'hydra',        desc:'Network login brute-force tool',                         install:'apt:hydra' },
  whatweb:     { binary:'whatweb',     name:'whatweb',      desc:'Web technology fingerprinter',                           install:'apt:whatweb' },
  sqlmap:      { binary:'sqlmap',      name:'sqlmap',       desc:'Automatic SQL injection detection and exploitation',     install:'apt:sqlmap / pip3 install sqlmap' },
  testssl:     { binary:'testssl.sh',  name:'testssl.sh',   desc:'TLS/SSL configuration tester',                          install:'apt:testssl.sh / brew:testssl' },
  proxychains: { binary:'proxychains4',name:'proxychains4', desc:'Route tool traffic through proxy chains',               install:'apt:proxychains4' },
  curl:        { binary:'curl',        name:'curl',         desc:'HTTP request tool — header analysis',                    install:'apt:curl / brew:curl' },
  msfconsole:  { binary:'msfconsole',  name:'metasploit',   desc:'Exploitation framework — post-exploitation and modules', install:'https://docs.metasploit.com/docs/using-metasploit/getting-started/nightly-installers.html' },
  burpsuite:   { binary:'burpsuite',   name:'Burp Suite',   desc:'Web application security testing proxy',                install:'https://portswigger.net/burp/releases' },
};

function checkTools(ws) {
  const results = {};
  Object.entries(TOOL_META).forEach(([key, meta]) => {
    results[key] = { installed: toolInstalled(meta.binary), ...meta };
  });
  ws.send(JSON.stringify({ type: 'toolStatus', results, wsl: { available: WSL_AVAILABLE, distro: WSL_DISTRO }, isWin: IS_WIN }));
}

function installTool(key, ws) {
  const meta = TOOL_META[key];
  if (!meta) { ws.send(JSON.stringify({ type: 'installResult', key, success: false, msg: 'Unknown tool' })); return; }
  if (IS_WIN && !WSL_AVAILABLE) {
    ws.send(JSON.stringify({ type: 'installResult', key, success: false, msg: 'WSL not found — install WSL first (wsl --install), then retry' }));
    return;
  }
  ws.send(JSON.stringify({ type: 'log', module: 'installer', logType: 'info', text: 'Installing ' + meta.name + '...' }));
  const hasPm = (pm) => { try { execSync('command -v ' + pm, {stdio:'ignore',shell:false}); return true; } catch { return false; } };
  let cmd = null;
  const inst = meta.install;
  if (inst.startsWith('go install'))     cmd = ['bash', ['-c', 'export PATH=$PATH:$(go env GOPATH)/bin && ' + inst]];
  else if (inst.startsWith('pip3'))      cmd = ['bash', ['-c', inst]];
  else if (hasPm('apt-get'))             cmd = ['bash', ['-c', 'sudo apt-get install -y ' + inst.split('apt:')[1]?.split(' /')[0] || meta.binary]];
  else if (hasPm('brew'))                cmd = ['bash', ['-c', 'brew install ' + (inst.split('brew:')[1]?.split(' /')[0] || meta.binary)]];
  if (!cmd) {
    ws.send(JSON.stringify({ type: 'installResult', key, success: false, msg: 'Manual install required: ' + inst }));
    return;
  }
  const wCmd = IS_WIN && WSL_AVAILABLE ? wslSpawn(cmd[0], cmd[1]) : { bin: cmd[0], args: cmd[1] };
  const proc = spawn(wCmd.bin, wCmd.args, { stdio: ['ignore','pipe','pipe'], shell: false });
  proc.stdout.on('data', d => broadcast('log', { module: 'installer', logType: 'info', text: d.toString().trim() }));
  proc.stderr.on('data', d => broadcast('log', { module: 'installer', logType: 'warn', text: d.toString().trim() }));
  proc.on('close', code => {
    const ok = code === 0 && toolInstalled(meta.binary);
    ws.send(JSON.stringify({ type: 'installResult', key, success: ok, msg: ok ? meta.name + ' installed successfully' : 'Installation failed — try manually: ' + inst }));
    checkTools(ws);
  });
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

      ws.send(JSON.stringify({ type: 'connected', version: '0.2.0' }));

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
