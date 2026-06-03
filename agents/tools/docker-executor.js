/**
 * Docker execution tool — called by n8n Code Tool nodes.
 * Runs a command inside the assignment container and returns stdout/stderr.
 *
 * Exported as a module AND usable as inline code in n8n toolCode nodes.
 */

const { execSync, spawnSync } = require('child_process');

const CONTAINER = process.env.DOCKER_CONTAINER_NAME || 'assignment-runner';

/**
 * Run a shell command inside the Docker container.
 * @param {string} command  - shell command to run
 * @param {string} workdir  - working directory inside container (e.g. /workspace/fit1045/ass1)
 * @param {number} timeout  - ms, default 60000
 * @returns {{ stdout, stderr, exitCode, success }}
 */
function runInDocker(command, workdir = '/workspace', timeout = 60000) {
  const cmd = `docker exec -w "${workdir}" ${CONTAINER} bash -c ${JSON.stringify(command)}`;
  try {
    const result = spawnSync('docker', [
      'exec', '-w', workdir, CONTAINER, 'bash', '-c', command
    ], { timeout, encoding: 'utf8' });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.status ?? 1,
      success: result.status === 0,
    };
  } catch (e) {
    return { stdout: '', stderr: e.message, exitCode: 1, success: false };
  }
}

/**
 * Copy a file into the container.
 */
function copyToContainer(localPath, containerPath) {
  try {
    execSync(`docker cp "${localPath}" ${CONTAINER}:${containerPath}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Copy a file out of the container.
 */
function copyFromContainer(containerPath, localPath) {
  try {
    execSync(`docker cp ${CONTAINER}:${containerPath} "${localPath}"`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Sync an entire local directory into the container workspace.
 */
function syncWorkspaceToContainer(localDir, containerDir) {
  // Docker volumes handle this automatically if using docker-compose.
  // This is a fallback for manual sync.
  const result = runInDocker(`mkdir -p "${containerDir}"`, '/');
  if (!result.success) return result;
  try {
    execSync(`docker cp "${localDir}/." ${CONTAINER}:${containerDir}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { runInDocker, copyToContainer, copyFromContainer, syncWorkspaceToContainer };

// ── n8n toolCode inline snippet (paste into n8n Code Tool node) ──────────────
//
// const { spawnSync } = require('child_process');
// const command   = $fromAI('command',  'Shell command to run inside the Docker container', 'string');
// const workdir   = $fromAI('workdir',  'Working directory inside container',                'string');
// const container = process.env.DOCKER_CONTAINER_NAME || 'assignment-runner';
// const result = spawnSync('docker', ['exec', '-w', workdir, container, 'bash', '-c', command], {
//   timeout: 120000, encoding: 'utf8'
// });
// return JSON.stringify({
//   stdout:   result.stdout   || '',
//   stderr:   result.stderr   || '',
//   exitCode: result.status   ?? 1,
//   success:  result.status === 0,
// });
