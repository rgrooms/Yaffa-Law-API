#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-redis.sh — Start Redis for Yaffa Law API development
#
# Precedence:
#   1. If REDIS_URL points to a running server → skip (already up)
#   2. If Docker is available → run redis:7-alpine in a container
#   3. If Homebrew redis is installed → brew services start redis
#   4. Else → print install instructions and exit 1
#
# Usage:
#   npm run redis            (via package.json script)
#   bash scripts/start-redis.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
CONTAINER_NAME="yaffa-redis"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

banner() { echo -e "${BLUE}${BOLD}[Yaffa Redis]${NC} $1"; }
ok()     { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}⚠${NC}  $1"; }
fail()   { echo -e "${RED}✗${NC} $1"; }

banner "Checking Redis at ${REDIS_HOST}:${REDIS_PORT}…"

# ── 1. Already running? ───────────────────────────────────────────────────────
if redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" ping 2>/dev/null | grep -q "PONG"; then
  ok "Redis is already running at ${REDIS_HOST}:${REDIS_PORT}"
  exit 0
fi

# ── 2. Try Docker ─────────────────────────────────────────────────────────────
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  banner "Starting Redis via Docker…"

  # Remove stopped container with same name if exists
  docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${REDIS_PORT}:6379" \
    --restart unless-stopped \
    redis:7-alpine \
    redis-server --save 60 1 --loglevel warning

  # Wait for healthy
  for i in $(seq 1 15); do
    if redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" ping 2>/dev/null | grep -q "PONG"; then
      ok "Redis (Docker) started on port ${REDIS_PORT}"
      ok "Container: ${CONTAINER_NAME} (redis:7-alpine)"
      exit 0
    fi
    sleep 0.5
  done

  fail "Docker Redis container started but didn't respond — check: docker logs ${CONTAINER_NAME}"
  exit 1
fi

# ── 3. Try Homebrew ───────────────────────────────────────────────────────────
if command -v brew &>/dev/null && brew list redis &>/dev/null 2>&1; then
  banner "Starting Redis via Homebrew…"
  brew services start redis

  for i in $(seq 1 15); do
    if redis-cli ping 2>/dev/null | grep -q "PONG"; then
      ok "Redis (Homebrew) started on port ${REDIS_PORT}"
      exit 0
    fi
    sleep 0.5
  done

  fail "Homebrew Redis started but didn't respond"
  exit 1
fi

# ── 4. Not found ──────────────────────────────────────────────────────────────
fail "Redis not found. Install one of:"
echo ""
echo "  Option A — Docker (recommended):"
echo "    docker run -d --name yaffa-redis -p 6379:6379 redis:7-alpine"
echo ""
echo "  Option B — Homebrew:"
echo "    brew install redis && brew services start redis"
echo ""
echo "  Option C — Redis Cloud (free):"
echo "    https://redis.io/try-free → set REDIS_URL in .env"
echo ""
exit 1
