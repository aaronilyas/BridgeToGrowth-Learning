#!/bin/sh
# BridgeToGrowth Learning installer for macOS and Linux.
#
# Installs everything the build needs (system libraries on Linux, Bun), downloads
# the source if this script is not inside a checkout, and builds the desktop app
# into artifacts/.
#
#   From a checkout:  ./install.sh
#   Standalone:       curl -fsSL https://raw.githubusercontent.com/aaronilyas/BridgeToGrowth-Learning/main/install.sh | sh
#
# Settings (environment variables):
#   BTG_DIR=<path>     where to put the source when downloading it (default: ~/BridgeToGrowth-Learning)
#   BTG_BRANCH=<name>  branch to download (default: main)
#   BTG_YES=1          install system packages without asking
#   BTG_SKIP_SYSTEM=1  skip the system package step
set -eu

REPO="aaronilyas/BridgeToGrowth-Learning"
BRANCH="${BTG_BRANCH:-main}"
BUN_VERSION="1.4.4"   # the version CI builds with; an existing Bun 1.4 or newer is kept

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'install: %s\n' "$*" >&2; }
die() { printf '\ninstall: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Asks a yes/no question on the terminal, even when the script itself arrives on stdin (curl | sh).
confirm() {
  [ "${BTG_YES:-}" = "1" ] && return 0
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s [Y/n] ' "$1" > /dev/tty
    read -r reply < /dev/tty || reply=""
    case "$reply" in ""|y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
  fi
  return 0
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif have sudo; then sudo "$@"
  else die "this step needs root and sudo is not installed. Run as root: $*"
  fi
}

# ---------------------------------------------------------------- system packages

linux_family() {
  [ -r /etc/os-release ] || { echo unknown; return; }
  ids=$(. /etc/os-release; printf '%s %s' "${ID:-}" "${ID_LIKE:-}" | tr '[:upper:]' '[:lower:]')
  for id in $ids; do
    case "$id" in
      debian|ubuntu) echo debian; return ;;
      fedora|rhel|centos) echo fedora; return ;;
      arch|manjaro) echo arch; return ;;
      opensuse*|suse|sles) echo suse; return ;;
    esac
  done
  echo unknown
}

# Build headers (GTK 3, WebKitGTK 4.1), the runtime libraries Electrobun's native wrapper links
# against (see scripts/linux-runtime.ts), and the tools the build calls: curl, unzip (Bun's
# installer), git, pkg-config, zstd and tar (AppImage packaging), rsvg-convert (icons).
install_linux_packages() {
  family=$(linux_family)
  case "$family" in
    debian)
      update="apt-get update"
      cmd="apt-get install -y curl unzip git ca-certificates pkg-config zstd tar librsvg2-bin libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-1" ;;
    fedora)
      update=""
      cmd="dnf install -y curl unzip git tar zstd pkgconf-pkg-config librsvg2-tools pkgconfig(gtk+-3.0) pkgconfig(webkit2gtk-4.1) pkgconfig(libsoup-3.0) libayatana-appindicator-gtk3" ;;
    arch)
      update=""
      cmd="pacman -S --needed --noconfirm curl unzip git tar zstd pkgconf librsvg gtk3 webkit2gtk-4.1 libsoup3 libayatana-appindicator" ;;
    suse)
      update=""
      cmd="zypper --non-interactive install curl unzip git tar zstd pkg-config rsvg-convert pkgconfig(gtk+-3.0) pkgconfig(webkit2gtk-4.1) pkgconfig(libsoup-3.0) libayatana-appindicator3-1" ;;
    *)
      warn "unrecognized Linux distribution, so system packages were not installed."
      warn "Install with your package manager: curl, unzip, git, pkg-config, zstd, rsvg-convert,"
      warn "GTK 3 and WebKitGTK 4.1 development files, libsoup 3, Ayatana AppIndicator 3."
      return 0 ;;
  esac

  say "Installing system packages ($family)"
  echo "  ${update:+$update && }$cmd"
  if ! confirm "Run this with administrator rights now?"; then
    warn "skipped. The build will stop if a required library is missing."
    return 0
  fi
  # shellcheck disable=SC2086 # the package lists are intentionally word-split
  { [ -z "$update" ] || as_root $update; } && as_root $cmd || die "installing system packages failed. See the messages above."
}

install_macos_prereqs() {
  # Command Line Tools provide git. Without them the source is downloaded as an archive instead,
  # so they are offered, not required.
  if ! xcode-select -p >/dev/null 2>&1; then
    warn "Xcode Command Line Tools are not installed (optional; they provide git)."
    warn "To add them later: xcode-select --install"
  fi
}

# ---------------------------------------------------------------- Bun

bun_ok() {
  have bun || return 1
  v=$(bun --version 2>/dev/null) || return 1
  major=$(echo "$v" | cut -d. -f1); minor=$(echo "$v" | cut -d. -f2)
  [ "$major" -gt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -ge 4 ]; }
}

ensure_bun() {
  BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export BUN_INSTALL
  PATH="$BUN_INSTALL/bin:$PATH"
  export PATH
  if bun_ok; then
    echo "Bun $(bun --version) is installed."
    return
  fi
  if have bun; then
    say "Upgrading Bun $(bun --version) (1.4 or newer is required)"
    bun upgrade || die "bun upgrade failed."
  else
    say "Installing Bun $BUN_VERSION"
    have curl || die "curl is required to install Bun."
    have unzip || die "unzip is required to install Bun. Install it with your package manager."
    curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION" || die "installing Bun failed."
  fi
  bun_ok || die "Bun is still missing or too old. Open a new terminal and run this script again."
}

# ---------------------------------------------------------------- source

is_checkout() { [ -f "$1/package.json" ] && grep -q '"name": "bridgetogrowth-learning"' "$1/package.json"; }

locate_source() {
  # Running as ./install.sh inside a checkout: build that checkout.
  case "$0" in
    */install.sh|install.sh)
      here=$(cd "$(dirname "$0")" && pwd)
      if is_checkout "$here"; then SRC="$here"; return; fi ;;
  esac
  if is_checkout "$(pwd)"; then SRC=$(pwd); return; fi

  SRC="${BTG_DIR:-$HOME/BridgeToGrowth-Learning}"
  git_works=0
  if have git && { [ "$(uname -s)" != "Darwin" ] || xcode-select -p >/dev/null 2>&1; }; then git_works=1; fi

  if [ -d "$SRC/.git" ] && [ "$git_works" -eq 1 ]; then
    say "Updating the source in $SRC"
    git -C "$SRC" pull --ff-only || warn "could not update $SRC; building the copy that is there."
  elif is_checkout "$SRC"; then
    say "Using the existing source in $SRC"
  elif [ -e "$SRC" ] && [ -n "$(ls -A "$SRC" 2>/dev/null)" ]; then
    die "$SRC exists and is not a BridgeToGrowth Learning folder. Set BTG_DIR to another path."
  elif [ "$git_works" -eq 1 ]; then
    say "Downloading the source to $SRC"
    git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$SRC" || die "git clone failed."
  else
    say "Downloading the source to $SRC"
    have curl || die "curl is required to download the source."
    mkdir -p "$SRC"
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$SRC" --strip-components=1 \
      || die "downloading the source failed."
  fi
}

# ---------------------------------------------------------------- main

main() {
  os=$(uname -s)
  echo "BridgeToGrowth Learning installer ($os $(uname -m))"

  if [ "${BTG_SKIP_SYSTEM:-}" != "1" ]; then
    case "$os" in
      Linux) install_linux_packages ;;
      Darwin) install_macos_prereqs ;;
      *) die "unsupported system: $os. On Windows, run install.cmd instead." ;;
    esac
  fi

  ensure_bun
  locate_source
  cd "$SRC"

  say "Installing JavaScript dependencies"
  bun install --frozen-lockfile || die "bun install failed."

  if [ "$os" = "Linux" ]; then
    say "Checking the desktop window's libraries"
    BTG_SKIP_INSTALL_PROMPT=1 bun scripts/linux-runtime.ts || die "required libraries are missing (listed above). Install them, then run this script again."
  fi

  bun scripts/make-app.ts || die "the build failed. See the messages above."

  echo
  echo "Source folder: $SRC"
  for image in "$SRC"/artifacts/*.AppImage; do
    [ -f "$image" ] && echo "Run the app:   $image"
  done
  for deb in "$SRC"/artifacts/*.deb; do
    [ -f "$deb" ] && have apt && echo "Add it to your app menu: sudo apt install $deb"
  done
  return 0
}

main "$@"
