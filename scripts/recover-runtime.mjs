import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'output/orchestration');
const stateFile = join(dir, 'state.json');
const recoveryFile = join(dir, 'recovery.json');
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const stamp = () => new Date().toISOString();
const live = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (existsSync(recoveryFile)) {
  const old = JSON.parse(readFileSync(recoveryFile, 'utf8'));
  if (old.status === 'running' && live(old.pid)) throw new Error('Recuperação já ativa: ' + old.pid);
}
const status = { pid: process.pid, status: 'running', phase: 'waiting_initial_integration', startedAt: stamp(), validation: 'not_run', reason: 'Grok cancelled a documentation MCP permission request in headless mode; no code delivered. Recovery uses only local file tools and explicit scoped writes.' };
const save = () => writeFileSync(recoveryFile, JSON.stringify(status, null, 2));
save();
async function waitForSupervisor() {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (!['running', 'stopping'].includes(state.status) || !live(state.supervisorPid)) return;
    await delay(2000);
  }
  throw new Error('Supervisor anterior ainda ativo; não duplicar.');
}
async function run(retry) {
  status.phase = 'retry_' + retry; save();
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['scripts/orchestrate.mjs', '--retry', retry], { cwd: root, shell: false, windowsHide: true, stdio: 'inherit' });
    status.childPid = child.pid; save();
    child.once('error', reject); child.once('close', code => code === 0 ? resolveRun() : reject(new Error('Supervisor terminou com código ' + code)));
  });
}
try {
  await waitForSupervisor();
  await run('runtime');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.jobs?.runtime?.status === 'awaiting_review') {
    await run('integration');
    status.status = 'finished_awaiting_review';
  } else status.status = 'incomplete_manual_followup_required';
} catch(error) { status.status = 'failed'; status.error = String(error); process.exitCode = 1; }
status.finishedAt = stamp(); save();
