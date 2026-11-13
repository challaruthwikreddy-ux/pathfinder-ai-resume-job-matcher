# Pathfinder — Resume and Job Matcher

Pathfinder is a web application for the Software Engineering and System Design course project. It extracts skills from PDF, DOCX, and TXT resumes, compares them with job requirements, and shows ranked matches.

## Features

- Resume upload with PDF, DOCX, and TXT parsing.
- Skill and experience extraction, plus match scores and skill-gap details.
- Searchable job board with six sample roles and the ability to add personal roles.
- Dashboard, recent activity, market skill trends, and CSV exports.
- SQLite persistence when run locally, plus a searchable database browser.
- FastAPI backend, responsive frontend, and interactive API docs at `/docs`.
- Separate browser workspaces on the public demo; resume files are processed in memory and full extracted text is not retained.

## Run locally on Windows

Install Python 3.10 or newer, open PowerShell in this folder, and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
./Start-Pathfinder.ps1
```

Open <http://127.0.0.1:8000>. The app creates `data/matcher.db` and seeds six sample roles on first run. Locally, the SQLite file persists between restarts.

To run manually instead:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
```

## Run with Docker

```sh
docker compose up --build
```

Open <http://localhost:8000>. Compose keeps the SQLite database in a named volume.

## Publish a public demo with Render

1. Put this project folder in a **new public GitHub repository**. Do not upload `.venv`, `.env`, `data/matcher.db`, or any resume files; the included `.gitignore` excludes them.
2. In Render, create a **Blueprint** from that repository and deploy the included `render.yaml`.
3. Render builds the Docker image and gives the site a public `onrender.com` address. Share that address so anyone can open the site.

### Free demo limits and resume privacy

The included Render configuration uses a free web service and temporary SQLite storage. Free Render services sleep after 15 minutes without traffic, take about a minute to start again, and lose local files when they sleep, restart, or redeploy. Pathfinder will recreate the six sample jobs; uploaded profiles and roles added by visitors can be cleared. The free Render Postgres option expires after 30 days, so this setup does not use it. [Render free-service limits](https://render.com/docs/free).

Each browser creates an unguessable workspace ID and sends it with API requests so its resumes and added roles are kept separate from other visitors in the normal app. There is no user account or authentication; this is a course-project demo, not a production privacy boundary. Visitors should avoid confidential resumes. Uploaded files are parsed in memory, while extracted name, email, skills, and match results are stored in the hosted database until the host clears it or the visitor deletes their workspace data in **Data**. Clearing browser storage loses access to that browser’s workspace.

For persistent production use, deploy on a paid host with managed PostgreSQL and add real user authentication, retention controls, backups, and operational monitoring before accepting sensitive resumes.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status |
| `GET` | `/api/database/info` | Current browser workspace database counts |
| `DELETE` | `/api/workspace/data` | Delete current browser workspace data |
| `GET` | `/api/dashboard` | Workspace dashboard totals and recent resumes |
| `GET`, `POST` | `/api/resumes` | List or upload resumes |
| `GET`, `DELETE` | `/api/resumes/{id}` | View or remove a resume |
| `GET`, `POST` | `/api/jobs` | List/search or add workspace-specific roles |
| `DELETE` | `/api/jobs/{id}` | Remove a workspace-specific role |
| `GET` | `/api/matches?resume_id={id}` | List saved match results |
| `POST` | `/api/matches/run?resume_id={id}` | Recalculate a resume’s matches |
| `GET` | `/api/analytics` | Workspace candidate skill counts and job demand |

API calls that access workspace data require the `X-Workspace-ID` header created by the browser app.

## Match scoring

The score combines required-skill coverage (82%) and preferred-skill coverage (18%). A resume below a role’s minimum experience receives a small 10% adjustment. The score is a screening aid; it does not judge resume quality or guarantee job suitability.

## Project structure

```text
backend/
  main.py             FastAPI routes, parsing, matching, and SQLite data access
  frontend/
    index.html        App pages and dialogs
    styles.css        Responsive UI styles
    app.js            Frontend navigation, forms, and API calls
data/                 Local SQLite database (created on first run)
requirements.txt
Dockerfile
compose.yaml
render.yaml           Render Blueprint configuration
Start-Pathfinder.ps1
```

