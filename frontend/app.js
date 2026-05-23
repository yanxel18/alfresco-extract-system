const API = "";

// ── Bootstrap ────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  loadSites();
  loadJobs();
  setInterval(loadJobs, 3000);
});

// ── Sites ─────────────────────────────────────────────────────────────────────
async function loadSites() {
  try {
    const res = await fetch(`${API}/api/sites`);
    const sites = await res.json();
    const sel = document.getElementById("site-select");
    sel.innerHTML = sites.length
      ? sites
          .map(
            (s) =>
              `<option value="${s.short_name}">${s.title} (${s.short_name})</option>`,
          )
          .join("")
      : '<option value="">No sites found</option>';
  } catch (e) {
    document.getElementById("site-select").innerHTML =
      '<option value="">Error loading sites</option>';
  }
}

// ── Start Job ─────────────────────────────────────────────────────────────────
async function startJob() {
  const siteName = document.getElementById("site-select").value;
  const errEl = document.getElementById("start-error");
  errEl.classList.add("hidden");

  if (!siteName) {
    showError(errEl, "Please select a site.");
    return;
  }

  try {
    const res = await fetch(`${API}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_name: siteName }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    loadJobs();
  } catch (e) {
    showError(errEl, e.message);
  }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
async function loadJobs() {
  try {
    const res = await fetch(`${API}/api/jobs`);
    const jobs = await res.json();
    renderJobs(jobs);
  } catch (_) {}
}

function renderJobs(jobs) {
  const tbody = document.getElementById("job-tbody");
  if (!jobs.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="empty">No jobs yet.</td></tr>';
    return;
  }
  tbody.innerHTML = jobs
    .map((j) => {
      const pct =
        j.total_files > 0
          ? Math.round((j.copied_files / j.total_files) * 100)
          : 0;
      return `<tr>
      <td>${j.id}</td>
      <td><strong>${j.site_name}</strong><br/><small>${j.site_title || ""}</small></td>
      <td><span class="badge badge-${j.status}">${j.status}</span></td>
      <td>${j.scanned_files} / ${j.total_files}</td>
      <td>${j.copied_files}</td>
      <td class="${j.failed_files > 0 ? "fail" : ""}">${j.failed_files}</td>
      <td>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <small>${pct}%</small>
      </td>
      <td class="actions">
        ${actionButtons(j)}
      </td>
    </tr>`;
    })
    .join("");
}

function actionButtons(j) {
  const btns = [];
  if (j.status === "scanned") {
    btns.push(`<button onclick="startCopy(${j.id})">📂 Copy Files</button>`);
  }
  if (["scanning", "copying"].includes(j.status)) {
    btns.push(`<button onclick="pauseJob(${j.id})">⏸ Pause</button>`);
  }
  if (["paused", "failed"].includes(j.status)) {
    btns.push(`<button onclick="resumeJob(${j.id})">▶ Resume</button>`);
  }
  if (["scanned", "copying", "done"].includes(j.status)) {
    btns.push(
      `<a href="/api/jobs/${j.id}/csv" download><button>⬇ CSV</button></a>`,
    );
  }
  return btns.join("");
}

// ── Job Actions ───────────────────────────────────────────────────────────────
async function startCopy(id) {
  await fetch(`${API}/api/jobs/${id}/start-copy`, { method: "POST" });
  loadJobs();
}

async function pauseJob(id) {
  await fetch(`${API}/api/jobs/${id}/pause`, { method: "POST" });
  loadJobs();
}

async function resumeJob(id) {
  await fetch(`${API}/api/jobs/${id}/resume`, { method: "POST" });
  loadJobs();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
