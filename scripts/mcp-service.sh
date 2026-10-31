#!/usr/bin/env bash
# Orchestra MCP Hub Service Manager
# Runs the Streamable-HTTP MCP server (docs/context/knowledge + chat threads +
# master prompts) as a managed background service, with an optional Cloudflare
# tunnel for remote ChatGPT/Gemini connectors.
# Subcommands: install|start|stop|restart|status|logs|uninstall|tunnel|enable-autostart|disable-autostart

set -euo pipefail

RUNTIME_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/orchestra-mcp"
LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/log}/orchestra-mcp"
PID_FILE="$RUNTIME_DIR/mcp.pid"
PORT_FILE="$RUNTIME_DIR/mcp.port"
HOST_FILE="$RUNTIME_DIR/mcp.host"
LOG_FILE="$LOG_DIR/mcp.log"
TUNNEL_PID_FILE="$RUNTIME_DIR/tunnel.pid"
TUNNEL_LOG_FILE="$LOG_DIR/tunnel.log"

REPO_ROOT="${PCORE_ORCHESTRA_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVER_JS="$REPO_ROOT/scripts/mcp-knowledge-server.js"
DEFAULT_PORT=8765
DEFAULT_HOST="127.0.0.1"
UNIT_NAME="orchestra-mcp"
PLIST_NAME="org.pcore.orchestra-mcp"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

usage() {
  cat <<EOF
Usage: mcp-service.sh <command> [options]

Commands:
  install             Install the service (systemd/launchd/nohup)
  start               Start the MCP HTTP server
  stop                Stop the service
  restart             Restart the service
  status              Check status (exit 0 = running + healthy)
  logs                Show/follow server logs
  tunnel              Start (or report) a Cloudflare tunnel to the local port
  uninstall           Remove the service and clean up
  enable-autostart    Start on login/boot (systemd/launchd)
  disable-autostart   Disable autostart

Options:
  --port N            Port (default: $DEFAULT_PORT)
  --host ADDR         Bind address (default: $DEFAULT_HOST)
  --expose            Bind 0.0.0.0 — REQUIRES a bearer token
  --root PATH         Project root served by the knowledge tools (PCORE_MCP_ROOT)
  --token SECRET      Bearer token (or set PCORE_MCP_TOKEN); never put it on a URL
  --dry-run           Print actions without executing
  --backend B         auto|systemd|launchd|nohup (default: auto)
  --help              Show this help

Security:
  A non-loopback bind is refused without a token — the read tools serve project
  files. Prefer staying on loopback and exposing via 'tunnel' (cloudflared) so
  only the connector with your bearer token can reach it.
EOF
}

# --- state helpers ---
ensure_dirs() { mkdir -p "$RUNTIME_DIR" "$LOG_DIR"; }
read_or() { local f="$1" d="$2"; [[ -f "$f" ]] && cat "$f" || echo "$d"; }
write_file() { echo "$2" > "$1"; }
read_port() { read_or "$PORT_FILE" "$DEFAULT_PORT"; }
read_host() { read_or "$HOST_FILE" "$DEFAULT_HOST"; }
read_pid() { read_or "$PID_FILE" ""; }
is_pid_running() { local pid="$1"; [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; }

is_loopback() { [[ "$1" == "127.0.0.1" || "$1" == "localhost" || "$1" == "::1" ]]; }

detect_backend() {
  if [[ "${ORCHESTRA_MCP_BACKEND:-auto}" != "auto" ]]; then echo "$ORCHESTRA_MCP_BACKEND"; return; fi
  if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
    echo "systemd"
  elif [[ "$(uname)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    echo "launchd"
  else
    echo "nohup"
  fi
}

# --- token/root resolution (env wins, CLI overrides) ---
effective_token() { echo "${MCP_TOKEN_ARG:-${PCORE_MCP_TOKEN:-}}"; }
effective_root() { echo "${MCP_ROOT_ARG:-${PCORE_MCP_ROOT:-$PWD}}"; }

# --- health probe (MCP server serves GET /health) ---
probe_health() {
  local host="$1" port="$2"
  local probe_host="127.0.0.1"
  is_loopback "$host" || probe_host="127.0.0.1"
  if command -v curl >/dev/null 2>&1; then
    curl -sf "http://${probe_host}:${port}/health" >/dev/null 2>&1
  else
    node -e "
      const http = require('http');
      const req = http.get('http://${probe_host}:${port}/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1));
      req.on('error', () => process.exit(1));
      req.setTimeout(5000, () => { req.destroy(); process.exit(1); });
    "
  fi
}

# --- systemd ---
systemd_unit_path() { echo "$HOME/.config/systemd/user/${UNIT_NAME}.service"; }

systemd_render_unit() {
  local port="$1" host="$2" dry="${3:-false}"
  local unit; unit="$(systemd_unit_path)"
  if [[ "$dry" == "true" ]]; then log_info "Would write systemd unit to $unit"; return; fi
  mkdir -p "$(dirname "$unit")"
  local env_block="Environment=PCORE_MCP_ROOT=$(effective_root)"
  local tok; tok="$(effective_token)"
  [[ -n "$tok" ]] && env_block="${env_block}"$'\n'"Environment=PCORE_MCP_TOKEN=${tok}"
  cat > "$unit" <<EOF
[Unit]
Description=Orchestra MCP Hub (Streamable HTTP)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node ${SERVER_JS} --port ${port} --host ${host}
${env_block}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  chmod 600 "$unit"
  systemctl --user daemon-reload
}

systemd_start() { systemctl --user start "$UNIT_NAME"; }
systemd_stop() { systemctl --user stop "$UNIT_NAME"; }
systemd_status() { systemctl --user is-active "$UNIT_NAME" >/dev/null 2>&1; }
systemd_enable() { systemctl --user enable "$UNIT_NAME"; }
systemd_disable() { systemctl --user disable "$UNIT_NAME"; }
systemd_logs() { journalctl --user -u "$UNIT_NAME" -n 200 -f; }
systemd_uninstall() {
  systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
  systemctl --user disable "$UNIT_NAME" 2>/dev/null || true
  rm -f "$(systemd_unit_path)"
  systemctl --user daemon-reload
}

# --- launchd ---
launchd_plist_path() { echo "$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"; }

launchd_render_plist() {
  local port="$1" host="$2" dry="${3:-false}"
  local plist; plist="$(launchd_plist_path)"
  if [[ "$dry" == "true" ]]; then log_info "Would write launchd plist to $plist"; return; fi
  mkdir -p "$(dirname "$plist")"
  local tok; tok="$(effective_token)"
  local tokendict=""
  [[ -n "$tok" ]] && tokendict="    <key>PCORE_MCP_TOKEN</key><string>${tok}</string>"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${SERVER_JS}</string>
    <string>--port</string><string>${port}</string>
    <string>--host</string><string>${host}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PCORE_MCP_ROOT</key><string>$(effective_root)</string>
    ${tokendict}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
EOF
  chmod 600 "$plist"
}

launchd_start() {
  local plist; plist="$(launchd_plist_path)"
  launchctl load "$plist" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$plist"
}
launchd_stop() {
  local plist; plist="$(launchd_plist_path)"
  launchctl unload "$plist" 2>/dev/null || launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
}
launchd_status() { [[ -f "$(launchd_plist_path)" ]] && launchctl list | grep -q "$PLIST_NAME"; }
launchd_uninstall() { launchd_stop; rm -f "$(launchd_plist_path)"; }

# --- nohup ---
nohup_start() {
  local port="$1" host="$2" dry="${3:-false}"
  ensure_dirs
  local -a envkv=("PCORE_MCP_ROOT=$(effective_root)")
  local tok; tok="$(effective_token)"
  [[ -n "$tok" ]] && envkv+=("PCORE_MCP_TOKEN=$tok")
  if [[ "$dry" == "true" ]]; then
    log_info "Would start: env ${envkv[*]} node ${SERVER_JS} --port ${port} --host ${host} >> ${LOG_FILE} 2>&1 &"
    return
  fi
  nohup env "${envkv[@]}" node "$SERVER_JS" --port "$port" --host "$host" >> "$LOG_FILE" 2>&1 &
  local pid=$!
  sleep 0.5
  if is_pid_running "$pid"; then write_file "$PID_FILE" "$pid"; log_ok "Started nohup PID $pid on ${host}:${port}"; else
    log_err "Server died immediately — see $LOG_FILE"; return 1; fi
}
nohup_stop() {
  local pid; pid="$(read_pid)"
  if is_pid_running "$pid"; then
    kill "$pid" 2>/dev/null || true
    local c=0
    while is_pid_running "$pid" && [[ $c -lt 50 ]]; do sleep 0.2; ((c++)) || true; done
    is_pid_running "$pid" && { kill -9 "$pid" 2>/dev/null || true; log_warn "Force killed PID $pid"; }
    log_ok "Stopped PID $pid"
  else
    log_warn "Process not running (stale pidfile)"
  fi
  rm -f "$PID_FILE"
}
nohup_status() { is_pid_running "$(read_pid)"; }
tail_logs() { tail -n 200 -f "$LOG_FILE" 2>/dev/null || log_warn "Log file not found: $LOG_FILE"; }

# --- guard: non-loopback needs a token ---
check_bind_policy() {
  local host="$1"
  if ! is_loopback "$host" && [[ -z "$(effective_token)" ]]; then
    log_err "Refusing to bind $host without a bearer token (set --token or PCORE_MCP_TOKEN)."
    log_err "Stay on loopback and use '$0 tunnel' to expose it instead."
    return 1
  fi
  return 0
}

# --- commands ---
cmd_install() {
  local port="$1" host="$2" dry="${3:-false}"
  local backend; backend="$(detect_backend)"
  check_bind_policy "$host" || return 1
  log_info "Installing Orchestra MCP service (backend: $backend, ${host}:${port})"
  ensure_dirs
  write_file "$PORT_FILE" "$port"
  write_file "$HOST_FILE" "$host"
  case "$backend" in
    systemd) systemd_render_unit "$port" "$host" "$dry" ;;
    launchd) launchd_render_plist "$port" "$host" "$dry" ;;
    nohup) log_info "nohup backend: no unit file needed" ;;
    *) log_err "Unknown backend: $backend"; return 1 ;;
  esac
  if [[ "$dry" == "false" ]]; then
    log_ok "Installed. Run 'mcp-service.sh start' to launch."
  fi
}

cmd_start() {
  local port host backend
  port="$(read_port)"; host="$(read_host)"; backend="$(detect_backend)"
  check_bind_policy "$host" || return 1
  if cmd_status quiet; then log_warn "Already running on ${host}:${port}"; return 0; fi
  log_info "Starting Orchestra MCP on ${host}:${port} (backend: $backend)"
  case "$backend" in
    systemd) systemd_start ;;
    launchd) launchd_start ;;
    nohup) nohup_start "$port" "$host" ;;
    *) log_err "Unknown backend: $backend"; return 1 ;;
  esac
  local c=0
  while [[ $c -lt 30 ]]; do
    if probe_health "$host" "$port"; then
      log_ok "MCP hub healthy → http://${host}:${port}/mcp  (root=$(effective_root))"
      [[ "$(effective_token)" ]] && log_info "Bearer auth enabled. Register the URL with a Bearer header."
      return 0
    fi
    sleep 0.5; ((c++)) || true
  done
  log_err "Health probe failed after 15s — see $LOG_FILE"
  return 1
}

cmd_stop() {
  local backend; backend="$(detect_backend)"
  log_info "Stopping Orchestra MCP (backend: $backend)"
  case "$backend" in
    systemd) systemd_stop ;;
    launchd) launchd_stop ;;
    nohup) nohup_stop ;;
  esac
  stop_tunnel || true
  log_ok "Stopped"
}

cmd_restart() { cmd_stop; sleep 1; cmd_start; }

cmd_status() {
  local quiet="${1:-}" port host backend running=false
  port="$(read_port)"; host="$(read_host)"; backend="$(detect_backend)"
  case "$backend" in
    systemd) systemd_status && running=true ;;
    launchd) launchd_status && running=true ;;
    nohup) nohup_status && running=true ;;
  esac
  if [[ "$running" == "true" ]]; then
    if probe_health "$host" "$port"; then
      [[ -z "$quiet" ]] && log_ok "Running on http://${host}:${port}/mcp (healthy)"
      return 0
    else
      [[ -z "$quiet" ]] && log_warn "Process running but health probe failed on ${host}:${port}"
      return 1
    fi
  else
    if [[ -z "$quiet" ]]; then
      [[ -n "$(read_pid)" ]] && log_warn "Not running (stale pidfile)" || log_info "Not running"
    fi
    return 1
  fi
}

cmd_logs() {
  local backend; backend="$(detect_backend)"
  case "$backend" in
    systemd) systemd_logs ;;
    *) tail_logs ;;
  esac
}

cmd_uninstall() {
  local backend; backend="$(detect_backend)"
  log_info "Uninstalling Orchestra MCP (backend: $backend)"
  cmd_stop || true
  case "$backend" in
    systemd) systemd_uninstall ;;
    launchd) launchd_uninstall ;;
    nohup) log_info "nohup backend: no unit file to remove" ;;
  esac
  rm -rf "$RUNTIME_DIR" "$LOG_DIR"
  log_ok "Uninstalled"
}

cmd_enable_autostart() {
  local backend; backend="$(detect_backend)"
  log_info "Enabling autostart (backend: $backend)"
  case "$backend" in
    systemd) systemd_enable; log_ok "Autostart enabled (run 'loginctl enable-linger \$USER' to persist across logins)." ;;
    launchd) log_ok "Autostart enabled via launchd (RunAtLoad=true)." ;;
    nohup) log_warn "nohup backend: no autostart. Use systemd or launchd."; return 1 ;;
  esac
}

cmd_disable_autostart() {
  local backend; backend="$(detect_backend)"
  log_info "Disabling autostart (backend: $backend)"
  case "$backend" in
    systemd) systemd_disable; log_ok "Autostart disabled." ;;
    launchd) log_warn "launchd: autostart disabled by uninstalling." ;;
    nohup) log_info "nohup backend: no autostart to disable." ;;
  esac
}

# --- tunnel (best-effort cloudflared quick tunnel) ---
start_tunnel() {
  local port="$1"
  if ! command -v cloudflared >/dev/null 2>&1; then
    log_err "cloudflared not found. Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) or expose the port another way."
    log_info "Manual: cloudflared tunnel --url http://localhost:${port}"
    return 127
  fi
  ensure_dirs
  if is_pid_running "$(read_or "$TUNNEL_PID_FILE" "")"; then
    log_warn "Tunnel already running (PID $(cat "$TUNNEL_PID_FILE"))"
    return 0
  fi
  nohup cloudflared tunnel --url "http://localhost:${port}" > "$TUNNEL_LOG_FILE" 2>&1 &
  local pid=$!
  write_file "$TUNNEL_PID_FILE" "$pid"
  log_ok "Tunnel starting (PID $pid). Watch $TUNNEL_LOG_FILE for the https://<...>.trycloudflare.com/mcp URL, then register it with your connector."
}

stop_tunnel() {
  local pid; pid="$(read_or "$TUNNEL_PID_FILE" "")"
  if is_pid_running "$pid"; then kill "$pid" 2>/dev/null || true; log_ok "Tunnel stopped (PID $pid)"; fi
  rm -f "$TUNNEL_PID_FILE"
}

cmd_tunnel() {
  local port="$1"
  if ! is_loopback "$(read_host)" && [[ -z "$(effective_token)" ]]; then check_bind_policy "$(read_host)" || return 1; fi
  if [[ "$TUNNEL_STOP" == "true" ]]; then stop_tunnel; return; fi
  start_tunnel "$port"
}

# --- main ---
TUNNEL_STOP=false
main() {
  local cmd="" port="$DEFAULT_PORT" host="$DEFAULT_HOST" dry="false" backend="auto"
  local args=()
  MCP_TOKEN_ARG=""
  MCP_ROOT_ARG=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port) port="$2"; shift 2 ;;
      --host) host="$2"; shift 2 ;;
      --expose) host="0.0.0.0"; shift ;;
      --root) MCP_ROOT_ARG="$2"; shift 2 ;;
      --token) MCP_TOKEN_ARG="$2"; shift 2 ;;
      --dry-run) dry="true"; shift ;;
      --backend) backend="$2"; export ORCHESTRA_MCP_BACKEND="$backend"; shift 2 ;;
      --stop) TUNNEL_STOP=true; shift ;;
      --help|-h) usage; exit 0 ;;
      *) args+=("$1"); shift ;;
    esac
  done
  cmd="${args[0]:-}"
  [[ -z "$cmd" ]] && { usage; exit 1; }

  # persist chosen host/port on install so start/status read the same values
  case "$cmd" in
    install) cmd_install "$port" "$host" "$dry" ;;
    start) ensure_dirs; write_file "$PORT_FILE" "$port"; write_file "$HOST_FILE" "$host"; cmd_start ;;
    stop) cmd_stop ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    uninstall) cmd_uninstall ;;
    tunnel) cmd_tunnel "$(read_port)" ;;
    enable-autostart) cmd_enable_autostart ;;
    disable-autostart) cmd_disable_autostart ;;
    *) log_err "Unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
