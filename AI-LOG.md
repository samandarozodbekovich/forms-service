# AI work log

Tools used: Claude (chat assistant) for the first version; Claude for review and improvements.

## 1. Initial version (Claude)

- Read the task brief and agreed on the stack: Node.js 20 + Express, a JSON file for storage
  (to avoid native SQLite builds that could break `npm install`), plain HTML/JS frontend (no build step).
- Generated the first version: admin form builder, public form page, REST API, server-side validation,
  and a drop-off report (the form page reports the first focus on each question to the server).
- Tested the API with curl and the pages in a simulated browser (jsdom).

## 2. Review and improvements claude ai

Goal: review the MVP against the brief and harden it.

- Fixed storage handling so a missing database starts empty while malformed or unreadable data is reported rather than silently replaced.
- Added strict server-side validation for form definitions and for text, number, date, dropdown, checkbox, and required answers.
- Strengthened publication links, rejected repeat submissions from the same form session, and returned JSON errors for malformed or oversized API requests.
- Improved browser-side required-field checks, submission feedback, duplicate-click prevention, and admin loading/error states.
- Added integration tests (creation, validation, submission, results, persistence after restart, corrupt storage).
- Added reusable published-form templates, question reordering, and a CSV export with spreadsheet-formula protection.
- Updated setup and testing instructions in the README.

## Verification

- `node --check server.js`, `node --check test/server.test.js`
- `npm test`: 2 integration tests passed.
- Browser smoke test: created a form, confirmed a required field blocks an empty submission, submitted an answer, and verified it appears in admin results.
- Browser UX check: reordered questions, copied a published form as a template, published it under a different link, and verified CSV export quotes values and prefixes formula-like answers.
- `npm audit fix`: 0 vulnerabilities; clean clone tested with `npm install` and `npm start`.

## My own role

- I am a Python/Django developer new to Node.js. I first considered a separate Python backend, but the brief
  requires Node.js 20 and a two-command start (`npm install`, `npm start`), so I kept everything in one Node.js project.
- I used the assistant to explain the purpose of the task and to translate the brief into my own language,
  so that I understood the requirements before building.
- I chose the stack together with the assistant (Express, JSON file storage, plain HTML/JS frontend) and
  accepted the trade-offs written in the README.
- I had the finished project checked against the brief's technical requirements: Node.js 20+, `npm install` and
  `npm start`, port 3000 with `PORT`, no external dependencies, `/admin` without authorization, and this AI log.
- On my own Windows machine I ran `npm install`, `npm audit fix` (0 vulnerabilities), `npm test`
  (2 integration tests passed) and `npm start`.