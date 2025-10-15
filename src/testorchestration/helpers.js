const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const Logger = require('../utils/logger');

// Constants
const MAX_GIT_META_DATA_SIZE_IN_BYTES = 512 * 1024; // 512 KB

/**
 * Get host information for the test orchestration
 */
function getHostInfo() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
    username: os.userInfo().username
  };
}

/**
 * Format git author information
 */
function gitAuthor(name, email) {
  if (!name && !email) {
    return '';
  }
  return `${name} (${email})`;
}

/**
 * Get the size of a JSON object in bytes
 */
function getSizeOfJsonObjectInBytes(obj) {
  try {
    const jsonString = JSON.stringify(obj);
    return Buffer.byteLength(jsonString, 'utf8');
  } catch (e) {
    Logger.error(`Error calculating object size: ${e}`);
    return 0;
  }
}

/**
 * Truncate a string to reduce its size by the specified number of bytes
 */
function truncateString(str, bytesToTruncate) {
  if (!str || bytesToTruncate <= 0) {
    return str;
  }
  
  const originalBytes = Buffer.byteLength(str, 'utf8');
  const targetBytes = Math.max(0, originalBytes - bytesToTruncate);
  
  if (targetBytes >= originalBytes) {
    return str;
  }
  
  // Perform binary search to find the right truncation point
  let left = 0;
  let right = str.length;
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const truncated = str.substring(0, mid);
    const bytes = Buffer.byteLength(truncated, 'utf8');
    
    if (bytes <= targetBytes) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  
  return str.substring(0, left - 1) + '...';
}

/**
 * Check and truncate VCS info if needed
 */
function checkAndTruncateVcsInfo(gitMetaData) {
  const gitMetaDataSizeInBytes = getSizeOfJsonObjectInBytes(gitMetaData);
  
  if (gitMetaDataSizeInBytes && gitMetaDataSizeInBytes > MAX_GIT_META_DATA_SIZE_IN_BYTES) {
    const truncateSize = gitMetaDataSizeInBytes - MAX_GIT_META_DATA_SIZE_IN_BYTES;
    const truncatedCommitMessage = truncateString(gitMetaData.commit_message, truncateSize);
    gitMetaData.commit_message = truncatedCommitMessage;
    Logger.info(`The commit has been truncated. Size of commit after truncation is ${getSizeOfJsonObjectInBytes(gitMetaData) / 1024} KB`);
  }
  return gitMetaData;
}

/**
 * Check if a git metadata result is valid
 */
function isValidGitResult(result) {
  return (
    Array.isArray(result.filesChanged) &&
    result.filesChanged.length > 0 &&
    Array.isArray(result.authors) &&
    result.authors.length > 0
  );
}

/**
 * Get base branch from repository
 */
function getBaseBranch() {
  try {
    // Try to get the default branch from origin/HEAD symbolic ref (works for most providers)
    try {
      const originHeadOutput = execSync('git symbolic-ref refs/remotes/origin/HEAD').toString().trim();
      if (originHeadOutput.startsWith('refs/remotes/origin/')) {
        return originHeadOutput.replace('refs/remotes/', '');
      }
    } catch (e) {
      // Symbolic ref might not exist
    }
    
    // Fallback: use the first branch in local heads
    try {
      const branchesOutput = execSync('git branch').toString().trim();
      const branches = branchesOutput.split('\n').filter(Boolean);
      if (branches.length > 0) {
        // Remove the '* ' from current branch if present and return first branch
        const firstBranch = branches[0].replace(/^\*\s+/, '').trim();
        return firstBranch;
      }
    } catch (e) {
      // Branches might not exist
    }
    
    // Fallback: use the first remote branch if available
    try {
      const remoteBranchesOutput = execSync('git branch -r').toString().trim();
      const remoteBranches = remoteBranchesOutput.split('\n').filter(Boolean);
      for (const branch of remoteBranches) {
        const cleanBranch = branch.trim();
        if (cleanBranch.startsWith('origin/') && !cleanBranch.includes('HEAD')) {
          return cleanBranch;
        }
      }
    } catch (e) {
      // Remote branches might not exist
    }
  } catch (e) {
    Logger.debug(`Error finding base branch: ${e}`);
  }
  
  return null;
}

/**
 * Get changed files from commits
 */
function getChangedFilesFromCommits(commitHashes) {
  const changedFiles = new Set();
  
  try {
    for (const commit of commitHashes) {
      try {
        // Check if commit has parents
        const parentsOutput = execSync(`git log -1 --pretty=%P ${commit}`).toString().trim();
        const parents = parentsOutput.split(' ').filter(Boolean);
        
        for (const parent of parents) {
          const diffOutput = execSync(`git diff --name-only ${parent} ${commit}`).toString().trim();
          const files = diffOutput.split('\n').filter(Boolean);
          
          for (const file of files) {
            changedFiles.add(file);
          }
        }
      } catch (e) {
        Logger.debug(`Error processing commit ${commit}: ${e}`);
      }
    }
  } catch (e) {
    Logger.debug(`Error getting changed files from commits: ${e}`);
  }
  
  return Array.from(changedFiles);
}

/**
 * Get Git metadata for AI selection
 * @param multiRepoSource Array of repository paths for multi-repo setup
 */
function getGitMetadataForAiSelection(folders = []) {
  if (folders && folders.length === 0) {
    folders = [process.cwd()];
  }
  
  const results = [];
  
  for (const folder of folders) {
    const originalDir = process.cwd();
    try {
      // Initialize the result structure
      const result = {
        prId: '',
        filesChanged: [],
        authors: [],
        prDate: '',
        commitMessages: [],
        prTitle: '',
        prDescription: '',
        prRawDiff: ''
      };
      
      // Change directory to the folder
      process.chdir(folder);
      
      // Get current branch and latest commit
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
      const latestCommit = execSync('git rev-parse HEAD').toString().trim();
      result.prId = latestCommit;
      
      // Find base branch
      const baseBranch = getBaseBranch();
      Logger.debug(`Base branch for comparison: ${baseBranch}`);
      
      let commits = [];
      
      if (baseBranch) {
        try {
          // Get changed files between base branch and current branch
          const changedFilesOutput = execSync(`git diff --name-only ${baseBranch}...${currentBranch}`).toString().trim();
          Logger.debug(`Changed files between ${baseBranch} and ${currentBranch}: ${changedFilesOutput}`);
          result.filesChanged = changedFilesOutput.split('\n').filter(f => f.trim());
          
          // Get commits between base branch and current branch
          const commitsOutput = execSync(`git log ${baseBranch}..${currentBranch} --pretty=%H`).toString().trim();
          commits = commitsOutput.split('\n').filter(Boolean);
        } catch (e) {
          Logger.debug('Failed to get changed files from branch comparison. Falling back to recent commits.');
          // Fallback to recent commits
          const recentCommitsOutput = execSync('git log -10 --pretty=%H').toString().trim();
          commits = recentCommitsOutput.split('\n').filter(Boolean);
          
          if (commits.length > 0) {
            result.filesChanged = getChangedFilesFromCommits(commits.slice(0, 5));
          }
        }
      } else {
        // Fallback to recent commits
        const recentCommitsOutput = execSync('git log -10 --pretty=%H').toString().trim();
        commits = recentCommitsOutput.split('\n').filter(Boolean);
        
        if (commits.length > 0) {
          result.filesChanged = getChangedFilesFromCommits(commits.slice(0, 5));
        }
      }
      
      // Process commit authors and messages
      const authorsSet = new Set();
      const commitMessages = [];
      
      // Only process commits if we have them
      if (commits.length > 0) {
        for (const commit of commits) {
          try {
            const commitMessage = execSync(`git log -1 --pretty=%B ${commit}`).toString().trim();
            Logger.debug(`Processing commit: ${commitMessage}`);
            
            const authorName = execSync(`git log -1 --pretty=%an ${commit}`).toString().trim();
            authorsSet.add(authorName || 'Unknown');
            
            commitMessages.push({
              message: commitMessage.trim(),
              user: authorName || 'Unknown'
            });
          } catch (e) {
            Logger.debug(`Error processing commit ${commit}: ${e}`);
          }
        }
      }
      
      // If we have no commits but have changed files, add a fallback author
      if (commits.length === 0 && result.filesChanged.length > 0) {
        try {
          // Try to get current git user as fallback
          const fallbackAuthor = execSync('git config user.name').toString().trim() || 'Unknown';
          authorsSet.add(fallbackAuthor);
          Logger.debug(`Added fallback author: ${fallbackAuthor}`);
        } catch (e) {
          authorsSet.add('Unknown');
          Logger.debug('Added Unknown as fallback author');
        }
      }
      
      result.authors = Array.from(authorsSet);
      result.commitMessages = commitMessages;
      
      // Get commit date
      if (latestCommit) {
        const commitDate = execSync(`git log -1 --pretty=%cd --date=format:'%Y-%m-%d' ${latestCommit}`).toString().trim();
        result.prDate = commitDate.replace(/'/g, '');
      }
      
      // Set PR title and description from latest commit if not already set
      if ((!result.prTitle || result.prTitle.trim() === '') && latestCommit) {
        try {
          const latestCommitMessage = execSync(`git log -1 --pretty=%B ${latestCommit}`).toString().trim();
          const messageLines = latestCommitMessage.trim().split('\n');
          result.prTitle = messageLines[0] || '';
          
          if (messageLines.length > 2) {
            result.prDescription = messageLines.slice(2).join('\n').trim();
          }
        } catch (e) {
          Logger.debug(`Error extracting commit message for PR title: ${e}`);
        }
      }
      
      // Reset directory
      process.chdir(originalDir);
      
      results.push(result);
    } catch (e) {
      Logger.error(`Exception in populating Git metadata for AI selection (folder: ${folder}): ${e}`);
      
      // Reset directory if needed
      try {
        process.chdir(originalDir);
      } catch (dirError) {
        Logger.error(`Error resetting directory: ${dirError}`);
      }
    }
  }
  
  // Filter out results with empty filesChanged
  const filteredResults = results.filter(isValidGitResult);

  // Map to required output format
  const formattedResults = filteredResults.map((result) => ({
    prId: result.prId || '',
    filesChanged: Array.isArray(result.filesChanged) ? result.filesChanged : [],
    authors: Array.isArray(result.authors) ? result.authors : [],
    prDate: result.prDate || '',
    commitMessages: Array.isArray(result.commitMessages)
      ? result.commitMessages.map((cm) => ({
        message: cm.message || '',
        user: cm.user || ''
      }))
      : [],
    prTitle: result.prTitle || '',
    prDescription: result.prDescription || '',
    prRawDiff: result.prRawDiff || ''
  }));
  
  return formattedResults;
}

module.exports = {
  getHostInfo,
  getGitMetadataForAiSelection,
  gitAuthor,
  checkAndTruncateVcsInfo
};