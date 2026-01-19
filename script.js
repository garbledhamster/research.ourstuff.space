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

// Track currently expanded card details
let currentExpandedBookmarkDetails = null;
let currentExpandedBookmarkButton = null;
let currentExpandedProjectDetails = null;
let currentExpandedProjectButton = null;

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

createLibraryDrawer();
createSettingsDrawer();

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

// ---------- OPENAI SETTINGS ----------

function getOpenAISettings() {
  return {
    apiKey: localStorage.getItem("openaiApiKey") || "",
    model: localStorage.getItem("openaiModel") || "gpt-4o-mini",
    temperature: parseFloat(localStorage.getItem("openaiTemperature") || "0.7"),
    maxTokens: parseInt(localStorage.getItem("openaiMaxTokens") || "300", 10),
    generateAbstractions: localStorage.getItem("openaiGenerateAbstractions") === "true",
  };
}

function setOpenAISettings(apiKey, model, temperature, maxTokens, generateAbstractions) {
  localStorage.setItem("openaiApiKey", apiKey);
  localStorage.setItem("openaiModel", model);
  localStorage.setItem("openaiTemperature", String(temperature));
  localStorage.setItem("openaiMaxTokens", String(maxTokens));
  localStorage.setItem("openaiGenerateAbstractions", String(generateAbstractions));
}

async function validateOpenAIKey() {
  const apiKeyInput = document.getElementById("openaiApiKey");
  const apiKey = apiKeyInput?.value.trim() || "";
  const statusDiv = document.getElementById("openaiValidationStatus");
  const configPanel = document.getElementById("openaiConfigPanel");

  if (!apiKey) {
    statusDiv.innerText = "Please enter an API key.";
    statusDiv.style.color = "var(--pico-color-red-500)";
    configPanel.style.display = "none";
    return;
  }

  statusDiv.innerText = "Validating...";
  statusDiv.style.color = "";

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      localStorage.setItem("openaiApiKey", apiKey);
      statusDiv.innerText = "API key is valid! Configuration options revealed below.";
      statusDiv.style.color = "var(--pico-color-green-500)";
      configPanel.style.display = "block";

      // Load saved settings
      const settings = getOpenAISettings();
      document.getElementById("openaiModel").value = settings.model;
      document.getElementById("openaiTemperature").value = settings.temperature;
      document.getElementById("tempValue").textContent = settings.temperature;
      document.getElementById("openaiMaxTokens").value = settings.maxTokens;
      document.getElementById("tokensValue").textContent = settings.maxTokens;
      document.getElementById("openaiGenerateAbstractions").checked = settings.generateAbstractions;
    } else {
      const error = await response.json().catch(() => ({}));
      statusDiv.innerText = `Invalid API key: ${error.error?.message || response.statusText}`;
      statusDiv.style.color = "var(--pico-color-red-500)";
      configPanel.style.display = "none";
    }
  } catch (err) {
    statusDiv.innerText = `Validation error: ${err.message}`;
    statusDiv.style.color = "var(--pico-color-red-500)";
    configPanel.style.display = "none";
  }
}

function saveOpenAISettings() {
  const model = document.getElementById("openaiModel")?.value || "gpt-4o-mini";
  const temperature = parseFloat(
    document.getElementById("openaiTemperature")?.value || "0.7"
  );
  const maxTokens = parseInt(
    document.getElementById("openaiMaxTokens")?.value || "300",
    10
  );
  const generateAbstractions = document.getElementById("openaiGenerateAbstractions")?.checked || false;
  const apiKey = getOpenAISettings().apiKey;

  setOpenAISettings(apiKey, model, temperature, maxTokens, generateAbstractions);

  const statusDiv = document.getElementById("openaiValidationStatus");
  const originalText = statusDiv.innerText;
  statusDiv.innerText = "ChatGPT settings saved!";
  statusDiv.style.color = "var(--pico-color-green-500)";

  setTimeout(() => {
    statusDiv.innerText = originalText;
  }, 2000);
}

async function generateResearchNote(bookmarkId) {
  const bookmarks = getBookmarks();
  const bookmark = bookmarks.find((b) => b.id === bookmarkId);
  if (!bookmark) return;

  const settings = getOpenAISettings();
  if (!settings.apiKey) {
    alert("Please add and validate your OpenAI API key in Advanced settings.");
    return;
  }

  const statusElement = document.getElementById(`chatty-status-${bookmarkId}`);
  if (statusElement) {
    statusElement.innerText = "Chatty is thinking...";
  }

  // Determine what to generate based on settings
  let prompt;
  let isAbstraction = false;
  
  if (settings.generateAbstractions) {
    isAbstraction = true;
    const hasOriginalAbstract = bookmark.abstract && bookmark.abstract.length >= 30 && bookmark.abstract !== "Abstract not available";
    
    if (hasOriginalAbstract) {
      // Rewrite existing abstract
      prompt = `You are a research assistant. Rewrite the following academic paper abstract in your own words while preserving all key information. Keep it concise and academic in tone.

Title: ${bookmark.title}
Authors: ${bookmark.authors || "Unknown"}
Year: ${bookmark.year || "Unknown"}

Original Abstract:
${bookmark.abstract}

Provide only the rewritten abstract, nothing else.`;
    } else {
      // Generate new abstract
      prompt = `You are a research assistant. Based on the title and authors of the following academic paper, write a brief abstract that describes what the paper likely covers. Keep it concise and academic in tone.

Title: ${bookmark.title}
Authors: ${bookmark.authors || "Unknown"}
Year: ${bookmark.year || "Unknown"}

Provide only the abstract, nothing else.`;
    }
  } else {
    // Original research note behavior
    prompt = `You are a research assistant. Analyze the following academic paper and provide a single well-written paragraph that explains:
1. The abstraction or theoretical framework
2. The key findings
3. The conclusions

Keep it concise and academic in tone.

Title: ${bookmark.title}
Authors: ${bookmark.authors || "Unknown"}
Year: ${bookmark.year || "Unknown"}
Abstract: ${bookmark.abstract || "No abstract available"}`;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: prompt }],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || response.statusText);
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "";

    // Update bookmark with AI content
    const updatedBookmarks = bookmarks.map((b) => {
      if (b.id === bookmarkId) {
        if (isAbstraction) {
          return { ...b, aiAbstract: aiContent, aiAbstractGenerated: true };
        } else {
          return { ...b, aiSummary: aiContent };
        }
      }
      return b;
    });
    saveBookmarks(updatedBookmarks);

    // Re-render to show the content
    renderBookmarksView();
  } catch (err) {
    if (statusElement) {
      statusElement.innerText = `Error: ${err.message}`;
      statusElement.style.color = "var(--pico-color-red-500)";
    } else {
      alert(`Error generating note: ${err.message}`);
    }
  }
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
    bookmarkBtn.style.color = "var(--accent-bookmarked)";
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
    pubDate ? ` <span style="color:var(--text-3)">(${pubDate})</span>` : ""
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
    btn.style.color = "var(--accent-bookmarked)";
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

// ---------- LIBRARY DRAWER ----------

function createLibraryDrawer() {
  const overlay = document.createElement("div");
  overlay.id = "libraryDrawerOverlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "var(--surface-overlay)";
  overlay.style.display = "none";
  overlay.style.zIndex = "998";
  overlay.onclick = closeLibraryDrawer;
  document.body.appendChild(overlay);

  const drawer = document.createElement("div");
  drawer.id = "libraryDrawer";
  drawer.style.position = "fixed";
  drawer.style.right = "-420px";
  drawer.style.top = "0";
  drawer.style.width = "400px";
  drawer.style.height = "100%";
  drawer.style.background = "var(--surface-1)";
  drawer.style.boxShadow = "-2px 0 8px var(--shadow-color)";
  drawer.style.padding = "15px";
  drawer.style.overflowY = "auto";
  drawer.style.transition = "0.3s";
  drawer.style.zIndex = "999";

  drawer.innerHTML = `
    <div class="drawer-header">
      <button type="button" class="drawer-icon-button" onclick="closeLibraryDrawer()">✕</button>
      <h2 id="libraryDrawerTitle">Library</h2>
      <button type="button" class="drawer-icon-button" id="libraryDrawerActionBtn" onclick="exportBookmarks()">Export</button>
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

function openLibraryDrawer() {
  document.getElementById("libraryDrawer").style.right = "0px";
  document.getElementById("libraryDrawerOverlay").style.display = "block";
}

function closeLibraryDrawer() {
  document.getElementById("libraryDrawer").style.right = "-420px";
  document.getElementById("libraryDrawerOverlay").style.display = "none";
}

// ---------- SETTINGS DRAWER ----------

function createSettingsDrawer() {
  const overlay = document.createElement("div");
  overlay.id = "settingsDrawerOverlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "var(--surface-overlay)";
  overlay.style.display = "none";
  overlay.style.zIndex = "998";
  overlay.onclick = closeSettingsDrawer;
  document.body.appendChild(overlay);

  const drawer = document.createElement("div");
  drawer.id = "settingsDrawer";
  drawer.style.position = "fixed";
  drawer.style.right = "-420px";
  drawer.style.top = "0";
  drawer.style.width = "400px";
  drawer.style.height = "100%";
  drawer.style.background = "var(--surface-1)";
  drawer.style.boxShadow = "-2px 0 8px var(--shadow-color)";
  drawer.style.padding = "15px";
  drawer.style.overflowY = "auto";
  drawer.style.transition = "0.3s";
  drawer.style.zIndex = "999";

  drawer.innerHTML = `
    <div class="drawer-header">
      <button type="button" class="drawer-icon-button" onclick="closeSettingsDrawer()">✕</button>
      <h2>Settings</h2>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">
        OpenAI ChatGPT (Research Notes)
        <span class="help-links">
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener"
            title="Get your OpenAI API key"
          >Get API Key</a>
        </span>
      </div>

      <div class="settings-grid">
        <input
          id="openaiApiKey"
          type="password"
          placeholder="OpenAI API key (stored locally)"
        />
        <button type="button" onclick="validateOpenAIKey()">Validate Key</button>
      </div>

      <div id="openaiValidationStatus" class="settings-note"></div>

      <div id="openaiConfigPanel" style="display: none;">
        <div class="settings-grid">
          <select id="openaiModel" title="ChatGPT Model">
            <option value="gpt-4o-mini">GPT-4o Mini (Fast & Affordable)</option>
            <option value="gpt-4o">GPT-4o (Recommended)</option>
            <option value="gpt-4-turbo">GPT-4 Turbo</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          </select>

          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <label for="openaiTemperature" style="font-size: 0.875rem;">Temperature: <span id="tempValue">0.7</span></label>
            <input
              id="openaiTemperature"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value="0.7"
              oninput="document.getElementById('tempValue').textContent = this.value"
            />
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <label for="openaiMaxTokens" style="font-size: 0.875rem;">Max Tokens: <span id="tokensValue">300</span></label>
            <input
              id="openaiMaxTokens"
              type="range"
              min="100"
              max="500"
              step="50"
              value="300"
              oninput="document.getElementById('tokensValue').textContent = this.value"
            />
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
            <input
              id="openaiGenerateAbstractions"
              type="checkbox"
              style="width: auto; margin: 0;"
            />
            <label for="openaiGenerateAbstractions" style="font-size: 0.875rem; margin: 0;">Generate AI abstractions for bookmarks</label>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-3); margin-top: -0.5rem; margin-left: 1.5rem;">
            When enabled, AI will write/rewrite abstractions instead of using the original. AI-generated abstractions will be marked with 🤖.
          </div>
        </div>

        <button type="button" onclick="saveOpenAISettings()" style="width: 100%; margin-top: 10px;">Save ChatGPT Settings</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">
        Google Source Finder (Bookmarks)
        <span class="help-links">
          <a
            href="https://developers.google.com/custom-search/v1/introduction"
            target="_blank"
            rel="noopener"
            title="How to get an API key + set up Programmable Search Engine"
          >Help</a>
          <span class="dot">•</span>
          <a
            href="https://support.google.com/programmable-search/answer/12499034?hl=en"
            target="_blank"
            rel="noopener"
            title="How to find your Search Engine ID (cx)"
          >Find cx</a>
        </span>
      </div>

      <div class="settings-grid">
        <input
          id="googleApiKey"
          type="password"
          placeholder="Google Custom Search API key (stored locally)"
        />
        <input id="googleCx" type="text" placeholder="Search Engine ID (cx) (stored locally)" />
        <button type="button" onclick="saveGoogleSettings()" style="width: 100%;">Save Google Settings</button>
      </div>

      <div id="googleSettingsStatus" class="settings-note">
        Tip: Restrict your API key by HTTP referrer to your GitHub Pages domain.
      </div>
    </div>

    <div class="settings-note" style="margin-top: 20px;">
      All settings are stored locally in your browser and are never sent to any server except the respective APIs.
    </div>
  `;

  drawer.onclick = (e) => e.stopPropagation();
  document.body.appendChild(drawer);

  // Initialize settings after drawer is created
  initializeSettings();
}

function openSettingsDrawer() {
  document.getElementById("settingsDrawer").style.right = "0px";
  document.getElementById("settingsDrawerOverlay").style.display = "block";
}

function closeSettingsDrawer() {
  document.getElementById("settingsDrawer").style.right = "-420px";
  document.getElementById("settingsDrawerOverlay").style.display = "none";
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

  const drawerTitle = document.getElementById("libraryDrawerTitle");
  if (drawerTitle) drawerTitle.innerText = "Bookmarks";

  const actionBtn = document.getElementById("libraryDrawerActionBtn");
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

  const drawerTitle = document.getElementById("libraryDrawerTitle");
  if (drawerTitle) drawerTitle.innerText = "Projects";

  const actionBtn = document.getElementById("libraryDrawerActionBtn");
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

  // Clear tracking variables when re-rendering
  currentExpandedProjectDetails = null;
  currentExpandedProjectButton = null;

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
      // Collapse any currently expanded project
      if (currentExpandedProjectDetails && currentExpandedProjectDetails !== details) {
        currentExpandedProjectDetails.hidden = true;
        if (currentExpandedProjectButton) {
          currentExpandedProjectButton.innerText = "Details";
        }
      }

      // Toggle current card
      details.hidden = !details.hidden;
      toggleButton.innerText = details.hidden ? "Details" : "Hide";

      // Update tracking
      if (details.hidden) {
        currentExpandedProjectDetails = null;
        currentExpandedProjectButton = null;
      } else {
        currentExpandedProjectDetails = details;
        currentExpandedProjectButton = toggleButton;
      }
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

  // Clear tracking variables when re-rendering
  currentExpandedBookmarkDetails = null;
  currentExpandedBookmarkButton = null;

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

    const generateButton = document.createElement("button");
    generateButton.type = "button";
    generateButton.className = "bookmark-icon-button";
    generateButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`;
    generateButton.title = "Generate AI research note";
    generateButton.onclick = (event) => {
      event.stopPropagation();
      generateResearchNote(b.id);
    };

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "bookmark-icon-button";
    toggleButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    toggleButton.title = "View details";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "bookmark-icon-button bookmark-danger";
    deleteButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    deleteButton.title = "Delete bookmark";
    deleteButton.onclick = (event) => {
      event.stopPropagation();
      removeBookmark(b.id);
    };

    actions.appendChild(generateButton);
    actions.appendChild(toggleButton);
    actions.appendChild(deleteButton);

    header.appendChild(title);

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

    const aiSummarySection = b.aiSummary
      ? `<div class="chatty-summary">
           <div class="chatty-header">
             <span class="chatty-name">🤖 Chatty</span>
           </div>
           <div class="chatty-content" id="chatty-status-${b.id}">${escapeHtml(
           b.aiSummary
         )}</div>
         </div>`
      : "";

    // Display AI-generated abstract or original abstract
    let abstractSection = "";
    if (b.aiAbstract && b.aiAbstractGenerated) {
      // AI-generated abstract with warning
      abstractSection = `<div class="chatty-summary">
           <div class="chatty-header">
             <span class="chatty-name">🤖 Abstraction</span>
           </div>
           <div class="chatty-content" id="chatty-status-${b.id}">${escapeHtml(b.aiAbstract)}</div>
           <div class="chatty-warning">Generated with OpenAI, may be inaccurate</div>
         </div>`;
    } else if (b.abstract && b.abstract.length >= 30 && b.abstract !== "Abstract not available") {
      // Original abstract
      abstractSection = `<div class="chatty-summary">
           <div class="chatty-header">
             <span class="chatty-name">Abstraction</span>
           </div>
           <div class="chatty-content">${escapeHtml(b.abstract)}</div>
         </div>`;
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
      ${aiSummarySection}
      ${abstractSection}
      <div class="bookmark-note">
        <label for="bookmark-note-${b.id}">Note</label>
        <textarea id="bookmark-note-${b.id}" placeholder="Add a note..."></textarea>
      </div>
    `;

    const noteInput = details.querySelector("textarea");
    if (noteInput) {
      noteInput.value = b.note || "";
      noteInput.addEventListener("input", (event) => {
        updateBookmarkNote(b.id, event.target.value);
      });
    }

    toggleButton.onclick = () => {
      // Collapse any currently expanded bookmark
      if (currentExpandedBookmarkDetails && currentExpandedBookmarkDetails !== details) {
        currentExpandedBookmarkDetails.hidden = true;
        if (currentExpandedBookmarkButton) {
          currentExpandedBookmarkButton.innerText = "Details";
        }
      }

      // Toggle current card
      details.hidden = !details.hidden;
      toggleButton.innerText = details.hidden ? "Details" : "Hide";

      // Update tracking
      if (details.hidden) {
        currentExpandedBookmarkDetails = null;
        currentExpandedBookmarkButton = null;
      } else {
        currentExpandedBookmarkDetails = details;
        currentExpandedBookmarkButton = toggleButton;
      }
    };

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(details);
    item.appendChild(actions);
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

// ---------- INITIALIZATION ----------

function initializeSettings() {
  // Load Google settings
  const googleSettings = getGoogleSettings();
  const googleApiKeyInput = document.getElementById("googleApiKey");
  const googleCxInput = document.getElementById("googleCx");
  if (googleApiKeyInput) googleApiKeyInput.value = googleSettings.apiKey || "";
  if (googleCxInput) googleCxInput.value = googleSettings.cx || "";
  updateGoogleSettingsStatus();

  // Load OpenAI settings
  const openaiSettings = getOpenAISettings();
  const openaiApiKeyInput = document.getElementById("openaiApiKey");
  if (openaiApiKeyInput && openaiSettings.apiKey) {
    openaiApiKeyInput.value = openaiSettings.apiKey;

    // If there's a saved API key, show the config panel
    const configPanel = document.getElementById("openaiConfigPanel");
    const statusDiv = document.getElementById("openaiValidationStatus");
    if (configPanel && statusDiv) {
      statusDiv.innerText = "API key loaded from storage. Click 'Validate Key' to verify.";
      configPanel.style.display = "block";

      // Load saved config values
      document.getElementById("openaiModel").value = openaiSettings.model;
      document.getElementById("openaiTemperature").value = openaiSettings.temperature;
      document.getElementById("tempValue").textContent = openaiSettings.temperature;
      document.getElementById("openaiMaxTokens").value = openaiSettings.maxTokens;
      document.getElementById("tokensValue").textContent = openaiSettings.maxTokens;
      document.getElementById("openaiGenerateAbstractions").checked = openaiSettings.generateAbstractions;
    }
  }
}

// Settings are initialized when the settings drawer is created
