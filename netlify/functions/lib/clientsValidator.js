export function validateClientInput(body, isUpdate) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }

  if (!isUpdate || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return 'Missing required field: "name" (non-empty string)';
    }
    if (body.name.trim().length > 120) {
      return '"name" must be 120 characters or fewer';
    }
  }

  if (!isUpdate || body.logo !== undefined) {
    if (typeof body.logo !== "string" || !body.logo.trim()) {
      return 'Missing required field: "logo" (non-empty string)';
    }
    if (body.logo.length > 2048) {
      return '"logo" must be 2048 characters or fewer';
    }
    if (!isImageValue(body.logo)) {
      return '"logo" must be a site path beginning with "/" or a full http/https URL';
    }
  }

  if (body.website !== undefined && body.website !== null) {
    if (typeof body.website !== "string") {
      return '"website" must be a URL string or null';
    }
    if (body.website.trim() !== "" && !isHttpUrl(body.website.trim())) {
      return '"website" must be a valid http or https URL';
    }
  }

  if (body.published !== undefined && typeof body.published !== "boolean") {
    return '"published" must be a boolean';
  }

  return null;
}

export function slugifyName(name) {
  var base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "client-" + Date.now();
}

export function uniquify(id, existingIds) {
  if (!existingIds.includes(id)) return id;
  var i = 2;
  while (existingIds.includes(id + "-" + i)) {
    i += 1;
  }
  return id + "-" + i;
}

function isImageValue(s) {
  if (s.startsWith("/")) return true;
  return isHttpUrl(s);
}

function isHttpUrl(s) {
  try {
    var u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
