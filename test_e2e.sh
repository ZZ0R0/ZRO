#!/bin/bash
# ─────────────────────────────────────────────────────────────
# zro — Script de test end-to-end
# Requiert: le runtime doit être démarré (./run.sh)
# ─────────────────────────────────────────────────────────────
set -e

BASE="http://localhost:8090"
COOKIE_JAR="/tmp/zro_e2e_cookies.txt"
PASS=0
FAIL=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
    local name="$1"
    local expected="$2"
    local actual="$3"
    TOTAL=$((TOTAL + 1))
    if echo "$actual" | grep -q "$expected"; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}✓${NC} $name"
    else
        FAIL=$((FAIL + 1))
        echo -e "  ${RED}✗${NC} $name"
        echo -e "    ${RED}Expected to contain:${NC} $expected"
        echo -e "    ${RED}Got:${NC} $actual"
    fi
}

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  zro — Tests End-to-End${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ── 1. Health check ──────────────────────────────────────────
echo ""
echo "Health & Auth"
R=$(curl -s --max-time 5 "$BASE/health" 2>&1)
check "GET /health returns ok" '"status":"ok"' "$R"
check "GET /health shows echo app" '"echo"' "$R"
check "GET /health shows notes app" '"notes"' "$R"
check "GET /health shows files app" '"files"' "$R"
check "GET /health shows terminal app" '"terminal"' "$R"

# ── 2. Auth ──────────────────────────────────────────────────
R=$(curl -s --max-time 5 -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"username":"wrong","password":"wrong"}' 2>&1)
check "Login with wrong creds fails" '"ok":false' "$R"

R=$(curl -s --max-time 5 -c "$COOKIE_JAR" -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"username":"dev","password":"dev"}' 2>&1)
check "Login with dev/dev succeeds" '"ok":true' "$R"
check "Login returns username" '"username":"dev"' "$R"
check "Login returns role" '"role":"admin"' "$R"

# ── 3. Auth protection ──────────────────────────────────────
R=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$BASE/echo/api/status" 2>&1)
check "Unauthenticated API returns 401" "401" "$R"

# ── 4. Echo app HTTP ────────────────────────────────────────
echo ""
echo "Echo App — HTTP API"
R=$(curl -s --max-time 10 -b "$COOKIE_JAR" "$BASE/echo/api/status" 2>&1)
check "GET /api/status returns ok" '"ok":true' "$R"
check "GET /api/status shows slug" '"slug":"echo"' "$R"
check "GET /api/status shows session user" '"username":"dev"' "$R"

R=$(curl -s --max-time 10 -b "$COOKIE_JAR" -X POST "$BASE/echo/api/echo" -H "Content-Type: application/json" -d '{"test":42}' 2>&1)
check "POST /api/echo returns ok" '"ok":true' "$R"
check "POST /api/echo echoes body" 'test.*42' "$R"

R=$(curl -s --max-time 10 -b "$COOKIE_JAR" -X PUT "$BASE/echo/api/kv" -H "Content-Type: application/json" -d '{"key":"e2e","value":"success"}' 2>&1)
check "PUT /api/kv sets key" '"ok":true' "$R"

R=$(curl -s --max-time 10 -b "$COOKIE_JAR" "$BASE/echo/api/kv" 2>&1)
check "GET /api/kv reads back key" '"e2e":"success"' "$R"

R=$(curl -s --max-time 10 -b "$COOKIE_JAR" -X DELETE "$BASE/echo/api/kv" -H "Content-Type: application/json" -d '{"key":"e2e"}' 2>&1)
check "DELETE /api/kv removes key" '"removed":true' "$R"

R=$(curl -s --max-time 10 -b "$COOKIE_JAR" "$BASE/echo/api/log" 2>&1)
check "GET /api/log returns entries" '"entries"' "$R"

# ── 5. Notes app ────────────────────────────────────────────
echo ""
echo "Notes App"
R=$(curl -s --max-time 10 -b "$COOKIE_JAR" -X POST "$BASE/notes/api/note" -H "Content-Type: application/json" -d '{"title":"E2E Test","content":"Created by e2e test script"}' 2>&1)
check "POST /api/note creates note" '"title":"E2E Test"' "$R"
NOTE_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")

R=$(curl -s --max-time 10 -b "$COOKIE_JAR" "$BASE/notes/api/notes" 2>&1)
check "GET /api/notes lists notes" '"notes"' "$R"

if [ -n "$NOTE_ID" ]; then
    R=$(curl -s --max-time 10 -b "$COOKIE_JAR" "$BASE/notes/api/note/$NOTE_ID" 2>&1)
    check "GET /api/note/:id returns note" '"E2E Test"' "$R"
fi

# ── 6. Frontend serving ─────────────────────────────────────
echo ""
echo "Frontend Serving"
R=$(curl -s --max-time 5 -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE/echo/" 2>&1)
check "GET /echo/ serves index.html" "200" "$R"

R=$(curl -s --max-time 5 -b "$COOKIE_JAR" "$BASE/echo/" 2>&1)
check "Echo frontend contains test UI" 'Echo Test' "$R"

R=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$BASE/auth/login" 2>&1)
check "GET /auth/login serves login page" "200" "$R"

R=$(curl -s --max-time 5 -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE/apps" 2>&1)
check "GET /apps serves launcher" "200" "$R"

# ── Results ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $FAIL -eq 0 ]; then
    echo -e "  ${GREEN}Résultat: $PASS/$TOTAL tests réussis ✓${NC}"
else
    echo -e "  ${RED}Résultat: $PASS/$TOTAL réussis, $FAIL échoué(s) ✗${NC}"
fi
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

rm -f "$COOKIE_JAR"
exit $FAIL
