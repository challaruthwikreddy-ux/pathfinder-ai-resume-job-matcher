from __future__ import annotations

import io
import json
import os
import re
import sqlite3
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from xml.etree import ElementTree

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from pypdf import PdfReader
except ImportError:  # PDF support is reported clearly if the optional dependency is absent.
    PdfReader = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = Path(__file__).resolve().parent / "frontend"
DB_PATH = Path(os.getenv("APP_DB_PATH", PROJECT_ROOT / "data" / "matcher.db"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
APP_VERSION = "1.2.0"
LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001"

SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "Python": ("python",), "Java": ("java",), "JavaScript": ("javascript", "js"),
    "TypeScript": ("typescript", "ts"), "C++": ("c++", "cpp"), "C#": ("c#", "csharp"),
    "Go": ("golang", "go"), "Rust": ("rust",), "SQL": ("sql",), "HTML": ("html",),
    "CSS": ("css",), "React": ("react", "react js", "reactjs"), "Next.js": ("next js", "nextjs"),
    "Node.js": ("node js", "nodejs", "node"), "Express": ("express", "express js"),
    "FastAPI": ("fastapi", "fast api"), "Django": ("django",), "Flask": ("flask",),
    "Spring Boot": ("spring boot",), "REST APIs": ("rest api", "rest apis", "restful api", "restful apis"),
    "GraphQL": ("graphql",), "Microservices": ("microservices", "microservice architecture"),
    "PostgreSQL": ("postgresql", "postgres"), "MySQL": ("mysql",), "MongoDB": ("mongodb", "mongo db"),
    "SQLite": ("sqlite",), "Redis": ("redis",), "AWS": ("aws", "amazon web services"),
    "Azure": ("azure",), "Google Cloud": ("google cloud", "gcp"), "Docker": ("docker",),
    "Kubernetes": ("kubernetes", "k8s"), "CI/CD": ("ci/cd", "continuous integration", "continuous delivery"),
    "Git": ("git",), "Linux": ("linux",), "Machine Learning": ("machine learning", "ml"),
    "Deep Learning": ("deep learning",), "NLP": ("natural language processing", "nlp"),
    "TensorFlow": ("tensorflow",), "PyTorch": ("pytorch",), "Pandas": ("pandas",),
    "Data Analysis": ("data analysis", "data analytics"), "Data Visualization": ("data visualization",),
    "Power BI": ("power bi",), "Tableau": ("tableau",), "Figma": ("figma",),
    "UI/UX Design": ("ui/ux", "ux design", "user experience", "user interface design"),
    "Agile": ("agile",), "Scrum": ("scrum",), "Communication": ("communication",),
    "Problem Solving": ("problem solving", "problem-solving"), "Leadership": ("leadership",),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect_db() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SEED_JOBS = [
    {
        "company": "Northstar Labs", "title": "Junior Full Stack Developer", "location": "Remote · India",
        "employment_type": "Full-time", "salary_range": "₹6–10 LPA", "level": "Entry level", "min_experience": 0,
        "description": "Build customer-facing product features across a modern web stack. Work with designers and engineers to ship reliable software.",
        "required_skills": ["JavaScript", "React", "Node.js", "REST APIs", "Git"], "preferred_skills": ["TypeScript", "PostgreSQL", "Docker"],
    },
    {
        "company": "Finora", "title": "Python Backend Engineer", "location": "Bengaluru, India",
        "employment_type": "Full-time", "salary_range": "₹10–16 LPA", "level": "Mid level", "min_experience": 2,
        "description": "Design APIs and data services for a high-volume financial platform. Own services from implementation through monitoring.",
        "required_skills": ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Docker"], "preferred_skills": ["AWS", "Redis", "CI/CD"],
    },
    {
        "company": "Orbit Health", "title": "Machine Learning Associate", "location": "Hyderabad, India",
        "employment_type": "Full-time", "salary_range": "₹8–14 LPA", "level": "Entry level", "min_experience": 1,
        "description": "Prepare data and build machine learning prototypes that improve patient operations. Partner with product and analytics teams.",
        "required_skills": ["Python", "Machine Learning", "Pandas", "SQL", "Data Analysis"], "preferred_skills": ["NLP", "PyTorch", "AWS"],
    },
    {
        "company": "Pixel & Form", "title": "Product Designer", "location": "Remote · India",
        "employment_type": "Full-time", "salary_range": "₹7–12 LPA", "level": "Mid level", "min_experience": 2,
        "description": "Shape intuitive product workflows from discovery to polished UI. Create prototypes, test ideas, and work closely with engineering.",
        "required_skills": ["Figma", "UI/UX Design", "Communication", "Problem Solving"], "preferred_skills": ["Data Analysis", "Agile", "Leadership"],
    },
    {
        "company": "CloudKite", "title": "Cloud & Platform Engineer", "location": "Pune, India",
        "employment_type": "Full-time", "salary_range": "₹12–20 LPA", "level": "Mid level", "min_experience": 3,
        "description": "Help teams deploy and operate secure cloud services. Improve automation, reliability, and developer experience.",
        "required_skills": ["AWS", "Docker", "Kubernetes", "Linux", "CI/CD"], "preferred_skills": ["Python", "Go", "Terraform", "Git"],
    },
    {
        "company": "MetricSpring", "title": "Data Analyst", "location": "Mumbai, India",
        "employment_type": "Full-time", "salary_range": "₹6–11 LPA", "level": "Entry level", "min_experience": 0,
        "description": "Turn product and business data into useful reporting. Build dashboards, investigate trends, and communicate findings.",
        "required_skills": ["SQL", "Data Analysis", "Power BI", "Excel", "Communication"], "preferred_skills": ["Python", "Pandas", "Tableau"],
    },
]


def initialize_database() -> None:
    with connect_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS resumes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT,
                candidate_name TEXT NOT NULL,
                email TEXT,
                filename TEXT NOT NULL,
                skills_json TEXT NOT NULL,
                experience_years INTEGER NOT NULL DEFAULT 0,
                extracted_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT,
                company TEXT NOT NULL,
                title TEXT NOT NULL,
                location TEXT NOT NULL,
                employment_type TEXT NOT NULL,
                salary_range TEXT NOT NULL,
                level TEXT NOT NULL,
                min_experience INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL,
                required_skills_json TEXT NOT NULL,
                preferred_skills_json TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id TEXT,
                resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
                job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                score INTEGER NOT NULL,
                matched_skills_json TEXT NOT NULL,
                missing_skills_json TEXT NOT NULL,
                summary TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(resume_id, job_id)
            );
        """)
        # Older local project databases are upgraded in place. Existing public
        # releases start with an empty, isolated database and shared sample jobs.
        for table in ("resumes", "jobs", "matches"):
            columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if "workspace_id" not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN workspace_id TEXT")
        if os.getenv("APP_ENV", "local") != "public":
            for table in ("resumes", "jobs", "matches"):
                conn.execute(f"UPDATE {table} SET workspace_id=? WHERE workspace_id IS NULL", (LOCAL_WORKSPACE_ID,))
        conn.execute("CREATE INDEX IF NOT EXISTS idx_resumes_workspace ON resumes(workspace_id, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id, is_active)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_matches_workspace ON matches(workspace_id, score)")
        count = conn.execute("SELECT COUNT(*) FROM jobs WHERE is_active=1").fetchone()[0]
        if count == 0:
            for job in SEED_JOBS:
                conn.execute("""INSERT INTO jobs
                    (company,title,location,employment_type,salary_range,level,min_experience,description,required_skills_json,preferred_skills_json,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (
                    job["company"], job["title"], job["location"], job["employment_type"], job["salary_range"],
                    job["level"], job["min_experience"], job["description"], json.dumps(job["required_skills"]),
                    json.dumps(job["preferred_skills"]), utc_now()))


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9+#/]+", " ", text.casefold()).strip()


def extract_skills(text: str) -> list[str]:
    haystack = f" {normalize(text)} "
    found: list[str] = []
    for skill, aliases in SKILL_ALIASES.items():
        for alias in aliases:
            phrase = f" {normalize(alias)} "
            if phrase in haystack:
                found.append(skill)
                break
    return found


def extract_text(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        if PdfReader is None:
            raise HTTPException(status_code=500, detail="PDF support is unavailable. Install the project requirements and restart.")
        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read this PDF: {exc}") from exc
    if suffix == ".docx":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            return "\n".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read this DOCX. Please upload a valid Word document.") from exc
    return data.decode("utf-8", errors="ignore")


def guess_candidate_name(filename: str, text: str) -> str:
    for line in text.splitlines()[:8]:
        clean = re.sub(r"\s+", " ", line).strip(" \t|,-")
        if 2 <= len(clean) <= 70 and "@" not in clean and not re.search(r"\d{5,}", clean):
            if len(clean.split()) <= 5:
                return clean
    return Path(filename).stem.replace("_", " ").replace("-", " ").title()


def match_score(resume_skills: list[str], experience: int, job: sqlite3.Row) -> tuple[int, list[str], list[str], str]:
    required = json.loads(job["required_skills_json"])
    preferred = json.loads(job["preferred_skills_json"])
    resume_set = set(resume_skills)
    matched_required = [skill for skill in required if skill in resume_set]
    missing = [skill for skill in required if skill not in resume_set]
    matched_preferred = [skill for skill in preferred if skill in resume_set]
    required_coverage = len(matched_required) / max(len(required), 1)
    preferred_coverage = len(matched_preferred) / max(len(preferred), 1)
    base = 0.82 * required_coverage + 0.18 * preferred_coverage
    experience_factor = 1.0 if experience >= int(job["min_experience"]) else 0.9
    score = max(0, min(99, round(base * experience_factor * 100)))
    all_matched = matched_required + matched_preferred
    if score >= 80:
        summary = "Strong fit — your experience covers most of the role's core skills."
    elif score >= 55:
        summary = "Promising fit — you match several core skills, with a few gaps to address."
    else:
        summary = "Early fit — focus on the listed core skills to strengthen your application."
    return score, all_matched, missing, summary


def refresh_matches(conn: sqlite3.Connection, resume_id: int) -> None:
    resume = conn.execute("SELECT skills_json, experience_years, workspace_id FROM resumes WHERE id=?", (resume_id,)).fetchone()
    if not resume:
        return
    skills = json.loads(resume["skills_json"])
    jobs = conn.execute("SELECT * FROM jobs WHERE is_active=1 AND (workspace_id IS NULL OR workspace_id=?)", (resume["workspace_id"],)).fetchall()
    for job in jobs:
        score, matched, missing, summary = match_score(skills, resume["experience_years"], job)
        conn.execute("""INSERT INTO matches (workspace_id,resume_id,job_id,score,matched_skills_json,missing_skills_json,summary,updated_at)
            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(resume_id,job_id) DO UPDATE SET
            workspace_id=excluded.workspace_id,
            score=excluded.score, matched_skills_json=excluded.matched_skills_json,
            missing_skills_json=excluded.missing_skills_json, summary=excluded.summary, updated_at=excluded.updated_at""",
            (resume["workspace_id"], resume_id, job["id"], score, json.dumps(matched), json.dumps(missing), summary, utc_now()))


def refresh_all_matches(conn: sqlite3.Connection, workspace_id: str) -> None:
    for row in conn.execute("SELECT id FROM resumes WHERE workspace_id=?", (workspace_id,)).fetchall():
        refresh_matches(conn, row["id"])


def unpack_job(row: sqlite3.Row) -> dict:
    result = dict(row)
    result["required_skills"] = json.loads(result.pop("required_skills_json"))
    result["preferred_skills"] = json.loads(result.pop("preferred_skills_json"))
    result["is_active"] = bool(result["is_active"])
    return result


def unpack_resume(row: sqlite3.Row) -> dict:
    result = dict(row)
    result["skills"] = json.loads(result.pop("skills_json"))
    result.pop("extracted_text", None)
    return result


class JobCreate(BaseModel):
    company: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=120)
    location: str = Field(min_length=1, max_length=100)
    employment_type: str = Field(default="Full-time", max_length=50)
    salary_range: str = Field(default="Not listed", max_length=60)
    level: str = Field(default="Any level", max_length=40)
    min_experience: int = Field(default=0, ge=0, le=50)
    description: str = Field(min_length=1, max_length=3000)
    required_skills: list[str] = Field(min_length=1, max_length=20)
    preferred_skills: list[str] = Field(default_factory=list, max_length=20)


app = FastAPI(title="Pathfinder — Resume & Job Matcher", version=APP_VERSION)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.middleware("http")
async def prevent_api_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def require_workspace(x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID")) -> str:
    if not x_workspace_id or not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}", x_workspace_id):
        raise HTTPException(status_code=400, detail="A valid browser workspace ID is required. Refresh the page and retry.")
    return x_workspace_id.lower()


@app.on_event("startup")
def on_startup() -> None:
    initialize_database()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
def health() -> dict:
    database_label = "Temporary hosted SQLite" if os.getenv("APP_ENV", "local") == "public" else "SQLite"
    return {"status": "ok", "version": APP_VERSION, "database": database_label}


@app.get("/api/database/info")
def database_info(workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        counts = {
            "resumes": conn.execute("SELECT COUNT(*) FROM resumes WHERE workspace_id=?", (workspace_id,)).fetchone()[0],
            "jobs": conn.execute("SELECT COUNT(*) FROM jobs WHERE is_active=1 AND (workspace_id IS NULL OR workspace_id=?)", (workspace_id,)).fetchone()[0],
            "matches": conn.execute("SELECT COUNT(*) FROM matches WHERE workspace_id=?", (workspace_id,)).fetchone()[0],
        }
    database_label = "Temporary hosted storage" if os.getenv("APP_ENV", "local") == "public" else str(DB_PATH)
    return {"engine": "SQLite", "database": database_label, "counts": counts}


@app.delete("/api/workspace/data")
def delete_workspace_data(workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        resumes = conn.execute("DELETE FROM resumes WHERE workspace_id=?", (workspace_id,)).rowcount
        jobs = conn.execute("DELETE FROM jobs WHERE workspace_id=?", (workspace_id,)).rowcount
    return {"deleted": True, "resumes": resumes, "jobs": jobs}


@app.get("/api/dashboard")
def dashboard(workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        resumes = conn.execute("SELECT COUNT(*) FROM resumes WHERE workspace_id=?", (workspace_id,)).fetchone()[0]
        jobs = conn.execute("SELECT COUNT(*) FROM jobs WHERE is_active=1 AND (workspace_id IS NULL OR workspace_id=?)", (workspace_id,)).fetchone()[0]
        match_row = conn.execute("SELECT COUNT(*) AS count, COALESCE(AVG(score),0) AS average FROM matches WHERE workspace_id=?", (workspace_id,)).fetchone()
        recent = conn.execute("SELECT id,candidate_name,filename,skills_json,created_at FROM resumes WHERE workspace_id=? ORDER BY id DESC LIMIT 5", (workspace_id,)).fetchall()
        return {"resume_count": resumes, "job_count": jobs, "match_count": match_row["count"],
                "average_match": round(match_row["average"]), "recent_resumes": [
                    {"id": r["id"], "candidate_name": r["candidate_name"], "filename": r["filename"],
                     "skills": json.loads(r["skills_json"]), "created_at": r["created_at"]} for r in recent]}


@app.get("/api/resumes")
def list_resumes(workspace_id: str = Header(alias="X-Workspace-ID")) -> list[dict]:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        rows = conn.execute("SELECT * FROM resumes WHERE workspace_id=? ORDER BY id DESC", (workspace_id,)).fetchall()
        return [unpack_resume(row) for row in rows]


@app.get("/api/resumes/{resume_id}")
def get_resume(resume_id: int, workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        row = conn.execute("SELECT * FROM resumes WHERE id=? AND workspace_id=?", (resume_id, workspace_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Resume not found")
        return unpack_resume(row)


@app.post("/api/resumes", status_code=201)
async def upload_resume(file: UploadFile = File(...), workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    filename = Path(file.filename or "resume.txt").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt"}:
        raise HTTPException(status_code=415, detail="Upload a PDF, DOCX, or TXT resume.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The resume must be 10 MB or smaller.")
    text = extract_text(filename, data)[:200_000]
    skills = extract_skills(text)
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I)
    experience_matches = [int(value) for value in re.findall(r"\b(\d{1,2})\+?\s+years?\b", text, re.I)]
    experience = max(experience_matches, default=0)
    name = guess_candidate_name(filename, text)
    with connect_db() as conn:
        cursor = conn.execute("""INSERT INTO resumes (workspace_id,candidate_name,email,filename,skills_json,experience_years,extracted_text,created_at)
            VALUES (?,?,?,?,?,?,?,?)""", (workspace_id, name, email_match.group(0) if email_match else None, filename,
            json.dumps(skills), experience, "", utc_now()))
        resume_id = cursor.lastrowid
        refresh_matches(conn, resume_id)
        row = conn.execute("SELECT * FROM resumes WHERE id=? AND workspace_id=?", (resume_id, workspace_id)).fetchone()
        return {**unpack_resume(row), "skill_count": len(skills), "match_count": conn.execute("SELECT COUNT(*) FROM matches WHERE resume_id=? AND workspace_id=?", (resume_id, workspace_id)).fetchone()[0]}


@app.delete("/api/resumes/{resume_id}")
def delete_resume(resume_id: int, workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        cursor = conn.execute("DELETE FROM resumes WHERE id=? AND workspace_id=?", (resume_id, workspace_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Resume not found")
        return {"deleted": True, "id": resume_id}


@app.get("/api/jobs")
def list_jobs(q: str | None = None, location: str | None = None, workspace_id: str = Header(alias="X-Workspace-ID")) -> list[dict]:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        rows = conn.execute("SELECT * FROM jobs WHERE is_active=1 AND (workspace_id IS NULL OR workspace_id=?) ORDER BY id", (workspace_id,)).fetchall()
        jobs = [unpack_job(row) for row in rows]
        if q:
            query = q.casefold()
            jobs = [job for job in jobs if query in job["title"].casefold() or query in job["company"].casefold()
                    or query in job["description"].casefold() or any(query in skill.casefold() for skill in job["required_skills"])]
        if location:
            query = location.casefold()
            jobs = [job for job in jobs if query in job["location"].casefold()]
        return jobs


@app.post("/api/jobs", status_code=201)
def create_job(job: JobCreate, workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        cursor = conn.execute("""INSERT INTO jobs (workspace_id,company,title,location,employment_type,salary_range,level,min_experience,description,required_skills_json,preferred_skills_json,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", (workspace_id, job.company.strip(), job.title.strip(), job.location.strip(),
            job.employment_type, job.salary_range, job.level, job.min_experience, job.description.strip(),
            json.dumps(job.required_skills), json.dumps(job.preferred_skills), utc_now()))
        refresh_all_matches(conn, workspace_id)
        row = conn.execute("SELECT * FROM jobs WHERE id=? AND workspace_id=?", (cursor.lastrowid, workspace_id)).fetchone()
        return unpack_job(row)


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int, workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        cursor = conn.execute("UPDATE jobs SET is_active=0 WHERE id=? AND workspace_id=? AND is_active=1", (job_id, workspace_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Active job not found")
        conn.execute("DELETE FROM matches WHERE job_id=? AND workspace_id=?", (job_id, workspace_id))
        return {"deleted": True, "id": job_id}


@app.get("/api/matches")
def list_matches(resume_id: int | None = None, job_id: int | None = None, limit: int = 100, workspace_id: str = Header(alias="X-Workspace-ID")) -> list[dict]:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        sql = """SELECT m.*, r.candidate_name, r.filename, j.title, j.company, j.location, j.salary_range, j.level,
            j.employment_type, j.description, j.min_experience, j.required_skills_json, j.preferred_skills_json
            FROM matches m JOIN resumes r ON r.id=m.resume_id JOIN jobs j ON j.id=m.job_id WHERE j.is_active=1 AND m.workspace_id=?"""
        params: list = [workspace_id]
        if resume_id is not None:
            sql += " AND m.resume_id=?"
            params.append(resume_id)
        if job_id is not None:
            sql += " AND m.job_id=?"
            params.append(job_id)
        sql += " ORDER BY m.score DESC, m.updated_at DESC LIMIT ?"
        params.append(max(1, min(limit, 500)))
        rows = conn.execute(sql, params).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["matched_skills"] = json.loads(item.pop("matched_skills_json"))
            item["missing_skills"] = json.loads(item.pop("missing_skills_json"))
            item["required_skills"] = json.loads(item.pop("required_skills_json"))
            item["preferred_skills"] = json.loads(item.pop("preferred_skills_json"))
            results.append(item)
        return results


@app.post("/api/matches/run")
def run_matches(resume_id: int, workspace_id: str = Header(alias="X-Workspace-ID")) -> list[dict]:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        if conn.execute("SELECT 1 FROM resumes WHERE id=? AND workspace_id=?", (resume_id, workspace_id)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Resume not found")
        refresh_matches(conn, resume_id)
    return list_matches(resume_id=resume_id, workspace_id=workspace_id)


@app.get("/api/analytics")
def analytics(workspace_id: str = Header(alias="X-Workspace-ID")) -> dict:
    workspace_id = require_workspace(workspace_id)
    with connect_db() as conn:
        resume_rows = conn.execute("SELECT skills_json FROM resumes WHERE workspace_id=?", (workspace_id,)).fetchall()
        job_rows = conn.execute("SELECT required_skills_json FROM jobs WHERE is_active=1 AND (workspace_id IS NULL OR workspace_id=?)", (workspace_id,)).fetchall()
        candidate_counts: dict[str, int] = {}
        demand_counts: dict[str, int] = {}
        for row in resume_rows:
            for skill in set(json.loads(row["skills_json"])):
                candidate_counts[skill] = candidate_counts.get(skill, 0) + 1
        for row in job_rows:
            for skill in set(json.loads(row["required_skills_json"])):
                demand_counts[skill] = demand_counts.get(skill, 0) + 1
        return {"candidate_skills": sorted(candidate_counts.items(), key=lambda item: (-item[1], item[0]))[:8],
                "in_demand_skills": sorted(demand_counts.items(), key=lambda item: (-item[1], item[0]))[:8]}


