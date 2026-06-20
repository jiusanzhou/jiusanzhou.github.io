#!/usr/bin/env bash
# OG image renderer
# Usage:
#   ./render.sh              # render all templates
#   ./render.sh c            # render template c
#   ./render.sh c og.png     # render template c to custom name
#
# Templates are static HTML at 1200x630. Use Chrome headless to screenshot.
# To customize content, edit the template HTML directly (data.json is reference for future SaaS).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL_DIR="$ROOT/templates"
OUT_DIR="$ROOT/output"
PORT=8765

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at $CHROME. Set CHROME=/path/to/chrome" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Start a tiny http server (file:// blocks subresources)
cleanup() { [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

cd "$TPL_DIR"
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 0.5

render() {
  local key="$1"   # e.g. a, b, c
  local out="${2:-og-${key}.png}"
  local tpl
  tpl=$(ls "$TPL_DIR"/${key}-*.html 2>/dev/null | head -1)
  if [[ -z "$tpl" ]]; then
    echo "Template '$key' not found in $TPL_DIR" >&2
    return 1
  fi
  local name
  name=$(basename "$tpl")
  echo "→ rendering $name"
  "$CHROME" \
    --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=1200,630 \
    --screenshot="$OUT_DIR/$out" \
    "http://localhost:$PORT/$name" 2>&1 | grep -v "Trying to load" || true
  echo "  ✓ $OUT_DIR/$out"
}

if [[ $# -eq 0 ]]; then
  for key in a b c; do render "$key"; done
else
  render "$@"
fi

echo ""
echo "Done. Outputs in $OUT_DIR/"
ls -la "$OUT_DIR"/*.png 2>/dev/null || true
