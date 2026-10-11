// Stub of nimbalyst.mjs for test-assistant.mjs. STUB_MODE: ok (default) | notrunning | boom
export function listProjects() {
  if (process.env.STUB_MODE === 'notrunning') { const e = new Error('x'); e.code = 'NOT_RUNNING'; throw e; }
  return [{ name: 'alpha', path: 'C:\\Projects\\alpha' }, { name: 'beta', path: 'C:\\Projects\\beta' }];
}
export async function listSessions(projectPath) {
  if (process.env.STUB_MODE === 'boom') throw new Error('endpoint exploded');
  return projectPath.endsWith('alpha')
    ? [{ id: 'a1', title: 'Alpha one', status: 'running' }, { id: 'a2', title: 'Alpha two', status: 'idle' }]
    : [{ id: 'b1', title: 'Beta one', status: 'waiting' }];
}
