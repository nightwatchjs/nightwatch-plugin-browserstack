const Logger = require('./logger');

/**
 * CustomTagManager manages custom tag metadata at both test and build levels.
 *
 * Each tag entry is structured as:
 *   { field_type: "multi_dropdown", values: ["val1", "val2"] }
 *
 * When the same key is set multiple times, values are merged (not overridden).
 */

// Per-test custom metadata keyed by test UUID
const testLevelTags = new Map();

// Build-level custom metadata (single object)
const buildLevelTags = {};

// Buffer for test-level tags set before UUID is available.
// Drained into the correct UUID entry when getTestLevelCustomMetadata is called.
let pendingTestTags = {};

/**
 * Splits a comma-separated string into an array of trimmed values.
 * Handles quoted strings containing commas.
 * e.g. '"a,b", c' -> ["a,b", "c"]
 */
function splitValues(input) {
  const result = [];
  const regex = /\s*"([^"]*)"\s*|[^,]+/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    const value = match[1] !== undefined ? match[1] : match[0].trim();
    if (value !== '') {
      result.push(value);
    }
  }

  return result;
}

/**
 * Merges new values into an existing tag entry, deduplicating.
 */
function mergeInto(target, keyName, newValues) {
  if (target[keyName]) {
    const existing = target[keyName].values;
    for (const val of newValues) {
      if (!existing.includes(val)) {
        existing.push(val);
      }
    }
  } else {
    target[keyName] = {field_type: 'multi_dropdown', values: [...newValues]};
  }
}

/**
 * Merges all entries from source into target.
 */
function mergeAll(target, source) {
  for (const [keyName, entry] of Object.entries(source)) {
    mergeInto(target, keyName, entry.values);
  }
}

/**
 * Sets a custom tag. If buildLevelCustomTag is true, stores at build level.
 * Otherwise stores at test level keyed by testUUID.
 * If testUUID is not yet available, buffers in pendingTestTags (drained on retrieval).
 */
exports.setCustomTag = function(keyName, keyValue, buildLevelCustomTag, testUUID) {
  if (!keyName || !keyValue || typeof keyName !== 'string' || typeof keyValue !== 'string' ||
      keyName.trim() === '' || keyValue.trim() === '') {
    Logger.error('[CustomTagManager] keyName and keyValue must be non-empty strings');

    return;
  }

  const values = splitValues(keyValue);

  if (buildLevelCustomTag) {
    mergeInto(buildLevelTags, keyName, values);

    return;
  }

  if (!testUUID) {
    // UUID not yet assigned — buffer and drain when the event is sent
    mergeInto(pendingTestTags, keyName, values);

    return;
  }

  if (!testLevelTags.has(testUUID)) {
    testLevelTags.set(testUUID, {});
  }
  mergeInto(testLevelTags.get(testUUID), keyName, values);
};

/**
 * Returns the custom metadata object for a specific test UUID.
 */
exports.getTestLevelCustomMetadata = function(uuid) {
  const tags = testLevelTags.get(uuid);

  return tags ? JSON.parse(JSON.stringify(tags)) : {};
};

/**
 * Drains pendingTestTags into the specified UUID's entry.
 * Must be called synchronously when the UUID is known and before any async
 * processing, to avoid races with the next test buffering into pendingTestTags.
 */
exports.drainPendingTestTags = function(uuid) {
  if (uuid && Object.keys(pendingTestTags).length > 0) {
    if (!testLevelTags.has(uuid)) {
      testLevelTags.set(uuid, {});
    }
    mergeAll(testLevelTags.get(uuid), pendingTestTags);
    pendingTestTags = {};
  }
};

/**
 * Returns the build-level custom metadata object.
 */
exports.getBuildLevelCustomMetadata = function() {
  return JSON.parse(JSON.stringify(buildLevelTags));
};

/**
 * Clears test-level tags for a completed test to prevent memory leaks.
 */
exports.clearTestLevelCustomMetadata = function(uuid) {
  testLevelTags.delete(uuid);
};

/**
 * Merges external build-level tags into the local buildLevelTags.
 * Used to aggregate tags received from worker processes via IPC.
 */
exports.mergeBuildLevelTags = function(tags) {
  if (!tags || typeof tags !== 'object') {
    return;
  }
  for (const [keyName, entry] of Object.entries(tags)) {
    if (entry && Array.isArray(entry.values)) {
      mergeInto(buildLevelTags, keyName, entry.values);
    }
  }
};

// Exported for testing
exports._splitValues = splitValues;
exports._testLevelTags = testLevelTags;
exports._buildLevelTags = buildLevelTags;
exports._getPendingTestTags = function() { return pendingTestTags };
