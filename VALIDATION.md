# Frontend Validation

This document describes the automated frontend validation process for this project.

## Overview

All frontend code (HTML, CSS, JavaScript) is automatically validated using industry-standard tools via ephemeral CLI execution with `npx`. No dependencies or configuration files are committed to the repository.

## Validation Tools

### Core Tools (Always Run)

#### 1. **Biome** - JavaScript Formatting & Linting
- **Purpose**: Format and lint JavaScript code
- **Command**: `npx --yes @biomejs/biome@latest check --write script.js`
- **Auto-fix**: Yes
- **What it checks**:
  - Code formatting (indentation, quotes, etc.)
  - Code quality (unused variables, template literals, optional chaining)
  - Potential bugs

**Note**: Biome may show warnings for functions called from HTML (onclick handlers) as "unused". These are false positives and acceptable.

#### 2. **html-validate** - HTML Validation
- **Purpose**: Validate HTML structure and syntax
- **Command**: `npx --yes html-validate@latest index.html`
- **Auto-fix**: No (manual fixes required)
- **What it checks**:
  - HTML syntax errors
  - Void element style (e.g., `<meta>` vs `<meta />`)
  - Proper nesting and structure
  - Accessibility attributes

#### 3. **Stylelint** - CSS Validation
- **Purpose**: Validate and lint CSS code
- **Command**: `npx --yes stylelint@latest --config /tmp/stylelint-config.json "*.css" "assets/*.css"`
- **Auto-fix**: Partial (some rules support --fix)
- **What it checks**:
  - Invalid hex colors
  - Duplicate properties
  - Empty blocks
  - Unknown properties and units
  - Invalid pseudo-classes/elements

**Note**: Uses a minimal ephemeral configuration file created in `/tmp/stylelint-config.json`

#### 4. **ESLint** - JavaScript Linting
- **Purpose**: Additional JavaScript linting beyond Biome
- **Command**: `npx --yes eslint@latest --config /tmp/eslint.config.js script.js`
- **Auto-fix**: Partial (some rules support --fix)
- **What it checks**:
  - Undefined variables
  - Unused variables
  - Syntax errors

**Note**: Uses an ephemeral ESLint flat config created in `/tmp/eslint.config.js` with browser globals

### Optional Tools (Run After Changes)

#### 5. **Playwright** - UI Testing (Optional)
- **Purpose**: Test UI functionality after changes
- **Command**: `npx --yes playwright@latest test`
- **When to run**: After UI changes
- **Requirements**: Requires `playwright.config.ts` (create with `npx playwright init`)

#### 6. **Lighthouse** - Performance & Accessibility Audit (Optional)
- **Purpose**: Final audit of performance, accessibility, best practices, and SEO
- **Command**: `npx --yes lighthouse@latest http://localhost:8000`
- **When to run**: Final audit before deployment
- **Requirements**: Site must be running locally (e.g., `python -m http.server 8000`)

## Running Validation

### Automated Script

Run all validation checks at once:

```bash
./validate.sh
```

This script:
1. Runs all validation tools in sequence
2. Applies auto-fixes where supported
3. Reports pass/fail status for each tool
4. Provides a summary with error and warning counts

### Optional Checks

Run additional validation checks:

```bash
# Run Playwright tests (after UI changes)
./validate.sh --playwright

# Run Lighthouse audit (final performance/accessibility check)
./validate.sh --lighthouse

# Run all checks including Playwright and Lighthouse
./validate.sh --all
```

**Note**: 
- Playwright requires a `playwright.config.ts` file. Initialize with `npx playwright init`
- Lighthouse requires the site to be running locally (e.g., `python -m http.server 8000`)

### Manual Validation

You can also run each tool individually:

```bash
# Biome (JavaScript)
npx --yes @biomejs/biome@latest check --write script.js

# html-validate (HTML)
npx --yes html-validate@latest index.html

# Stylelint (CSS)
echo '{"rules": {"color-no-invalid-hex": true, "declaration-block-no-duplicate-properties": true}}' > /tmp/stylelint-config.json
npx --yes stylelint@latest --config /tmp/stylelint-config.json "*.css" "assets/*.css"

# ESLint (JavaScript)
# (See validate.sh for the full ESLint config)
npx --yes eslint@latest --config /tmp/eslint.config.js script.js
```

## Validation Results

### Current Status (Core Tools)
- ✅ **Biome**: PASSED (with warnings for HTML-called functions)
- ✅ **html-validate**: PASSED
- ✅ **Stylelint**: PASSED
- ✅ **ESLint**: PASSED (with warnings for HTML-called functions)

### Optional Tools Status
- ⏭️ **Playwright**: Available via `./validate.sh --playwright` (requires config)
- ⏭️ **Lighthouse**: Available via `./validate.sh --lighthouse` (requires local server)

### Known Warnings

Some functions are flagged as "unused" by Biome and ESLint because they are called from HTML inline event handlers (`onclick`, `onkeydown`). These are false positives and safe to ignore:

- `toggleAdvanced()` - Called from HTML
- `search()` - Called from HTML
- `openLibraryDrawer()` - Called from HTML
- `openSettingsDrawer()` - Called from HTML
- `saveGoogleSettings()` - Called from HTML
- `saveOpenAISettings()` - Called from HTML
- `validateOpenAIKey()` - Called from HTML
- `switchView()` - Called from HTML

## Changes Applied

### JavaScript (script.js)
- ✅ Formatting: Converted to tabs, consistent spacing
- ✅ Template literals: Changed string concatenation to template literals
- ✅ Optional chaining: Simplified null checks
- ✅ Assignment in expressions: Extracted assignment from arrow function

### HTML (index.html)
- ✅ Void elements: Removed self-closing slashes from void elements (`<meta />` → `<meta>`)
- ✅ Consistency: All void elements now follow HTML5 standard

### CSS (style.css, assets/site.css)
- ✅ No changes needed - already valid

## Ephemeral Execution

All tools are run via `npx` with ephemeral CLI execution:
- No `node_modules` directory created
- No `package.json` or lock files needed
- No dependencies committed to the repository
- Configurations created in `/tmp` and not committed

This approach ensures:
- ✅ Always uses latest tool versions
- ✅ No dependency management overhead
- ✅ Clean repository without build artifacts
- ✅ Easy to run on any machine with Node.js/npm

## Usage Instructions

### Basic Usage (Core Tools Only)
```bash
./validate.sh
```
This runs Biome, html-validate, Stylelint, and ESLint.

### With Optional Tools
```bash
# After UI changes, run Playwright tests
./validate.sh --playwright

# Before deployment, run Lighthouse audit
./validate.sh --lighthouse

# Run everything
./validate.sh --all
```

### Integration

**Pre-commit**: Add to your Git hooks
```bash
#!/bin/sh
./validate.sh || exit 1
```

**CI/CD**: Add to your workflow
```yaml
- name: Validate Frontend
  run: ./validate.sh --all
```
