import { readClientsFromGitHub, writeClientsToGitHub } from "./lib/githubClientsStore.js";
import { validateClientInput, slugifyName, uniquify } from "./lib/clientsValidator.js";

const MAX_RETRIES = 2;

export default async function handler(req) {
  try {
    var allowedTokens = getAllowedAdminTokens();
    if (allowedTokens.length === 0) {
      console.error("[admin-clients] NEWS_ADMIN_TOKEN, BLOG_INGEST_TOKEN, or GITHUB_TOKEN is not set");
      return jsonError(500, "Server misconfiguration");
    }
    var bearerToken = readBearerToken(req);
    var authorized = await isAuthorizedAdminToken(bearerToken, allowedTokens, process.env.GITHUB_CLIENTS_PATH ?? "data/clients.json");
    if (!authorized) {
      return jsonError(401, "Unauthorized");
    }

    var route = extractRoute(req.url);
    if (route.kind === "collection") {
      if (req.method === "GET") return await handleList();
      if (req.method === "POST") return await handleCreate(req);
      return jsonError(405, "Method Not Allowed");
    }
    if (route.kind === "reorder") {
      if (req.method === "PUT") return await handleReorder(req);
      return jsonError(405, "Method Not Allowed");
    }
    if (route.kind === "item") {
      if (req.method === "PUT") return await handleUpdate(req, route.id);
      if (req.method === "DELETE") return await handleDelete(route.id);
      return jsonError(405, "Method Not Allowed");
    }
    return jsonError(404, "Not Found");
  } catch (err) {
    console.error("[admin-clients] unhandled error:", err.message);
    return jsonError(500, "Internal Server Error");
  }
}

async function isAuthorizedAdminToken(bearerToken, allowedTokens, verifyPath) {
  if (!bearerToken) return false;
  if (allowedTokens.includes(bearerToken)) return true;
  return await canAccessConfiguredGitHubRepo(bearerToken);
}

async function canAccessConfiguredGitHubRepo(token) {
  var owner = (process.env.GITHUB_OWNER ?? "").trim();
  var repo = (process.env.GITHUB_REPO ?? "").trim();
  if (!owner || !repo) return false;

  var url = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  try {
    var res = await fetch(url, {
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getAllowedAdminTokens() {
  return [
    process.env.GITHUB_TOKEN,
    process.env.NEWS_ADMIN_TOKEN,
    process.env.BLOG_INGEST_TOKEN,
  ]
    .map(function (value) { return value ? value.trim() : ""; })
    .filter(function (value, index, arr) {
      return value.length > 0 && arr.indexOf(value) === index;
    });
}

function readBearerToken(req) {
  var authHeader = req.headers.get("authorization") ?? "";
  var match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function extractRoute(rawUrl) {
  var pathname;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  var stripped = pathname
    .replace(/^\/?\.netlify\/functions\/admin-clients/, "")
    .replace(/^\/?api\/admin\/clients/, "")
    .replace(/^\/+/, "");
  if (stripped === "" || stripped === "/") return { kind: "collection" };
  if (stripped === "reorder") return { kind: "reorder" };
  return { kind: "item", id: decodeURIComponent(stripped.split("/")[0]) };
}

async function handleList() {
  var { items } = await readClientsFromGitHub();
  return jsonResponse(200, sortByOrder(items));
}

async function handleCreate(req) {
  var body = await readJsonBody(req);
  if (body.error) return body.error;
  var validationError = validateClientInput(body.value, false);
  if (validationError) return jsonError(400, validationError);

  return await mutateWithRetry(function (items) {
    var existingIds = items.map(function (c) { return c.id; });
    var id = uniquify(slugifyName(body.value.name), existingIds);
    var now = new Date().toISOString();
    var maxOrder = items.reduce(function (max, c) {
      return typeof c.order === "number" && c.order > max ? c.order : max;
    }, 0);
    var item = {
      id: id,
      name: body.value.name.trim(),
      logo: body.value.logo.trim(),
      website: normalizeWebsite(body.value.website),
      published: body.value.published !== false,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    var renumbered = renumberItems(items, now);
    return { items: renumbered, payload: renumbered.find(function (c) { return c.id === id; }) };
  });
}

async function handleUpdate(req, id) {
  var body = await readJsonBody(req);
  if (body.error) return body.error;
  var validationError = validateClientInput(body.value, true);
  if (validationError) return jsonError(400, validationError);

  return await mutateWithRetry(function (items) {
    var idx = items.findIndex(function (c) { return c.id === id; });
    if (idx === -1) {
      return { error: jsonError(404, 'No client with id "' + id + '"') };
    }
    var prev = items[idx];
    var updated = {
      ...prev,
      name: body.value.name !== undefined ? body.value.name.trim() : prev.name,
      logo: body.value.logo !== undefined ? body.value.logo.trim() : prev.logo,
      website: body.value.website !== undefined ? normalizeWebsite(body.value.website) : prev.website,
      published: body.value.published !== undefined ? body.value.published : prev.published,
      updatedAt: new Date().toISOString(),
    };
    items[idx] = updated;
    return { items: items, payload: updated };
  });
}

async function handleDelete(id) {
  return await mutateWithRetry(function (items) {
    var next = items.filter(function (c) { return c.id !== id; });
    if (next.length === items.length) {
      return { error: jsonError(404, 'No client with id "' + id + '"') };
    }
    var renumbered = renumberItems(next, new Date().toISOString());
    return { items: renumbered, payload: { deleted: id } };
  });
}

async function handleReorder(req) {
  var body = await readJsonBody(req);
  if (body.error) return body.error;
  if (!body.value || !Array.isArray(body.value.order)) {
    return jsonError(400, '"order" must be an array of client ids');
  }
  if (!body.value.order.every(function (x) { return typeof x === "string"; })) {
    return jsonError(400, '"order" must contain only string ids');
  }

  return await mutateWithRetry(function (items) {
    var idToItem = new Map();
    items.forEach(function (it) { idToItem.set(it.id, it); });
    var listed = [];
    var seen = new Set();
    body.value.order.forEach(function (id) {
      var it = idToItem.get(id);
      if (it && !seen.has(id)) {
        listed.push(it);
        seen.add(id);
      }
    });
    var combined = listed.concat(items.filter(function (it) { return !seen.has(it.id); }));
    var now = new Date().toISOString();
    combined = combined.map(function (it, i) {
      var newOrder = i + 1;
      if (it.order === newOrder) return it;
      return { ...it, order: newOrder, updatedAt: now };
    });
    return { items: combined, payload: sortByOrder(combined) };
  });
}

async function mutateWithRetry(mutate) {
  var attempt = 0;
  while (true) {
    var { items, sha } = await readClientsFromGitHub();
    var result = mutate(items);
    if (result.error) return result.error;
    try {
      await writeClientsToGitHub(result.items, sha);
      return jsonResponse(200, result.payload);
    } catch (err) {
      var isConflict = err.status === 409 || err.status === 422;
      if (isConflict && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(200 * attempt);
        continue;
      }
      console.error("[admin-clients] write failed:", err.message);
      return jsonError(500, "Failed to persist clients update");
    }
  }
}

function normalizeWebsite(value) {
  if (value === null || value === undefined) return null;
  var trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function sortByOrder(items) {
  return items.slice().sort(function (a, b) {
    var ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
    var bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
}

function renumberItems(items, now) {
  return sortByOrder(items).map(function (it, i) {
    var newOrder = i + 1;
    if (it.order === newOrder) return it;
    return { ...it, order: newOrder, updatedAt: now };
  });
}

async function readJsonBody(req) {
  try {
    return { value: await req.json() };
  } catch {
    return { error: jsonError(400, "Invalid JSON body") };
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function jsonError(status, message) {
  return jsonResponse(status, { error: message });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}
