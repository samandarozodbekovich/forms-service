# Forms service

A small form builder. A manager builds an application form in the admin panel and publishes it
under a unique link. Students open the link and submit answers. The manager reads the answers
and sees where people abandon the form.

## Run

```
npm install
npm start
```

- Admin panel: http://localhost:3000/admin (no authorization, as required)
- Since the admin panel and results API are intentionally unauthenticated, do not expose this MVP
  to the public internet or use it for real student personal data.
- Public forms: the link shown in the admin panel, for example http://localhost:3000/f/ab12cd34ef
- Change the port with the `PORT` environment variable. In PowerShell: `$env:PORT=4000; npm start`.
  In cmd.exe: `set PORT=4000 && npm start`. On macOS/Linux: `PORT=4000 npm start`.
- Run the integration tests with `npm test`.
- AI-assisted work is summarized in [AI-LOG.md](./AI-LOG.md).
- Requires Node.js 20 or newer. The only dependency is `express`. Data is stored in `data/db.json`
  (created on first write). Set `DATA_FILE` to use a different database file.

## What it does

- Question types: short text, long text, number, dropdown, checkbox, date. Each can be required.
- Answers are validated on the server (required fields, numbers, dates, dropdown values and input types).
- Repeated submissions from the same form session are rejected.
- Published forms can be reused as editable templates, and question order can be changed before publishing.
- The admin panel lists answers in a table and exports responses to CSV.
- **Drop-off report (the second problem in the brief).** The student page tells the server when a
  question is first focused. The results view shows how many people reached each question, the
  share of those who started, and the question where the most people stopped.

## Decisions and trade-offs

- **JSON file instead of SQLite.** Native SQLite packages need a compiler on some machines, and
  `npm install` must never fail. Writes use a temporary file and atomic rename. A missing file
  starts as an empty database; malformed or unreadable data is reported instead of silently replaced.
  This single-process storage is intended for a local MVP; real multi-instance traffic should use a
  database such as PostgreSQL.
- **No frontend framework.** Plain HTML and JavaScript means no build step, so `npm start` is enough.
  Student text is always inserted with `textContent`, so answers cannot inject HTML into the admin panel.
- **Left out on purpose:** admin authorization (not wanted in the brief), editing a published form,
  file uploads, rate limiting. Anonymous drop-off sessions are never cleaned up.
