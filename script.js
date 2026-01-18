let cursor = "*";
let currentQuery = "";
let currentSort = "";
let isLoading = false;

let totalResults = 0;
let loadedResults = 0;

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

// ---------- UI INIT ----------

createBookmarkDrawer();
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
      "Add your API key + Search Engine ID to enable PDF lookup for bookmarks.";
    return;
  }

  status.innerText = "Google settings saved. PDF lookup is enabled for bookmarks.";
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

async function fetchGooglePdfLinks(entry) {
  const { apiKey, cx } = getGoogleSettings();
  if (!apiKey || !cx) {
    return { links: [], status: "missing_settings" };
  }

  const title = entry.title || "";
  const firstAuthor = (entry.authors || "").split(",")[0]?.trim();

  const queryParts = [];
  if (title) queryParts.push(`"${title}"`);
  if (firstAuthor) queryParts.push(`"${firstAuthor}"`);
  queryParts.push("filetype:pdf");

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", queryParts.join(" "));
  url.searchParams.set("num", "10");
  url.searchParams.set("fileType", "pdf");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return { links: [], status: `error_${res.status}` };
    }

    const data = await res.json();
    const items = data?.items || [];
    const unique = new Set();

    items.forEach((item) => {
      const link = item?.link || "";
      if (link.toLowerCase().includes(".pdf")) {
        unique.add(link);
      }
    });

    return { links: Array.from(unique).slice(0, 5), status: "ok" };
  } catch (error) {
    console.error(error);
    return { links: [], status: "error_network" };
  }
}

function renderPdfPills(links) {
  if (!links || links.length === 0) return "";
  return `
    <div class="pdf-pills">
      ${links
        .map(
          (link, index) =>
            `<a class="pdf-pill" href="${link}" target="_blank" rel="noopener">PDF ${
              index + 1
            }</a>`
        )
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
      pdfLinks: [],
      pdfLinksStatus: "pending"
    };
    bookmarks.push(pendingEntry);
    btn.style.color = "blue";
    btn.style.opacity = "1";
  }

  saveBookmarks(bookmarks);
  renderBookmarkList();

  if (!exists) {
    const { links, status } = await fetchGooglePdfLinks(entry);
    const updated = getBookmarks().map((b) =>
      b.id === entry.id
        ? {
            ...b,
            pdfLinks: links,
            pdfLinksStatus: status
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
  btn.innerText = "Bookmarks";

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

function createBookmarkDrawer() {
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
  drawer.id = "bookmarkDrawer";
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
    <button onclick="closeDrawer()" style="float:left">✕</button>
    <h2 style="margin-left:30px">Bookmarks</h2>
    <button onclick="exportBookmarks()">Export JSON</button>
    <div id="bookmarkList" style="margin-top:10px"></div>
  `;

  drawer.onclick = (e) => e.stopPropagation();
  document.body.appendChild(drawer);

  renderBookmarkList();
}

function openDrawer() {
  document.getElementById("bookmarkDrawer").style.right = "0px";
  document.getElementById("drawerOverlay").style.display = "block";
}

function closeDrawer() {
  document.getElementById("bookmarkDrawer").style.right = "-420px";
  document.getElementById("drawerOverlay").style.display = "none";
}

function renderBookmarkList() {
  const list = document.getElementById("bookmarkList");
  if (!list) return;

  const bookmarks = getBookmarks();
  list.innerHTML = "";

  if (bookmarks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small-note";
    empty.innerText = "No bookmarks yet.";
    list.appendChild(empty);
    return;
  }

  bookmarks.forEach((b) => {
    const item = document.createElement("div");
    item.style.borderBottom = "1px solid #ddd";
    item.style.padding = "8px";
    item.style.cursor = "pointer";

    item.innerHTML = `<b>${b.title}</b>`;

    item.onclick = () => {
      const pdfLinks = Array.isArray(b.pdfLinks) ? b.pdfLinks : [];
      let pdfSection = "";

      if (b.pdfLinksStatus === "pending") {
        pdfSection = `<div class="small-note">Finding PDF links...</div>`;
      } else if (b.pdfLinksStatus === "missing_settings") {
        pdfSection = `<div class="small-note">Add your Google API key + cx to find PDFs.</div>`;
      } else if (b.pdfLinksStatus && b.pdfLinksStatus !== "ok") {
        pdfSection = `<div class="small-note">Could not load PDF links (${escapeHtml(
          b.pdfLinksStatus
        )}).</div>`;
      }

      item.innerHTML = `
        <b>${b.title}</b><br>
        <small>${b.year}${
        b.publication_date ? ` (${b.publication_date})` : ""
      }</small><br>
        <small>${b.authors}</small><br>
        ${
          b.cited_by_count != null
            ? `<small>Citations: ${b.cited_by_count}</small><br>`
            : ""
        }
        ${b.doi ? `<small>DOI: ${b.doi}</small><br>` : ""}
        ${renderPdfPills(pdfLinks)}
        ${pdfSection}
        <p>${escapeHtml(b.abstract || "")}</p>
      `;
    };

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
