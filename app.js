// Minimal, deployable browser app. No bundler required.
// Uses Zarrita via CDN only for store path utilities if needed; tree built from consolidated .zmetadata.

// Optional: try to import zarrita for URL helpers. If CDN fails, app still works.
let zarrita; // eslint-disable-line no-unused-vars
(async () => {
  try {
    zarrita = await import("https://esm.sh/zarrita@0.4?bundle");
  } catch (e) {
    // ignore; we don't strictly need zarrita to render metadata tree
  }
})();

const $ = (sel) => document.querySelector(sel);
const statusEl = () => $("#status");
const slideEl = () => $("#slide");
const sidebarEl = () => $("#sidebar");

const state = {
  baseUrl: "",
  tree: null, // { pathMap: Map<string, Node>, root: Node }
  activePath: "/",
  highlightVarPath: null,
};

/** Node shape
 * {
 *  path: string ("/" for root),
 *  type: "group" | "array",
 *  attrs?: object,
 *  zarray?: object, // for arrays
 *  children: string[] // child basenames sorted
 * }
 */

function normalizeBase(url) {
  // Ensure no trailing slash for consistent joins
  return url.replace(/\/$/, "");
}

function normalizePath(p) {
  if (!p) return "/";
  // Ensure leading slash, collapse repeats, remove trailing slash (except root)
  let s = p.replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 1) s = s.replace(/\/$/, "");
  return s;
}

async function fetchJson(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadZmetadata(baseUrl) {
  const u = normalizeBase(baseUrl);
  const metaUrl = `${u}/.zmetadata`;
  setStatus(`Fetching .zmetadata from ${metaUrl} ...`);
  const jm = await fetchJson(metaUrl);
  if (!jm || typeof jm !== "object" || !jm.metadata) {
    throw new Error(".zmetadata missing 'metadata' key. Ensure store is consolidated.");
  }
  return { base: u, consolidated: jm };
}

function buildTree(consolidated) {
  const pathMap = new Map();
  // Ensure root exists
  ensureNode(pathMap, "/").type = "group";

  const meta = consolidated.metadata;
  for (const [key, value] of Object.entries(meta)) {
    // keys are like "foo/.zgroup", "foo/bar/.zarray", "foo/.zattrs"
    if (!key.endsWith(".zgroup") && !key.endsWith(".zarray") && !key.endsWith(".zattrs")) continue;
    const path = normalizePath("/" + key.replace(/\.z(group|array|attrs)$/i, ""));
    const node = ensureNode(pathMap, path);
    if (key.endsWith(".zgroup")) node.type = "group";
    if (key.endsWith(".zarray")) node.type = "array";
    if (key.endsWith(".zattrs")) node.attrs = value || {};
    if (key.endsWith(".zarray")) node.zarray = value || {};
  }

  // Infer missing parent groups and children lists
  for (const p of pathMap.keys()) {
    if (p === "/") continue;
    const parent = dirname(p);
    const base = basename(p);
    const parentNode = ensureNode(pathMap, parent);
    if (!parentNode.children.includes(base)) parentNode.children.push(base);
  }
  // Sort children for stable sibling navigation
  for (const node of pathMap.values()) node.children.sort((a, b) => a.localeCompare(b));

  return { pathMap, root: pathMap.get("/") };
}

function ensureNode(map, path) {
  const np = normalizePath(path);
  let node = map.get(np);
  if (!node) {
    node = { path: np, type: "group", attrs: {}, children: [] };
    map.set(np, node);
  }
  return node;
}

function dirname(p) {
  const np = normalizePath(p);
  if (np === "/") return "/";
  const parts = np.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}
function basename(p) {
  const np = normalizePath(p);
  if (np === "/") return "/";
  const parts = np.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

function siblingsOf(tree, path) {
  // Operate among sibling GROUPS only
  const parent = dirname(path);
  const sibNames = tree.pathMap.get(parent)?.children || [];
  const sibGroups = sibNames
    .map((name) => tree.pathMap.get(join(parent, name)))
    .filter((n) => n && n.type === "group")
    .map((n) => basename(n.path));
  const idx = sibGroups.indexOf(basename(path));
  return { parent, list: sibGroups, index: idx };
}

function firstChildOf(tree, path) {
  const node = tree.pathMap.get(path);
  if (!node || !node.children.length) return null;
  // Choose first GROUP child only
  for (const name of node.children) {
    const child = tree.pathMap.get(join(path, name));
    if (child && child.type === "group") return child.path;
  }
  return null;
}

function join(parent, childBase) {
  const pp = normalizePath(parent);
  const out = pp === "/" ? `/${childBase}` : `${pp}/${childBase}`;
  return normalizePath(out);
}

function setStatus(msg) { statusEl().textContent = msg; }

function renderActive() {
  const { tree, activePath } = state;
  const el = slideEl();
  try {
    if (!tree) {
      el.innerHTML = `<div class="placeholder">Enter a Zarr store URL and click Load.</div>`;
      renderSidebar();
      return;
    }
    const node = tree.pathMap.get(activePath);
    if (!node) {
      el.innerHTML = `<div class="error">Path not found: ${escapeHtml(activePath)}</div>`;
      renderSidebar();
      return;
    }

  const crumbs = breadcrumb(activePath)
    .map((p, i, arr) => `<span>${escapeHtml(basename(p) || "/")}${i < arr.length - 1 ? " / " : ""}</span>`)
    .join("");

  const parts = [];
  parts.push(`<div class="breadcrumb">${crumbs}</div>`);
  if (node.type === "array") {
    parts.push(`<div class="node-title">Array <span class="badge">${escapeHtml(activePath)}</span></div>`);
    const metaRows = [];
    metaRows.push(["type", "array"]);
    const za = node.zarray || {};
    if (za.shape) metaRows.push(["shape", JSON.stringify(za.shape)]);
    if (za.dtype) metaRows.push(["dtype", String(za.dtype)]);
    if (za.chunks) metaRows.push(["chunks", JSON.stringify(za.chunks)]);
    if (za.chunk_grid) metaRows.push(["chunk_grid", JSON.stringify(za.chunk_grid)]);
    if (za.codecs) metaRows.push(["codecs", JSON.stringify(za.codecs)]);
    if (za.compressor) metaRows.push(["compressor", JSON.stringify(za.compressor)]);
    parts.push(`<div class="meta">${metaRows.map(([k, v]) => `<div class="label">${escapeHtml(k)}</div><div class="value">${escapeHtml(v)}</div>`).join("")}</div>`);
    if (node.attrs && Object.keys(node.attrs).length) {
      parts.push(`<div class="section"><h3>Attributes</h3><pre class="codeblock">${escapeHtml(JSON.stringify(node.attrs, null, 2))}</pre></div>`);
    }
    el.innerHTML = parts.join("");
    return;
  }

  parts.push(`<div class="node-title">Group <span class="badge">${escapeHtml(activePath)}</span></div>`);
  const groupView = renderGroupLikeXarray(state.tree, node);
  parts.push(groupView);
  el.innerHTML = parts.join("");
  renderSidebar();
  } catch (e) {
    el.innerHTML = `<div class="error">Render error: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function breadcrumb(path) {
  const parts = path.split("/").filter(Boolean);
  const acc = ["/"];
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : `/${p}`;
    acc.push(cur);
  }
  return acc;
}

function escapeHtml(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setActive(path) {
  // Prevent setting arrays as active; keep only groups active
  const node = state.tree?.pathMap.get(path);
  const targetPath = node && node.type === "group" ? path : dirname(path);
  state.activePath = targetPath;
  state.highlightVarPath = node && node.type === "array" ? node.path : null;
  renderActive();
}

function handleKeydown(ev) {
  if (!state.tree) return;
  const { key } = ev;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) ev.preventDefault();

  if (key === "ArrowUp") {
    const parent = dirname(state.activePath);
    if (parent && parent !== state.activePath) setActive(parent);
  } else if (key === "ArrowDown") {
    const child = firstChildOf(state.tree, state.activePath);
    if (child) setActive(child);
  } else if (key === "ArrowLeft" || key === "ArrowRight") {
    const { parent, list, index } = siblingsOf(state.tree, state.activePath);
    if (!list.length) return;
    if (index < 0) return; // current not a group sibling (e.g., root) -> no-op
    const delta = key === "ArrowLeft" ? -1 : 1;
    const nextIdx = (index + delta + list.length) % list.length;
    const nextPath = join(parent, list[nextIdx]);
    setActive(nextPath);
  }
}

async function onLoadClick() {
  const input = $("#zarrUrl");
  const baseUrl = (input.value || "").trim();
  if (!baseUrl) {
    setStatus("Please enter a Zarr store base URL.");
    input.focus();
    return;
  }
  try {
    slideEl().focus();
    setStatus("Loading...");
    const { consolidated } = await loadZmetadata(baseUrl);
    state.baseUrl = normalizeBase(baseUrl);
    state.tree = buildTree(consolidated);
    state.activePath = "/";
    renderActive();
    setStatus("Loaded.");
  } catch (err) {
    slideEl().innerHTML = `<div class="error">${escapeHtml(err.message || String(err))}</div>`;
    setStatus("Error.");
  }
}

function init() {
  $("#loadBtn").addEventListener("click", onLoadClick);
  $("#zarrUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") onLoadClick(); });
  document.addEventListener("keydown", handleKeydown);
  renderActive();
}

init();

function renderSidebar() {
  const el = sidebarEl();
  if (!el) return;
  if (!state.tree) {
    el.innerHTML = `<div class="sidebar__placeholder small">Load a store to view the hierarchy</div>`;
    return;
  }
  const html = `<ul class="tree">${renderTreeNode(state.tree, "/")}</ul>`;
  el.innerHTML = html;
  // Bind clicks
  el.querySelectorAll("a[data-path]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const p = a.getAttribute("data-path");
      if (!p) return;
      setActive(p);
    });
  });
  // Mark active
  const active = el.querySelector(`a[data-path="${CSS.escape(state.activePath)}"]`);
  if (active) active.classList.add("active");
}

function renderTreeNode(tree, path) {
  const node = tree.pathMap.get(normalizePath(path));
  if (!node) return "";
  const isGroup = node.type === "group";
  const label = path === "/" ? "/" : basename(path);
  let li = `<li>`;
  li += `<a href="#" data-path="${escapeHtml(node.path)}">${isGroup ? `<span class=\"badge\">grp</span>` : `<span class=\"badge\">arr</span>`}${escapeHtml(label)}</a>`;
  if (isGroup && node.children && node.children.length) {
    const kids = node.children.map((name) => {
      const childPath = join(node.path, name);
      return renderTreeNode(tree, childPath);
    }).join("");
    if (kids) li += `<ul>${kids}</ul>`;
  }
  li += `</li>`;
  return li;
}

function renderGroupLikeXarray(tree, grpNode) {
  const arrays = collectArrays(tree, grpNode, 0, 0); // only variables directly in this group

  const dimsByVar = new Map();
  const sizesByVar = new Map();
  const attrsByVar = new Map();
  const allDims = new Set();
  const coordCandidates = new Map(); // name -> size for 1D arrays named after themselves

  for (const arr of arrays) {
    const dims = inferArrayDims(arr);
    dimsByVar.set(arr, dims);
    sizesByVar.set(arr, Array.isArray(arr.zarray?.shape) ? arr.zarray.shape : []);
    attrsByVar.set(arr, arr.attrs || {});
    dims.forEach((d) => allDims.add(d));
    // collect 1D arrays as potential coordinates
    const name = basename(arr.path);
    const shp = Array.isArray(arr.zarray?.shape) ? arr.zarray.shape : [];
    if (shp.length === 1 && Number.isFinite(shp[0])) {
      coordCandidates.set(name, shp[0]);
    }
  }

  // Build dim -> size mapping (prefer coords of same name, else first occurrence)
  const dimSizes = new Map();
  // First pass: from variables
  for (const arr of arrays) {
    const dims = dimsByVar.get(arr) || [];
    const shape = sizesByVar.get(arr) || [];
    dims.forEach((d, i) => {
      if (!dimSizes.has(d) && Number.isFinite(shape[i])) dimSizes.set(d, shape[i]);
    });
  }
  // Second pass: prefer coord arrays named after the dim
  for (const arr of arrays) {
    const name = basename(arr.path);
    const dims = dimsByVar.get(arr) || [];
    const shape = sizesByVar.get(arr) || [];
    if (dims.length === 1 && dims[0] === name && Number.isFinite(shape[0])) dimSizes.set(name, shape[0]);
  }
  // If no explicit dim names, derive from 1D coord candidates
  if (dimSizes.size === 0 && coordCandidates.size > 0) {
    for (const [n, sz] of coordCandidates.entries()) dimSizes.set(n, sz);
  }

  // If variable has no _ARRAY_DIMENSIONS, infer names by matching axis sizes to known coord sizes
  for (const arr of arrays) {
    const dims = dimsByVar.get(arr) || [];
    if (!dims.length || dims.every((d) => d.startsWith("dim_"))) {
      const shape = sizesByVar.get(arr) || [];
      const inferred = [];
      const used = new Set();
      for (const ax of shape) {
        let match = null;
        for (const [dn, sz] of dimSizes.entries()) {
          if (sz === ax && !used.has(dn)) { match = dn; break; }
        }
        inferred.push(match || `dim_${inferred.length}`);
        if (match) used.add(match);
      }
      dimsByVar.set(arr, inferred);
      inferred.forEach((d) => allDims.add(d));
    }
  }

  const coords = [];
  const dataVars = [];
  for (const arr of arrays) {
    const name = basename(arr.path);
    const dims = dimsByVar.get(arr) || [];
    const shape = sizesByVar.get(arr) || [];
    const isCoord = (shape.length === 1 && coordCandidates.has(name)) || (dims.length === 1 && (dims[0] === name || coordCandidates.has(name)));
    (isCoord ? coords : dataVars).push({ arr, name, dims, shape, attrs: attrsByVar.get(arr) || {} });
  }

  if (allDims.size === 0 && coordCandidates.size > 0) {
    for (const dn of coordCandidates.keys()) allDims.add(dn);
  }
  const dimList = Array.from(allDims);

  const sections = [];
  // Dimensions
  const dimRows = dimList.length ? dimList.map((d) => `<div class="label">${escapeHtml(d)}</div><div class="value">${escapeHtml(dimSizes.get(d) ?? "?")}</div>`).join("") : `<div class="small">(none)</div>`;
  sections.push(`<div class="section"><h3>Dimensions</h3><div class="meta">${dimRows}</div></div>`);

  // Coordinates (collapsible)
  const coordItems = coords.map(({ name, dims, shape, arr }) =>
    `<div class="varline ${arr.path === state.highlightVarPath ? 'highlight' : ''}"><span class=\"badge\">coord</span> <span class=\"varname\">${escapeHtml(name)}</span> ${formatDimsWithSizes(dims, shape)} ${renderChunkViz(arr)} ${renderVarAttrsDetails(arr.attrs)}</div>`
  ).join("") || `<div class=\"small\">(none)</div>`;
  sections.push(`
    <div class="section">
      <details open>
        <summary>Coordinates</summary>
        <div class="codeblock">${coordItems}</div>
      </details>
    </div>
  `);

  // Data variables (collapsible)
  const dataItems = dataVars.map(({ name, dims, shape, arr }) =>
    `<div class="varline ${arr.path === state.highlightVarPath ? 'highlight' : ''}"><span class=\"badge\">data</span> <span class=\"varname\">${escapeHtml(name)}</span> ${formatDimsWithSizes(dims, shape)} ${renderChunkViz(arr)} ${renderVarAttrsDetails(arr.attrs)}</div>`
  ).join("") || `<div class=\"small\">(none)</div>`;
  sections.push(`
    <div class="section">
      <details open>
        <summary>Data variables</summary>
        <div class="codeblock">${dataItems}</div>
      </details>
    </div>
  `);

  // Child groups (always show immediate child groups)
  const groupChildren = grpNode.children
    .map((name) => tree.pathMap.get(join(grpNode.path, name)))
    .filter((n) => n && n.type === "group");
  const groupItems = groupChildren.map((g) => `<div><span class="badge">group</span> <a href="#" data-path="${escapeHtml(g.path)}" class="navlink">${escapeHtml(basename(g.path) || "/")}</a></div>`).join("") || `<div class="small">(none)</div>`;
  sections.push(`<div class="section"><h3>Groups</h3><div class="codeblock">${groupItems}</div></div>`);

  // Attributes (collapsible; show even if none)
  const attrsBlock = grpNode.attrs && Object.keys(grpNode.attrs).length
    ? `<pre class="codeblock">${escapeHtml(JSON.stringify(grpNode.attrs, null, 2))}</pre>`
    : `<div class="codeblock"><div class="small">(none)</div></div>`;
  sections.push(`
    <div class="section">
      <details>
        <summary>Attributes</summary>
        ${attrsBlock}
      </details>
    </div>
  `);

  const html = sections.join("");
  queueMicrotask(() => bindNavLinks());
  return html;
}

function collectArrays(tree, grpNode, depth = 0, maxDepth = 1) {
  const found = [];
  // arrays directly under this group
  for (const name of grpNode.children) {
    const n = tree.pathMap.get(join(grpNode.path, name));
    if (n && n.type === "array") found.push(n);
  }
  if (depth < maxDepth) {
    for (const name of grpNode.children) {
      const n = tree.pathMap.get(join(grpNode.path, name));
      if (n && n.type === "group") found.push(...collectArrays(tree, n, depth + 1, maxDepth));
    }
  }
  return found;
}

function inferArrayDims(arr) {
  const attrs = arr.attrs || {};
  const dimsAttr = attrs["_ARRAY_DIMENSIONS"]; // common with xarray zarr
  if (Array.isArray(dimsAttr) && dimsAttr.every((d) => typeof d === "string")) return dimsAttr;
  const rank = Array.isArray(arr.zarray?.shape) ? arr.zarray.shape.length : 0;
  const fallback = Array.from({ length: rank }, (_, i) => `dim_${i}`);
  return fallback;
}

function formatDimsWithSizes(dims, shape) {
  const pairs = dims.map((d, i) => `${d}: ${shape[i] ?? "?"}`);
  return `(${pairs.join(", ")})`;
}

function bindNavLinks() {
  document.querySelectorAll("a.navlink[data-path]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      // Do not navigate to array as active; keep group active.
      // In future we could show an inline variable detail.
    });
  });
}

function formatVarAttrsInline(attrs = {}) {
  const keys = ["standard_name", "long_name", "units"];
  const parts = keys.map((k) => attrs && attrs[k] ? `${k}=${escapeHtml(String(attrs[k]))}` : null).filter(Boolean);
  return parts.length ? `| ${parts.join(" ")}` : "";
}

function renderVarAttrsDetails(attrs = {}) {
  if (!attrs || typeof attrs !== "object" || Object.keys(attrs).length === 0) return "";
  const rows = Object.entries(attrs).map(([k, v]) => {
    let val;
    if (v == null) val = "null";
    else if (typeof v === "object") val = JSON.stringify(v);
    else val = String(v);
    return `<div class="label">${escapeHtml(k)}</div><div class="value">${escapeHtml(val)}</div>`;
  }).join("");
  return `<details class="var-attrs"><summary>Attributes</summary><div class="meta small">${rows}</div></details>`;
}

function renderChunkViz(arr) {
  const za = arr.zarray || {};
  const shape = Array.isArray(za.shape) ? za.shape : [];
  const chunks = Array.isArray(za.chunks) ? za.chunks : null;
  if (!shape.length || !chunks || chunks.length !== shape.length) return "";
  const counts = chunkCounts(shape, chunks);
  // Only visualize 1D/2D for simplicity, else summary
  if (counts.length === 1) {
    const n = Math.ceil(counts[0]);
    const cap = Math.min(n, 200);
    const cells = Array.from({ length: cap }, (_, i) => `<div class="chunk-cell" title="chunk ${i+1}/${n}"></div>`).join("");
    const more = n > cap ? `<span class="small"> +${n-cap} more</span>` : "";
    return `<div class="chunkviz chunkviz-1d" aria-label="chunks: ${n}">${cells}</div>${more}`;
  }
  if (counts.length === 2) {
    const [ny, nx] = counts.map((c) => Math.ceil(c));
    const maxX = Math.min(nx, 50);
    const maxY = Math.min(ny, 30);
    let rows = "";
    for (let y = 0; y < maxY; y++) {
      const rowCells = Array.from({ length: maxX }, (_, x) => `<div class="chunk-cell" title="chunk (${y+1},${x+1})/${ny},${nx}"></div>`).join("");
      rows += `<div class="chunk-row">${rowCells}${nx>maxX?`<span class=\"small\"> +${nx-maxX} →</span>`:""}</div>`;
    }
    const moreY = ny > maxY ? `<div class="small">+${ny-maxY} rows more ↓</div>` : "";
    return `<div class="chunkviz chunkviz-2d" aria-label="chunks: ${ny}x${nx}">${rows}${moreY}</div>`;
  }
  // Higher dims: show summary only
  const summary = counts.map((c) => Math.ceil(c)).join("x");
  return `<span class="small">chunks: ${escapeHtml(summary)}</span>`;
}

function chunkCounts(shape, chunks) {
  return shape.map((s, i) => (chunks[i] ? Math.ceil(s / chunks[i]) : 1));
}
