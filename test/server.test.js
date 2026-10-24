const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const serverPath = path.join(__dirname, '..', 'server.js');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer(port, databaseFile) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), DATA_FILE: databaseFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before starting:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/admin`);
      if (response.ok) return { child, baseUrl };
    } catch {}
    await delay(50);
  }

  child.kill();
  throw new Error(`Server did not start in time:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function post(baseUrl, route, body) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('form creation, validation, submission, results and persistence', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-service-test-'));
  const databaseFile = path.join(directory, 'db.json');
  let server;
  t.after(async () => {
    if (server) await stopServer(server.child);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const port = await availablePort();
  server = await startServer(port, databaseFile);
  const { baseUrl } = server;

  const invalidDefinition = await post(baseUrl, '/api/admin/forms', { title: 'Invalid', fields: [null] });
  assert.equal(invalidDefinition.status, 400);

  const invalidJson = await fetch(`${baseUrl}/api/admin/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid json',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error, 'Invalid JSON request body');

  const created = await post(baseUrl, '/api/admin/forms', {
    title: 'Internship application',
    fields: [
      { label: 'Name', type: 'text', required: true },
      { label: 'Age', type: 'number', required: false },
      { label: 'Role', type: 'select', required: true, options: ['Engineer', 'Designer'] },
      { label: 'Consent', type: 'checkbox', required: true },
      { label: 'Start date', type: 'date', required: false },
    ],
  });
  assert.equal(created.status, 201);
  const form = await created.json();
  assert.match(form.slug, /^[a-f0-9]{32}$/);

  const publicForm = await fetch(`${baseUrl}/api/forms/${form.slug}`);
  assert.equal(publicForm.status, 200);
  assert.equal((await publicForm.json()).fields.length, 5);
  const adminForm = await fetch(`${baseUrl}/api/admin/forms/${form.slug}`);
  assert.equal(adminForm.status, 200);
  assert.equal((await adminForm.json()).slug, form.slug);
  const missingAdminForm = await fetch(`${baseUrl}/api/admin/forms/not-a-real-form`);
  assert.equal(missingAdminForm.status, 404);

  const missingRequiredAnswer = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1', answers: { f1: 'Ada', f2: '', f3: 'Engineer', f4: false },
  });
  assert.equal(missingRequiredAnswer.status, 400);

  const malformedAnswers = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1', answers: [],
  });
  assert.equal(malformedAnswers.status, 400);

  const invalidNumber = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1', answers: { f1: 'Ada', f2: 'not a number', f3: 'Engineer', f4: true },
  });
  assert.equal(invalidNumber.status, 400);

  const invalidOption = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1', answers: { f1: 'Ada', f2: '36', f3: 'Hacker', f4: true },
  });
  assert.equal(invalidOption.status, 400);

  const invalidDate = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1', answers: { f1: 'Ada', f2: '36', f3: 'Engineer', f4: true, f5: '2024-02-30' },
  });
  assert.equal(invalidDate.status, 400);

  const reached = await post(baseUrl, `/api/forms/${form.slug}/progress`, { sessionId: 'session-1', fieldId: 'f1' });
  assert.equal(reached.status, 200);
  const submitted = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1',
    answers: { f1: 'Ada', f2: '36', f3: 'Engineer', f4: true, f5: '2024-02-29' },
  });
  assert.equal(submitted.status, 201);

  const duplicate = await post(baseUrl, `/api/forms/${form.slug}/responses`, {
    sessionId: 'session-1',
    answers: { f1: 'Ada', f2: '36', f3: 'Engineer', f4: true, f5: '2024-02-29' },
  });
  assert.equal(duplicate.status, 409);

  const results = await fetch(`${baseUrl}/api/admin/forms/${form.slug}/results`);
  assert.equal(results.status, 200);
  const resultData = await results.json();
  assert.equal(resultData.stats.started, 1);
  assert.equal(resultData.stats.submitted, 1);
  assert.equal(resultData.responses.length, 1);

  await stopServer(server.child);
  server = undefined;
  const restarted = await startServer(port, databaseFile);
  server = restarted;
  const persistedForms = await fetch(`${restarted.baseUrl}/api/admin/forms`);
  assert.equal(persistedForms.status, 200);
  assert.equal((await persistedForms.json()).length, 1);
});

test('corrupted storage reports an error instead of appearing empty', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-service-corrupt-test-'));
  const databaseFile = path.join(directory, 'db.json');
  fs.writeFileSync(databaseFile, '{invalid json');
  let server;
  t.after(async () => {
    if (server) await stopServer(server.child);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  server = await startServer(await availablePort(), databaseFile);
  const response = await fetch(`${server.baseUrl}/api/admin/forms`);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Internal server error');
});
