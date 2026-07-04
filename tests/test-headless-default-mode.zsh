#!/usr/bin/env zsh

# Headless-by-default routing tests (ticket #2: Remove Ink TUI)
#
# Verifies the entry-point routing decision in src/index.ts without requiring
# real API access: validateApiKey() only checks that a key is non-empty, and
# processPromptHeadless() throws a distinguishing, network-free error
# ("Headless mode requires explicit approval settings") as soon as it's
# reached, before any LLM call is attempted.  Combined with the pre-existing
# "No prompt provided via argument or stdin" message and the interactive
# path's startup banner, these give fast, deterministic signals for which
# branch was taken.

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_PATH="$PROJECT_ROOT/dist/index.js"

[[ ! -f "$CLI_PATH" ]] && echo Error: project not built -- run mzke build first. >&2 && exit 1

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

log_result() {
  ((TESTS_RUN++))
  if [[ "$1" == PASS ]]; then
    ((TESTS_PASSED++))
    echo ✅ $2
  else
    ((TESTS_FAILED++))
    echo ❌ $2
  fi
}

echo Headless-by-default routing tests
echo ==================================
echo

typeset -x GROK_API_KEY=test-key-format-only

# TC1: No flags at all + empty stdin -> headless path, no prompt available
OUT=$(echo -n "" | timeout 10 node "$CLI_PATH" 2>&1)
if [[ "$OUT" == *"No prompt provided via argument or stdin"* ]]; then
  log_result PASS "TC1: default (no flags) takes the headless path"
else
  log_result FAIL "TC1: default (no flags) did not take the headless path (got: $OUT)"
fi

# TC2: -p with a prompt and no auto-approve flags -> headless path reached
# (fails fast on the approval-settings check, before any network call)
OUT=$(timeout 10 node "$CLI_PATH" -p hello 2>&1)
if [[ "$OUT" == *"Headless mode requires explicit approval settings"* ]]; then
  log_result PASS "TC2: -p (no --interactive/--no-ink) takes the headless path"
else
  log_result FAIL "TC2: -p did not take the headless path (got: $OUT)"
fi

# TC3: --interactive + empty stdin -> plain-console REPL, not headless
OUT=$(echo -n "" | timeout 10 node "$CLI_PATH" --interactive 2>&1)
if [[ "$OUT" == *"Starting ZDS AI Agents CLI"* && "$OUT" != *"No prompt provided"* ]]; then
  log_result PASS "TC3: --interactive takes the plain-console REPL path"
else
  log_result FAIL "TC3: --interactive did not take the REPL path (got: $OUT)"
fi

# TC4: --no-ink + empty stdin -> same as --interactive (alias)
OUT=$(echo -n "" | timeout 10 node "$CLI_PATH" --no-ink 2>&1)
if [[ "$OUT" == *"Starting ZDS AI Agents CLI"* && "$OUT" != *"No prompt provided"* ]]; then
  log_result PASS "TC4: --no-ink takes the plain-console REPL path (alias of --interactive)"
else
  log_result FAIL "TC4: --no-ink did not take the REPL path (got: $OUT)"
fi

# TC5: -p together with --interactive -> -p still forces headless
# (matches zai-cli's existing -p precedence)
OUT=$(timeout 10 node "$CLI_PATH" -p hello --interactive 2>&1)
if [[ "$OUT" == *"Headless mode requires explicit approval settings"* ]]; then
  log_result PASS "TC5: -p forces headless even when --interactive is also given"
else
  log_result FAIL "TC5: -p did not force headless with --interactive (got: $OUT)"
fi

echo
echo Results: $TESTS_PASSED/$TESTS_RUN passed

exit $TESTS_FAILED
