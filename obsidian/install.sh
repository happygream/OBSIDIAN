#!/usr/bin/env bash
# OBSIDIAN — Auto-installer
# Runs automatically on first launch. Safe to re-run.

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[OBSIDIAN]${NC} $1"; }
ok()   { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[!!]${NC} $1"; }

# Package manager detection
if command -v apt-get &>/dev/null;   then PM="apt"
elif command -v dnf &>/dev/null;     then PM="dnf"
elif command -v pacman &>/dev/null;  then PM="pacman"
elif command -v brew &>/dev/null;    then PM="brew"
else PM="unknown"; fi

log "Package manager: $PM"
log "Installing OBSIDIAN tools..."

# Update package list once
if [ "$PM" = "apt" ]; then
  sudo apt-get update -qq 2>/dev/null || true
fi

# Install a package if not already present
install_if_missing() {
  local binary="$1"
  local pkg="${2:-$1}"
  if command -v "$binary" &>/dev/null; then
    ok "$binary already installed"
    return 0
  fi
  warn "Installing $binary..."
  case "$PM" in
    apt)    sudo apt-get install -y "$pkg" 2>/dev/null && ok "$binary installed" || err "Failed: $binary" ;;
    dnf)    sudo dnf install -y "$pkg" 2>/dev/null && ok "$binary installed" || err "Failed: $binary" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" 2>/dev/null && ok "$binary installed" || err "Failed: $binary" ;;
    brew)   brew install "$pkg" 2>/dev/null && ok "$binary installed" || err "Failed: $binary" ;;
    *)      err "Cannot auto-install $binary — install manually" ;;
  esac
}

# pip install with Ubuntu 24 compatibility
pip_install() {
  local pkg="$1"
  local binary="${2:-$1}"
  if command -v "$binary" &>/dev/null; then ok "$binary already installed"; return 0; fi
  warn "Installing $binary via pip..."
  pip3 install "$pkg" --break-system-packages 2>/dev/null \
    || pip3 install "$pkg" 2>/dev/null \
    || pipx install "$pkg" 2>/dev/null \
    || { err "pip install failed for $pkg"; return 1; }
  # Symlink to /usr/local/bin so it's in PATH
  for b in "$binary" "${binary}3"; do
    [ -f "$HOME/.local/bin/$b" ] && sudo ln -sf "$HOME/.local/bin/$b" "/usr/local/bin/$b" 2>/dev/null || true
  done
  command -v "$binary" &>/dev/null && ok "$binary installed" || err "$binary installed but not in PATH"
}

# go install
go_install() {
  local pkg="$1"
  local binary="$2"
  if command -v "$binary" &>/dev/null; then ok "$binary already installed"; return 0; fi
  if ! command -v go &>/dev/null; then warn "Go not found — skipping $binary"; return 1; fi
  warn "Installing $binary via go..."
  go install "$pkg" 2>/dev/null \
    && sudo ln -sf "$(go env GOPATH)/bin/$binary" "/usr/local/bin/$binary" 2>/dev/null \
    && ok "$binary installed" || err "go install failed for $binary"
}

# ---- Core tools ----
install_if_missing nmap
install_if_missing nikto
install_if_missing masscan
install_if_missing hydra
install_if_missing whatweb
install_if_missing sqlmap
install_if_missing proxychains4
install_if_missing curl
install_if_missing ffuf

# ---- TLS ----
install_if_missing testssl.sh testssl.sh
install_if_missing sslscan

# ---- Web ----
install_if_missing rustscan
install_if_missing wpscan
install_if_missing gobuster
install_if_missing feroxbuster
install_if_missing wapiti3 wapiti3
install_if_missing nikto

# ---- Recon ----
install_if_missing amass
install_if_missing dnsrecon
install_if_missing nbtscan
install_if_missing snmpwalk snmp
install_if_missing theHarvester theharvester
install_if_missing enum4linux

# ---- Auth ----
install_if_missing medusa
install_if_missing crackmapexec

# ---- Go tools ----
go_install "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest" nuclei
go_install "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest" subfinder
go_install "github.com/OJ/gobuster/v3@latest" gobuster

# ---- Pip tools ----
install_if_missing python3-pip python3-pip
pip_install arjun arjun
pip_install shodan shodan
pip_install wapiti3 wapiti3
pip_install dnsrecon dnsrecon

# ---- Nuclei templates ----
if command -v nuclei &>/dev/null; then
  log "Updating nuclei templates..."
  nuclei -update-templates -silent 2>/dev/null && ok "Nuclei templates updated" || warn "Nuclei template update failed"
fi

# ---- Wordlists ----
if [ ! -f /usr/share/wordlists/rockyou.txt ]; then
  warn "rockyou.txt not found — installing wordlists..."
  sudo apt-get install -y wordlists 2>/dev/null || true
  [ -f /usr/share/wordlists/rockyou.txt.gz ] && sudo gzip -d /usr/share/wordlists/rockyou.txt.gz 2>/dev/null || true
fi

# ---- Node deps ----
if command -v npm &>/dev/null; then
  log "Installing Node.js dependencies..."
  cd "$(dirname "$0")" && npm install --silent && ok "Node deps installed"
fi

echo ""
echo -e "${GREEN}[OBSIDIAN] Installation complete.${NC}"
echo -e "${CYAN}Run with: npm start${NC}"
