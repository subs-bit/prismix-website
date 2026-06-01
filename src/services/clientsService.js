import { clients as FALLBACK_CLIENTS } from "../data/clients.js";

const API_URL = import.meta.env.VITE_CLIENTS_API_URL ?? "/api/clients";
const RAW_URL = import.meta.env.VITE_CLIENTS_JSON_URL;
const CACHE_TTL_MS = 60_000;
let _cache = null;
let _cacheAt = 0;

const FALLBACK_SORTED = [...FALLBACK_CLIENTS].filter(isPublished).sort(byOrderAsc);

export async function getClients() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) {
    return _cache;
  }

  const urls = [];
  if (API_URL) urls.push({ url: API_URL, cacheBucketMs: 60_000 });
  if (RAW_URL) urls.push({ url: RAW_URL, cacheBucketMs: 300_000 });

  for (const source of urls) {
    try {
      const bucket = Math.floor(now / source.cacheBucketMs);
      const separator = source.url.includes("?") ? "&" : "?";
      const res = await fetch(source.url + separator + "v=" + bucket, {
        headers: { "Accept": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const visible = data.filter(isPublished).sort(byOrderAsc);
          _cache = visible;
          _cacheAt = now;
          return visible;
        }
      }
    } catch (err) {
      console.warn("[clientsService] clients fetch failed; trying fallback:", err.message);
    }
  }

  return FALLBACK_SORTED;
}

export function invalidateClientsCache() {
  _cache = null;
  _cacheAt = 0;
}

function isPublished(item) {
  return item && item.published !== false;
}

function byOrderAsc(a, b) {
  const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
  return ao - bo;
}