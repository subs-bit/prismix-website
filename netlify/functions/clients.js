import { readClientsFromGitHub } from "./lib/githubClientsStore.js";

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    var { items } = await readClientsFromGitHub();
    var visible = items
      .filter(function (c) { return c && c.published !== false; })
      .sort(byOrderAsc);

    return new Response(JSON.stringify(visible), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[clients] read failed:", err.message);
    return new Response("Internal Server Error", { status: 500 });
  }
}

function byOrderAsc(a, b) {
  var ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
  var bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
  return ao - bo;
}
