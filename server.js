// Form builder service: Express API + static pages. Data lives in one JSON file.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];
const emptyDatabase = () => ({ forms: [], responses: [], sessions: {} });

// ---- Storage: a single JSON file, written atomically (tmp file + rename) ----
function load() {
  let contents;
  try {
    contents = fs.readFileSync(DB_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDatabase();
    throw error;
  }

  const db = JSON.parse(contents);
  if (!db || !Array.isArray(db.forms) || !Array.isArray(db.responses)
    || !db.sessions || typeof db.sessions !== 'object' || Array.isArray(db.sessions)) {
    throw new Error(`Invalid database structure in ${DB_FILE}`);
  }
  return db;
}
function save(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tempFile = `${DB_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    try {
      fs.unlinkSync(tempFile);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Could not remove temporary database file:', cleanupError);
    }
    throw error;
  }
}
const findForm = (db, slug) => db.forms.find((f) => f.slug === slug);

// ---- Validation helpers ----
// Normalize the form definition sent by the admin UI. Returns null if invalid.
function cleanFields(fields) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 50) return null;
  const out = [];
  for (const [i, f] of fields.entries()) {
    if (!f || typeof f !== 'object' || Array.isArray(f)
      || typeof f.label !== 'string' || !TYPES.includes(f.type)
      || (f.required !== undefined && typeof f.required !== 'boolean')) return null;
    const label = f.label.trim();
    if (!label || label.length > 200) return null;
    const field = { id: 'f' + (i + 1), label, type: f.type, required: f.required === true };
    if (f.type === 'select') {
      if (!Array.isArray(f.options) || f.options.length < 1 || f.options.length > 100) return null;
      field.options = f.options.map((o) => typeof o === 'string' ? o.trim() : '');
      if (field.options.some((o) => !o || o.length > 200)) return null;
    }
    out.push(field);
  }
  return out;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

// Check a student's answers against the form definition.
function checkAnswers(form, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { error: 'Answers must be an object' };
  }
  const out = {};
  for (const f of form.fields) {
    let v = answers[f.id];
    const empty = v === undefined || v === null || v === false || (typeof v === 'string' && !v.trim());
    if (empty) {
      if (f.required) return { error: `"${f.label}" is required` };
      out[f.id] = f.type === 'checkbox' ? false : '';
      continue;
    }
    if (f.type === 'number') {
      if ((typeof v !== 'string' && typeof v !== 'number') || !Number.isFinite(Number(v))) {
        return { error: `"${f.label}" must be a number` };
      }
      v = Number(v);
    } else if (f.type === 'select') {
      if (typeof v !== 'string' || !f.options.includes(v)) return { error: `"${f.label}" has an invalid option` };
    } else if (f.type === 'checkbox') {
      if (typeof v !== 'boolean') return { error: `"${f.label}" must be checked or unchecked` };
      v = true;
    } else if (f.type === 'date') {
      if (typeof v !== 'string' || !isValidDate(v)) return { error: `"${f.label}" must be a valid date` };
    } else {
      if (typeof v !== 'string') return { error: `"${f.label}" must be text` };
      if (v.length > 5000) return { error: `"${f.label}" must be 5000 characters or fewer` };
    }
    out[f.id] = v;
  }
  return { answers: out };
}

// A "session" is one browser visit to a form; it powers the drop-off report.
function touchSession(db, slug, sid) {
  return (db.sessions[slug + ':' + sid] ||= { slug, reached: [], submitted: false });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/f/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'form.html')));

// ---- Admin API ----
app.get('/api/admin/forms', (req, res) => {
  const db = load();
  res.json(db.forms.map((f) => ({
    slug: f.slug, title: f.title,
    responseCount: db.responses.filter((r) => r.slug === f.slug).length,
  })).reverse());
});

app.post('/api/admin/forms', (req, res) => {
  const title = typeof (req.body && req.body.title) === 'string' ? req.body.title.trim() : '';
  const fields = cleanFields(req.body && req.body.fields);
  if (!title || title.length > 200) return res.status(400).json({ error: 'Form title is required and must be 200 characters or fewer' });
  if (!fields) return res.status(400).json({ error: 'Every question needs text, and dropdowns need options' });
  const db = load();
  let slug;
  do { slug = crypto.randomBytes(16).toString('hex'); } while (findForm(db, slug));
  const form = { slug, title, fields, createdAt: new Date().toISOString() };
  db.forms.push(form);
  save(db);
  res.status(201).json(form);
});

app.get('/api/admin/forms/:slug', (req, res) => {
  const form = findForm(load(), req.params.slug);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  res.json(form);
});

app.get('/api/admin/forms/:slug/results', (req, res) => {
  const db = load();
  const form = findForm(db, req.params.slug);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const sessions = Object.values(db.sessions).filter((s) => s.slug === form.slug);
  res.json({
    form,
    responses: db.responses.filter((r) => r.slug === form.slug),
    stats: {
      started: sessions.length,
      submitted: sessions.filter((s) => s.submitted).length,
      // How many visitors reached (focused) each question.
      reached: form.fields.map((f) => ({ id: f.id, label: f.label, count: sessions.filter((s) => s.reached.includes(f.id)).length })),
    },
  });
});

// ---- Public API (used by the student page) ----
app.get('/api/forms/:slug', (req, res) => {
  const form = findForm(load(), req.params.slug);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  res.json({ slug: form.slug, title: form.title, fields: form.fields });
});

app.post('/api/forms/:slug/progress', (req, res) => {
  const db = load();
  const form = findForm(db, req.params.slug);
  const { sessionId, fieldId } = req.body || {};
  if (!form || typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 64 || !form.fields.some((f) => f.id === fieldId)) {
    return res.status(400).json({ error: 'Bad request' });
  }
  const s = touchSession(db, form.slug, sessionId);
  if (!s.reached.includes(fieldId)) { s.reached.push(fieldId); save(db); }
  res.json({ ok: true });
});

app.post('/api/forms/:slug/responses', (req, res) => {
  const db = load();
  const form = findForm(db, req.params.slug);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const result = checkAnswers(form, req.body && req.body.answers);
  if (result.error) return res.status(400).json({ error: result.error });
  const sid = req.body && req.body.sessionId;
  if (typeof sid !== 'string' || !sid.trim() || sid.length > 64) {
    return res.status(400).json({ error: 'A valid session ID is required' });
  }
  const session = touchSession(db, form.slug, sid);
  if (session.submitted) return res.status(409).json({ error: 'This application has already been submitted' });
  session.submitted = true;
  session.reached = form.fields.map((f) => f.id); // a finished form means every question was reached (covers autofill)
  db.responses.push({ slug: form.slug, answers: result.answers, createdAt: new Date().toISOString() });
  save(db);
  res.status(201).json({ ok: true });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 400 || error.status === 413 ? error.status : 500;
  if (status === 500) console.error('Request failed:', error);
  res.status(status).json({
    error: status === 413 ? 'Request body is too large' : status === 400 ? 'Invalid JSON request body' : 'Internal server error',
  });
});

app.listen(PORT, () => console.log(`Forms service running: http://localhost:${PORT}/admin`));
