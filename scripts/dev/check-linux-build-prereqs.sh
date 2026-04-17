#!/usr/bin/env bash
set -euo pipefail

declare -a NAMES=()
declare -a STATUSES=()
declare -a DETAILS=()
declare -a FIXES=()
declare -a REQUIRED=()

add_result() {
  local name="$1"
  local ok="$2"
  local details="$3"
  local fix="${4:-}"
  local required="${5:-1}"

  NAMES+=("$name")
  if [ "$ok" -eq 1 ]; then
    STATUSES+=("OK")
  else
    STATUSES+=("MISSING")
  fi
  DETAILS+=("$details")
  FIXES+=("$fix")
  REQUIRED+=("$required")
}

check_cmd() {
  local cmd="$1"
  local name="$2"
  local fix="$3"
  local required="${4:-1}"

  if command -v "$cmd" >/dev/null 2>&1; then
    local path
    local version
    path="$(command -v "$cmd")"
    version="$("$cmd" --version 2>/dev/null | head -n1 || true)"
    add_result "$name" 1 "${version:-found at $path} ($path)" "" "$required"
  else
    add_result "$name" 0 "$cmd not found in PATH" "$fix" "$required"
  fi
}

check_pkg() {
  local pkg="$1"
  local name="$2"
  local fix="$3"
  local required="${4:-1}"

  if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists "$pkg"; then
    local version
    version="$(pkg-config --modversion "$pkg" 2>/dev/null || true)"
    add_result "$name" 1 "${pkg} ${version:-installed}" "" "$required"
  else
    add_result "$name" 0 "${pkg} not detected by pkg-config" "$fix" "$required"
  fi
}

check_cmd cargo "cargo" "Install Rust toolchain: curl https://sh.rustup.rs -sSf | sh" 1
check_cmd rustc "rustc" "Install Rust toolchain: curl https://sh.rustup.rs -sSf | sh" 1
check_cmd rustup "rustup" "Install Rust toolchain: curl https://sh.rustup.rs -sSf | sh" 1

if command -v rustup >/dev/null 2>&1; then
  if rustup target list --installed | grep -qx "x86_64-unknown-linux-gnu"; then
    add_result "rust target (x86_64-unknown-linux-gnu)" 1 "Installed" "" 1
  else
    add_result "rust target (x86_64-unknown-linux-gnu)" 0 "Missing target" "Run: rustup target add x86_64-unknown-linux-gnu" 1
  fi
fi

if command -v cc >/dev/null 2>&1; then
  add_result "C compiler (cc)" 1 "$(cc --version 2>/dev/null | head -n1 || echo "cc found")" "" 1
else
  add_result "C compiler (cc)" 0 "cc not found in PATH" "Install build tools: sudo apt install -y build-essential" 1
fi

check_cmd pkg-config "pkg-config" "Install: sudo apt install -y pkg-config" 1
check_cmd node "Node.js (Vite frontend build)" "Install: https://nodejs.org/ or sudo apt install -y nodejs npm" 1
check_cmd npm "npm (frontend workflows)" "Install Node.js/npm: https://nodejs.org/ or sudo apt install -y nodejs npm" 1

check_pkg "gtk+-3.0" "GTK3 dev headers" "Install: sudo apt install -y libgtk-3-dev" 1
check_pkg "gdk-3.0" "GDK3 dev headers" "Install: sudo apt install -y libgtk-3-dev" 1

if command -v pkg-config >/dev/null 2>&1; then
  if pkg-config --exists "webkit2gtk-4.1"; then
    add_result "WebKit2GTK dev headers" 1 "webkit2gtk-4.1 $(pkg-config --modversion webkit2gtk-4.1 2>/dev/null || echo installed)" "" 1
  elif pkg-config --exists "webkit2gtk-4.0"; then
    add_result "WebKit2GTK dev headers" 1 "webkit2gtk-4.0 $(pkg-config --modversion webkit2gtk-4.0 2>/dev/null || echo installed)" "" 1
  else
    add_result "WebKit2GTK dev headers" 0 "webkit2gtk-4.1/4.0 not detected" "Install: sudo apt install -y libwebkit2gtk-4.1-dev (or libwebkit2gtk-4.0-dev on older distro)" 1
  fi

  if pkg-config --exists "javascriptcoregtk-4.1"; then
    add_result "JavaScriptCoreGTK dev headers" 1 "javascriptcoregtk-4.1 $(pkg-config --modversion javascriptcoregtk-4.1 2>/dev/null || echo installed)" "" 1
  elif pkg-config --exists "javascriptcoregtk-4.0"; then
    add_result "JavaScriptCoreGTK dev headers" 1 "javascriptcoregtk-4.0 $(pkg-config --modversion javascriptcoregtk-4.0 2>/dev/null || echo installed)" "" 1
  else
    add_result "JavaScriptCoreGTK dev headers" 0 "javascriptcoregtk-4.1/4.0 not detected" "Install: sudo apt install -y libjavascriptcoregtk-4.1-dev (or libjavascriptcoregtk-4.0-dev on older distro)" 1
  fi
else
  add_result "WebKit2GTK dev headers" 0 "pkg-config unavailable, cannot validate" "Install pkg-config first" 1
  add_result "JavaScriptCoreGTK dev headers" 0 "pkg-config unavailable, cannot validate" "Install pkg-config first" 1
fi

check_pkg "openssl" "OpenSSL dev headers" "Install: sudo apt install -y libssl-dev" 1
check_cmd patchelf "patchelf" "Install: sudo apt install -y patchelf" 1

printf "\nRheoLab Enterprise V2 - Linux build prerequisites audit\n"
printf "======================================================\n"
printf "%-44s %-10s %s\n" "Check" "Status" "Details"
printf "%-44s %-10s %s\n" "-----" "------" "-------"

for i in "${!NAMES[@]}"; do
  printf "%-44s %-10s %s\n" "${NAMES[$i]}" "${STATUSES[$i]}" "${DETAILS[$i]}"
done

ready=1
for i in "${!NAMES[@]}"; do
  if [ "${REQUIRED[$i]}" -eq 1 ] && [ "${STATUSES[$i]}" != "OK" ]; then
    ready=0
    break
  fi
done

if [ "$ready" -eq 1 ]; then
  printf "\nReady for Linux build: YES\n"
  printf "Next: npm run test:desktop-core && npm run build:ci\n"
  exit 0
fi

printf "\nReady for Linux build: NO\n"
printf "Recommended fixes:\n"
for i in "${!NAMES[@]}"; do
  if [ "${STATUSES[$i]}" != "OK" ] && [ -n "${FIXES[$i]}" ]; then
    printf -- "- %s: %s\n" "${NAMES[$i]}" "${FIXES[$i]}"
  fi
done

printf "\nBaseline Debian/Ubuntu install command:\n"
printf "sudo apt update && sudo apt install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev nodejs npm\n"

exit 1
