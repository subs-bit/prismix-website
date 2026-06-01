import { cloneDefaultClients } from "./defaultClients.js";
var GITHUB_API = "https://api.github.com";
var COMMIT_MESSAGE = "chore: update clients [skip netlify]";

function getConfig() {
  var token = (process.env.GITHUB_TOKEN ?? "").trim();
  var owner = (process.env.GITHUB_OWNER ?? "").trim();
  var repo = (process.env.GITHUB_REPO ?? "").trim();
  var branch = (process.env.GITHUB_BRANCH ?? "main").trim() || "main";
  var path = process.env.GITHUB_CLIENTS_PATH ?? "data/clients.json";

  if (!token || !owner || !repo) {
    throw new Error("Missing required GitHub env vars: GITHUB_TOKEN, GITHUB_OWNER, and/or GITHUB_REPO");
  }
  return { token, owner, repo, branch, path };
}

export async function readClientsFromGitHub() {
  var { token, owner, repo, branch, path } = getConfig();
  var url = GITHUB_API + "/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + branch;

  var res = await fetch(url, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.status === 404) {
    return { items: cloneDefaultClients(), sha: null, seeded: true };
  }
  if (!res.ok) {
    var errBody = await res.text();
    throw new Error("GitHub read failed (" + res.status + "): " + errBody);
  }

  var data = await res.json();
  var rawJson = Buffer.from(data.content, "base64").toString("utf8");
  var items;
  try {
    items = JSON.parse(rawJson);
  } catch {
    items = [];
  }

  return { items: Array.isArray(items) ? items : [], sha: data.sha };
}

export async function writeClientsToGitHub(items, sha) {
  var { token, owner, repo, branch, path } = getConfig();
  var json = JSON.stringify(items, null, 2);
  var content = Buffer.from(json, "utf8").toString("base64");
  var putBody = { message: COMMIT_MESSAGE, content: content, branch: branch };
  if (sha) {
    putBody.sha = sha;
  }

  var url = GITHUB_API + "/repos/" + owner + "/" + repo + "/contents/" + path;
  var res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(putBody),
  });

  if (!res.ok) {
    var errBody = await res.text();
    var err = new Error("GitHub write failed (" + res.status + "): " + errBody);
    err.status = res.status;
    throw err;
  }

  return await res.json();
}
