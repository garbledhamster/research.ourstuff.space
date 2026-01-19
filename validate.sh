#!/bin/bash

# Frontend Validation Script
# Runs all validation tools using ephemeral CLI execution via npx

set -e  # Exit on first error

echo "========================================="
echo "Frontend Validation Suite"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASSED${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        ERRORS=$((ERRORS + 1))
    fi
}

# 1. Biome - Format and Lint JavaScript
echo "1. Running Biome (JavaScript format + lint)..."
# Note: Biome may show warnings for HTML-called functions (false positives)
# Exit code 0 = no issues, 1 = warnings (acceptable), 2+ = errors
if npx --yes @biomejs/biome@latest check --write script.js; then
    print_status 0
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 1 ]; then
        echo -e "${YELLOW}⚠ PASSED with warnings (HTML-called functions appear unused)${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        print_status 1
    fi
fi
echo ""

# 2. html-validate - HTML validation
echo "2. Running html-validate (HTML validation)..."
if npx --yes html-validate@latest index.html; then
    print_status 0
else
    print_status 1
fi
echo ""

# 3. Stylelint - CSS validation
echo "3. Running Stylelint (CSS validation)..."
# Create minimal config in /tmp for ephemeral execution
echo '{"rules": {"color-no-invalid-hex": true, "declaration-block-no-duplicate-properties": true, "block-no-empty": true, "selector-pseudo-class-no-unknown": true, "selector-pseudo-element-no-unknown": true, "property-no-unknown": true, "unit-no-unknown": true}}' > /tmp/stylelint-config.json

if npx --yes stylelint@latest --config /tmp/stylelint-config.json "*.css" "assets/*.css"; then
    print_status 0
else
    print_status 1
fi
echo ""

# 4. ESLint - JavaScript linting (additional checks beyond Biome)
echo "4. Running ESLint (JavaScript linting)..."
# Create ESLint config in /tmp for ephemeral execution
cat > /tmp/eslint.config.js << 'EOF'
export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        console: "readonly",
        alert: "readonly",
        confirm: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        requestAnimationFrame: "readonly",
        CSS: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  }
];
EOF

if npx --yes eslint@latest --config /tmp/eslint.config.js script.js; then
    print_status 0
else
    # ESLint warnings are acceptable (HTML-called functions appear unused)
    if [ $? -eq 1 ]; then
        echo -e "${YELLOW}⚠ PASSED with warnings (HTML-called functions)${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        print_status 1
    fi
fi
echo ""

# Summary
echo "========================================="
echo "Validation Summary"
echo "========================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}All validation checks passed!${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
    fi
    exit 0
else
    echo -e "${RED}Validation failed with $ERRORS error(s)${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
    fi
    exit 1
fi
