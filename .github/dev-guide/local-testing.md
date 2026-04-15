# Local Testing Guide (Nightwatch Plugin)

> Pack, link, and run the local nightwatch-plugin-browserstack against a sample project to verify changes.

---

## Prerequisites

- **Node.js:** 16+ recommended
- **Sample repo:** A Nightwatch project that uses `@nightwatch/browserstack` (e.g., `nightwatch-browserstack`)
- **BrowserStack credentials:** `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` exported in your shell

---

## Build (Pack)

```bash
cd /absolute/path/to/nightwatch-plugin-browserstack

# Remove any previous tarball first — avoids installing a stale version
rm -f nightwatch-browserstack-*.tgz

npm pack
# → nightwatch-browserstack-<version>.tgz (e.g., nightwatch-browserstack-3.8.0.tgz)

# Capture the tarball path
export NW_PLUGIN_TGZ=$(pwd)/$(ls nightwatch-browserstack-*.tgz | head -1)
echo "Tarball: $NW_PLUGIN_TGZ"
```

---

## Link to Sample

Install the local tarball directly into the sample project:

```bash
cd /absolute/path/to/<sample>

npm install "$NW_PLUGIN_TGZ"
```

Verify the linked version has your changes:

```bash
# Check the installed version
cat node_modules/@nightwatch/browserstack/package.json | grep version
```

> **Tip:** When iterating on changes, always delete the old `.tgz` before repacking:
> ```bash
> cd /absolute/path/to/nightwatch-plugin-browserstack
> rm -f nightwatch-browserstack-*.tgz
> npm pack
> cd /absolute/path/to/<sample>
> npm install "$NW_PLUGIN_TGZ"
> ```

---

## Run Sample

> **Working directory:** Run all test commands from the **sample's root directory**, not the plugin directory.

```bash
cd /absolute/path/to/<sample>

# Export credentials if not already set
export BROWSERSTACK_USERNAME=<your-username>
export BROWSERSTACK_ACCESS_KEY=<your-access-key>

# Run a single test
npx nightwatch --test ./tests/single/single_test.js --env browserstack 2>&1 | tee /tmp/nw-test-run.log
```

After the run, verify:
```bash
# Check for BrowserStack signals and errors
grep -i "browserstack\|bstack\|error\|exception" /tmp/nw-test-run.log | head -30
```

---

## Troubleshooting

### "Still using published version, not local"
```bash
# Verify the installed version matches your tarball
cat <sample>/node_modules/@nightwatch/browserstack/package.json | grep version

# If stale, reinstall
cd <sample> && npm install "$NW_PLUGIN_TGZ"
```

### "Cannot convert undefined or null to object" in `helper.js:checkTestEnvironmentForAppAutomate`
The nightwatch version in the sample may be too old. The plugin 3.x requires nightwatch 3.x:
```bash
npx nightwatch --version
# If 2.x, upgrade:
npm install nightwatch@latest
```

### "TypeError: browser.<method> is not a function"
The plugin was not correctly linked. Re-pack and reinstall:
```bash
cd /absolute/path/to/nightwatch-plugin-browserstack
rm -f nightwatch-browserstack-*.tgz
npm pack
cd /absolute/path/to/<sample>
npm install /absolute/path/to/nightwatch-plugin-browserstack/nightwatch-browserstack-*.tgz
```
