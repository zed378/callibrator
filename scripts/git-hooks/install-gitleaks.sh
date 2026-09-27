#!/usr/bin/env bash
# Install the pinned gitleaks for the pre-push hook (A-19) — checksum-verified.
#
#   bash scripts/git-hooks/install-gitleaks.sh      (make hooks runs it)
#
# Installs gitleaks $VERSION into <repo>/.tools/bin (git-ignored), which the
# pre-push hook puts first on its PATH. The version and checksums are the
# release's own gitleaks_<v>_checksums.txt; the linux_x64 value is the one CI
# pins in .github/workflows/ci.yml, so a hook and CI scan with the same binary.
#
# Idempotent: an existing .tools/bin/gitleaks of the pinned version is kept.
# A download or checksum failure exits non-zero and installs NOTHING — the hook
# then SKIPS the secret scan loudly, and CI still scans.
set -euo pipefail

VERSION=8.30.1

root="$(git rev-parse --show-toplevel)"
dest="$root/.tools/bin"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) os=linux ext=tar.gz ;;
  Darwin) os=darwin ext=tar.gz ;;
  MINGW* | MSYS* | CYGWIN*) os=windows ext=zip ;;
  *) echo "install-gitleaks: unsupported OS '$os' — install gitleaks $VERSION yourself" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "install-gitleaks: unsupported architecture '$arch' — install gitleaks $VERSION yourself" >&2; exit 1 ;;
esac

asset="gitleaks_${VERSION}_${os}_${arch}.${ext}"
case "$asset" in
  gitleaks_8.30.1_linux_x64.tar.gz) sum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  gitleaks_8.30.1_linux_arm64.tar.gz) sum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  gitleaks_8.30.1_darwin_x64.tar.gz) sum=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  gitleaks_8.30.1_darwin_arm64.tar.gz) sum=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  gitleaks_8.30.1_windows_x64.zip) sum=d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e ;;
  gitleaks_8.30.1_windows_arm64.zip) sum=b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f ;;
  *) echo "install-gitleaks: no pinned checksum for $asset" >&2; exit 1 ;;
esac

bin="$dest/gitleaks"
[ "$os" = windows ] && bin="$dest/gitleaks.exe"
if [ -x "$bin" ] && "$bin" version 2>/dev/null | grep -q "$VERSION"; then
  echo "install-gitleaks: gitleaks $VERSION already at ${bin#"$root"/}"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -sSfL -o "$tmp/$asset" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset}"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
if [ "$actual" != "$sum" ]; then
  echo "install-gitleaks: CHECKSUM MISMATCH for $asset (got $actual) — nothing installed" >&2
  exit 1
fi

if [ "$ext" = zip ]; then
  unzip -q -o "$tmp/$asset" -d "$tmp/x"
else
  mkdir -p "$tmp/x" && tar xzf "$tmp/$asset" -C "$tmp/x"
fi
mkdir -p "$dest"
install -m 0755 "$tmp/x/$(basename "$bin")" "$bin"
echo "install-gitleaks: installed gitleaks $VERSION at ${bin#"$root"/} (sha256 verified)"
