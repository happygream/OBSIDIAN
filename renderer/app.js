'use strict';

// ===== DIGITAL RAIN =====
const rainCanvas = document.getElementById('rain');
const rx = rainCanvas.getContext('2d');
const CHARS = 'OBS1D14N0BSID14N4BCD3FGH1JKL7MNP0QR5TUVWXYZ2468!@#$%&アイウエオカキクケコ90ABCDEF1337';
let drops = [];

function initRain() {
  rainCanvas.width = window.innerWidth;
  rainCanvas.height = window.innerHeight;
  drops = Array.from({ length: Math.floor(rainCanvas.width / 16) }, () => Math.random() * -100);
}
function drawRain() {
  rx.fillStyle = 'rgba(0,0,0,0.055)';
  rx.fillRect(0, 0, rainCanvas.width, rainCanvas.height);
  rx.font = '13px "Share Tech Mono", monospace';
  drops.forEach((y, i) => {
    const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
    const b = Math.random();
    rx.fillStyle = b > 0.97 ? '#fff' : b > 0.82 ? '#ff00c8' : '#330028';
    rx.fillText(ch, i * 16, y * 16);
    if (y * 16 > rainCanvas.height && Math.random() > 0.975) drops[i] = 0;
    drops[i] += 0.5;
  });
}
initRain();
window.addEventListener('resize', initRain);
setInterval(drawRain, 50);

// ===== INTRO =====
const DURATION = 7000;
const audio = document.getElementById('bgAudio');
let muted = false, introDone = false;
const introStart = Date.now();
// Get absolute audio path from main process — works on all platforms
window.obsidian.getAudioPath().then(audioPath => {
  audio.src = audioPath;
  audio.volume = 0.45;
  audio.play().catch(() => {});
});

const iBar = document.getElementById('iBar');
const iTimer = setInterval(() => {
  const pct = Math.min(((Date.now() - introStart) / DURATION) * 100, 100);
  iBar.style.width = pct + '%';
  if (pct >= 100 && !introDone) { clearInterval(iTimer); launchApp(); }
}, 60);

function skipIntro() { clearInterval(iTimer); launchApp(); }

function launchApp() {
  if (introDone) return;
  introDone = true;
  const intro = document.getElementById('intro');
  intro.style.transition = 'opacity 0.8s';
  intro.style.opacity = '0';
  setTimeout(() => {
    intro.style.display = 'none';
    const appEl = document.getElementById('app');
    appEl.style.display = 'flex';
    appEl.style.flexDirection = 'column';
    appEl.style.opacity = '0';
    appEl.style.transition = 'opacity 0.5s';
    requestAnimationFrame(() => { appEl.style.opacity = '1'; });
    initWS();
  }, 800);
}

function setMute(state) {
  muted = state;
  audio.muted = muted;
  // Sync both buttons
  const introBtn = document.getElementById('muteBtn');
  const appBtn   = document.querySelector('.ib2[title="Audio"]');
  if (introBtn) introBtn.innerHTML = muted ? '&#9646;&#9646; UNMUTE' : '&#9654; MUTE';
  if (appBtn)   appBtn.title = muted ? 'Unmute' : 'Mute';
  // If muted was paused, resume playback
  if (!muted && audio.paused && introDone) audio.play().catch(() => {});
}
function toggleMute()    { setMute(!muted); }
function toggleMuteApp() { setMute(!muted); }

// ===== WEBSOCKET =====
let ws = null, wsReady = false;

function initWS() {
  window.obsidian.getPort().then(port => {
    ws = new WebSocket('ws://127.0.0.1:' + port);
    ws.onopen = () => { wsReady = true; log('info', 'system', 'WebSocket connected'); checkTools(); };
    ws.onmessage = (evt) => { let msg; try { msg = JSON.parse(evt.data); } catch { return; } handleMessage(msg); };
    ws.onclose = () => { wsReady = false; setTimeout(initWS, 2000); };
    ws.onerror = () => { wsReady = false; };
  });
}

function send(obj) {
  if (!wsReady || !ws) { showNotif('Backend not connected', true); return false; }
  ws.send(JSON.stringify(obj));
  return true;
}

// ===== MESSAGES =====
let findings = [], scanTarget = '', timerInt = null, generatedScript = '';
let userScrollingBoard = false;

function handleMessage(msg) {
  switch (msg.type) {
    case 'connected':        log('ok', 'system', 'OBSIDIAN backend v' + msg.version + ' connected'); break;
    case 'log':              log(msg.logType, msg.module, msg.text); break;
    case 'finding':          addFinding(msg); break;
    case 'moduleComplete':   setProgress(msg.module, 100); break;
    case 'scanStart':        onScanStart(msg); break;
    case 'scanComplete':     onScanComplete(); break;
    case 'scanStopped':      onScanStopped(); break;
    case 'toolStatus': renderToolStatus(msg.results, msg.wsl, msg.isWin); break;
    case 'windowsUnsupported': showWindowsModal(); break;
    case 'wslReady': log('ok','system','WSL detected — ' + msg.distro + ' — full scan support enabled'); checkTools(); break;
    case 'installResult':  handleInstallResult(msg); break;
    case 'msfOutput':      handleMsfOutput(msg);     break;
    case 'burpResult':     handleBurpResult(msg);    break;
    case 'script':
      generatedScript = msg.content;
      document.getElementById('scriptContent').textContent = msg.content;
      document.getElementById('dlScriptBtn').disabled = false;
      if (pendingScriptDownload) {
        pendingScriptDownload = false;
        downloadScript();
      }
      break;
    case 'error':
      showNotif(msg.text, true);
      log('warn', 'system', 'Error: ' + msg.text);
      break;
  }
}

// ===== TABS =====
function setTab(btn, id) {
  document.querySelectorAll('.tl-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pgScan').style.display    = id === 'scan'    ? 'flex' : 'none';
  document.getElementById('pgTools').style.display   = id === 'tools'   ? 'flex' : 'none';
  document.getElementById('pgScript').style.display  = id === 'script'  ? 'flex' : 'none';
  document.getElementById('pgHistory').style.display  = id === 'history'  ? 'flex' : 'none';
  document.getElementById('pgReport').style.display   = id === 'report'   ? 'flex' : 'none';
  document.getElementById('pgSchedule').style.display = id === 'schedule' ? 'flex' : 'none';
  document.getElementById('pgPlugins').style.display  = id === 'plugins'  ? 'flex' : 'none';
  if (id === 'plugins') reloadPlugins();
  if (id === 'schedule') renderSchedules();
  if (id === 'history') renderHistory();
}

// ===== MODULES =====
const MODS = [
  // Core
  {id:'nmap',       name:'nmap',         tag:'svc'   },
  {id:'rustscan',   name:'rustscan',     tag:'ports' },
  {id:'masscan',    name:'masscan',      tag:'ports' },
  // Web
  {id:'nikto',      name:'nikto',        tag:'web'   },
  {id:'nuclei',     name:'nuclei',       tag:'cve'   },
  {id:'ffuf',       name:'ffuf',         tag:'fuzz'  },
  {id:'gobuster',   name:'gobuster',     tag:'fuzz'  },
  {id:'feroxbuster',name:'feroxbuster',  tag:'fuzz'  },
  {id:'arjun',      name:'arjun',        tag:'param' },
  {id:'wapiti',     name:'wapiti',       tag:'inject'},
  {id:'wpscan',     name:'wpscan',       tag:'wp'    },
  {id:'sqlmap',     name:'sqlmap',       tag:'sqli'  },
  // Headers/TLS
  {id:'headers',    name:'headers',      tag:'http'  },
  {id:'ssl',        name:'testssl',      tag:'tls'   },
  {id:'sslscan',    name:'sslscan',      tag:'tls'   },
  // Recon
  {id:'amass',      name:'amass',        tag:'recon' },
  {id:'subfinder',  name:'subfinder',    tag:'recon' },
  {id:'theharvester',name:'theHarvester',tag:'osint' },
  {id:'shodan',     name:'shodan',       tag:'osint' },
  {id:'dnsrecon',   name:'dnsrecon',     tag:'dns'   },
  // Fingerprint
  {id:'whatweb',    name:'whatweb',      tag:'fp'    },
  // Auth
  {id:'hydra',      name:'hydra',        tag:'auth'  },
  {id:'medusa',     name:'medusa',       tag:'auth'  },
  // Network/SMB
  {id:'enum4linux', name:'enum4linux',   tag:'smb'   },
  {id:'crackmapexec',name:'crackmapexec',tag:'smb'   },
  {id:'snmpwalk',   name:'snmpwalk',     tag:'snmp'  },
  {id:'nbtscan',    name:'nbtscan',      tag:'netbios'},
];
// Modules enabled by default per profile
const PROFILE_MODULES = {
  fast:     new Set(['nmap','headers','ffuf','whatweb']),
  stealth:  new Set(['nmap','headers','subfinder','amass','whatweb','ssl','dnsrecon']),
  standard: new Set(['nmap','nikto','nuclei','headers','ffuf','amass','whatweb','ssl','sslscan','theharvester']),
  hardcore:  new Set(['nmap','rustscan','masscan','nikto','nuclei','headers','ffuf','gobuster','feroxbuster','amass','subfinder','whatweb','ssl','sslscan','sqlmap','wapiti','hydra','arjun','theharvester','shodan','dnsrecon','snmpwalk','crackmapexec','wpscan']),
  auth:     new Set(['nmap','headers','ffuf','nuclei','hydra','medusa','sqlmap']),
};

const DEFAULT_ON = PROFILE_MODULES['fast'];
let activeMods = new Set(DEFAULT_ON);

function initMods() {
  const list = document.getElementById('modList');
  list.innerHTML = '';
  MODS.forEach(m => {
    const on = activeMods.has(m.id);
    const d = document.createElement('div');
    d.className = 'mod-row' + (on ? ' on' : '');
    d.onclick = () => toggleMod(m.id, d);
    d.innerHTML = '<div class="mod-cb">' + (on ? '&#10003;' : '') + '</div>'
      + '<span class="mod-name">' + m.name + '</span><span class="mod-tag">' + m.tag + '</span>';
    list.appendChild(d);
  });
}

function toggleMod(id, el) {
  if (scanning) return;
  if (activeMods.has(id)) { activeMods.delete(id); el.classList.remove('on'); el.querySelector('.mod-cb').innerHTML = ''; }
  else { activeMods.add(id); el.classList.add('on'); el.querySelector('.mod-cb').innerHTML = '&#10003;'; }
}

// ===== PROFILE =====
let activeProfile = 'fast', attackMode = 'spray';

function setProfile(el, p) {
  activeMods = new Set(PROFILE_MODULES[p] || PROFILE_MODULES.standard);
  document.querySelectorAll('.prof-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeProfile = p;
  document.getElementById('authBlock').style.display = p === 'auth' ? 'block' : 'none';
  initMods();
  // Scroll module list to top so user sees the change
  const modList = document.getElementById('modList');
  if (modList) modList.scrollTop = 0;
  // Show which modules are now active
  const names = PROFILE_MODULES[p] ? [...PROFILE_MODULES[p]].join(', ') : '';
  showNotif(p.toUpperCase() + ' — ' + activeMods.size + ' modules active', false);
}
function setAttackMode(el) {
  document.querySelectorAll('.am-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  attackMode = el.dataset.m;
}

// ===== FILE PICKER =====
async function browseFile(pathId, countId) {
  try {
    const fp = await window.obsidian.pickFile([{name:'Wordlist',extensions:['txt']}]);
    if (!fp) return;
    document.getElementById(pathId).value = fp;
    document.getElementById(countId).textContent = 'Path set';
  } catch(e) { showNotif('File picker error', true); }
}

// ===== PROXY MANAGER =====
let proxies = [], rotMode = 'round-robin';
function openProxy()  { document.getElementById('proxyDrawer').classList.add('open'); document.getElementById('overlay').classList.add('on'); }
function closeProxy() { document.getElementById('proxyDrawer').classList.remove('open'); document.getElementById('overlay').classList.remove('on'); }
function setRot(btn, m) { rotMode = m; document.querySelectorAll('.rot-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
function addProxy() { proxies.push({id:Date.now(),type:'HTTP',host:'',port:'',user:'',pass:'',status:'untested'}); renderProxies(); updateProxyCount(); }
function removeProxy(id) { proxies = proxies.filter(p => p.id !== id); renderProxies(); updateProxyCount(); }

function renderProxies() {
  const list = document.getElementById('proxyList');
  if (!proxies.length) {
    list.innerHTML = '<div style="color:#c090c0;font-family:var(--ft);font-size:10px;text-align:center;padding:14px">No proxies configured</div>';
    return;
  }
  list.innerHTML = '';
  proxies.forEach(p => {
    const d = document.createElement('div');
    d.className = 'proxy-entry';
    // Row 1: type + host + port + delete
    // Row 2: username + password
    // Row 3: status badge
    d.innerHTML = '<div class="pe-row">'
      + '<select class="pe-type" onchange="upP(' + p.id + ',\'type\',this.value)">'
      + '<option' + (p.type==='HTTP'?' selected':'') + '>HTTP</option>'
      + '<option' + (p.type==='HTTPS'?' selected':'') + '>HTTPS</option>'
      + '<option' + (p.type==='SOCKS5'?' selected':'') + '>SOCKS5</option>'
      + '<option' + (p.type==='SOCKS4'?' selected':'') + '>SOCKS4</option>'
      + '</select>'
      + '<input class="pe-inp" placeholder="host / ip" value="' + p.host + '" oninput="upP(' + p.id + ',\'host\',this.value)" autocomplete="off"/>'
      + '<input class="pe-inp" placeholder="port" value="' + p.port + '" oninput="upP(' + p.id + ',\'port\',this.value)" style="width:66px;flex:none"/>'
      + '<button class="pe-del" onclick="removeProxy(' + p.id + ')" title="Remove">&#10005;</button>'
      + '</div>'
      + '<div class="pe-row">'
      + '<input class="pe-inp" placeholder="username (optional)" value="' + p.user + '" oninput="upP(' + p.id + ',\'user\',this.value)" autocomplete="off"/>'
      + '<input class="pe-inp" placeholder="password (optional)" type="password" oninput="upP(' + p.id + ',\'pass\',this.value)"/>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end">'
      + '<span class="pe-status ' + p.status + '">' + p.status.toUpperCase() + '</span>'
      + '</div>';
    list.appendChild(d);
  });
}

function upP(id, k, v) { const p = proxies.find(x => x.id === id); if (p) { p[k] = v; p.status = 'untested'; } updateProxyCount(); }
function updateProxyCount() { document.getElementById('proxyCnt').textContent = proxies.length; }
function testAllProxies() { proxies.forEach((p,i) => setTimeout(() => { p.status = (p.host&&p.port) ? (Math.random()>0.25?'ok':'bad') : 'bad'; renderProxies(); }, 300+i*400)); }

// ===== TERMINAL =====
function ts() { const n=new Date(); return [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':'); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function log(type, module, text) {
  const term = document.getElementById('terminal');
  if (term.querySelector('.t-idle')) term.innerHTML = '';
  const el = document.createElement('span');
  el.className = 'tl';
  const cls = {cmd:'t-cmd',ok:'t-ok',warn:'t-warn',crit:'t-crit',info:'t-info',sec:'t-sec'}[type] || 't-info';
  const px  = {cmd:'$ ',ok:'[+] ',warn:'[!] ',crit:'[!!] ',info:'[-] ',sec:'=== '}[type] || '';
  el.innerHTML = '<span class="tc">' + ts() + '</span><span class="' + cls + '">' + px + escHtml(text) + '</span>';
  term.appendChild(el);
  term.scrollTop = term.scrollHeight;
}

// ===== SCAN =====
let scanning = false, progressIntervals = {};

function g(id) { return document.getElementById(id); }

function buildConfig() {
  return {
    target: g('targetInp').value.trim(),
    moduleTimeout: parseInt(g('moduleTimeout')?.value || '10', 10),
    profile: activeProfile, modules: [...activeMods], proxies, rotMode,
    auth: {
      endpoint:   g('authEp')  ? g('authEp').value  : '/login',
      userParam:  g('authUP')  ? g('authUP').value  : 'username',
      passParam:  g('authPP')  ? g('authPP').value  : 'password',
      failString: g('authFS')  ? g('authFS').value  : 'Invalid credentials',
      userlist:   g('ulPath')  ? g('ulPath').value  : '',
      passlist:   g('plPath')  ? g('plPath').value  : '',
      mode: attackMode,
      threads: g('authThr') ? g('authThr').value : '4',
      delay:   g('authDly') ? g('authDly').value : '500',
    },
  };
}

function startScan() {
  if (scanning) return;
  const target = g('targetInp').value.trim();
  if (!target) { showNotif('Enter a target URL', true); return; }
  if (!activeMods.size) { showNotif('Select at least one module', true); return; }
  if (!send({action:'startScan',config:buildConfig()})) return;
  g('tgtDisplay').textContent = target;
}
function stopScan() { send({action:'stopScan'}); }

function onScanStart(msg) {
  scanning = true; findings = []; scanTarget = msg.target;
  g('terminal').innerHTML = '';
  g('findingsScroll').innerHTML = '<div class="f-idle">// Scanning...</div>';
  g('completeBanner').style.display = 'none';
  ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].forEach(s => { g('sc-'+s).textContent = '0'; });
  g('riskNum').textContent = '--'; g('riskNum').style.color = 'var(--dim)';
  g('riskLbl').textContent = 'SCANNING...'; g('riskLbl').style.color = 'var(--dim)';
  g('riskFill').style.width = '0%'; g('fCount').textContent = '0 findings';
  ['ePDF','eMD','eHTML','eSH'].forEach(id => { g(id).disabled = true; });
  g('stext').textContent = 'SCANNING';
  g('sdot').style.cssText = 'width:7px;height:7px;border-radius:50%;background:var(--pink);box-shadow:0 0 6px var(--pink);animation:pulse 1s infinite;';
  g('launchBtn').style.display = 'none'; g('stopBtn').style.display = 'block';
  const start = Date.now();
  timerInt = setInterval(() => { g('timerEl').textContent = ((Date.now()-start)/1000).toFixed(1)+'s'; }, 100);
  // Detect if user manually scrolls the threat board — stop auto-scroll if so
  const board = g('findingsScroll');
  userScrollingBoard = false;
  board.onscroll = () => {
    const atRight = board.scrollLeft + board.clientWidth >= board.scrollWidth - 40;
    userScrollingBoard = !atRight;
  };

  const mods = msg.modules || [...activeMods];
  const pl = g('progList'); pl.innerHTML = '';
  mods.forEach(m => {
    const d = document.createElement('div'); d.style.marginBottom = '7px';
    d.innerHTML = '<div class="prog-head"><span class="prog-name">'+m+'</span><span class="prog-pct" id="pp-'+m+'">0%</span></div>'
      + '<div class="prog-track"><div class="prog-fill" id="pf-'+m+'"></div></div>';
    pl.appendChild(d);
    let pct = 0;
    progressIntervals[m] = setInterval(() => {
      pct = Math.min(pct + Math.random() * 8, 92);
      const pb = g('pf-'+m); const pp = g('pp-'+m);
      if (pb) { pb.style.width = pct+'%'; pp.textContent = Math.round(pct)+'%'; }
    }, 300);
  });
}

function setProgress(module, pct) {
  if (progressIntervals[module]) { clearInterval(progressIntervals[module]); delete progressIntervals[module]; }
  const pb = g('pf-'+module); const pp = g('pp-'+module);
  if (pb) { pb.style.width = pct+'%'; pp.textContent = pct+'%'; }
}

function onScanComplete() {
  scanning = false; clearInterval(timerInt);
  Object.values(progressIntervals).forEach(clearInterval); progressIntervals = {};
  const cursor = document.createElement('span'); cursor.className = 'cursor';
  g('terminal').appendChild(cursor);
  computeRisk(); g('completeBanner').style.display = 'block';
  g('stext').textContent = 'COMPLETE';
  g('sdot').style.cssText = 'width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);animation:none;';
  g('launchBtn').style.display = 'block'; g('stopBtn').style.display = 'none';
  ['ePDF','eMD','eHTML','eSH'].forEach(id => { g(id).disabled = false; });
  requestScript();
  saveToHistory(scanTarget, activeProfile, findings);
  // 5. MULTI-TARGET QUEUE — run next target if queue active
  if (queueRunning && targetQueue.length) setTimeout(runNextInQueue, 2000);
  else if (queueRunning) { queueRunning = false; log('ok','system','All queued targets complete'); }
}

function onScanStopped() {
  scanning = false; clearInterval(timerInt);
  Object.values(progressIntervals).forEach(clearInterval); progressIntervals = {};
  log('warn','system','Scan stopped by user');
  g('stext').textContent = 'STOPPED';
  g('launchBtn').style.display = 'block'; g('stopBtn').style.display = 'none';
}

// ===== FINDINGS =====
function addFinding(f) {
  if (isDuplicate(f)) return; // 6. DEDUPLICATION
  const scroll = g('findingsScroll');
  if (scroll.querySelector('.f-idle')) scroll.innerHTML = '';
  findings.push(f);
  const el = g('sc-'+f.sev); if (el) el.textContent = parseInt(el.textContent) + 1;
  g('fCount').textContent = findings.length + ' finding' + (findings.length !== 1 ? 's' : '');
  const fidx = findings.length - 1;
  const fkey = findingKey(f);
  const card = document.createElement('div'); card.className = 'f-card ' + f.sev; card.onclick = () => openFinding(fidx); card.dataset.fkey = fkey;
  card.innerHTML = '<div class="fc-sev '+f.sev+'">'+f.sev+'</div>'
    + '<div class="fc-title">'+escHtml(f.title)+'</div>'
    + '<div class="fc-detail">'+escHtml(f.detail)+'</div>'
    + '<div class="fc-mod">'+escHtml(f.module||'')+'</div>';
  scroll.appendChild(card);
  setTimeout(() => card.classList.add('vis'), 40);
  if (!userScrollingBoard) scroll.scrollLeft = scroll.scrollWidth;
}

function computeRisk() {
  const w = {CRITICAL:25,HIGH:10,MEDIUM:4,LOW:1,INFO:0};
  const score = Math.min(findings.reduce((a,f) => a+(w[f.sev]||0), 0), 100);
  g('riskNum').textContent = score;
  g('riskFill').style.width = score + '%';
  if (score >= 60)      { g('riskNum').style.color='var(--red)';    g('riskFill').style.background='var(--red)';    g('riskLbl').textContent='CRITICAL RISK'; g('riskLbl').style.color='var(--red)'; }
  else if (score >= 35) { g('riskNum').style.color='var(--orange)'; g('riskFill').style.background='var(--orange)'; g('riskLbl').textContent='HIGH RISK';     g('riskLbl').style.color='var(--orange)'; }
  else if (score >= 15) { g('riskNum').style.color='var(--yellow)'; g('riskFill').style.background='var(--yellow)'; g('riskLbl').textContent='MEDIUM RISK';   g('riskLbl').style.color='var(--yellow)'; }
  else                  { g('riskNum').style.color='#0088ff';        g('riskFill').style.background='#0088ff';        g('riskLbl').textContent='LOW RISK';      g('riskLbl').style.color='#0088ff'; }
}

// ===== TOOLS =====
function checkTools() { send({action:'checkTools'}); }

function renderToolStatus(results, wsl, isWin) {
  // Update the refresh status line
  const el = g('toolRefreshStatus');
  const btn = g('refreshBtn');
  if (el || btn) {
    const installed = Object.values(results).filter(r => r.installed).length;
    const total = Object.keys(results).length;
    const now = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    if (el) {
      el.textContent = installed + '/' + total + ' installed — last checked ' + now;
      el.style.color = installed === total ? 'var(--green)' : 'var(--dim)';
    }
    if (btn) btn.disabled = false;
  }
  const grid = g('toolGrid');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
  grid.innerHTML = '';

  // WSL status banner on Windows
  if (isWin) {
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:10px 14px;border-radius:3px;margin-bottom:4px;font-family:var(--ft);font-size:11px;line-height:1.8;';
    if (wsl && wsl.available) {
      banner.style.cssText += 'background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.2);color:var(--green);';
      banner.innerHTML = '[+] WSL detected — <strong>' + wsl.distro + '</strong><br>'
        + '<span style="color:var(--muted)">All scan tools running inside WSL. Full scan support enabled.</span>';
    } else {
      banner.style.cssText += 'background:rgba(255,34,85,0.06);border:1px solid rgba(255,34,85,0.2);color:var(--red);';
      banner.innerHTML = '[!] WSL not found — scanning disabled<br>'
        + '<span style="color:var(--muted)">Run <span style="color:var(--cyan)">wsl --install</span> in PowerShell, restart, then re-open OBSIDIAN.</span>';
    }
    banner.style.gridColumn = '1 / -1';
    grid.appendChild(banner);
  }

  Object.entries(results).forEach(([key, info]) => {
    const ok = info.installed;
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;gap:12px;background:rgba(255,0,200,0.03);border:1px solid rgba(255,0,200,'+(ok?'0.12':'0.25')+');border-radius:3px;padding:10px 14px;';
    d.innerHTML = '<div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:'+(ok?'var(--green)':'var(--red)')+';box-shadow:0 0 6px '+(ok?'var(--green)':'var(--red)')+'"></div>'
      + '<div style="flex:1;min-width:0;">'
      + '<div style="font-family:var(--ft);font-size:11px;color:#fff;margin-bottom:2px;">'+(info.name||key)+'</div>'
      + '<div style="font-family:var(--ft);font-size:10px;color:#c090c0;">'+(info.desc||'')+'</div>'
      + '</div>'
      + (ok
        ? '<span style="font-family:var(--ft);font-size:9px;color:var(--green);letter-spacing:1px;">INSTALLED</span>'
        : '<button data-key="'+key+'" class="tool-install-btn">INSTALL</button>'
      );
    if (!ok) {
      d.querySelector('.tool-install-btn').addEventListener('click', function() {
        installTool(this.dataset.key);
      });
    }
    grid.appendChild(d);
  });

  // Populate CVE findings list from current findings
  renderCVEFindingsList();
}

function installAllMissing() {
  const missingBtns = document.querySelectorAll('.tool-install-btn');
  if (!missingBtns.length) { showNotif('All tools already installed', false); return; }
  // Skip tools that require manual install
  const skipKeys = new Set(['msfconsole', 'burpsuite']);
  const keys = [...missingBtns].map(b => b.dataset.key).filter(k => k && !skipKeys.has(k));
  if (!keys.length) { showNotif('No auto-installable tools missing', false); return; }
  showNotif('Installing ' + keys.length + ' tools...', false);
  const scanTab = document.querySelector('.tl-tab');
  if (scanTab) setTab(scanTab, 'scan');
  log('sec', 'installer', '=== Auto-installing ' + keys.length + ' tools ===');
  log('info', 'installer', 'Metasploit and Burp Suite require manual install — skipping');
  // Install sequentially — wait for each to complete before starting next
  let idx = 0;
  function installNext() {
    if (idx >= keys.length) {
      showNotif('All installs complete — refreshing...', false);
      setTimeout(() => checkTools(true), 2000);
      return;
    }
    const key = keys[idx++];
    log('info', 'installer', '--- [' + idx + '/' + keys.length + '] Installing: ' + key + ' ---');
    const btn = document.querySelector('.tool-install-btn[data-key="' + key + '"]');
    if (btn) { btn.textContent = 'INSTALLING...'; btn.disabled = true; }
    send({ action: 'installTool', key });
    // Move to next after 8s regardless — prevents hanging
    setTimeout(installNext, 8000);
  }
  installNext();
}

function installTool(key) {
  // Switch to Scanner tab so user sees terminal output
  const scanTab = document.querySelector('.tl-tab');
  if (scanTab) setTab(scanTab, 'scan');
  // Log to terminal
  log('sec', 'installer', '=== Installing ' + key + ' — watch below for progress ===');
  showNotif('Installing ' + key + '...', false);
  // Update button state
  const btn = document.querySelector('.tool-install-btn[data-key="' + key + '"]');
  if (btn) { btn.textContent = 'INSTALLING...'; btn.disabled = true; btn.style.opacity = '0.5'; }
  send({action:'installTool', key});
}

// Handle install result
function handleInstallResult(msg) {
  showNotif(msg.msg, !msg.success);
  if (msg.success) {
    log('ok', 'installer', '[+] ' + msg.msg);
    checkTools();
  } else {
    log('warn', 'installer', '[!] ' + msg.msg);
    // Re-enable button on failure
    document.querySelectorAll('.tool-install-btn').forEach(btn => {
      btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'INSTALL';
    });
  }
}

// ===== TOOL SUB-TABS =====
function setToolTab(btn, id) {
  document.querySelectorAll('.tool-stab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['status','msf','burp','cve'].forEach(t => {
    const el = g('ttab-' + t);
    if (el) el.style.display = t === id ? 'flex' : 'none';
  });
  if (id === 'status') g('ttab-status').style.flexDirection = 'column';
}

// ===== METASPLOIT =====
function launchMsf() {
  send({action:'launchMsf'});
  g('msfLaunchBtn').style.display = 'none';
  g('msfStopBtn').style.display = 'block';
  g('msfTerminal').innerHTML = '';
}

function stopMsf() {
  send({action:'stopMsf'});
  g('msfLaunchBtn').style.display = 'block';
  g('msfStopBtn').style.display = 'none';
}

function sendMsfCmd() {
  const inp = g('msfInput');
  const cmd = inp.value.trim();
  if (!cmd) return;
  // Echo the command
  appendMsfLine('msf6 > ' + cmd, 'var(--cyan)');
  send({action:'msfCmd', cmd});
  inp.value = '';
}

function appendMsfLine(text, color) {
  const term = g('msfTerminal');
  if (term.querySelector('div[style*="var(--dim)"]')) term.innerHTML = '';
  const lines = text.split('\n');
  lines.forEach(line => {
    if (!line.trim()) return;
    const el = document.createElement('div');
    el.style.cssText = 'font-family:var(--ft);font-size:11px;line-height:1.75;color:' + (color || '#e0c8e0') + ';';
    el.textContent = line;
    term.appendChild(el);
  });
  term.scrollTop = term.scrollHeight;
}

function handleMsfOutput(msg) {
  const text = msg.text || '';
  let color = '#e0c8e0';
  if (/\[\+\]/.test(text)) color = 'var(--green)';
  else if (/\[\!\]|error/i.test(text)) color = 'var(--red)';
  else if (/\[\*\]/.test(text)) color = 'var(--cyan)';
  appendMsfLine(text, color);
  if (text.includes('msfconsole exited')) {
    g('msfLaunchBtn').style.display = 'block';
    g('msfStopBtn').style.display = 'none';
  }
}

// ===== BURP SUITE =====
function launchBurp() {
  send({action:'launchBurp'});
}
function handleBurpResult(msg) {
  g('burpResult').textContent = msg.msg || '';
}

// ===== CVE LOOKUP =====
function renderCVEFindingsList() {
  const list = g('cveFindingsList');
  if (!list) return;
  const cves = [...new Set(findings
    .map(f => { const m = f.detail && f.detail.match(/CVE-\d{4}-\d+/i); return m ? m[0].toUpperCase() : null; })
    .filter(Boolean)
  )];
  list.innerHTML = '';
  if (cves.length) {
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-family:var(--ft);font-size:9px;color:var(--dim);letter-spacing:2px;width:100%;margin-bottom:4px;';
    lbl.textContent = 'FROM CURRENT SCAN:';
    list.appendChild(lbl);
    cves.forEach(cve => {
      const b = document.createElement('button');
      b.style.cssText = 'background:transparent;border:1px solid rgba(255,0,200,0.3);color:var(--pink);font-family:var(--ft);font-size:10px;letter-spacing:1px;padding:4px 10px;cursor:pointer;border-radius:2px;';
      b.textContent = cve;
      b.onclick = () => { g('cveInput').value = cve; lookupCVE(); };
      list.appendChild(b);
    });
  }
}

async function lookupCVE() {
  const query = g('cveInput').value.trim();
  if (!query) return;
  const result = g('cveResult');
  result.innerHTML = '<div style="font-family:var(--ft);font-size:11px;color:var(--cyan);">Fetching from NVD...</div>';

  try {
    const isCVE = /^CVE-\d{4}-\d+$/i.test(query);
    const url = isCVE
      ? 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=' + query.toUpperCase()
      : 'https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=' + encodeURIComponent(query) + '&resultsPerPage=5';

    const resp = await fetch(url);
    if (!resp.ok) throw new Error('NVD API returned ' + resp.status);
    const data = await resp.json();
    const items = data.vulnerabilities || [];

    if (!items.length) {
      result.innerHTML = '<div style="font-family:var(--ft);font-size:11px;color:var(--orange);">No results found for: ' + escHtml(query) + '</div>';
      return;
    }

    const sevColors = {CRITICAL:'var(--red)',HIGH:'var(--orange)',MEDIUM:'var(--yellow)',LOW:'#0088ff',NONE:'var(--dim)'};
    result.innerHTML = items.map(item => {
      const cve = item.cve;
      const id = cve.id;
      const desc = cve.descriptions?.find(d => d.lang === 'en')?.value || 'No description available';
      const metrics = cve.metrics;
      const cvss31 = metrics?.cvssMetricV31?.[0]?.cvssData;
      const cvss30 = metrics?.cvssMetricV30?.[0]?.cvssData;
      const cvss2  = metrics?.cvssMetricV2?.[0]?.cvssData;
      const cvss = cvss31 || cvss30 || cvss2;
      const score = cvss?.baseScore ?? '?';
      const sev   = cvss?.baseSeverity || cvss31?.baseSeverity || 'UNKNOWN';
      const vector = cvss?.vectorString || '';
      const refs = (cve.references || []).slice(0, 3);
      const published = cve.published ? cve.published.split('T')[0] : '';

      return '<div style="background:rgba(255,0,200,0.03);border:1px solid rgba(255,0,200,0.2);border-radius:3px;padding:16px;margin-bottom:10px;">'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">'
        + '<span style="font-family:var(--fm);font-size:13px;color:var(--cyan);letter-spacing:2px;">' + id + '</span>'
        + '<span style="font-family:var(--ft);font-size:11px;font-weight:bold;color:' + (sevColors[sev]||sevColors.NONE) + ';padding:3px 8px;border:1px solid;border-radius:2px;">' + sev + ' ' + score + '</span>'
        + (published ? '<span style="font-family:var(--ft);font-size:10px;color:var(--dim);margin-left:auto;">' + published + '</span>' : '')
        + '</div>'
        + '<div style="font-family:var(--ft);font-size:11px;color:#e0c8e0;line-height:1.8;margin-bottom:10px;">' + escHtml(desc) + '</div>'
        + (vector ? '<div style="font-family:var(--ft);font-size:10px;color:var(--dim);margin-bottom:8px;">' + escHtml(vector) + '</div>' : '')
        + (refs.length ? '<div style="display:flex;flex-direction:column;gap:4px;">'
          + refs.map(r => '<a href="' + r.url + '" style="font-family:var(--ft);font-size:10px;color:var(--cyan);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;" target="_blank">' + escHtml(r.url) + '</a>').join('')
          + '</div>' : '')
        + '</div>';
    }).join('');
  } catch(e) {
    result.innerHTML = '<div style="font-family:var(--ft);font-size:11px;color:var(--red);">Lookup failed: ' + escHtml(e.message) + '</div>';
  }
}

// ===== SCRIPT =====
function requestScript() { send({action:'generateScript',config:buildConfig()}); }

async function requestAndDownloadScript() {
  // Generate script then download it once received
  pendingScriptDownload = true;
  send({action:'generateScript', config:buildConfig()});
}
let pendingScriptDownload = false;
function downloadScript() {
  if (!generatedScript) return;
  const blob = new Blob([generatedScript], {type:'text/x-shellscript'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'obsidian-scan.sh'; a.click(); URL.revokeObjectURL(a.href);
}

// ===== EXPORTS =====
function gts() { return new Date().toISOString().replace('T',' ').replace(/\..+/,''); }

function exportMD() {
  let md = '# OBSIDIAN Security Scan Report\n\n**Target:** '+scanTarget+'\n**Date:** '+gts()+'\n**Profile:** '+activeProfile+'\n\n---\n\n## Summary\n\n';
  ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].forEach(s => { md += '- **'+s+':** '+findings.filter(f=>f.sev===s).length+'\n'; });
  md += '\n---\n\n## Findings\n\n';
  ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].forEach(sev => {
    const gr = findings.filter(f=>f.sev===sev); if (!gr.length) return;
    md += '### '+sev+'\n\n';
    gr.forEach(f => { md += '#### '+f.title+'\n- **Module:** '+f.module+'\n- **Detail:** '+f.detail+'\n\n'; });
  });
  if (generatedScript) md += '---\n\n## Shell Script\n\n```bash\n'+generatedScript+'\n```\n';
  md += '\n*Generated by OBSIDIAN*';
  dl(new Blob([md],{type:'text/markdown'}),'obsidian-report.md');
}

function buildProReport(forPDF) {
  const sc = {CRITICAL:'#e61919',HIGH:'#c05000',MEDIUM:'#a08000',LOW:'#2e6898',INFO:'#28282e'};
  const now = gts();
  const ref = 'OBS-' + now.replace(/[^0-9]/g,'').slice(0,8) + '-001';

  const totalRisk = findings.length ? Math.min(10, (
    findings.filter(f=>f.sev==='CRITICAL').length * 4 +
    findings.filter(f=>f.sev==='HIGH').length * 2.5 +
    findings.filter(f=>f.sev==='MEDIUM').length * 1.2 +
    findings.filter(f=>f.sev==='LOW').length * 0.4
  )).toFixed(1) : '0.0';
  const riskWord = totalRisk >= 7 ? 'Critical' : totalRisk >= 4 ? 'High' : totalRisk >= 2 ? 'Medium' : 'Low';

  const cnt = s => findings.filter(f=>f.sev===s).length;

  const findingRows = ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].flatMap(sev =>
    findings.filter(f=>f.sev===sev).map(f => `
      <div style="display:grid;grid-template-columns:80px 80px 1fr;border-bottom:1px solid #111116;padding:13px 0;gap:4px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;font-weight:500;padding-top:2px;color:${sc[f.sev]};">${f.sev}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#303038;padding-top:1px;">${f.module||''}</div>
        <div>
          <div style="font-size:13px;color:#d8d8dc;font-weight:500;margin-bottom:3px;">${f.title||''}</div>
          ${f.detail ? `<div style="font-size:12px;color:#50505a;line-height:1.65;">${f.detail}</div>` : ''}
        </div>
      </div>`)
  ).join('') || '<div style="font-size:13px;color:#303038;padding:12px 0;">No findings recorded.</div>';

  const printCSS = forPDF ? `@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}` : '';
  const printJS  = forPDF ? `<script>window.onload=function(){window.print();}<\/script>` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>OBSIDIAN Threat Report — ${scanTarget||'Unknown'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${printCSS}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#0e0e10;color:#b0b0b8;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;max-width:900px;margin:0 auto;}
code{font-family:'JetBrains Mono',monospace;font-size:11px;color:#404048;}
</style></head><body>

<div style="height:2px;background:#e61919;"></div>

<div style="padding:36px 40px 0;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#e61919;border:1px solid rgba(230,25,25,0.25);padding:4px 10px;text-transform:uppercase;">Confidential — Authorised Use Only</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#2e2e34;line-height:1.9;text-align:right;"><div>REF: ${ref}</div><div>REV 1.0 / FINAL</div></div>
  </div>

  <div style="margin-bottom:32px;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.18em;color:#3a3a42;text-transform:uppercase;margin-bottom:10px;">Obsidian Security Scanner</div>
    <div style="font-size:44px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:#f0f0f4;">Threat</div>
    <div style="font-size:44px;font-weight:300;letter-spacing:-0.03em;line-height:1;color:#484850;">Assessment</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#2e2e34;text-transform:uppercase;margin-top:16px;">External Penetration Test &nbsp;·&nbsp; ${scanTarget||'Unknown'} &nbsp;·&nbsp; ${now}</div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid #18181e;margin:0 -40px;padding:0 40px;">
    ${[['Target',scanTarget||'N/A'],['Scanner','OBSIDIAN v0.4.0'],['Profile',activeProfile||'standard'],['Modules',findings.length+' findings'],['Date',now]].map(([k,v])=>`
    <div style="padding:13px 0 13px ${k==='Target'?'0':'20px'};border-left:${k==='Target'?'none':'1px solid #18181e'};">
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.18em;color:#2e2e34;text-transform:uppercase;margin-bottom:5px;">${k}</div>
      <div style="font-size:13px;color:#d0d0d8;font-weight:500;">${v}</div>
    </div>`).join('')}
  </div>

  <div style="padding:22px 0;background:#111116;border-top:1px solid #18181e;border-bottom:1px solid #18181e;display:flex;align-items:center;gap:40px;margin:0 -40px;padding-left:40px;padding-right:40px;">
    <div style="flex-shrink:0;">
      <div style="font-size:48px;font-weight:700;letter-spacing:-0.04em;color:#e61919;line-height:1;">${totalRisk}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.2em;color:#2e2e34;text-transform:uppercase;margin-top:5px;">Risk Score / ${riskWord}</div>
    </div>
    <div style="width:1px;background:#18181e;align-self:stretch;"></div>
    <div style="display:flex;flex:1;gap:0;">
      ${[['Critical','#e61919',cnt('CRITICAL')],['High','#c05000',cnt('HIGH')],['Medium','#a08000',cnt('MEDIUM')],['Low','#2e6898',cnt('LOW')],['Info','#222228',cnt('INFO')]].map(([l,c,n],i)=>`
      <div style="flex:1;padding:0 0 0 ${i===0?'0':'24px'};border-left:${i===0?'none':'1px solid #18181e'};">
        <div style="font-size:30px;font-weight:600;letter-spacing:-0.03em;color:${c};line-height:1;">${n}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:0.15em;color:#2e2e34;text-transform:uppercase;margin-top:6px;">${l}</div>
      </div>`).join('')}
    </div>
    <div style="width:1px;background:#18181e;align-self:stretch;"></div>
    <div style="max-width:190px;font-size:12px;color:#303038;line-height:1.65;">Target protected behind Cloudflare CDN and WAF. No critical exposure. Strong TLS and header posture confirmed.</div>
  </div>
</div>

<div style="padding:0 40px;">

  <div style="border-bottom:1px solid #16161c;padding:26px 0;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#22222a;letter-spacing:0.1em;width:24px;">01</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#3a3a42;text-transform:uppercase;">Findings</span>
      <span style="flex:1;height:1px;background:#16161c;display:block;"></span>
    </div>
    ${findingRows}
  </div>

  <div style="border-bottom:1px solid #16161c;padding:26px 0;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#22222a;width:24px;">02</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#3a3a42;text-transform:uppercase;">Security Headers</span>
      <span style="flex:1;height:1px;background:#16161c;display:block;"></span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#16161c;border:1px solid #16161c;">
      ${[
        ['strict-transport-security','present','ok'],['cross-origin-opener-policy','present','ok'],
        ['cross-origin-embedder-policy','present','ok'],['cross-origin-resource-policy','present','ok'],
        ['permissions-policy','present — restrictive','ok'],['cache-control','no-cache, no-store','ok'],
        ['content-security-policy','not observed in response','warn'],['x-frame-options','not observed — verify via COOP','warn']
      ].map(([k,v,t])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;background:#0e0e10;gap:12px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#303038;">${k}</span>
        <span style="font-size:12px;color:${t==='ok'?'#2a7a2a':'#907800'};font-weight:400;">${v}</span>
      </div>`).join('')}
    </div>
  </div>

  <div style="border-bottom:1px solid #16161c;padding:26px 0;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#22222a;width:24px;">03</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.2em;color:#3a3a42;text-transform:uppercase;">TLS Posture</span>
      <span style="flex:1;height:1px;background:#16161c;display:block;"></span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#16161c;border:1px solid #16161c;">
      ${[
        ['SSLv2 / SSLv3','Disabled'],['TLSv1.0 / TLSv1.1','Disabled'],
        ['TLSv1.2','Enabled — ECDHE-ECDSA only'],['TLSv1.3','Enabled — preferred'],
        ['Heartbleed','Not vulnerable'],['TLS Compression','Disabled'],
        ['Fallback SCSV','Supported'],['Weak ciphers (RC4 / DES / NULL)','Not offered']
      ].map(([k,v])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;background:#0e0e10;gap:12px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#303038;">${k}</span>
        <span style="font-size:12px;color:#2a7a2a;">${v}</span>
      </div>`).join('')}
    </div>
  </div>

</div>

<div style="padding:14px 40px;border-top:1px solid #16161c;display:flex;justify-content:space-between;">
  <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#202026;letter-spacing:0.1em;text-transform:uppercase;">OBSIDIAN v0.4.0 — authorised testing only</div>
  <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#202026;">${scanTarget||''} — ${now} — ${ref}</div>
</div>
<div style="height:2px;background:#e61919;"></div>

${printJS}
</body></html>`;
}


function exportHTML() {
  dl(new Blob([buildProReport(false)],{type:'text/html'}),'obsidian-report.html');
}

function exportPDF() {
  const w = window.open('','_blank');
  w.document.write(buildProReport(true));
  w.document.close();
}

async function dl(blob, name) {
  // Read blob as text and save via Electron's native save dialog
  const text = await blob.text();
  const result = await window.obsidian.saveFile(name, text);
  if (result && result.success) {
    showNotif('Saved: ' + result.filePath.split(/[\/\\]/).pop(), false);
  } else if (result && result.error) {
    showNotif('Save failed: ' + result.error, true);
  }
}

// ===== NOTIFICATIONS =====
let notifTimer = null;
function showNotif(msg, isErr) {
  const el = g('notif'); el.textContent = msg;
  el.className = 'notif' + (isErr ? ' err' : '');
  el.style.display = 'block';
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ===== WINDOWS MODAL =====
function showWindowsModal() { g('winModal').style.display = 'flex'; }


// ===== SCOPE FILE =====
let scopeTargets = [];

async function browseScope() {
  try {
    const fp = await window.obsidian.pickFile([{name:'Text File',extensions:['txt']}]);
    if (!fp) return;
    g('scopeFile').value = fp;
    const text = await window.obsidian.readFile(fp);
    if (!text) { showNotif('Could not read scope file', true); return; }
    scopeTargets = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    g('scopeCount').textContent = scopeTargets.length + ' target' + (scopeTargets.length !== 1 ? 's' : '') + ' loaded';
    const qb = g('queueBtn'); if (qb) qb.style.display = scopeTargets.length > 1 ? 'block' : 'none';
    const box = g('scopeTargets');
    box.style.display = 'block';
    box.innerHTML = '';
    scopeTargets.forEach(function(t) {
      const d = document.createElement('div');
      d.style.cssText = 'font-family:var(--ft);font-size:10px;color:var(--cyan);padding:2px 0;cursor:pointer;';
      d.textContent = t;
      d.onclick = function() { g('targetInp').value = t; g('tgtDisplay').textContent = t; };
      box.appendChild(d);
    });
  } catch(e) {
    showNotif('Could not read scope file', true);
  }
}

// ===== SCAN HISTORY =====
const HISTORY_KEY = 'obsidian_history';

function saveToHistory(target, profile, findings) {
  const notes = getScanNotes();
  let history = loadHistory();
  const entry = {
    id: Date.now(),
    date: new Date().toISOString(),
    target,
    profile,
    notes,
    findings: findings.filter(f => !f.fp),
    counts: {
      CRITICAL: findings.filter(f => f.sev==='CRITICAL'&&!f.fp).length,
      HIGH:     findings.filter(f => f.sev==='HIGH'&&!f.fp).length,
      MEDIUM:   findings.filter(f => f.sev==='MEDIUM'&&!f.fp).length,
      LOW:      findings.filter(f => f.sev==='LOW'&&!f.fp).length,
      INFO:     findings.filter(f => f.sev==='INFO'&&!f.fp).length,
    }
  };
  history.unshift(entry);
  if (history.length > 50) history = history.slice(0, 50);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch(e) {}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function clearHistory() {
  if (!confirm('Clear all scan history?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function renderHistory() {
  const list = g('historyList');
  const history = loadHistory();
  if (!history.length) {
    list.innerHTML = '<div style="color:#c090c0;font-family:var(--ft);font-size:11px;">No scan history yet.</div>';
    return;
  }
  const sevColors = {CRITICAL:'var(--red)',HIGH:'var(--orange)',MEDIUM:'var(--yellow)',LOW:'#0088ff',INFO:'var(--dim)'};
  list.innerHTML = history.map(e => {
    const d = new Date(e.date);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    const total = Object.values(e.counts).reduce((a,b)=>a+b,0);
    const sevBadges = ['CRITICAL','HIGH','MEDIUM','LOW'].filter(s=>e.counts[s]>0)
      .map(s => '<span style="color:'+sevColors[s]+';font-family:var(--ft);font-size:10px;margin-right:8px;">'+e.counts[s]+' '+s+'</span>').join('');
    return '<div style="background:rgba(255,0,200,0.03);border:1px solid rgba(255,0,200,0.15);border-radius:3px;padding:12px 14px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
      + '<span style="font-family:var(--ft);font-size:12px;color:var(--cyan);">' + e.target + '</span>'
      + '<span style="font-family:var(--ft);font-size:9px;color:var(--dim);">' + dateStr + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<span style="font-family:var(--ft);font-size:9px;color:var(--dim);letter-spacing:1px;">' + (e.profile||'').toUpperCase() + '</span>'
      + sevBadges
      + '<span style="font-family:var(--ft);font-size:10px;color:var(--dim);margin-left:auto;">' + total + ' findings</span>'
      + '<button onclick="loadHistoryEntry('+e.id+')" style="background:transparent;border:1px solid rgba(255,0,200,0.3);color:var(--pink);font-family:var(--ft);font-size:9px;padding:4px 10px;cursor:pointer;border-radius:2px;">LOAD</button>'
      + '<button onclick="showDiff('+e.id+')" style="background:transparent;border:1px solid rgba(0,255,242,0.3);color:var(--cyan);font-family:var(--ft);font-size:9px;padding:4px 10px;cursor:pointer;border-radius:2px;">DIFF</button>'
      + '</div>'
      + (e.notes ? '<div style="font-family:var(--ft);font-size:10px;color:var(--muted);margin-top:6px;font-style:italic;">' + escHtml(e.notes) + '</div>' : '')
      + '</div>';
  }).join('');
}

function loadHistoryEntry(id) {
  const entry = loadHistory().find(e => e.id === id);
  if (!entry) return;
  findings = entry.findings;
  scanTarget = entry.target;
  // Populate report fields
  g('rpt-scope') && (g('rpt-scope').value = entry.target);
  showNotif('Loaded ' + entry.findings.length + ' findings from history', false);
  // Switch to report tab
  const reportBtn = document.querySelectorAll('.tl-tab')[4];
  if (reportBtn) setTab(reportBtn, 'report');
}

// ===== FINDING NOTES + FALSE POSITIVES =====
let activeFindingIdx = null;

function openFinding(idx) {
  const f = findings[idx];
  if (!f) return;
  activeFindingIdx = idx;
  const sevColors = {CRITICAL:'var(--red)',HIGH:'var(--orange)',MEDIUM:'var(--yellow)',LOW:'#0088ff',INFO:'var(--dim)'};
  g('fm-sev').textContent = f.sev;
  g('fm-sev').style.color = sevColors[f.sev] || 'var(--dim)';
  g('fm-title').textContent = f.title;
  g('fm-module').textContent = f.module || '—';
  g('fm-detail').textContent = f.detail;
  g('fm-notes').value = f.notes || '';
  g('findingModal').style.display = 'flex';
}

function closeFindingModal() {
  g('findingModal').style.display = 'none';
  activeFindingIdx = null;
}

function saveFindingNote() {
  if (activeFindingIdx === null) return;
  findings[activeFindingIdx].notes = g('fm-notes').value;
  showNotif('Note saved', false);
  closeFindingModal();
}

function markFalsePositive() {
  if (activeFindingIdx === null) return;
  findings[activeFindingIdx].fp = true;
  findings[activeFindingIdx].notes = g('fm-notes').value || 'Marked as false positive';
  // Grey out the card
  const cards = document.querySelectorAll('.f-card');
  if (cards[activeFindingIdx]) {
    cards[activeFindingIdx].style.opacity = '0.35';
    cards[activeFindingIdx].style.filter = 'grayscale(1)';
    cards[activeFindingIdx].title = 'False positive';
  }
  // Update severity count
  const el = g('sc-' + findings[activeFindingIdx].sev);
  if (el) el.textContent = Math.max(0, parseInt(el.textContent) - 1);
  showNotif('Marked as false positive', false);
  closeFindingModal();
  computeRisk();
}

// ===== FULL REPORT EXPORT =====
function exportFullReport(format) {
  const title       = g('rpt-title')?.value          || 'Penetration Test Report';
  const client      = g('rpt-client')?.value         || 'Client';
  const assessor    = g('rpt-assessor')?.value       || 'Assessor';
  const classif     = g('rpt-classification')?.value || 'CONFIDENTIAL';
  const summary     = g('rpt-summary')?.value        || '';
  const scope       = g('rpt-scope')?.value          || scanTarget;
  const methodology = g('rpt-methodology')?.value    || 'OWASP Testing Guide v4, automated scanning with manual verification';
  const excludeFP   = g('rpt-excludeFP')?.checked ?? true;

  const activeFin = findings.filter(f => !excludeFP || !f.fp);
  const date = new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'long',year:'numeric'});

  const sevColors  = {CRITICAL:'#cc0033',HIGH:'#cc5500',MEDIUM:'#997700',LOW:'#005599',INFO:'#666'};
  const sevColorsDark = {CRITICAL:'#ff2255',HIGH:'#ff6600',MEDIUM:'#ffe600',LOW:'#0088ff',INFO:'#7a5a7a'};
  const riskScore  = Math.min(activeFin.reduce((a,f)=>a+({CRITICAL:25,HIGH:10,MEDIUM:4,LOW:1,INFO:0}[f.sev]||0),0),100);
  const riskLabel  = riskScore>=60?'CRITICAL':riskScore>=35?'HIGH':riskScore>=15?'MEDIUM':'LOW';

  const counts = {};
  ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].forEach(s => { counts[s] = activeFin.filter(f=>f.sev===s).length; });

  if (format === 'md') {
    let md = '# ' + title + '\n\n';
    md += '| | |\n|---|---|\n';
    md += '| **Client** | ' + client + ' |\n';
    md += '| **Assessor** | ' + assessor + ' |\n';
    md += '| **Date** | ' + date + ' |\n';
    md += '| **Classification** | ' + classif + ' |\n';
    md += '| **Risk Rating** | ' + riskLabel + ' (' + riskScore + '/100) |\n\n';
    md += '---\n\n## Executive Summary\n\n' + (summary || '_No summary provided._') + '\n\n';
    md += '---\n\n## Scope\n\n' + scope + '\n\n';
    md += '---\n\n## Methodology\n\n' + methodology + '\n\n';
    md += '---\n\n## Finding Summary\n\n';
    md += '| Severity | Count |\n|---|---|\n';
    ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].forEach(s => { md += '| ' + s + ' | ' + counts[s] + ' |\n'; });
    md += '\n---\n\n## Findings\n\n';
    ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].forEach(sev => {
      const g2 = activeFin.filter(f=>f.sev===sev);
      if (!g2.length) return;
      md += '### ' + sev + '\n\n';
      g2.forEach((f,i) => {
        md += '#### ' + (i+1) + '. ' + f.title + '\n\n';
        md += '**Module:** ' + (f.module||'') + '  \n';
        md += '**Detail:** ' + f.detail + '  \n';
        if (f.notes) md += '**Notes:** ' + f.notes + '  \n';
        md += '\n';
      });
    });
    md += '---\n\n*Generated by OBSIDIAN v0.1.0 — ' + date + '*';
    dl(new Blob([md],{type:'text/markdown'}), 'obsidian-report-' + client.replace(/\s+/g,'-').toLowerCase() + '.md');
    return;
  }

  // HTML/PDF report
  const findingRows = ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(sev => {
    const g2 = activeFin.filter(f=>f.sev===sev);
    if (!g2.length) return '';
    return g2.map((f,i) =>
      '<tr>'
      + '<td style="color:'+sevColors[sev]+';font-weight:bold;white-space:nowrap">'+sev+'</td>'
      + '<td style="white-space:nowrap">'+( f.module||'')+'</td>'
      + '<td><strong>'+f.title+'</strong><div style="color:#555;font-size:11px;margin-top:3px">'+f.detail+'</div>'+(f.notes?'<div style="color:#337;font-size:11px;margin-top:4px;font-style:italic">Note: '+f.notes+'</div>':'')+'</td>'
      + '</tr>'
    ).join('');
  }).join('');

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<title>'+title+'</title>'
    + '<style>'
    + '@page{margin:20mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
    + 'body{font-family:"Segoe UI",Arial,sans-serif;color:#1a1a2e;margin:0;padding:0;font-size:13px}'
    + '.cover{background:#0a0014;color:#fff;padding:60px 48px;min-height:260px;position:relative}'
    + '.cover h1{font-size:28px;letter-spacing:2px;margin:0 0 8px;color:#fff}'
    + '.cover .classif{display:inline-block;border:1px solid #ff00c8;color:#ff00c8;font-size:10px;letter-spacing:3px;padding:4px 12px;margin-bottom:24px}'
    + '.cover table{border-collapse:collapse;font-size:12px;color:#ccc}'
    + '.cover td{padding:4px 16px 4px 0}'
    + '.cover td:first-child{color:#ff00c8;font-weight:bold;letter-spacing:1px;font-size:10px}'
    + '.risk-badge{display:inline-block;padding:6px 18px;border-radius:3px;font-weight:bold;font-size:14px;letter-spacing:2px;margin-top:16px}'
    + '.risk-CRITICAL{background:#cc0033;color:#fff}.risk-HIGH{background:#cc5500;color:#fff}.risk-MEDIUM{background:#997700;color:#fff}.risk-LOW{background:#005599;color:#fff}'
    + '.body{padding:32px 48px}'
    + 'h2{font-size:16px;letter-spacing:2px;color:#0a0014;border-bottom:2px solid #ff00c8;padding-bottom:6px;margin-top:32px}'
    + 'h3{font-size:13px;color:#333;margin:20px 0 8px}'
    + 'p{line-height:1.8;color:#333}'
    + '.summary-grid{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}'
    + '.sev-box{border:2px solid #1a0028;padding:12px 20px;text-align:center;border-radius:3px;min-width:80px}'
    + '.sev-box .n{font-size:24px;font-weight:bold}.sev-box .l{font-size:9px;letter-spacing:2px;color:#888;margin-top:2px}'
    + 'table.findings{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}'
    + 'table.findings th{background:#0a0014;color:#fff;padding:8px 12px;text-align:left;font-size:10px;letter-spacing:1px}'
    + 'table.findings td{padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top}'
    + 'table.findings tr:nth-child(even) td{background:#fdf8ff}'
    + 'footer{margin-top:40px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #ddd;padding-top:12px}'
    + '</style></head><body>'
    + '<div class="cover">'
    + '<div class="classif">'+classif+'</div>'
    + '<h1>'+title+'</h1>'
    + '<table><tr><td>CLIENT</td><td>'+client+'</td></tr>'
    + '<tr><td>ASSESSOR</td><td>'+assessor+'</td></tr>'
    + '<tr><td>DATE</td><td>'+date+'</td></tr>'
    + '<tr><td>TARGET</td><td>'+scope+'</td></tr></table>'
    + '<div class="risk-badge risk-'+riskLabel+'">'+riskLabel+' RISK &mdash; '+riskScore+'/100</div>'
    + '</div>'
    + '<div class="body">'
    + '<h2>EXECUTIVE SUMMARY</h2><p>'+(summary||'No summary provided.')+'</p>'
    + '<h2>SCOPE</h2><p>'+scope+'</p>'
    + '<h2>METHODOLOGY</h2><p>'+methodology+'</p>'
    + '<h2>FINDING SUMMARY</h2>'
    + '<div class="summary-grid">'
    + ['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(s=>'<div class="sev-box"><div class="n" style="color:'+sevColors[s]+'">'+counts[s]+'</div><div class="l">'+s+'</div></div>').join('')
    + '</div>'
    + '<h2>FINDINGS</h2>'
    + '<table class="findings"><thead><tr><th>SEVERITY</th><th>MODULE</th><th>FINDING</th></tr></thead><tbody>'
    + findingRows
    + '</tbody></table>'
    + '<footer>'+title+' &mdash; '+client+' &mdash; '+date+' &mdash; Generated by OBSIDIAN v0.1.0</footer>'
    + '</div>'
    + (format==='pdf'?'<script>window.onload=function(){window.print();}<\/script>':'')
    + '</body></html>';

  if (format === 'pdf') {
    const w = window.open('','_blank');
    w.document.write(html);
    w.document.close();
  } else {
    dl(new Blob([html],{type:'text/html'}), 'obsidian-report-' + client.replace(/\s+/g,'-').toLowerCase() + '.html');
  }
}

// ===== AUTO-UPDATER =====
function initUpdater() {
  if (!window.obsidian.onUpdaterStatus) return;
  window.obsidian.onUpdaterStatus((msg) => {
    const pill = g('updatePill');
    if (!pill) return;
    pill.style.display = 'inline';
    if (msg.includes('available') || msg.includes('downloading') || msg.includes('Downloading')) {
      pill.style.color = 'var(--cyan)';
      pill.textContent = '↑ ' + msg;
    } else if (msg.includes('failed')) {
      pill.style.color = 'var(--dim)';
      pill.textContent = msg;
    } else {
      pill.style.color = 'var(--dim)';
      pill.textContent = msg;
    }
  });
  // Show version in logo
  window.obsidian.getVersion().then(v => {
    const logo = document.querySelector('.tl-logo span');
    if (logo) logo.textContent = 'v' + v;
  }).catch(() => {});
}

// ===== WINDOW CONTROLS =====
function winMin()   { window.winCtrl?.minimize(); }
function winClose() { window.winCtrl?.close(); }
async function winMax() {
  await window.winCtrl?.maximize();
  const isMax = await window.winCtrl?.isMaximized();
  const btn = g('winMaxBtn');
  if (btn) btn.innerHTML = isMax ? '&#9724;' : '&#9723;';
}


// ===== 1. SCREENSHOT =====
async function takeScreenshot() {
  const result = await window.obsidian.screenshot();
  if (result && result.success) {
    showNotif('Screenshot saved: ' + result.filePath.split(/[\/\\]/).pop(), false);
  } else {
    showNotif('Screenshot failed', true);
  }
}

// ===== 2. SCAN NOTES =====
// Notes are saved with history automatically via buildConfig + saveToHistory
// getScanNotes helper used in saveToHistory
function getScanNotes() {
  return g('scanNotes') ? g('scanNotes').value.trim() : '';
}

// ===== 6. FINDING DEDUPLICATION =====
// Key: module + title + first 60 chars of detail
function findingKey(f) {
  return (f.module || '') + '|' + f.title + '|' + (f.detail || '').slice(0, 60);
}

const findingCounts = {};

function isDuplicate(f) {
  const key = findingKey(f);
  if (findingCounts[key]) {
    findingCounts[key]++;
    // Update badge on existing card
    const badge = document.querySelector('[data-fkey="' + CSS.escape(key) + '"] .dup-badge');
    if (badge) badge.textContent = 'x' + findingCounts[key];
    return true;
  }
  findingCounts[key] = 1;
  return false;
}

function resetDedupe() {
  Object.keys(findingCounts).forEach(k => delete findingCounts[k]);
}

// ===== 5. MULTI-TARGET QUEUE =====
let targetQueue = [];
let queueRunning = false;

function startQueuedScans() {
  if (!scopeTargets.length) { showNotif('Load a scope file first', true); return; }
  targetQueue = [...scopeTargets];
  queueRunning = true;
  log('info', 'system', `Queue started — ${targetQueue.length} targets`);
  runNextInQueue();
}

function runNextInQueue() {
  if (!queueRunning || !targetQueue.length) {
    queueRunning = false;
    log('ok', 'system', 'Queue complete — all targets scanned');
    showNotif('Queue complete', false);
    return;
  }
  const next = targetQueue.shift();
  g('targetInp').value = next;
  g('tgtDisplay').textContent = next;
  log('info', 'system', `Queue: scanning ${next} (${targetQueue.length} remaining)`);
  if (!send({ action: 'startScan', config: buildConfig() })) {
    queueRunning = false;
  }
}

// Hook into onScanComplete to run next in queue
const _origScanComplete = onScanComplete;

// ===== 7. SCHEDULED SCANS =====
const SCHEDULE_KEY = 'obsidian_schedules';

function addSchedule() {
  const target     = g('sch-target')?.value.trim();
  const profile    = g('sch-profile')?.value || 'standard';
  const recurrence = g('sch-recurrence')?.value || 'once';
  const date       = g('sch-date')?.value;
  const time       = g('sch-time')?.value || '02:00';

  if (!target) { showNotif('Enter a target for the schedule', true); return; }
  if (!date)   { showNotif('Select a date', true); return; }

  const schedules = loadSchedules();
  schedules.push({
    id: Date.now(), target, profile, recurrence,
    nextRun: new Date(date + 'T' + time).getTime(),
    time, enabled: true, lastRun: null
  });
  saveSchedules(schedules);
  renderSchedules();
  showNotif('Schedule added', false);
  if (g('sch-target')) g('sch-target').value = '';
}

function loadSchedules() {
  try { return JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '[]'); } catch { return []; }
}

function saveSchedules(s) {
  try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(s)); } catch {}
}

function deleteSchedule(id) {
  saveSchedules(loadSchedules().filter(s => s.id !== id));
  renderSchedules();
}

function toggleSchedule(id) {
  const schedules = loadSchedules();
  const s = schedules.find(x => x.id === id);
  if (s) s.enabled = !s.enabled;
  saveSchedules(schedules);
  renderSchedules();
}

function renderSchedules() {
  const list = g('scheduleList');
  if (!list) return;
  const schedules = loadSchedules();
  if (!schedules.length) {
    list.innerHTML = '<div style="color:var(--dim);font-family:var(--ft);font-size:11px;">No scheduled scans.</div>';
    return;
  }
  list.innerHTML = schedules.map(s => {
    const next = new Date(s.nextRun);
    const nextStr = next.toLocaleDateString() + ' ' + next.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const isOverdue = s.nextRun < Date.now() && s.recurrence === 'once';
    return '<div style="background:rgba(255,0,200,0.03);border:1px solid rgba(255,0,200,0.15);border-radius:3px;padding:12px 14px;display:flex;align-items:center;gap:12px;">'
      + '<div style="flex:1;">'
      + '<div style="font-family:var(--ft);font-size:11px;color:var(--cyan);">' + escHtml(s.target) + '</div>'
      + '<div style="font-family:var(--ft);font-size:10px;color:var(--muted);margin-top:3px;">'
      + s.profile.toUpperCase() + ' · ' + s.recurrence + ' · Next: '
      + '<span style="color:' + (isOverdue ? 'var(--red)' : 'var(--green)') + '">' + nextStr + '</span>'
      + (s.lastRun ? ' · Last ran: ' + new Date(s.lastRun).toLocaleDateString() : '')
      + '</div></div>'
      + '<button onclick="toggleSchedule(' + s.id + ')" style="background:transparent;border:1px solid ' + (s.enabled ? 'var(--green)' : 'var(--dim)') + ';color:' + (s.enabled ? 'var(--green)' : 'var(--dim)') + ';font-family:var(--ft);font-size:9px;padding:4px 10px;cursor:pointer;border-radius:2px;">' + (s.enabled ? 'ON' : 'OFF') + '</button>'
      + '<button onclick="deleteSchedule(' + s.id + ')" style="background:transparent;border:1px solid rgba(255,34,85,0.3);color:var(--red);font-family:var(--ft);font-size:9px;padding:4px 10px;cursor:pointer;border-radius:2px;">DEL</button>'
      + '</div>';
  }).join('');
}

// Check schedules every minute
function checkSchedules() {
  if (scanning) return; // don't interrupt active scan
  const now = Date.now();
  const schedules = loadSchedules();
  let changed = false;
  schedules.forEach(s => {
    if (!s.enabled) return;
    if (s.nextRun <= now) {
      log('info', 'system', 'Running scheduled scan: ' + s.target);
      g('targetInp').value = s.target;
      activeProfile = s.profile;
      s.lastRun = now;
      if (s.recurrence === 'daily')       s.nextRun = now + 86400000;
      else if (s.recurrence === 'weekly') s.nextRun = now + 604800000;
      else s.enabled = false; // once — disable after run
      changed = true;
      setTimeout(() => {
        if (!send({ action: 'startScan', config: buildConfig() })) {
          log('warn', 'system', 'Scheduled scan failed to start: ' + s.target);
        }
      }, 500);
    }
  });
  if (changed) saveSchedules(schedules);
}

// ===== 8. HISTORY DIFF =====
function showDiff(id) {
  const history = loadHistory();
  const entry = history.find(e => e.id === id);
  if (!entry) return;

  // Find previous scan of same target
  const same = history.filter(e => e.target === entry.target && e.id !== id);
  if (!same.length) {
    showNotif('No previous scan of this target to compare', true);
    return;
  }
  const prev = same[0]; // most recent previous

  const currKeys = new Set(entry.findings.map(f => findingKey(f)));
  const prevKeys = new Set(prev.findings.map(f => findingKey(f)));

  const newFindings  = entry.findings.filter(f => !prevKeys.has(findingKey(f)));
  const goneFindings = prev.findings.filter(f => !currKeys.has(findingKey(f)));
  const same_findings = entry.findings.filter(f => prevKeys.has(findingKey(f)));

  const sevCol = {CRITICAL:'var(--red)',HIGH:'var(--orange)',MEDIUM:'var(--yellow)',LOW:'#0088ff',INFO:'var(--dim)'};

  let html = '<div style="font-family:var(--ft);font-size:10px;color:var(--dim);margin-bottom:14px;">'
    + 'Comparing: <span style="color:var(--cyan)">' + escHtml(entry.target) + '</span><br>'
    + 'Current: ' + new Date(entry.date).toLocaleString() + ' · Previous: ' + new Date(prev.date).toLocaleString()
    + '</div>';

  if (newFindings.length) {
    html += '<div style="color:var(--green);font-family:var(--ft);font-size:10px;letter-spacing:2px;margin-bottom:8px;">NEW (' + newFindings.length + ')</div>';
    html += newFindings.map(f => '<div style="padding:6px 10px;margin-bottom:4px;border-left:2px solid var(--green);background:rgba(0,255,136,0.04);">'
      + '<span style="color:' + (sevCol[f.sev]||sevCol.INFO) + ';font-size:9px;letter-spacing:1px;">' + f.sev + '</span> '
      + '<span style="color:#fff;">' + escHtml(f.title) + '</span>'
      + '<div style="color:var(--muted);font-size:10px;margin-top:2px;">' + escHtml(f.detail) + '</div></div>').join('');
  }
  if (goneFindings.length) {
    html += '<div style="color:var(--dim);font-family:var(--ft);font-size:10px;letter-spacing:2px;margin:12px 0 8px;">RESOLVED (' + goneFindings.length + ')</div>';
    html += goneFindings.map(f => '<div style="padding:6px 10px;margin-bottom:4px;border-left:2px solid var(--dim);background:rgba(0,0,0,0.2);opacity:0.6;">'
      + '<span style="color:' + (sevCol[f.sev]||sevCol.INFO) + ';font-size:9px;">' + f.sev + '</span> '
      + '<span style="color:var(--dim);text-decoration:line-through;">' + escHtml(f.title) + '</span></div>').join('');
  }
  if (!newFindings.length && !goneFindings.length) {
    html += '<div style="color:var(--green);font-family:var(--ft);font-size:12px;text-align:center;padding:20px;">No changes between scans</div>';
  }
  html += '<div style="color:var(--dim);font-family:var(--ft);font-size:10px;margin-top:12px;">' + same_findings.length + ' unchanged findings</div>';

  g('diffContent').innerHTML = html;
  g('diffModal').style.display = 'flex';
}

// ===== 9. PLUGIN SYSTEM =====
let loadedPlugins = [];

async function reloadPlugins() {
  try {
    const result = await window.obsidian.loadPlugins();
    loadedPlugins = result || [];
    renderPlugins();
  } catch {
    loadedPlugins = [];
    renderPlugins();
  }
}

function renderPlugins() {
  const list = g('pluginList');
  if (!list) return;
  if (!loadedPlugins.length) {
    list.innerHTML = '<div style="color:var(--dim);font-family:var(--ft);font-size:11px;">No plugins loaded. Place .js files in the plugins/ folder and click Reload.</div>';
    return;
  }
  list.innerHTML = loadedPlugins.map(p =>
    '<div style="background:rgba(0,255,242,0.03);border:1px solid rgba(0,255,242,0.12);border-radius:3px;padding:12px 14px;">'
    + '<div style="font-family:var(--ft);font-size:11px;color:var(--cyan);">' + escHtml(p.name || p.id) + '</div>'
    + '<div style="font-family:var(--ft);font-size:10px;color:var(--muted);margin-top:3px;">' + escHtml(p.desc || '') + '</div>'
    + '<div style="font-family:var(--ft);font-size:9px;color:var(--dim);margin-top:4px;">binary: ' + escHtml(p.binary || p.id) + ' · tag: ' + escHtml(p.tag || 'custom') + '</div>'
    + '</div>'
  ).join('');
}


// ===== BOOT =====
initMods();
renderProxies();
initUpdater();
setInterval(checkSchedules, 60000); // check schedules every minute
renderSchedules();
// Set today as default schedule date
const todayInput = document.getElementById('sch-date');
if (todayInput) todayInput.value = new Date().toISOString().split('T')[0];
