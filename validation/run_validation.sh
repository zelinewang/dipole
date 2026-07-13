#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

validations=(
  "validation/run_tests.js"
  "validation/test_analyzer.js"
  "validation/check_json_only.js"
  "validation/mock_deploy_test.js"
)

for validation in "${validations[@]}"; do
  printf '\n==> node %s\n' "$validation"
  node "$validation"
done

printf '\nAll validations passed.\n'
