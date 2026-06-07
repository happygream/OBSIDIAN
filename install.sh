#!/usr/bin/env bash
# OBSIDIAN — Tool installer
# Supports: Debian/Ubuntu, Fedora/RHEL, Arch, macOS (Homebrew)
# LEGAL: Only use OBSIDIAN against systems you own or have written permission to test.

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[OBSIDIAN]${NC} $1"; }
ok()   { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[!!]${NC} $1"; }

# Detect OS/package manager
detect_pm() {
  if command -v apt-get &>/dev/null; then echo "apt"
  elif command -v dnf &>/dev/null;   then echo "dnf"
  elif command -v yum &>/dev/null;   then echo "yum"
  elif command -v pacman &>/dev/null; then echo "pacman"
  elif command -v brew &>/dev/null;  then echo "brew"
  else echo "unknown"; fi
}

PM=$(detect_pm)
log "Detected package manager: $PM"

install_pkg() {
  local pkg="$1"
  case "$PM" in
    apt)    sudo apt-get install -y "$pkg" ;;
    dnf)    sudo dnf install -y "$pkg" ;;
    yum)    sudo yum install -y "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    brew)   brew install "$pkg" ;;
    *)      err "Cannot auto-install $pkg — please install manually"; return 1 ;;
  esac
}

chk_install() {
  local binary="$1"
  local pkg="${2:-$1}"
  if command -v "$binary" &>/dev/null; then
    ok "$binary already installed"
  else
    warn "$binary not found — installing..."
    install_pkg "$pkg" && ok "$binary installed" || err "Failed to install $binary"
  fi
}

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       OBSIDIAN — TOOL INSTALLER      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
warn "This tool is for authorised security testing only."
warn "Only run against systems you own or have permission to test."
echo ""

# Core system tools
log "Installing core tools..."
if [ "$PM" = "apt" ]; then
  sudo apt-get update -qq
fi

chk_install nmap
chk_install nikto
chk_install hydra
chk_install whatweb
chk_install sqlmap
chk_install proxychains4 proxychains4
chk_install curl
chk_install wget

# masscan
if command -v masscan &>/dev/null; then
  ok "masscan already installed"
else
  warn "masscan not found — installing..."
  case "$PM" in
    apt) sudo apt-get install -y masscan ;;
    brew) brew install masscan ;;
    *) warn "Install masscan manually: https://github.com/robertdavidgraham/masscan" ;;
  esac
fi

# ffuf
if command -v ffuf &>/dev/null; then
  ok "ffuf already installed"
else
  warn "ffuf not found — installing..."
  case "$PM" in
    apt) sudo apt-get install -y ffuf 2>/dev/null || go install github.com/ffuf/ffuf/v2@latest ;;
    brew) brew install ffuf ;;
    *) go install github.com/ffuf/ffuf/v2@latest ;;
  esac
fi

# amass
if command -v amass &>/dev/null; then
  ok "amass already installed"
else
  warn "amass not found — installing..."
  case "$PM" in
    apt) sudo apt-get install -y amass 2>/dev/null || go install github.com/owasp-amass/amass/v4/...@latest ;;
    brew) brew install amass ;;
    *) go install github.com/owasp-amass/amass/v4/...@latest ;;
  esac
fi

# testssl.sh
if command -v testssl.sh &>/dev/null; then
  ok "testssl.sh already installed"
else
  warn "testssl.sh not found — installing..."
  case "$PM" in
    apt) sudo apt-get install -y testssl.sh 2>/dev/null ;;
    brew) brew install testssl ;;
    *)
      sudo git clone --depth 1 https://github.com/drwetter/testssl.sh.git /opt/testssl.sh 2>/dev/null
      sudo ln -sf /opt/testssl.sh/testssl.sh /usr/local/bin/testssl.sh
      ;;
  esac
fi

# wapiti
if command -v wapiti3 &>/dev/null; then
  ok "wapiti3 already installed"
else
  warn "wapiti3 not found — installing via pip..."
  pip3 install wapiti3 && ok "wapiti3 installed" || err "pip3 install wapiti3 failed"
fi

# Go-based tools (nuclei, subfinder) — require Go
if command -v go &>/dev/null; then
  log "Go detected — installing nuclei and subfinder..."

  if command -v nuclei &>/dev/null; then
    ok "nuclei already installed"
  else
    warn "nuclei not found — installing..."
    go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && ok "nuclei installed"
    # Pull latest templates
    nuclei -update-templates -silent && ok "nuclei templates updated"
  fi

  if command -v subfinder &>/dev/null; then
    ok "subfinder already installed"
  else
    warn "subfinder not found — installing..."
    go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest && ok "subfinder installed"
  fi
else
  warn "Go not found — nuclei and subfinder require Go"
  warn "Install Go from https://go.dev/dl/ then re-run this script"
fi

# wordlists
log "Checking wordlists..."
if [ -d /usr/share/wordlists ]; then
  ok "wordlists directory found"
  if [ ! -f /usr/share/wordlists/rockyou.txt ]; then
    warn "rockyou.txt not found"
    if [ "$PM" = "apt" ]; then
      sudo apt-get install -y wordlists 2>/dev/null
      [ -f /usr/share/wordlists/rockyou.txt.gz ] && sudo gzip -d /usr/share/wordlists/rockyou.txt.gz
    fi
  else
    ok "rockyou.txt present"
  fi
else
  warn "No wordlists directory — install wordlists package or provide your own"
fi

# Node.js dependencies for Electron
log "Installing Node.js dependencies..."
if command -v npm &>/dev/null; then
  npm install && ok "Node dependencies installed"
else
  err "npm not found — install Node.js from https://nodejs.org"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       INSTALLATION COMPLETE          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
log "Run OBSIDIAN with: npm start"
echo ""
