#!/usr/bin/env bash
# push_v398c.sh — push commit 81f7707 (v3.9.8c import-deck modal fix)
#
# Origin: https://github.com/aaronht88/marvel-hero-rush-sim  (main)
#
# Why this script exists:
#   - Terminal-issued `git push https://x-access-token:...` triggers
#     security-scan approval in Hermes. Aaron needs to approve in the
#     host UI. Doing it inside a shell script run from your own
#     terminal lets approval happen in one place.
#   - If the push has already happened some other way, this script
#     exits cleanly without re-pushing; it does `git ls-remote` first.
#
# What this script does:
#   1. cd into the repo and verify HEAD == 81f7707 (v3.9.8c fix)
#   2. Read PAT from env GITHUB_TOKEN or ~/.config/gh/hosts.yml (if `gh`
#      has been authenticated before) — fallback exits 1 with instructions
#   3. git push origin main
#   4. git ls-remote origin main  → confirm new HEAD matches local
#   5. curl GH Pages with a cache-bust, grep the version, confirm live
#      (CDN warm-up can take 1–2 min)
#
# Run:   bash scripts/push_v398c.sh
#
# Expect one approval prompt in the terminal when the push runs.

set -euo pipefail

REPO="/opt/data/mhr-battle-sim"
cd "$REPO"

EXPECTED_SHA="81f7707"
ACTUAL_SHA="$(git rev-parse --short HEAD)"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA"* ]]; then
  echo "Refusing: expected HEAD $EXPECTED_SHA..., actual $ACTUAL_SHA."
  echo "Did something else get committed?  Run 'git log --oneline -3' first."
  exit 1
fi

# ---- PAT discovery ----
PAT="${GITHUB_TOKEN:-}"
if [[ -z "$PAT" ]]; then
  GH_HOSTS="$HOME/.config/gh/hosts.yml"
  if [[ -f "$GH_HOSTS" ]]; then
    PAT="$(awk '/oauth_token:/{print $2; exit}' "$GH_HOSTS")"
  fi
fi
if [[ -z "$PAT" ]]; then
  cat <<EOF
No PAT found. Set GITHUB_TOKEN in env, then re-run:

    export GITHUB_TOKEN='ghp_…yourPAT…'
    bash scripts/push_v398c.sh

Or run 'gh auth login' once so the script picks the token up from
~/.config/gh/hosts.yml automatically.
EOF
  exit 1
fi

REMOTE="https://x-access-token:${PAT}@github.com/aaronht88/marvel-hero-rush-sim.git"

# ---- Skip if origin already has the commit ----
REMOTE_SHA="$(git ls-remote "$REMOTE" main 2>/dev/null | awk '{print $1}')"
if [[ -n "$REMOTE_SHA" && "$REMOTE_SHA" == "$(git rev-parse HEAD)"* ]]; then
  echo "Origin already at $REMOTE_SHA — nothing to push."
  echo "Verifying live Pages version:"
  sleep 2
  curl -s "https://aaronht88.github.io/marvel-hero-rush-sim/?cb=$RANDOM" \
    | grep -oE 'v3\.9\.[0-9]+[a-z]*' | head -3
  exit 0
fi

echo "About to push HEAD = $ACTUAL_SHA to $REMOTE"
git push "$REMOTE" main 2>&1 | sed "s|$PAT|ghp_***|g"

echo
echo "---- post-push verify ----"
git ls-remote "$REMOTE" main | head -1

echo
echo "---- CDN warm-up poll ----"
for n in $(seq 1 12); do
  sleep 5
  V="$(curl -s "https://aaronht88.github.io/marvel-hero-rush-sim/?cb=$RANDOM" \
        | grep -oE 'v3\.9\.[0-9]+[a-z]*' | head -1 || true)"
  echo "  [$n] live version: ${V:-<not yet>}"
  if [[ "$V" == "v3.9.8c" ]]; then
    echo "✓ GH Pages is serving v3.9.8c"
    exit 0
  fi
done

echo
echo "CDN did not pick up v3.9.8c after 60s — wait a bit longer or hit"
echo "shift-reload in the browser with DevTools cache disabled."
exit 0
