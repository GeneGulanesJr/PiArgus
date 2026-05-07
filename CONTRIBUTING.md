# Contributing to PiArgus

## Architecture

PiArgus is a two-tier browser extension for the Pi coding agent:

| Tier | Engine | Use Case |
|------|--------|----------|
| Light | Obscura (V8, 30MB) | Fetch, scrape, eval, links, text, search |
| Heavy | smolvm + Chromium + Puppeteer | Screenshots, clicks, forms, GPU rendering |

The tier router (`tier-router.ts`) automatically classifies which tier a tool call needs. Heavy actions are routed to a smolvm microVM running Chromium driven by puppeteer-core.

## File Map

| File | Responsibility |
|------|----------------|
| `index.ts` | Tool registration + execution dispatch |
| `obscura.ts` | Light-tier Obscura CLI wrapper |
| `smolvm.ts` | Heavy-tier smolvm + Puppeteer interactions |
| `tier-router.ts` | Automatic tier classification |
| `web-search.ts` | SearXNG search tool registration |
| `web-search-core.ts` | Pure SearXNG search logic (JSON API) |
| `types.ts` | Shared TypeScript type definitions |
| `smolfier/browser.smolfile` | smolvm VM image definition |

## Adding a New Tool

1. If the tool uses Obscura, add helper functions to `obscura.ts`
2. If the tool uses smolvm+Chromium, add an `InteractionAction` type to `smolvm.ts`
3. Register the tool in `index.ts` using `pi.registerTool()`
4. Update `tier-router.ts` if the new tool needs heavy tier
5. Add tests — unit tests for logic, registration tests in `test/index.test.ts`

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npx tsc --noEmit

# Run a single test file
npx vitest run test/tier-router.test.ts
```

## Testing

Tests use Vitest. Mock external binaries (Obscura, smolvm) — never depend on them being installed in CI.

- **Pure logic** (tier-router, web-search-core): Full unit tests with no mocks or minimal mocks
- **CLI wrappers** (obscura, smolvm): Mock `execFile` and test argument construction
- **Tool registration** (index): Mock all dependencies, verify tool names, labels, parameter shapes
