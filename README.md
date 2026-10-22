# Folio — personal resume workspace

A small HTML, CSS, and JavaScript app with a Python localhost server. Create a separate workspace for each person, save their details, choose a role and template, and download a searchable PDF. No frontend build tools, database, or account needed.

## Run

Requires Python 3.10 or newer. From this directory:

```sh
sh start.sh
```

Open **http://localhost:8000**. The launcher creates a local virtual environment, installs the two dependencies, and starts the server. Stop with Ctrl+C.

Or set up manually:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

For the editor and browser **Print / Save PDF** without dependencies, run `python3 server.py`. Direct PDF download needs ReportLab; PDF text import needs pypdf. DOCX text import uses Python’s standard library. Opening `index.html` directly is not supported; use the localhost URL.

If port 8000 is busy, use `PORT=8001 .venv/bin/python server.py`. All browsers and localhost ports served by this project use the same local `data` directory. Profiles are restored from that directory.

## Workflow

1. Enter a name in **Who is this being created for?**, or choose a saved profile. The example profile contains fictional information.
2. Fill in contact details, summary, skills, experience, education, projects, certifications, languages, and awards. Changes save as you type.
3. Import TXT, Markdown, PDF, or DOCX files, or paste source notes. Extracted text is retained with the profile. Optional AI organizes it into a reviewable draft; otherwise, use it as a reference and fill the form manually. Scanned PDFs need OCR elsewhere first. Original files are not retained.
4. Select a target direction: AI, frontend, backend, full stack, data, product, or general. Relevant supplied skills and projects move first using keyword matching. Experience stays in the order you enter it; enter your most recent experience first. Paste a job description for a word overlap check. This is not an ATS score or hiring prediction.
5. Select **Modern**, **Classic**, **Compact**, or **Graduate**, and A4 or US Letter. Graduate puts education first. Other templates vary typography, spacing, header alignment, and accent color.
6. Download the PDF. Every successful download of the current resume saves a snapshot in **My resumes**. Save versions manually, restore versions, or download earlier PDFs. Restoring or applying an AI draft saves the previous profile first.

The HTML preview is a continuous approximation. PDF export uses ReportLab with automatic pagination. The browser print option uses the HTML layout and your browser’s settings; turn off browser headers and footers. Content is not truncated to force one page. Check the exported document before applying.

## Optional AI

Copy `.env.example` to `.env`, add your key, and restart:

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4o-mini
```

The default is a configurable Structured Outputs capable model, not a claim about the latest or best model. Use a model your API account can access. The implementation uses the [OpenAI Responses API and Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) via Python’s standard HTTP library. No OpenAI SDK is required.

- **Organize with AI** merges source text into profile fields.
- **Create an AI draft** refines the profile for the target role and job description.
- Drafts are applied only after review and clicking **Apply this draft**.
- The prompt instructs the model to preserve facts and leave unknowns blank. Review the output: AI can still make mistakes.
- Keys stay on the server, outside frontend code and browser storage. `.env` is gitignored.
- Explicit AI actions transmit profile details, source notes (for extraction), and job descriptions to OpenAI. Requests use `store: false`; provider data policies still apply. API usage may incur charges.

## Storage and privacy

Profiles, source notes, role targets, selected templates, and history autosave to **`data/workspace.sqlite3`** on this computer. SQLite uses WAL and full synchronous commits. A save is shown as **Saved to disk** only after the transaction commits. Restart the server and refresh the page to restore your workspace. Keep the `data` folder when moving or reinstalling the app. It is gitignored.

New entries are saved **directly to the local directory**, through the Python server. The app does not write resume data to browser localStorage. Every input starts a disk-save request; rapid edits are serialized. A readable **`data/workspace.json`** copy is atomically replaced and flushed on each successful database save. SQLite remains authoritative; the JSON copy can also be imported as a Folio backup.

Startup must connect to the local folder before opening the editor. Existing browser data from older versions is imported when appropriate and removed from those old browser keys only after its folder save is acknowledged. New data is always loaded from the folder, independent of browser or port. If a save fails, a persistent warning appears, retries continue, and closing the tab warns about unconfirmed changes. Keep the tab open until **Saved to local folder** appears. Unacknowledged edits are held in memory, so a browser crash before a save completes can still lose those latest edits.

Revision checks prevent an older tab from silently overwriting newer data. On conflict, different profile versions are retained as separate profiles. Names, incomplete drafts, and history identifiers survive reloading. Source notes now autosave without needing the Save notes button.

The database retains the latest 100 snapshots and falls back to an earlier valid snapshot if a saved payload is corrupted. A separate consistent copy, `data/workspace.backup.sqlite3`, is refreshed on startup, after the first save, and on saves at least five minutes apart. For recovery from a damaged database file, stop the app, preserve the existing data directory, then copy the backup to a separate recovery directory as `workspace.sqlite3` before replacing the active directory. Do not replace a database while its server is running or mix it with another database’s WAL files.

Use **Back up workspace** or **Export profile** for independent JSON copies. No local saving system can guarantee recovery from physical disk loss or deletion of every copy. Exported backups should also be kept outside this computer for that case. The exact storage path appears in **AI & settings**. If disk saving fails, the status reports **Not saved to folder · reconnect**, and the app warns before closing. A separate warning reports a failed readable JSON refresh even when the database transaction succeeded.

Profiles are local workspaces without authentication or encryption. Anyone with access to this computer or server can access them. Old snapshots and exported backups may retain deleted profiles. Upload processing happens locally in memory; only explicit AI actions send resume details to OpenAI. The server serves only explicit public assets and rejects cross-origin requests and unexpected hostnames. The Google Fonts stylesheet uses the network; system fonts work offline.

### Persistence checks

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/persistence.test.cjs
```

These cover server restart, abrupt exit during an uncommitted transaction, corruption recovery, concurrent writers, browser migration, direct folder saves without browser writes, failed saves and retries, and in-flight edits.

## Formats and guidance

There is **no resume format accepted by every company or every applicant tracking system**. Employer instructions and regional conventions take priority. These four original templates use single columns, standard headings, and selectable text. They avoid photos and graphics in the PDF. They are not official university templates or a guarantee of ATS compatibility.

See [Harvard’s resume guidance](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/) for factual wording, readability, consistent formatting, reverse chronological experience, and tailoring. The exporter embeds Arial on macOS or DejaVu Sans on Linux when available. Classic uses built-in Times. Unsupported scripts may require other fonts and shaping support; multilingual and right-to-left typesetting are not fully supported.

## Files

- `index.html`: page structure and dialogs.
- `styles.css`: responsive workspace and template styling.
- `app.js`: editor, profiles, targeting, backups, AI review, and history.
- `server.py`: assets, file extraction, PDF export, optional AI.
- `storage.py`: transactional disk saves, revisions, snapshots, and database backup.
- `persistence.js`: direct folder saves, migration of old browser data, and conflict recovery.
- `requirements.txt`: ReportLab and pypdf.
- `start.sh`: environment setup and launcher.

No analytics, trackers, frontend packages, or build step. Network access is required for initial dependency installation and optional AI requests.
