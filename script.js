let cursor = "*";
let currentQuery = "";
let currentSort = "";
let isLoading = false;

let totalResults = 0;
let loadedResults = 0;
let bookmarkFilterTerm = "";
let bookmarkSortOrder = "recent_desc";

// Current drawer view: "bookmarks" or "projects"
let currentView = "bookmarks";

// Resolved IDs (two-step lookup)
let resolvedAuthorId = null;
let resolvedAuthorLabel = "";
let resolvedSourceId = null;
let resolvedSourceLabel = "";

// ---------- STORAGE ----------

function getBookmarks() {
  return JSON.parse(localStorage.getItem("researchBookmarks") || "[]");
}

function saveBookmarks(data) {
  localStorage.setItem("researchBookmarks", JSON.stringify(data));
}

function getGoogleSettings() {
  return {
    apiKey: localStorage.getItem("googleApiKey") || "",
    cx: localStorage.getItem("googleCx") || ""
  };
}

function setGoogleSettings(apiKey, cx) {
  localStorage.setItem("googleApiKey", apiKey || "");
  localStorage.setItem("googleCx", cx || "");
}

function getProjects() {
  return JSON.parse(localStorage.getItem("researchProjects") || "[]");
}

function saveProjects(data) {
  localStorage.setItem("researchProjects", JSON.stringify(data));
}

function createProject(name, description = "") {
  const projects = getProjects();
  const newProject = {
    id: `project_${Date.now()}`,
    name,
    description,
    createdAt: Date.now(),
    paperIds: []
  };
  projects.push(newProject);
  saveProjects(projects);
  return newProject;
}

function deleteProject(projectId) {
  const projects = getProjects().filter(p => p.id !== projectId);
  saveProjects(projects);
  renderCurrentView();
}

function addPaperToProject(projectId, paperId) {
  const projects = getProjects().map(p => {
    if (p.id === projectId && !p.paperIds.includes(paperId)) {
      return { ...p, paperIds: [...p.paperIds, paperId] };
    }
    return p;
  });
  saveProjects(projects);
  renderCurrentView();
}

function removePaperFromProject(projectId, paperId) {
  const projects = getProjects().map(p => {
    if (p.id === projectId) {
      return { ...p, paperIds: p.paperIds.filter(id => id !== paperId) };
    }
    return p;
  });
  saveProjects(projects);
  renderCurrentView();
}

function sortBookmarks(bookmarks) {
  const items = [...bookmarks];
  const getYear = (entry) => {
    const year = parseInt(entry.year, 10);
    return Number.isFinite(year) ? year : 0;
  };

  const getCitations = (entry) =>
    typeof entry.cited_by_count === "number" ? entry.cited_by_count : -1;

  const compareText = (a, b) =>
    String(a || "").localeCompare(String(b || ""), undefined, {
      sensitivity: "base"
    });

  const compare = (a, b, dir = 1) => (a > b ? dir : a < b ? -dir : 0);

  switch (bookmarkSortOrder) {
    case "recent_asc":
      return items.sort((a, b) =>
        compare(a.createdAt || 0, b.createdAt || 0, 1)
      );
    case "title_asc":
      return items.sort((a, b) => compareText(a.title, b.title));
    case "title_desc":
      return items.sort((a, b) => compareText(b.title, a.title));
    case "year_asc":
      return items.sort((a, b) => compare(getYear(a), getYear(b), 1));
    case "year_desc":
      return items.sort((a, b) => compare(getYear(a), getYear(b), -1));
    case "citations_asc":
      return items.sort((a, b) => compare(getCitations(a), getCitations(b), 1));
    case "citations_desc":
      return items.sort((a, b) => compare(getCitations(a), getCitations(b), -1));
    case "recent_desc":
    default:
      return items.sort((a, b) =>
        compare(a.createdAt || 0, b.createdAt || 0, -1)
      );
  }
}

function filterBookmarks(bookmarks) {
  const term = bookmarkFilterTerm.trim().toLowerCase();
  if (!term) return bookmarks;

  return bookmarks.filter((entry) => {
    const haystack = [
      entry.title,
      entry.authors,
      entry.year,
      entry.publication_date,
      entry.doi,
      entry.note
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(term);
  });
}

function updateBookmarkNote(id, note) {
  const bookmarks = getBookmarks().map((entry) =>
    entry.id === id ? { ...entry, note } : entry
  );
  saveBookmarks(bookmarks);
}

function removeBookmark(id) {
  const bookmarks = getBookmarks().filter((entry) => entry.id !== id);
  saveBookmarks(bookmarks);
  renderBookmarkList();
}

// ---------- UI INIT ----------

createDrawer();
createFloatingButton();
initGoogleSettings();

// ---------- ADVANCED TOGGLE ----------

function toggleAdvanced() {
  const panel = document.getElementById("advancedPanel");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
}

function initGoogleSettings() {
  const { apiKey, cx } = getGoogleSettings();
  const keyInput = document.getElementById("googleApiKey");
  const cxInput = document.getElementById("googleCx");

  if (keyInput) keyInput.value = apiKey;
  if (cxInput) cxInput.value = cx;

  updateGoogleSettingsStatus();
}

function updateGoogleSettingsStatus(message) {
  const status = document.getElementById("googleSettingsStatus");
  if (!status) return;

  if (message) {
    status.innerText = message;
    return;
  }

  const { apiKey, cx } = getGoogleSettings();
  if (!apiKey || !cx) {
    status.innerText =
      "Add your API key + Search Engine ID to enable source lookup for bookmarks.";
    return;
  }

  status.innerText =
    "Google settings saved. Source lookup is enabled for bookmarks.";
}

function saveGoogleSettings() {
  const apiKey = document.getElementById("googleApiKey")?.value.trim() || "";
  const cx = document.getElementById("googleCx")?.value.trim() || "";

  setGoogleSettings(apiKey, cx);
  updateGoogleSettingsStatus("Saved Google settings locally.");
}

// ---------- OPENALEX HELPERS ----------

function normalizeOpenAlexId(maybeUrl) {
  if (!maybeUrl) return "";
  const parts = String(maybeUrl).split("/");
  return parts[parts.length - 1]; // A..., S..., W...
}

function safeYearToDateStart(y) {
  const year = parseInt(y, 10);
  if (!Number.isFinite(year) || year < 1) return "";
  return `${String(year).padStart(4, "0")}-01-01`;
}

function safeYearToDateEnd(y) {
  const year = parseInt(y, 10);
  if (!Number.isFinite(year) || year < 1) return "";
  return `${String(year).padStart(4, "0")}-12-31`;
}

async function resolveAuthorIdByName(name) {
  const q = name.trim();
  if (!q) return { id: null, label: "" };

  const url = new URL("https://api.openalex.org/authors");
  url.searchParams.set("search", q);
  url.searchParams.set("per-page", "5");

  const res = await fetch(url.toString());
  if (!res.ok) return { id: null, label: "" };

  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit) return { id: null, label: "" };

  const id = normalizeOpenAlexId(hit.id);
  const label = hit.display_name ? `${hit.display_name} (${id})` : id;
  return { id, label };
}

async function resolveSourceIdByName(name) {
  const q = name.trim();
  if (!q) return { id: null, label: "" };

  const url = new URL("https://api.openalex.org/sources");
  url.searchParams.set("search", q);
  url.searchParams.set("per-page", "5");
  // prefer "bigger" sources when ambiguous
  url.searchParams.set("sort", "works_count:desc");

  const res = await fetch(url.toString());
  if (!res.ok) return { id: null, label: "" };

  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit) return { id: null, label: "" };

  const id = normalizeOpenAlexId(hit.id);
  const label = hit.display_name ? `${hit.display_name} (${id})` : id;
  return { id, label };
}

// OpenAlex abstracts are often given as an "inverted index".
// This reconstructs the text in the right order.
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";

  let maxPos = -1;
  for (const positions of Object.values(invertedIndex)) {
    for (const p of positions) {
      if (p > maxPos) maxPos = p;
    }
  }
  if (maxPos < 0) return "";

  const words = new Array(maxPos + 1).fill("");
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const p of positions) {
      words[p] = word;
    }
  }

  return words.join(" ").replace(/\s+/g, " ").trim();
}

// ---------- SEARCH ----------

async function search() {
  const queryInput = document.getElementById("query");
  const sortSelect = document.getElementById("sortOrder");

  const exact = document.getElementById("exactPhrase").value.trim();
  const titleTerm = document.getElementById("titleTerm").value.trim();
  const abstractTerm = document.getElementById("abstractTerm").value.trim();

  const authorName = document.getElementById("authorName").value.trim();
  const sourceName = document.getElementById("sourceName").value.trim();

  const fromYear = document.getElementById("fromYear").value;
  const toYear = document.getElementById("toYear").value;

  currentQuery = queryInput.value.trim();
  currentSort = sortSelect.value;

  const hasSomeInput =
    !!currentQuery ||
    !!exact ||
    !!titleTerm ||
    !!abstractTerm ||
    !!authorName ||
    !!sourceName ||
    !!fromYear ||
    !!toYear;

  if (!hasSomeInput) {
    alert("Enter a keyword or use Advanced filters.");
    return;
  }

  // reset pagination + totals
  cursor = "*";
  isLoading = false;
  totalResults = 0;
  loadedResults = 0;

  // reset resolved IDs each new search
  resolvedAuthorId = null;
  resolvedAuthorLabel = "";
  resolvedSourceId = null;
  resolvedSourceLabel = "";

  const resultsBox = document.getElementById("results");
  resultsBox.innerHTML = "";

  const status = document.createElement("div");
  status.id = "status";
  status.className = "small-note";
  status.innerText = "Resolving filters...";
  resultsBox.appendChild(status);

  // two-step lookup: name -> ID
  try {
    if (authorName) {
      const a = await resolveAuthorIdByName(authorName);
      resolvedAuthorId = a.id;
      resolvedAuthorLabel = a.label;
    }
    if (sourceName) {
      const s = await resolveSourceIdByName(sourceName);
      resolvedSourceId = s.id;
      resolvedSourceLabel = s.label;
    }
  } catch (e) {
    console.error(e);
  }

  // show what resolved
  const parts = [];
  if (resolvedAuthorId) parts.push(`Author: ${resolvedAuthorLabel}`);
  else if (authorName) parts.push("Author: (no match)");

  if (resolvedSourceId) parts.push(`Source: ${resolvedSourceLabel}`);
  else if (sourceName) parts.push("Source: (no match)");

  const fromD = safeYearToDateStart(fromYear);
  const toD = safeYearToDateEnd(toYear);
  if (fromD || toD)
    parts.push(`Date range: ${fromYear || "…"}–${toYear || "…"}`);

  status.innerText = parts.length ? parts.join(" • ") : "Searching...";

  await loadMore();
}

// ---------- FILTER + SORT BUILDERS ----------

function buildFilterString() {
  const filters = [];

  const titleTerm = document.getElementById("titleTerm").value.trim();
  const abstractTerm = document.getElementById("abstractTerm").value.trim();

  const fromYear = document.getElementById("fromYear").value;
  const toYear = document.getElementById("toYear").value;

  // Narrow text filters (documented as convenience filters)
  if (titleTerm) filters.push(`title.search:${titleTerm}`);
  if (abstractTerm) filters.push(`abstract.search:${abstractTerm}`);

  // Date range using from_publication_date / to_publication_date
  const fromD = safeYearToDateStart(fromYear);
  const toD = safeYearToDateEnd(toYear);
  if (fromD) filters.push(`from_publication_date:${fromD}`);
  if (toD) filters.push(`to_publication_date:${toD}`);

  // Author filter
  if (resolvedAuthorId)
    filters.push(`authorships.author.id:${resolvedAuthorId}`);

  // Source filter (primary location source)
  if (resolvedSourceId)
    filters.push(`primary_location.source.id:${resolvedSourceId}`);

  return filters.join(",");
}

function buildSortValue() {
  // Sort docs: publication_date, cited_by_count, relevance_score (only when searching)
  if (currentSort === "date_desc") return "publication_date:desc";
  if (currentSort === "date_asc") return "publication_date:asc";
  if (currentSort === "cite_desc") return "cited_by_count:desc";
  if (currentSort === "cite_asc") return "cited_by_count:asc";
  return ""; // default behavior
}

// ---------- LOAD MORE ----------

async function loadMore() {
  if (isLoading || cursor === null) return;
  isLoading = true;

  const resultsBox = document.getElementById("results");
  const status = document.getElementById("status");

  const loader = document.createElement("div");
  loader.className = "small-note";
  loader.innerText = "Loading...";
  resultsBox.appendChild(loader);

  // Build search query
  const exactPhrase = document.getElementById("exactPhrase").value.trim();
  const queryParts = [];
  if (currentQuery) queryParts.push(currentQuery);
  if (exactPhrase) queryParts.push(`"${exactPhrase}"`); // documented exact phrase behavior

  const combinedQuery = queryParts.join(" ").trim();

  // Build URL
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("per-page", "50");
  url.searchParams.set("cursor", cursor);

  if (combinedQuery) url.searchParams.set("search", combinedQuery);

  const filterString = buildFilterString();
  if (filterString) url.searchParams.set("filter", filterString);

  const sortValue = buildSortValue();
  if (sortValue) url.searchParams.set("sort", sortValue);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status}`);

    const data = await res.json();

    if (totalResults === 0) totalResults = data?.meta?.count || 0;
    cursor = data?.meta?.next_cursor || null;

    loader.remove();

    const results = data?.results || [];
    if (results.length === 0) {
      status.innerText = totalResults
        ? `Loaded ${loadedResults} of ${totalResults}`
        : "No results found.";
      cursor = null;
      removeLoadMore();
      return;
    }

    results.forEach(renderWorkCard);

    status.innerText = `Loaded ${loadedResults} of ${totalResults}`;

    if (loadedResults < totalResults && cursor) {
      ensureLoadMore();
    } else {
      status.innerText = `All ${totalResults} results loaded`;
      cursor = null;
      removeLoadMore();
    }
  } catch (err) {
    console.error(err);
    loader.remove();
    status.innerText = "Error loading results (check console).";
  } finally {
    isLoading = false;
  }
}

// ---------- RENDER WORK ----------

function renderWorkCard(paper) {
  const resultsBox = document.getElementById("results");

  const id = paper.id;
  const title = paper.title || "Untitled";
  const year = paper.publication_year || "Unknown";
  const pubDate = paper.publication_date || "";

  const authors =
    paper.authorships
      ?.slice(0, 6)
      .map((a) => a.author?.display_name)
      .filter(Boolean)
      .join(", ") || "Unknown";

  const doi = paper.doi ? paper.doi.replace("https://doi.org/", "") : "";
  const citations =
    typeof paper.cited_by_count === "number" ? paper.cited_by_count : null;

  const fullAbstract = paper.abstract_inverted_index
    ? reconstructAbstract(paper.abstract_inverted_index)
    : "";

  const abstractToShow = fullAbstract
    ? fullAbstract.length > 700
      ? fullAbstract.slice(0, 700) + "…"
      : fullAbstract
    : "Abstract not available";

  const card = document.createElement("div");
  card.className = "card";
  card.style.position = "relative";

  // Bookmark button (hover)
  const bookmarkBtn = document.createElement("div");
  bookmarkBtn.innerHTML = "🔖";
  bookmarkBtn.style.position = "absolute";
  bookmarkBtn.style.top = "10px";
  bookmarkBtn.style.right = "10px";
  bookmarkBtn.style.cursor = "pointer";
  bookmarkBtn.style.opacity = "0";
  bookmarkBtn.style.fontSize = "18px";

  const bookmarks = getBookmarks();
  if (bookmarks.find((b) => b.id === id)) {
    bookmarkBtn.style.color = "blue";
    bookmarkBtn.style.opacity = "1";
  }

  card.onmouseenter = () => (bookmarkBtn.style.opacity = "1");
  card.onmouseleave = () => {
    if (!bookmarkBtn.style.color) bookmarkBtn.style.opacity = "0";
  };

  bookmarkBtn.onclick = () =>
    toggleBookmark(
      {
        id,
        title,
        year,
        publication_date: pubDate,
        authors,
        doi,
        cited_by_count: citations,
        abstract: fullAbstract || "Abstract not available"
      },
      bookmarkBtn
    );

  card.innerHTML = `
    <h3>${title}</h3>
    <div class="meta"><b>Year:</b> ${year}${
    pubDate ? ` <span style="color:#888">(${pubDate})</span>` : ""
  }</div>
    <div class="meta"><b>Authors:</b> ${authors}</div>
    ${
      citations !== null
        ? `<div class="meta"><b>Citations:</b> ${citations}</div>`
        : ""
    }
    ${
      doi
        ? `<div class="meta"><b>DOI:</b> <a href="https://doi.org/${doi}" target="_blank">${doi}</a></div>`
        : ""
    }
    <p>${abstractToShow}</p>
  `;

  card.appendChild(bookmarkBtn);
  resultsBox.appendChild(card);

  loadedResults++;
}

function escapeHtml(value) {
  return String(value || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeGoogleLink(link) {
  return String(link || "").replace(/#.*$/, "").trim();
}

function extractHostname(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function normalizeDoiValue(doi) {
  if (!doi) return "";
  return String(doi).replace(/^https?:\/\/doi\.org\//i, "").trim();
}

function buildGoogleQueries(title, firstAuthor, doi) {
  const baseParts = [];
  if (title) baseParts.push(`"${title}"`);
  if (firstAuthor) baseParts.push(`"${firstAuthor}"`);

  const normalizedDoi = normalizeDoiValue(doi);

  return [
    {
      type: "primary",
      q: baseParts.join(" ").trim(),
      exactTerms: title || ""
    },
    {
      type: "citations",
      q: baseParts.join(" ").trim(),
      orTerms: "cited references bibliography"
    },
    {
      type: "doi",
      q: normalizedDoi,
      exactTerms: normalizedDoi
    }
  ].filter((query) => query.q);
}

function scoreGoogleItem(item, title) {
  const titleLower = String(title || "").toLowerCase();
  const itemTitle = String(item?.title || "").toLowerCase();
  const snippet = String(item?.snippet || "").toLowerCase();
  const link = String(item?.link || "").toLowerCase();

  let score = 0;
  if (titleLower && itemTitle.includes(titleLower)) score += 4;
  if (titleLower && snippet.includes(titleLower)) score += 2;
  if (link.includes(".pdf")) score -= 1;
  return score;
}

async function fetchGoogleItems({ apiKey, cx, query }) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query.q);
  url.searchParams.set("num", "10");

  if (query.exactTerms) url.searchParams.set("exactTerms", query.exactTerms);
  if (query.orTerms) url.searchParams.set("orTerms", query.orTerms);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return { items: [], status: `error_${res.status}` };
  }

  const data = await res.json();
  return { items: data?.items || [], status: "ok" };
}

async function fetchGoogleSourceLinks(entry) {
  const { apiKey, cx } = getGoogleSettings();
  if (!apiKey || !cx) {
    return { links: [], status: "missing_settings" };
  }

  const title = entry.title || "";
  const firstAuthor = (entry.authors || "").split(",")[0]?.trim();
  const queries = buildGoogleQueries(title, firstAuthor, entry.doi);

  if (queries.length === 0) {
    return { links: [], status: "missing_query" };
  }

  try {
    const aggregated = new Map();
    let status = "ok";

    for (const query of queries) {
      const result = await fetchGoogleItems({ apiKey, cx, query });
      if (result.status !== "ok") status = result.status;

      result.items.forEach((item) => {
        const link = normalizeGoogleLink(item?.link || "");
        if (!link) return;

        const existing = aggregated.get(link);
        const score = scoreGoogleItem(item, title);
        const entryData = {
          url: link,
          title: item?.title || extractHostname(link) || link,
          score,
          source: query.type
        };

        if (!existing || entryData.score > existing.score) {
          aggregated.set(link, entryData);
        }
      });
    }

    const links = Array.from(aggregated.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { links, status };
  } catch (error) {
    console.error(error);
    return { links: [], status: "error_network" };
  }
}

function renderSourcePills(links) {
  if (!links || links.length === 0) return "";
  const normalizedLinks = links.map((link) =>
    typeof link === "string" ? { url: link, title: link } : link
  );

  return `
    <div class="pdf-pills">
      ${normalizedLinks
        .map((link, index) => {
          const label = link.title || `Source ${index + 1}`;
          return `<a class="pdf-pill" href="${link.url}" target="_blank" rel="noopener">${escapeHtml(
            label
          )}</a>`;
        })
        .join("")}
    </div>
  `;
}

// ---------- LOAD MORE BUTTON ----------

function ensureLoadMore() {
  const resultsBox = document.getElementById("results");
  let btn = document.getElementById("loadMore");
  if (btn) return;

  btn = document.createElement("button");
  btn.id = "loadMore";
  btn.innerText = "Load More Results";
  btn.onclick = loadMore;
  btn.style.display = "block";
  btn.style.margin = "20px auto";
  resultsBox.appendChild(btn);
}

function removeLoadMore() {
  const btn = document.getElementById("loadMore");
  if (btn) btn.remove();
}

// ---------- BOOKMARKS ----------

async function toggleBookmark(entry, btn) {
  let bookmarks = getBookmarks();
  const exists = bookmarks.find((b) => b.id === entry.id);

  if (exists) {
    bookmarks = bookmarks.filter((b) => b.id !== entry.id);
    btn.style.color = "";
  } else {
    const pendingEntry = {
      ...entry,
      createdAt: Date.now(),
      googleLinks: [],
      googleLinksStatus: "pending",
      note: ""
    };
    bookmarks.push(pendingEntry);
    btn.style.color = "blue";
    btn.style.opacity = "1";
  }

  saveBookmarks(bookmarks);
  renderBookmarkList();

  if (!exists) {
    const { links, status } = await fetchGoogleSourceLinks(entry);
    const updated = getBookmarks().map((b) =>
      b.id === entry.id
        ? {
            ...b,
            googleLinks: links,
            googleLinksStatus: status
          }
        : b
    );
    saveBookmarks(updated);
    renderBookmarkList();
  }
}

// ---------- FLOATING BUTTON + DRAWER ----------

function createFloatingButton() {
  const btn = document.createElement("button");
  btn.innerText = "Library";

  btn.style.position = "fixed";
  btn.style.bottom = "20px";
  btn.style.right = "20px";
  btn.style.padding = "12px";
  btn.style.borderRadius = "20px";
  btn.style.cursor = "pointer";
  btn.style.zIndex = "999";

  btn.onclick = openDrawer;
  document.body.appendChild(btn);
}

function createDrawer() {
  const overlay = document.createElement("div");
  overlay.id = "drawerOverlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.3)";
  overlay.style.display = "none";
  overlay.style.zIndex = "998";
  overlay.onclick = closeDrawer;
  document.body.appendChild(overlay);

  const drawer = document.createElement("div");
  drawer.id = "drawer";
  drawer.style.position = "fixed";
  drawer.style.right = "-420px";
  drawer.style.top = "0";
  drawer.style.width = "400px";
  drawer.style.height = "100%";
  drawer.style.background = "#fff";
  drawer.style.boxShadow = "-2px 0 8px rgba(0,0,0,.2)";
  drawer.style.padding = "15px";
  drawer.style.overflowY = "auto";
  drawer.style.transition = "0.3s";
  drawer.style.zIndex = "999";

  drawer.innerHTML = `
    <div class="drawer-header">
      <button type="button" class="drawer-icon-button" onclick="closeDrawer()">✕</button>
      <h2 id="drawerTitle">Library</h2>
      <button type="button" class="drawer-icon-button" id="drawerActionBtn" onclick="exportBookmarks()">Export</button>
    </div>
    <div class="drawer-nav">
      <button type="button" class="nav-tab active" data-view="bookmarks" onclick="switchView('bookmarks')">Bookmarks</button>
      <button type="button" class="nav-tab" data-view="projects" onclick="switchView('projects')">Projects</button>
    </div>
    <div id="viewContainer"></div>
  `;

  drawer.onclick = (e) => e.stopPropagation();
  document.body.appendChild(drawer);

  renderCurrentView();
}

function openDrawer() {
  document.getElementById("drawer").style.right = "0px";
  document.getElementById("drawerOverlay").style.display = "block";
}

function closeDrawer() {
  document.getElementById("drawer").style.right = "-420px";
  document.getElementById("drawerOverlay").style.display = "none";
}

function switchView(view) {
  currentView = view;

  // Update nav tabs
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    if (tab.dataset.view === view) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === "bookmarks") {
    renderBookmarksView();
  } else if (currentView === "projects") {
    renderProjectsView();
  }
}

function renderBookmarksView() {
  const container = document.getElementById("viewContainer");
  if (!container) return;

  const drawerTitle = document.getElementById("drawerTitle");
  if (drawerTitle) drawerTitle.innerText = "Bookmarks";

  const actionBtn = document.getElementById("drawerActionBtn");
  if (actionBtn) {
    actionBtn.innerText = "Export";
    actionBtn.onclick = exportBookmarks;
    actionBtn.style.display = "block";
  }

  container.innerHTML = `
    <div class="view-toolbar">
      <input
        id="bookmarkFilter"
        type="search"
        placeholder="Filter by title, author, note, year..."
        aria-label="Filter bookmarks"
      />
      <select id="bookmarkSort" aria-label="Sort bookmarks">
        <option value="recent_desc">Sort: Recently added</option>
        <option value="recent_asc">Sort: Oldest added</option>
        <option value="title_asc">Sort: Title A → Z</option>
        <option value="title_desc">Sort: Title Z → A</option>
        <option value="year_desc">Sort: Year (newest)</option>
        <option value="year_asc">Sort: Year (oldest)</option>
        <option value="citations_desc">Sort: Citations (high → low)</option>
        <option value="citations_asc">Sort: Citations (low → high)</option>
      </select>
    </div>
    <div id="bookmarkSummary" class="view-summary"></div>
    <div id="bookmarkList"></div>
  `;

  const filterInput = container.querySelector("#bookmarkFilter");
  const sortSelect = container.querySelector("#bookmarkSort");

  if (filterInput) {
    filterInput.value = bookmarkFilterTerm;
    filterInput.addEventListener("input", (event) => {
      bookmarkFilterTerm = event.target.value;
      renderBookmarkList();
    });
  }

  if (sortSelect) {
    sortSelect.value = bookmarkSortOrder;
    sortSelect.addEventListener("change", (event) => {
      bookmarkSortOrder = event.target.value;
      renderBookmarkList();
    });
  }

  renderBookmarkList();
}

function renderProjectsView() {
  const container = document.getElementById("viewContainer");
  if (!container) return;

  const drawerTitle = document.getElementById("drawerTitle");
  if (drawerTitle) drawerTitle.innerText = "Projects";

  const actionBtn = document.getElementById("drawerActionBtn");
  if (actionBtn) {
    actionBtn.innerText = "New";
    actionBtn.onclick = showCreateProjectDialog;
    actionBtn.style.display = "block";
  }

  container.innerHTML = `
    <div id="projectSummary" class="view-summary"></div>
    <div id="projectList"></div>
  `;

  renderProjectList();
}

function showCreateProjectDialog() {
  const name = prompt("Project name:");
  if (!name || !name.trim()) return;

  const description = prompt("Project description (optional):");
  createProject(name.trim(), description?.trim() || "");
  renderProjectList();
}

function renderProjectList() {
  const list = document.getElementById("projectList");
  if (!list) return;

  const projects = getProjects();
  const summary = document.getElementById("projectSummary");

  if (summary) {
    summary.innerText = `${projects.length} project${projects.length !== 1 ? 's' : ''}`;
  }

  list.innerHTML = "";

  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small-note";
    empty.innerText = "No projects yet. Click 'New' to create one.";
    list.appendChild(empty);
    return;
  }

  projects.forEach((project) => {
    const item = document.createElement("div");
    item.className = "project-item";

    const bookmarks = getBookmarks();
    const projectPapers = bookmarks.filter(b => project.paperIds.includes(b.id));

    const header = document.createElement("div");
    header.className = "project-item-header";

    const title = document.createElement("div");
    title.className = "project-item-title";
    title.innerText = project.name;

    const actions = document.createElement("div");
    actions.className = "project-item-actions";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "project-ghost-button";
    toggleButton.innerText = "Details";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "project-danger-button";
    deleteButton.innerText = "Delete";
    deleteButton.onclick = (event) => {
      event.stopPropagation();
      if (confirm(`Delete project "${project.name}"?`)) {
        deleteProject(project.id);
      }
    };

    actions.appendChild(toggleButton);
    actions.appendChild(deleteButton);

    header.appendChild(title);
    header.appendChild(actions);

    const meta = document.createElement("div");
    meta.className = "project-item-meta";
    meta.innerText = `${projectPapers.length} paper${projectPapers.length !== 1 ? 's' : ''}`;
    if (project.description) {
      meta.innerText += ` • ${project.description}`;
    }

    const details = document.createElement("div");
    details.className = "project-item-details";
    details.hidden = true;

    if (projectPapers.length === 0) {
      details.innerHTML = `<div class="small-note">No papers in this project yet.</div>`;
    } else {
      const papersList = document.createElement("div");
      papersList.className = "project-papers-list";

      projectPapers.forEach((paper) => {
        const paperItem = document.createElement("div");
        paperItem.className = "project-paper-item";

        paperItem.innerHTML = `
          <div class="project-paper-title">${escapeHtml(paper.title || "Untitled")}</div>
          <div class="project-paper-meta">${escapeHtml([paper.year, paper.authors].filter(Boolean).join(" • "))}</div>
        `;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "project-paper-remove";
        removeBtn.innerText = "Remove";
        removeBtn.onclick = () => {
          removePaperFromProject(project.id, paper.id);
        };

        paperItem.appendChild(removeBtn);
        papersList.appendChild(paperItem);
      });

      details.appendChild(papersList);
    }

    toggleButton.onclick = () => {
      details.hidden = !details.hidden;
      toggleButton.innerText = details.hidden ? "Details" : "Hide";
    };

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(details);
    list.appendChild(item);
  });
}

function renderBookmarkList() {
  const list = document.getElementById("bookmarkList");
  if (!list) return;

  const allBookmarks = getBookmarks();
  const summary = document.getElementById("bookmarkSummary");

  list.innerHTML = "";

  const filtered = filterBookmarks(allBookmarks);
  const bookmarks = sortBookmarks(filtered);

  if (summary) {
    summary.innerText = bookmarkFilterTerm
      ? `Showing ${bookmarks.length} of ${allBookmarks.length} bookmarks`
      : `${allBookmarks.length} bookmarks saved`;
  }

  if (bookmarks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small-note";
    empty.innerText = bookmarkFilterTerm
      ? "No bookmarks match this filter."
      : "No bookmarks yet.";
    list.appendChild(empty);
    return;
  }

  bookmarks.forEach((b) => {
    const item = document.createElement("div");
    item.className = "bookmark-item";

    const header = document.createElement("div");
    header.className = "bookmark-item-header";

    const title = document.createElement("div");
    title.className = "bookmark-item-title";
    title.innerText = b.title || "Untitled";

    const actions = document.createElement("div");
    actions.className = "bookmark-item-actions";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "bookmark-ghost-button";
    toggleButton.innerText = "Details";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "bookmark-danger-button";
    deleteButton.innerText = "Delete";
    deleteButton.onclick = (event) => {
      event.stopPropagation();
      removeBookmark(b.id);
    };

    actions.appendChild(toggleButton);
    actions.appendChild(deleteButton);

    header.appendChild(title);
    header.appendChild(actions);

    const meta = document.createElement("div");
    meta.className = "bookmark-item-meta";
    meta.innerText = [b.year, b.authors].filter(Boolean).join(" • ");

    const details = document.createElement("div");
    details.className = "bookmark-item-details";
    details.hidden = true;

    const googleLinks = Array.isArray(b.googleLinks)
      ? b.googleLinks
      : Array.isArray(b.pdfLinks)
      ? b.pdfLinks
      : [];
    const googleStatus =
      b.googleLinksStatus || b.pdfLinksStatus || "missing_settings";
    let sourceSection = "";

    if (googleStatus === "pending") {
      sourceSection = `<div class="small-note">Finding source links...</div>`;
    } else if (googleStatus === "missing_settings") {
      sourceSection = `<div class="small-note">Add your Google API key + cx to find sources.</div>`;
    } else if (googleStatus === "missing_query") {
      sourceSection = `<div class="small-note">Missing title or author for source lookup.</div>`;
    } else if (googleStatus && googleStatus !== "ok") {
      sourceSection = `<div class="small-note">Could not load source links (${escapeHtml(
        googleStatus
      )}).</div>`;
    }

    details.innerHTML = `
      <div class="bookmark-item-info">
        <small>${b.year || "Unknown"}${
      b.publication_date ? ` (${b.publication_date})` : ""
    }</small>
        <small>${escapeHtml(b.authors || "")}</small>
        ${
          b.cited_by_count != null
            ? `<small>Citations: ${b.cited_by_count}</small>`
            : ""
        }
        ${b.doi ? `<small>DOI: ${b.doi}</small>` : ""}
      </div>
      ${renderSourcePills(googleLinks)}
      ${sourceSection}
      <div class="bookmark-note">
        <label for="bookmark-note-${b.id}">Note</label>
        <textarea id="bookmark-note-${b.id}" placeholder="Add a note..."></textarea>
      </div>
      <p>${escapeHtml(b.abstract || "")}</p>
    `;

    const noteInput = details.querySelector("textarea");
    if (noteInput) {
      noteInput.value = b.note || "";
      noteInput.addEventListener("input", (event) => {
        updateBookmarkNote(b.id, event.target.value);
      });
    }

    toggleButton.onclick = () => {
      details.hidden = !details.hidden;
      toggleButton.innerText = details.hidden ? "Details" : "Hide";
    };

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(details);
    list.appendChild(item);
  });
}

function exportBookmarks() {
  const data = JSON.stringify(getBookmarks(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "research_bookmarks.json";
  a.click();

  URL.revokeObjectURL(url);
}
