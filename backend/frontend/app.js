const DEFAULT_OWNER_NAME = "CHALLA RUTHWIK REDDY";
const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const CLIENT_API_VERSION = "1.2.0";
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function createWorkspaceId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getWorkspaceId() {
  if (isLocalHost) return LOCAL_WORKSPACE_ID;
  try {
    const saved = localStorage.getItem("pathfinder.workspaceId");
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
    const created = createWorkspaceId();
    localStorage.setItem("pathfinder.workspaceId", created);
    return created;
  } catch {
    return createWorkspaceId();
  }
}

const state = { resumes: [], jobs: [], matches: [], selectedResume: "", selectedJob: "", ownerName: DEFAULT_OWNER_NAME, databaseInfo: null, databaseResource: "resumes", workspaceId: getWorkspaceId(), toastTimer: null };

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Workspace-ID", state.workspaceId);
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status})`);
  return payload;
}

function notify(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3800);
}

function initials(name = "Candidate") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function shortDate(value) {
  if (!value) return "Recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function updateOwnerDisplay(name) {
  state.ownerName = name.trim() || DEFAULT_OWNER_NAME;
  const mark = state.ownerName.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]).join("").toUpperCase();
  $$(".owner-name").forEach((node) => { node.textContent = state.ownerName; });
  $$(".owner-avatar, .profile-trigger").forEach((node) => { node.textContent = mark; });
}

function setServerStatus(online, stale = false) {
  const status = $("#server-status");
  if (!status) return;
  status.classList.toggle("down", !online && !stale);
  status.classList.toggle("stale", stale);
  $("#server-status-text").textContent = stale ? (isLocalHost ? "Restart app to update" : "Update available") : online ? "All systems operational" : "Server offline";
}

function configureEnvironmentNotices() {
  const privacy = $("#privacy-copy");
  const databaseNote = $("#database-note");
  if (isLocalHost) {
    privacy.textContent = "Uploads are processed in memory. Extracted profile fields and match results are stored in the local SQLite database.";
    databaseNote.textContent = "Only extracted profile fields are stored; the uploaded file and extracted full text are not retained. Resume and match records stay in the local SQLite database. Exports omit source resume files.";
  } else {
    privacy.textContent = "This public class demo keeps separate data per browser. Uploaded files are processed in memory; extracted name, email, skills, and match records are stored on the host. Avoid confidential resumes. Your workspace stays in this browser, and host restarts can clear demo data.";
    databaseNote.textContent = "Only extracted profile fields are stored; the uploaded file and extracted full text are not retained. Each browser gets a separate workspace key. This public class demo has no login, and its temporary database can reset when the host restarts. Exports omit source resume files.";
  }
}

function readSavedOwnerName() {
  try { return localStorage.getItem("pathfinder.ownerName") || ""; }
  catch { return ""; }
}

function saveOwnerName(name) {
  try { localStorage.setItem("pathfinder.ownerName", name); return true; }
  catch { return false; }
}

function setPage(page) {
  const labels = { dashboard: "Overview", resumes: "Resumes", jobs: "Job board", matches: "Matches", database: "Data" };
  $$(".page").forEach((node) => node.classList.toggle("active", node.id === `page-${page}`));
  $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  $("#breadcrumb-page").textContent = labels[page] || "Overview";
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "jobs") loadJobs();
  if (page === "resumes") loadResumes();
  if (page === "matches") loadMatches();
  if (page === "database") loadDatabase();
}

async function refreshDashboard() {
  try {
    const [health, summary, analytics] = await Promise.all([api("/api/health"), api("/api/dashboard"), api("/api/analytics")]);
    const stale = health.version !== CLIENT_API_VERSION;
    setServerStatus(!stale, stale);
    $("#stat-resumes").textContent = summary.resume_count;
    $("#stat-jobs").textContent = summary.job_count;
    $("#stat-matches").textContent = summary.match_count;
    $("#stat-average").textContent = summary.average_match;
    $("#resume-nav-count").textContent = summary.resume_count;
    renderRecent(summary.recent_resumes);
    renderDemand(analytics.in_demand_skills);
  } catch (error) {
    setServerStatus(false);
    notify(error.message, true);
  }
}

function renderRecent(resumes) {
  const list = $("#recent-resumes");
  if (!resumes.length) {
    list.innerHTML = '<div class="empty-state small">No resumes yet. Upload one to get started.</div>';
    return;
  }
  list.innerHTML = resumes.map((resume) => `<div class="recent-row">
    <div class="file-icon">▤</div><div class="recent-meta"><strong>${esc(resume.candidate_name)}</strong><span>${esc(resume.filename)}</span></div>
    <div class="recent-tags">${resume.skills.slice(0, 2).map((skill) => `<span class="skill-chip">${esc(skill)}</span>`).join("")}${resume.skills.length > 2 ? `<span class="skill-more">+${resume.skills.length - 2}</span>` : ""}</div>
    <span class="recent-date">${shortDate(resume.created_at)}</span></div>`).join("");
}

function renderDemand(items) {
  const host = $("#demand-skills");
  if (!items.length) {
    host.innerHTML = '<div class="empty-inline">Add roles to see in-demand skills.</div>';
    return;
  }
  const max = Math.max(...items.map((item) => item[1]), 1);
  host.innerHTML = items.slice(0, 6).map(([skill, count]) => `<div class="trend-row"><span>${esc(skill)}</span><div class="trend-bar"><i style="width:${Math.max(9, (count / max) * 100)}%"></i></div><span class="trend-count">${count}</span></div>`).join("");
}

async function loadResumes() {
  try {
    state.resumes = await api("/api/resumes");
    $("#resume-nav-count").textContent = state.resumes.length;
    $("#resume-total-label").textContent = `${state.resumes.length} ${state.resumes.length === 1 ? "profile" : "profiles"}`;
    renderResumes();
    updateResumeSelect();
  } catch (error) {
    notify(error.message, true);
  }
}

function renderResumes() {
  const query = $("#resume-search").value.trim().toLowerCase();
  const visible = state.resumes.filter((resume) => `${resume.candidate_name} ${resume.filename} ${resume.email || ""} ${resume.skills.join(" ")}`.toLowerCase().includes(query));
  const host = $("#resume-grid");
  if (!visible.length) {
    host.innerHTML = `<div class="empty-state">${state.resumes.length ? "No resumes match that search." : "Your resume library is empty. Upload a resume to see skills and job matches."}</div>`;
    return;
  }
  host.innerHTML = visible.map((resume) => `<article class="resume-card">
    <div class="resume-card-top"><div class="resume-avatar">${esc(initials(resume.candidate_name))}</div><div class="resume-name"><strong>${esc(resume.candidate_name)}</strong><span>${esc(resume.filename)} · ${shortDate(resume.created_at)}</span></div><button class="card-menu delete-resume" data-id="${resume.id}" title="Delete resume" aria-label="Delete ${esc(resume.candidate_name)}">×</button></div>
    <div class="resume-email">${resume.email ? esc(resume.email) : `${resume.experience_years || 0} years of experience detected`}</div>
    <span class="section-kicker">EXTRACTED SKILLS</span><div class="chips-wrap">${resume.skills.length ? resume.skills.slice(0, 8).map((skill) => `<span class="skill-chip purple">${esc(skill)}</span>`).join("") : '<span class="skill-chip">No listed skills detected</span>'}${resume.skills.length > 8 ? `<span class="skill-chip">+${resume.skills.length - 8}</span>` : ""}</div>
    <div class="resume-card-bottom"><span>${resume.skills.length} skills · ${resume.experience_years || 0} yrs detected</span><button class="resume-matches" data-id="${resume.id}">See matches →</button></div></article>`).join("");
  $$(".delete-resume").forEach((button) => button.addEventListener("click", deleteResume));
  $$(".resume-matches").forEach((button) => button.addEventListener("click", () => {
    state.selectedResume = button.dataset.id;
    updateResumeSelect();
    setPage("matches");
  }));
}

async function deleteResume(event) {
  const id = event.currentTarget.dataset.id;
  const resume = state.resumes.find((item) => String(item.id) === String(id));
  if (!window.confirm(`Delete ${resume?.candidate_name || "this resume"} and its match results?`)) return;
  try {
    await api(`/api/resumes/${id}`, { method: "DELETE" });
    if (String(state.selectedResume) === String(id)) state.selectedResume = "";
    await Promise.all([loadResumes(), refreshDashboard()]);
    notify("Resume removed from your workspace.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadJobs() {
  try {
    const query = new URLSearchParams();
    if ($("#job-search").value.trim()) query.set("q", $("#job-search").value.trim());
    if ($("#job-location").value.trim()) query.set("location", $("#job-location").value.trim());
    state.jobs = await api(`/api/jobs?${query.toString()}`);
    renderJobs();
    updateJobSelect();
  } catch (error) {
    notify(error.message, true);
  }
}

function renderJobs() {
  $("#job-count-label").textContent = `${state.jobs.length} ${state.jobs.length === 1 ? "role" : "roles"}`;
  const host = $("#job-grid");
  if (!state.jobs.length) {
    host.innerHTML = '<div class="empty-state">No roles found. Try another search or add a role to the board.</div>';
    return;
  }
  host.innerHTML = state.jobs.map((job) => `<article class="job-card"><div class="job-card-head"><div class="company-mark">${esc(initials(job.company))}</div><div class="job-title-group"><h3>${esc(job.title)}</h3><span>${esc(job.company)}</span></div><span class="job-type">${esc(job.employment_type)}</span></div>
    <div class="job-meta"><span>⌖ ${esc(job.location)}</span><span>◷ ${esc(job.level)}</span></div><p class="job-description">${esc(job.description)}</p>
    <div class="job-skills">${job.required_skills.slice(0, 5).map((skill) => `<span class="skill-chip">${esc(skill)}</span>`).join("")}${job.required_skills.length > 5 ? `<span class="skill-chip">+${job.required_skills.length - 5}</span>` : ""}</div>
    <div class="job-card-foot"><span class="job-salary">${esc(job.salary_range)} <small>· ${job.min_experience} yrs min.</small></span><div class="job-actions"><button class="job-see-matches" data-id="${job.id}">See matches →</button>${job.workspace_id ? `<button class="job-remove" data-id="${job.id}" title="Remove role" aria-label="Remove ${esc(job.title)}">×</button>` : ""}</div></div></article>`).join("");
  $$(".job-see-matches").forEach((button) => button.addEventListener("click", () => {
    state.selectedJob = String(button.dataset.id);
    updateJobSelect();
    setPage("matches");
  }));
  $$(".job-remove").forEach((button) => button.addEventListener("click", removeJob));
}

function updateResumeSelect() {
  const select = $("#match-resume-select");
  if (!select) return;
  const current = state.selectedResume || select.value;
  select.innerHTML = '<option value="">All resumes</option>' + state.resumes.map((resume) => `<option value="${resume.id}">${esc(resume.candidate_name)}</option>`).join("");
  if ([...select.options].some((option) => option.value === String(current))) select.value = String(current);
  state.selectedResume = select.value;
}

function updateJobSelect() {
  const select = $("#match-job-select");
  if (!select) return;
  const current = state.selectedJob || select.value;
  select.innerHTML = '<option value="">All roles</option>' + state.jobs.map((job) => `<option value="${job.id}">${esc(job.title)} · ${esc(job.company)}</option>`).join("");
  select.value = [...select.options].some((option) => option.value === String(current)) ? String(current) : "";
  state.selectedJob = select.value;
}

async function loadMatches() {
  try {
    if (!state.resumes.length) state.resumes = await api("/api/resumes");
    if (!state.jobs.length) state.jobs = await api("/api/jobs");
    updateResumeSelect();
    updateJobSelect();
    const params = new URLSearchParams();
    if (state.selectedResume) params.set("resume_id", state.selectedResume);
    if (state.selectedJob) params.set("job_id", state.selectedJob);
    state.matches = await api(`/api/matches?${params.toString()}`);
    renderMatches();
  } catch (error) {
    notify(error.message, true);
  }
}

function renderMatches() {
  const host = $("#match-list");
  $("#match-count-label").textContent = `${state.matches.length} ${state.matches.length === 1 ? "match" : "matches"}`;
  if (!state.matches.length) {
    host.innerHTML = `<div class="empty-state">${state.resumes.length ? "No match results for this selection yet." : "Upload a resume to generate your first matches."}</div>`;
    return;
  }
  host.innerHTML = state.matches.map((match) => {
    const score = Math.max(0, Math.min(100, Number(match.score)));
    const label = score >= 80 ? "Strong fit" : score >= 55 ? "Good potential" : "Skills to build";
    const chips = match.matched_skills.slice(0, 5).map((skill) => `<span class="match-chip">✓ ${esc(skill)}</span>`).join("") + match.missing_skills.slice(0, 3).map((skill) => `<span class="match-chip missing">+ ${esc(skill)}</span>`).join("");
    return `<article class="match-card"><div class="score-ring" style="--score:${score}"><span>${score}<small>%</small></span></div><div class="match-main"><div class="match-title-line"><h3>${esc(match.title)}</h3><span class="match-score-label">${label}</span></div><div class="match-company">${esc(match.company)} · ${esc(match.location)} · ${esc(match.employment_type)}</div><p class="match-blurb">${esc(match.summary)} <span>For ${esc(match.candidate_name)}.</span></p><div class="match-chip-row">${chips || '<span class="skill-chip">Add skills to your resume profile for a more useful comparison</span>'}</div></div><div class="match-actions"><small>${esc(match.salary_range)} · ${match.missing_skills.length} skill gaps</small><button class="match-details" data-id="${match.id}">Review role ↗</button></div></article>`;
  }).join("");
  $$(".match-details").forEach((button) => button.addEventListener("click", () => {
    const match = state.matches.find((item) => String(item.id) === button.dataset.id);
    if (!match) return;
    showMatchDetails(match);
  }));
}

const DATABASE_COLUMNS = {
  resumes: [
    ["Candidate", (row) => row.candidate_name], ["Email", (row) => row.email || ""],
    ["File", (row) => row.filename], ["Skills", (row) => row.skills.join("; ")],
    ["Experience", (row) => `${row.experience_years || 0} years`], ["Added", (row) => row.created_at],
  ],
  jobs: [
    ["Role", (row) => row.title], ["Company", (row) => row.company], ["Location", (row) => row.location],
    ["Type", (row) => row.employment_type], ["Level", (row) => row.level], ["Required skills", (row) => row.required_skills.join("; ")],
    ["Preferred skills", (row) => row.preferred_skills.join("; ")], ["Salary", (row) => row.salary_range],
  ],
  matches: [
    ["Candidate", (row) => row.candidate_name], ["Role", (row) => row.title], ["Company", (row) => row.company],
    ["Fit score", (row) => `${row.score}%`], ["Matched skills", (row) => row.matched_skills.join("; ")],
    ["Skill gaps", (row) => row.missing_skills.join("; ")], ["Updated", (row) => row.updated_at],
  ],
};

async function loadDatabase() {
  try {
    const [info, resumes, jobs, matches] = await Promise.all([
      api("/api/database/info"), api("/api/resumes"), api("/api/jobs"), api("/api/matches?limit=500"),
    ]);
    state.databaseInfo = info;
    state.resumes = resumes;
    state.jobs = jobs;
    state.matches = matches;
    $("#database-engine").textContent = info.engine;
    $("#database-resume-count").textContent = info.counts.resumes;
    $("#database-job-count").textContent = info.counts.jobs;
    $("#database-match-count").textContent = info.counts.matches;
    $("#database-path").textContent = info.database;
    renderDatabaseTable();
    return true;
  } catch (error) {
    $("#database-body").innerHTML = `<tr><td class="database-empty">Database could not be loaded: ${esc(error.message)}</td></tr>`;
    notify(error.message, true);
    return false;
  }
}

function getVisibleDatabaseRows() {
  const resource = $("#database-resource").value;
  const columns = DATABASE_COLUMNS[resource];
  const rows = state[resource] || [];
  const query = $("#database-search").value.trim().toLowerCase();
  return { resource, columns, rows: rows.filter((row) => columns.map(([, value]) => String(value(row) ?? "")).join(" ").toLowerCase().includes(query)) };
}

function renderDatabaseTable() {
  const { resource, columns, rows } = getVisibleDatabaseRows();
  state.databaseResource = resource;
  const title = { resumes: "Resumes", jobs: "Jobs", matches: "Matches" }[resource];
  $("#database-table-title").textContent = title;
  $("#database-head").innerHTML = `<tr>${columns.map(([label]) => `<th>${esc(label)}</th>`).join("")}</tr>`;
  $("#database-row-count").textContent = `${rows.length} ${rows.length === 1 ? "record" : "records"}`;
  if (!rows.length) {
    $("#database-body").innerHTML = `<tr><td colspan="${columns.length}" class="database-empty">${state[resource].length ? "No records match your search." : `No ${title.toLowerCase()} are stored yet.`}</td></tr>`;
    return;
  }
  $("#database-body").innerHTML = rows.map((row) => `<tr>${columns.map(([, value]) => `<td title="${esc(value(row) ?? "")}">${esc(value(row) ?? "—")}</td>`).join("")}</tr>`).join("");
}

function exportDatabaseCsv() {
  const { resource, columns, rows } = getVisibleDatabaseRows();
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [columns.map(([label]) => quote(label)).join(","), ...rows.map((row) => columns.map(([, value]) => quote(value(row))).join(","))].join("\r\n");
  const link = document.createElement("a");
  const blobUrl = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.href = blobUrl;
  link.download = `pathfinder-${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  notify(`${rows.length} ${resource} record${rows.length === 1 ? "" : "s"} exported.`);
}

async function copyDatabasePath() {
  const details = state.databaseInfo;
  if (!details) return notify("Load the database details first.", true);
  const info = `${details.engine} · ${details.database}`;
  try {
    await navigator.clipboard.writeText(info);
    notify("Database information copied.");
  } catch {
    notify(info);
  }
}

async function clearWorkspaceData() {
  if (!window.confirm("Delete every resume, match result, and role added in this browser workspace? This cannot be undone.")) return;
  try {
    const deleted = await api("/api/workspace/data", { method: "DELETE" });
    state.selectedResume = "";
    state.selectedJob = "";
    await Promise.all([refreshDashboard(), loadResumes(), loadJobs()]);
    if (await loadDatabase() && $("#page-matches").classList.contains("active")) await loadMatches();
    notify(`Workspace cleared: ${deleted.resumes} resume${deleted.resumes === 1 ? "" : "s"} and ${deleted.jobs} added role${deleted.jobs === 1 ? "" : "s"} deleted.`);
  } catch (error) {
    notify(error.message, true);
  }
}

async function removeJob(event) {
  const id = event.currentTarget.dataset.id;
  const job = state.jobs.find((item) => String(item.id) === String(id));
  if (!window.confirm(`Remove ${job?.title || "this role"} from the job board? Its match results will be removed.`)) return;
  try {
    await api(`/api/jobs/${id}`, { method: "DELETE" });
    if (String(state.selectedJob) === String(id)) state.selectedJob = "";
    await Promise.all([loadJobs(), refreshDashboard()]);
    if ($("#page-matches").classList.contains("active")) await loadMatches();
    notify("Role removed from the job board.");
  } catch (error) {
    notify(error.message, true);
  }
}

function showActionModal(kicker, title, body) {
  $("#action-modal-kicker").textContent = kicker;
  $("#action-modal-title").textContent = title;
  $("#action-modal-body").innerHTML = body;
  $("#action-modal-backdrop").hidden = false;
}

function closeActionModal() {
  $("#action-modal-backdrop").hidden = true;
}

function showMatchDetails(match) {
  const matched = match.matched_skills.length
    ? match.matched_skills.map((skill) => `<span class="match-chip">✓ ${esc(skill)}</span>`).join("")
    : '<span class="detail-muted">No matching skills detected yet.</span>';
  const missing = match.missing_skills.length
    ? match.missing_skills.map((skill) => `<span class="match-chip missing">+ ${esc(skill)}</span>`).join("")
    : '<span class="detail-muted">You cover all listed required skills.</span>';
  const preferred = match.preferred_skills.length
    ? match.preferred_skills.map((skill) => `<span class="skill-chip">${esc(skill)}</span>`).join("")
    : '<span class="detail-muted">No preferred skills listed.</span>';
  showActionModal("MATCH DETAILS", `${match.title} at ${match.company}`, `<div class="role-detail-top"><div class="detail-score">${match.score}%<small> match</small></div><p>${esc(match.summary)}</p></div><p class="role-description">${esc(match.description || "No role description provided.")}</p><div class="detail-facts"><span>⌖ ${esc(match.location)}</span><span>◷ ${esc(match.employment_type)}</span><span>${esc(match.salary_range)}</span><span>${Number(match.min_experience) || 0}+ years requested</span></div><section class="detail-section"><strong>Skills you have</strong><div class="chips-wrap">${matched}</div></section><section class="detail-section"><strong>Core skills to build</strong><div class="chips-wrap">${missing}</div></section><section class="detail-section"><strong>Preferred skills</strong><div class="chips-wrap">${preferred}</div></section><button class="button button-primary detail-match-action" type="button" data-action="view-role-matches" data-job-id="${match.job_id}" data-resume-id="${match.resume_id}">View this role’s match results <span>→</span></button>`);
}

function openProfileModal() {
  const savedName = readSavedOwnerName() || state.ownerName;
  showActionModal("WORKSPACE PROFILE", "Workspace owner", `<form id="profile-form" class="profile-form"><label for="owner-name-input">Display name</label><input id="owner-name-input" name="owner_name" maxlength="70" required value="${esc(savedName)}" /><p>This name is shown in the Pathfinder sidebar and header on this browser.</p><button class="button button-primary" type="submit">Save profile <span>✓</span></button></form>`);
  $("#owner-name-input").focus();
  $("#owner-name-input").select();
}

async function openNotifications() {
  try {
    const [resumes, summary] = await Promise.all([api("/api/resumes"), api("/api/dashboard")]);
    state.resumes = resumes;
    const recent = resumes.slice(0, 5);
    const entries = recent.length ? recent.map((resume) => `<div class="activity-row"><span class="file-icon">▤</span><div><strong>${esc(resume.candidate_name)}</strong><small>${esc(resume.filename)} · added ${shortDate(resume.created_at)}</small></div><button class="text-link" data-action="activity-resume" data-id="${resume.id}">View matches →</button></div>`).join("") : '<div class="empty-state small">No recent activity yet. Upload your first resume to generate job matches.</div>';
    showActionModal("RECENT ACTIVITY", "Workspace activity", `<div class="activity-summary-grid"><div><strong>${summary.resume_count}</strong><span>resumes</span></div><div><strong>${summary.match_count}</strong><span>matches</span></div><div><strong>${summary.job_count}</strong><span>open roles</span></div></div><div class="activity-list">${entries}</div><button class="button button-secondary" type="button" data-action="go-resumes">Open resume library →</button>`);
  } catch (error) {
    notify(error.message, true);
  }
}

function openWorkspaceMenu() {
  showActionModal("WORKSPACE", "Workspace options", `<div class="workspace-actions"><button type="button" data-action="open-profile"><span>◎</span><div><strong>Workspace profile</strong><small>Update the display name shown in this app.</small></div><b>→</b></button><button type="button" data-action="refresh-workspace"><span>↻</span><div><strong>Refresh workspace</strong><small>Reload resumes, roles, and match results.</small></div><b>→</b></button><button type="button" data-action="open-docs"><span>⌘</span><div><strong>API documentation</strong><small>Open the interactive endpoint reference.</small></div><b>↗</b></button><button type="button" data-action="check-health"><span>●</span><div><strong>System status</strong><small>Check the API and database connection.</small></div><b>→</b></button></div>`);
}

async function refreshWorkspace() {
  closeActionModal();
  await Promise.all([refreshDashboard(), loadResumes(), loadJobs()]);
  if ($("#page-matches").classList.contains("active")) await loadMatches();
  notify("Workspace data refreshed.");
}

async function handleActionClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "open-profile") openProfileModal();
  if (action === "refresh-workspace") refreshWorkspace();
  if (action === "open-docs") window.open("/docs", "_blank", "noopener");
  if (action === "go-resumes") { closeActionModal(); setPage("resumes"); }
  if (action === "activity-resume") {
    state.selectedResume = String(button.dataset.id);
    state.selectedJob = "";
    closeActionModal();
    updateResumeSelect();
    updateJobSelect();
    setPage("matches");
  }
  if (action === "view-role-matches") {
    state.selectedJob = String(button.dataset.jobId);
    state.selectedResume = String(button.dataset.resumeId || "");
    closeActionModal();
    updateResumeSelect();
    updateJobSelect();
    setPage("matches");
  }
  if (action === "check-health") {
    try {
      const health = await api("/api/health");
      const stale = health.version !== CLIENT_API_VERSION;
      setServerStatus(!stale, stale);
      if (stale) {
        const updateSteps = isLocalHost ? 'In the VS Code terminal, press Ctrl+C and run <code>./Start-Pathfinder.ps1</code>, then refresh the browser with Ctrl+F5.' : "The hosted site needs a redeploy. Refresh this page after the update finishes.";
        showActionModal("UPDATE NEEDED", isLocalHost ? "Restart Pathfinder" : "Update Pathfinder", `<div class="health-status is-down"><span class="health-check">!</span><div><strong>The API is responding with an older version</strong><small>Current: ${esc(health.version || "older build")} · Expected: ${CLIENT_API_VERSION}</small></div></div><p class="detail-muted">${updateSteps}</p>`);
      } else {
        const storageNote = isLocalHost ? `Database file: <code>${esc(health.database)}</code>.` : "Each browser has a separate workspace. The free demo host can clear stored records when its service restarts.";
        showActionModal("SYSTEM STATUS", "Everything is connected", `<div class="health-status"><span class="health-check">✓</span><div><strong>Pathfinder API is responding</strong><small>Database connection: ${esc(health.status)}</small></div></div><p class="detail-muted">${storageNote}</p>`);
      }
    } catch (error) {
      setServerStatus(false);
      const offlineHelp = isLocalHost ? 'Start the app from the project terminal with <code>./Start-Pathfinder.ps1</code>, then refresh this page.' : "The hosted demo may be starting after a period of inactivity. Wait about a minute and refresh.";
      showActionModal("SYSTEM STATUS", "The app is offline", `<div class="health-status is-down"><span class="health-check">!</span><div><strong>Could not reach the Pathfinder API</strong><small>${esc(error.message)}</small></div></div><p class="detail-muted">${offlineHelp}</p>`);
    }
  }
}

function saveProfile(event) {
  if (event.target.id !== "profile-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const name = String(form.get("owner_name") || "").trim();
  if (!name) return;
  updateOwnerDisplay(name);
  const saved = saveOwnerName(name);
  closeActionModal();
  notify(saved ? "Workspace profile saved in this browser." : "Name updated for this session. Browser storage is unavailable.", !saved);
}

async function uploadResume(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  notify(`Analyzing ${file.name}…`);
  try {
    const resume = await api("/api/resumes", { method: "POST", body: formData });
    state.selectedResume = String(resume.id);
    state.selectedJob = "";
    await Promise.all([refreshDashboard(), loadResumes()]);
    await loadMatches();
    setPage("matches");
    notify(`${resume.candidate_name}: ${resume.skill_count} skills found and ${resume.match_count} roles matched.`);
  } catch (error) {
    notify(error.message, true);
  } finally {
    $("#resume-file").value = "";
  }
}

function openJobModal() {
  $("#modal-backdrop").hidden = false;
  $("#job-form").elements.company.focus();
}

function closeJobModal() {
  $("#modal-backdrop").hidden = true;
}

async function saveJob(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const splitSkills = (value) => value.split(",").map((skill) => skill.trim()).filter(Boolean);
  const payload = {
    company: form.get("company"), title: form.get("title"), location: form.get("location"),
    employment_type: form.get("employment_type"), salary_range: form.get("salary_range") || "Not listed",
    level: form.get("level"), min_experience: Number(form.get("min_experience") || 0), description: form.get("description"),
    required_skills: splitSkills(form.get("required_skills")), preferred_skills: splitSkills(form.get("preferred_skills") || ""),
  };
  try {
    await api("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeJobModal();
    formElement.reset();
    await Promise.all([loadJobs(), refreshDashboard()]);
    notify("Role added. Existing resumes have been re-matched.");
  } catch (error) {
    notify(error.message, true);
  }
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  $$("[data-page-link]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); setPage(button.dataset.pageLink); }));
  $("#resume-file").addEventListener("change", (event) => uploadResume(event.target.files?.[0]));
  $("#resume-search").addEventListener("input", renderResumes);
  $("#job-search").addEventListener("input", loadJobs);
  $("#job-location").addEventListener("input", loadJobs);
  $("#match-resume-select").addEventListener("change", (event) => {
    state.selectedResume = event.target.value;
    loadMatches();
  });
  $("#match-job-select").addEventListener("change", (event) => {
    state.selectedJob = event.target.value;
    loadMatches();
  });
  $("#refresh-database").addEventListener("click", async () => { if (await loadDatabase()) notify("Database records refreshed."); });
  $("#clear-workspace").addEventListener("click", clearWorkspaceData);
  $("#database-resource").addEventListener("change", renderDatabaseTable);
  $("#database-search").addEventListener("input", renderDatabaseTable);
  $("#export-database").addEventListener("click", exportDatabaseCsv);
  $("#copy-database-path").addEventListener("click", copyDatabasePath);
  $("#notifications-button").addEventListener("click", openNotifications);
  $("#workspace-menu-button").addEventListener("click", openWorkspaceMenu);
  $("#profile-button").addEventListener("click", openProfileModal);
  $("#action-modal-close").addEventListener("click", closeActionModal);
  $("#action-modal-done").addEventListener("click", closeActionModal);
  $("#action-modal-backdrop").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeActionModal(); });
  $("#action-modal-body").addEventListener("click", handleActionClick);
  $("#action-modal-body").addEventListener("submit", saveProfile);
  $("#open-job-modal").addEventListener("click", openJobModal);
  $("#close-job-modal").addEventListener("click", closeJobModal);
  $("#cancel-job-modal").addEventListener("click", closeJobModal);
  $("#modal-backdrop").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeJobModal(); });
  $("#job-form").addEventListener("submit", saveJob);
  const dropzone = $("#dropzone");
  ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove("dragging"); }));
  dropzone.addEventListener("drop", (event) => uploadResume(event.dataTransfer.files?.[0]));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeJobModal();
      closeActionModal();
    }
  });
  const savedName = readSavedOwnerName();
  if (savedName) updateOwnerDisplay(savedName);
}

configureEnvironmentNotices();
bindEvents();
refreshDashboard();
loadJobs();

