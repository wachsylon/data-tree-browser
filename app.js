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

const state = {
  baseUrl: "",
  tree: null, // { pathMap: Map<string, Node>, root: Node }
  activePath: "/",
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
    const path = "/" + key.replace(/\.z(group|array|attrs)$/i, "");
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
  let node = map.get(path);
  if (!node) {
    node = { path, type: "group", attrs: {}, children: [] };
    map.set(path, node);
  }
  return node;
}

function dirname(p) {
  if (p === "/") return "/";
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}
function basename(p) {
  if (p === "/") return "/";
  const parts = p.split("/").filter(Boolean);
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
  return parent === "/" ? `/${childBase}` : `${parent}/${childBase}`;
}

function setStatus(msg) { statusEl().textContent = msg; }

function renderActive() {
  const { tree, activePath } = state;
  const el = slideEl();
  try {
    if (!tree) {
      el.innerHTML = `<div class="placeholder">Enter a Zarr store URL and click Load.</div>`;
      return;
    }
    const node = tree.pathMap.get(activePath);
    if (!node) {
      el.innerHTML = `<div class="error">Path not found: ${escapeHtml(activePath)}</div>`;
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

function renderGroupLikeXarray(tree, grpNode) {
  let arrays = collectArrays(tree, grpNode, 0, 0); // only variables directly in this group
  if (arrays.length === 0) {
    // Fallback: look one level deeper to avoid empty sections for container groups
    arrays = collectArrays(tree, grpNode, 0, 1);
  }

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

  // Coordinates
  const coordItems = coords.map(({ name, dims, shape, arr }) =>
    `<div><span class="badge">coord</span> <a href="#" data-path="${escapeHtml(arr.path)}" class="navlink">${escapeHtml(name)}</a> ${formatDimsWithSizes(dims, shape)} dtype=${escapeHtml(arr.zarray?.dtype || "")} ${formatVarAttrsInline(arr.attrs)}</div>`
  ).join("") || `<div class="small">(none)</div>`;
  sections.push(`<div class="section"><h3>Coordinates</h3><div class="codeblock">${coordItems}</div></div>`);

  // Data variables
  const dataItems = dataVars.map(({ name, dims, shape, arr }) =>
    `<div><span class="badge">data</span> <a href="#" data-path="${escapeHtml(arr.path)}" class="navlink">${escapeHtml(name)}</a> ${formatDimsWithSizes(dims, shape)} dtype=${escapeHtml(arr.zarray?.dtype || "")} ${formatVarAttrsInline(arr.attrs)}</div>`
  ).join("") || `<div class="small">(none)</div>`;
  sections.push(`<div class="section"><h3>Data variables</h3><div class="codeblock">${dataItems}</div></div>`);

  // Child groups
  const groupChildren = grpNode.children
    .map((name) => tree.pathMap.get(join(grpNode.path, name)))
    .filter((n) => n && n.type === "group");
  const groupItems = groupChildren.map((g) => `<div><span class="badge">group</span> <a href="#" data-path="${escapeHtml(g.path)}" class="navlink">${escapeHtml(basename(g.path) || "/")}</a></div>`).join("") || `<div class="small">(none)</div>`;
  sections.push(`<div class="section"><h3>Groups</h3><div class="codeblock">${groupItems}</div></div>`);

  if (grpNode.attrs && Object.keys(grpNode.attrs).length) {
    sections.push(`<div class="section"><h3>Attributes</h3><pre class="codeblock">${escapeHtml(JSON.stringify(grpNode.attrs, null, 2))}</pre></div>`);
  }

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
