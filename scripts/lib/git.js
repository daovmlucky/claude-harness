// git.js — thin wrappers around the git CLI.
const { execFileSync } = require('child_process');

// stdout of a git command, trimmed; null if git fails (not a repo, no git...).
function gitOut(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

function harnessState(harnessRoot) {
  const commit = gitOut(['rev-parse', 'HEAD'], harnessRoot);
  if (!commit) return { commit: 'unknown', dirty: false };
  return { commit, dirty: gitOut(['status', '--porcelain'], harnessRoot) !== '' };
}

module.exports = { gitOut, harnessState };
