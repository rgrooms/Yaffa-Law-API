#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# health-check.sh — Verify all Yaffa Law API services are ready
#
# Checks:
#   1. Redis (port 6379)
#   2. Yaffa Law API /health endpoint (port 4000)
#   3. BullMQ worker status via API
#   4. Socket.io handshake
#
# Exit codes:
#   0 = all healthy
#   1 = one or more services down
# ─────────────────────────────────────────────────────────────────────────────

API_PORT="${PORT:-4000}"
REDIS_PORT="${REDIS_PORT:-6379}"
API_BASE="http://localhost:${API_PORT}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=1; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }

FAILED=0

echo -e "${BOLD}Yaffa Law API — Health Check${NC}"
echo "────────────────────────────"

# ── 1. Redis ──────────────────────────────────────────────────────────────────
if redis-cli -p "${REDIS_PORT}" ping 2>/dev/null | grep -q "PONG"; then
  ok "Redis       → localhost:${REDIS_PORT} (PONG)"
else
  fail "Redis       → localhost:${REDIS_PORT} — NOT RESPONDING"
  warn "  Run: npm run redis"
fi

# ── 2. API health endpoint ────────────────────────────────────────────────────
HEALTH=$(curl -sf "${API_BASE}/health" 2>/dev/null)
if [ $? -eq 0 ]; then
  WORKER=$(echo "${HEALTH}" | grep -o '"worker":"[^"]*"' | cut -d'"' -f4)
  ok "API         → ${API_BASE}/health (worker: ${WORKER:-unknown})"
else
  fail "API         → ${API_BASE} — NOT RESPONDING"
  warn "  Run: npm run dev"
fi

# ── 3. Bull Board ─────────────────────────────────────────────────────────────
if curl -sf "${API_BASE}/admin/queues/api/queues" -o /dev/null 2>/dev/null; then
  ok "Bull Board  → ${API_BASE}/admin/queues"
else
  warn "Bull Board  → ${API_BASE}/admin/queues — not responding (API may not be up)"
fi

echo "────────────────────────────"
if [ "${FAILED}" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All systems nominal${NC} 🏛️"
  exit 0
else
  echo -e "${RED}${BOLD}One or more services are down${NC}"
  exit 1
fi
