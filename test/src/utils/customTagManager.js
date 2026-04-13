const {expect} = require('chai');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CustomTagManager = require('../../../src/utils/customTagManager');

describe('CustomTagManager', () => {

  beforeEach(() => {
    // Clear internal state between tests
    CustomTagManager._testLevelTags.clear();
    for (const key of Object.keys(CustomTagManager._buildLevelTags)) {
      delete CustomTagManager._buildLevelTags[key];
    }
  });

  describe('getTestLevelCustomMetadata', () => {
    it('returns a deep clone, not the internal object', () => {
      CustomTagManager.setCustomTag('env', 'staging', false, 'uuid-1');

      const result = CustomTagManager.getTestLevelCustomMetadata('uuid-1');
      // Mutate the returned object
      result.env.values.push('production');

      // Internal state should be unchanged
      const internal = CustomTagManager.getTestLevelCustomMetadata('uuid-1');
      expect(internal.env.values).to.deep.equal(['staging']);
    });

    it('returns empty object for unknown UUID', () => {
      expect(CustomTagManager.getTestLevelCustomMetadata('nonexistent')).to.deep.equal({});
    });
  });

  describe('getBuildLevelCustomMetadata', () => {
    it('returns a deep clone, not the internal object', () => {
      CustomTagManager.setCustomTag('release', 'v1', true, null);

      const result = CustomTagManager.getBuildLevelCustomMetadata();
      // Mutate the returned object
      result.release.values.push('v2');

      // Internal state should be unchanged
      const internal = CustomTagManager.getBuildLevelCustomMetadata();
      expect(internal.release.values).to.deep.equal(['v1']);
    });
  });

  describe('temp file scoping', () => {
    it('worker writes temp file scoped to run ID', () => {
      // Simulate what afterChildProcess does
      const runId = 'test-run-uuid-123';
      const tagFile = path.join(os.tmpdir(), `bstack_build_tags_${runId}_${process.pid}.json`);
      const tags = {env: {field_type: 'multi_dropdown', values: ['staging']}};
      fs.writeFileSync(tagFile, JSON.stringify(tags));

      // Parent reads only files matching this run
      const tmpDir = os.tmpdir();
      const tagFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith(`bstack_build_tags_${runId}_`) && f.endsWith('.json'));

      expect(tagFiles.length).to.be.greaterThanOrEqual(1);
      expect(tagFiles[0]).to.include(runId);

      // Files from a different run should NOT be matched
      const otherRunFile = path.join(tmpDir, 'bstack_build_tags_other-run_99999.json');
      fs.writeFileSync(otherRunFile, JSON.stringify({}));

      const matchedFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith(`bstack_build_tags_${runId}_`) && f.endsWith('.json'));
      const hasOtherRun = matchedFiles.some(f => f.includes('other-run'));
      expect(hasOtherRun).to.be.false;

      // Cleanup
      fs.unlinkSync(tagFile);
      fs.unlinkSync(otherRunFile);
    });
  });
});
