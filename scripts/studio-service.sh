#!/usr/bin/env bash
# Orchestra Studio v2 Service Manager
# Subcommands: install|start|stop|restart|status|logs|uninstall|enable-autostart|disable-autostart

set -euo pipefail

# Config
RUNTIME_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/orchestra-studio"
LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/log}/orchestra-studio"
PID_FILE="$RUNTIME_DIR/studio.pid"
PORT_FILE="$RUNTIME_DIR/studio.port"
LOG_FILE="$LOG_DIR/studio.log"
# Repo root = parent of this script (override with PCORE_ORCHESTRA_REPO).
REPO_ROOT="${PCORE_ORCHESTRA_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEFAULT_PORT=3110
UNIT_NAME="orchestra-studio"
PLIST_NAME="org.pcore.orchestra-studio"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err() { echo -e "${RED}[ERR]${NC} $*" >&2; }

usage() {
  cat <<EOF
Usage: studio-service.sh <command> [options]

Commands:
  install               Install service (systemd/launchd/nohup)
  start                 Start the service
  stop                  Stop the service
  restart               Restart the service
  status                Check service status (exit 0=running+healthy, 1=not running)
  logs                  Show/follow logs
  uninstall             Remove service and cleanup
  enable-autostart      Enable autostart on login
  disable-autostart     Disable autostart on login

Options:
  --port N              Port to run on (default: 3110)
  --dry-run             Print actions without executing
  --backend B           Backend: auto|systemd|launchd|nohup (default: auto)
  --help                Show this help

Environment:
  PCORE_ORCHESTRA_REPO  Override repo root (default: /home/user/Documents/Project/pcore/pcore-orchestra)
  ORCHESTRA_STUDIO_BACKEND  Force backend: systemd|launchd|nohup
EOF
}

# --- Helpers ---
ensure_dirs() {
  mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
}

read_port() {
  [[ -f "$PORT_FILE" ]] && cat "$PORT_FILE" || echo "$DEFAULT_PORT"
}

write_port() {
  echo "$1" > "$PORT_FILE"
}

read_pid() {
  [[ -f "$PID_FILE" ]] && cat "$PID_FILE" || echo ""
}

write_pid() {
  echo "$1" > "$PID_FILE"
}

clear_pid() {
  rm -f "$PID_FILE"
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# --- Backend detection ---
detect_backend() {
  if [[ "${ORCHESTRA_STUDIO_BACKEND:-auto}" != "auto" ]]; then
    echo "$ORCHESTRA_STUDIO_BACKEND"
    return
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
    echo "systemd"
  elif [[ "$(uname)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    echo "launchd"
  else
    echo "nohup"
  fi
}

# --- Systemd ---
systemd_unit_path() {
  echo "$HOME/.config/systemd/user/${UNIT_NAME}.service"
}

systemd_render_unit() {
  local port="$1"
  local dry_run="${2:-false}"
  local unit_file
  unit_file=$(systemd_unit_path)
  mkdir -p "$(dirname "$unit_file")"
  if [[ "$dry_run" == "true" ]]; then
    log_info "Would write systemd unit to $unit_file"
    return
  fi
  sed -e "s|@REPO_ROOT@|$REPO_ROOT|g" -e "s|@PORT@|$port|g" \
    "$REPO_ROOT/scripts/systemd/${UNIT_NAME}.service" > "$unit_file"
  systemctl --user daemon-reload
}

systemd_start() {
  systemctl --user start "$UNIT_NAME"
}

systemd_stop() {
  systemctl --user stop "$UNIT_NAME"
}

systemd_status() {
  systemctl --user is-active "$UNIT_NAME" >/dev/null 2>&1
}

systemd_enable() {
  systemctl --user enable "$UNIT_NAME"
}

systemd_disable() {
  systemctl --user disable "$UNIT_NAME"
}

systemd_logs() {
  journalctl --user -u "$UNIT_NAME" -n 200 -f
}

systemd_uninstall() {
  systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
  systemctl --user disable "$UNIT_NAME" 2>/dev/null || true
  rm -f "$(systemd_unit_path)"
  systemctl --user daemon-reload
}

# --- Launchd ---
launchd_plist_path() {
  echo "$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
}

launchd_render_plist() {
  local port="$1"
  local dry_run="${2:-false}"
  local plist_file
  plist_file=$(launchd_plist_path)
  mkdir -p "$(dirname "$plist_file")"
  if [[ "$dry_run" == "true" ]]; then
    log_info "Would write launchd plist to $plist_file"
    return
  fi
  sed -e "s|@REPO_ROOT@|$REPO_ROOT|g" -e "s|@PORT@|$port|g" -e "s|@LOG_DIR@|$LOG_DIR|g" \
    "$REPO_ROOT/scripts/launchd/${PLIST_NAME}.plist" > "$plist_file"
}

launchd_start() {
  local plist_file
  plist_file=$(launchd_plist_path)
  launchctl load "$plist_file" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$plist_file"
}

launchd_stop() {
  local plist_file
  plist_file=$(launchd_plist_path)
  launchctl unload "$plist_file" 2>/dev/null || launchctl bootout "gui/$(id -u)" "$plist_file" 2>/dev/null || true
}

launchd_status() {
  local plist_file
  plist_file=$(launchd_plist_path)
  [[ -f "$plist_file" ]] && launchctl list | grep -q "$PLIST_NAME"
}

launchd_enable() {
  log_info "launchd autostart is enabled via RunAtLoad in plist"
}

launchd_disable() {
  log_warn "launchd autostart disabled by removing plist (use uninstall)"
}

launchd_logs() {
  tail -n 200 -f "$LOG_FILE" 2>/dev/null || log_warn "Log file not found: $LOG_FILE"
}

launchd_uninstall() {
  launchd_stop
  rm -f "$(launchd_plist_path)"
}

# --- Nohup ---
nohup_start() {
  local port="$1"
  local dry_run="${2:-false}"
  ensure_dirs
  if [[ "$dry_run" == "true" ]]; then
    log_info "Would start: nohup node $REPO_ROOT/server/studio-api.js --port $port >> $LOG_FILE 2>&1 &"
    return
  fi
  # Start server in background, capture PID properly
  nohup node "$REPO_ROOT/server/studio-api.js" --port "$port" >> "$LOG_FILE" 2>&1 &
  local pid=$!
  # Verify process started
  sleep 0.5
  if is_pid_running "$pid"; then
    write_pid "$pid"
    log_ok "Started nohup process PID $pid on port $port"
  else
    log_err "Failed to start server (process died immediately)"
    return 1
  fi
}

nohup_stop() {
  local pid
  pid=$(read_pid)
  if is_pid_running "$pid"; then
    kill "$pid" 2>/dev/null
    local count=0
    while is_pid_running "$pid" && [[ $count -lt 50 ]]; do
      sleep 0.2
      ((count++))
    done
    if is_pid_running "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
      log_warn "Force killed PID $pid"
    fi
    log_ok "Stopped PID $pid"
  else
    log_warn "Process not running (stale pidfile)"
  fi
  clear_pid
}

nohup_status() {
  local pid
  pid=$(read_pid)
  is_pid_running "$pid"
}

nohup_logs() {
  tail -n 200 -f "$LOG_FILE" 2>/dev/null || log_warn "Log file not found: $LOG_FILE"
}

# --- Health probe ---
probe_health() {
  local port="$1"
  local timeout=5
  if command -v curl >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${port}/api/runs" >/dev/null 2>&1
  else
    node -e "
      const http = require('http');
      const req = http.get('http://127.0.0.1:${port}/api/runs', (res) => {
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
      req.on('error', () => process.exit(1));
      req.setTimeout(${timeout}000, () => { req.destroy(); process.exit(1); });
    "
  fi
}

# --- Commands ---
cmd_install() {
  local port="${1:-$DEFAULT_PORT}"
  local dry_run="${2:-false}"
  local backend
  backend=$(detect_backend)

  log_info "Installing Orchestra Studio service (backend: $backend, port: $port)"
  ensure_dirs
  write_port "$port"

  case "$backend" in
    systemd)
      systemd_render_unit "$port" "$dry_run"
      ;;
    launchd)
      launchd_render_plist "$port" "$dry_run"
      ;;
    nohup)
      log_info "nohup backend: no unit file needed"
      ;;
    *)
      log_err "Unknown backend: $backend"
      return 1
      ;;
  esac

  if [[ "$dry_run" == "false" ]]; then
    log_ok "Service installed. Run 'studio-service.sh start' to start."
  fi
}

cmd_start() {
  local port
  port=$(read_port)
  local backend
  backend=$(detect_backend)

  # Check if already running
  if cmd_status quiet; then
    log_warn "Service already running on port $port"
    return 0
  fi

  log_info "Starting Orchestra Studio on port $port (backend: $backend)"

  case "$backend" in
    systemd)
      systemd_start
      ;;
    launchd)
      launchd_start
      ;;
    nohup)
      nohup_start "$port"
      ;;
    *)
      log_err "Unknown backend: $backend"
      return 1
      ;;
  esac

  # Wait for health
  local count=0
  while [[ $count -lt 30 ]]; do
    if probe_health "$port"; then
      log_ok "Studio is healthy on http://127.0.0.1:$port"
      return 0
    fi
    sleep 0.5
    ((count++))
  done
  log_err "Health probe failed after 15s"
  return 1
}

cmd_stop() {
  local backend
  backend=$(detect_backend)
  log_info "Stopping Orchestra Studio (backend: $backend)"

  case "$backend" in
    systemd)
      systemd_stop
      ;;
    launchd)
      launchd_stop
      ;;
    nohup)
      nohup_stop
      ;;
    *)
      log_err "Unknown backend: $backend"
      return 1
      ;;
  esac
  log_ok "Stopped"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  local quiet="${1:-}"
  local port
  port=$(read_port)
  local backend
  backend=$(detect_backend)
  local running=false

  case "$backend" in
    systemd)
      systemd_status && running=true
      ;;
    launchd)
      launchd_status && running=true
      ;;
    nohup)
      nohup_status && running=true
      ;;
  esac

  if [[ "$running" == "true" ]]; then
    if probe_health "$port"; then
      [[ -z "$quiet" ]] && log_ok "Running on http://127.0.0.1:$port (healthy)"
      return 0
    else
      [[ -z "$quiet" ]] && log_warn "Process running but health probe failed on port $port"
      return 1
    fi
  else
    if [[ -z "$quiet" ]]; then
      # Distinguish "pidfile left behind by a dead process" from "never installed".
      if [[ -n "$(read_pid)" ]]; then
        log_warn "Not running (stale pidfile)"
      else
        log_info "Not running"
      fi
    fi
    return 1
  fi
}

cmd_logs() {
  local backend
  backend=$(detect_backend)
  case "$backend" in
    systemd)
      systemd_logs
      ;;
    launchd|nohup)
      nohup_logs
      ;;
  esac
}

cmd_uninstall() {
  local backend
  backend=$(detect_backend)
  log_info "Uninstalling Orchestra Studio (backend: $backend)"

  cmd_stop || true

  case "$backend" in
    systemd)
      systemd_uninstall
      ;;
    launchd)
      launchd_uninstall
      ;;
    nohup)
      log_info "nohup backend: no unit file to remove"
      ;;
  esac

  rm -rf "$RUNTIME_DIR" "$LOG_DIR"
  log_ok "Uninstalled"
}

cmd_enable_autostart() {
  local backend
  backend=$(detect_backend)
  log_info "Enabling autostart (backend: $backend)"

  case "$backend" in
    systemd)
      systemd_enable
      log_ok "Autostart enabled via systemd. Note: run 'loginctl enable-linger \$USER' for persistence across logins."
      ;;
    launchd)
      launchd_enable
      log_ok "Autostart enabled via launchd (RunAtLoad=true)."
      ;;
    nohup)
      log_warn "nohup backend: no autostart support. Use systemd or launchd."
      return 1
      ;;
  esac
}

cmd_disable_autostart() {
  local backend
  backend=$(detect_backend)
  log_info "Disabling autostart (backend: $backend)"

  case "$backend" in
    systemd)
      systemd_disable
      log_ok "Autostart disabled."
      ;;
    launchd)
      log_warn "launchd: autostart disabled by uninstalling (plist has RunAtLoad=true)."
      ;;
    nohup)
      log_info "nohup backend: no autostart to disable."
      ;;
  esac
}

# --- Main ---
main() {
  local cmd="${1:-}"
  local port="$DEFAULT_PORT"
  local dry_run="false"
  local backend="auto"

  # Parse global options first
  local args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port)
        port="$2"
        shift 2
        ;;
      --dry-run)
        dry_run="true"
        shift
        ;;
      --backend)
        backend="$2"
        export ORCHESTRA_STUDIO_BACKEND="$backend"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        args+=("$1")
        shift
        ;;
    esac
  done

  # Re-parse command from args
  cmd="${args[0]:-}"
  if [[ -z "$cmd" ]]; then
    usage
    exit 1
  fi

  # Override port from args if provided after command
  for ((i=1; i<${#args[@]}; i++)); do
    if [[ "${args[i]}" == "--port" && $((i+1)) < ${#args[@]} ]]; then
      port="${args[i+1]}"
    fi
  done

  case "$cmd" in
    install)
      cmd_install "$port" "$dry_run"
      ;;
    start)
      cmd_start
      ;;
    stop)
      cmd_stop
      ;;
    restart)
      cmd_restart
      ;;
    status)
      cmd_status
      ;;
    logs)
      cmd_logs
      ;;
    uninstall)
      cmd_uninstall
      ;;
    enable-autostart)
      cmd_enable_autostart
      ;;
    disable-autostart)
      cmd_disable_autostart
      ;;
    *)
      log_err "Unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
