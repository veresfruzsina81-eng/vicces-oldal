// netlify/functions/google.js

// Megjegyzés: Node 18+ környezetben a fetch globális, nem kell a 'node-fetch' csomag.

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return reply(204, null, cors());
  }

  try {
    const { GOOGLE_API_KEY, GOOGLE_CX } = process.env;
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      return reply(500, { error: "Hiányzik a GOOGLE_API_KEY vagy a GOOGLE_CX környezeti változó." });
    }

    const q = (event.queryStringParameters && event.queryStringParameters.q || "").trim();
    if (!q) return reply(400, { error: "Hiányzik a keresési lekérdezés (q)." });

    // Google Custom Search API — HU fókusz
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", GOOGLE_API_KEY);
    url.searchParams.set("cx",  GOOGLE_CX);
    url.searchParams.set("q",   q);
    url.searchParams.set("num", "8");         // több jelölt a jobb összefoglaláshoz
    url.searchParams.set("safe","active");    // biztonságos találatok
    url.searchParams.set("hl",  "hu");        // felület nyelv
    url.searchParams.set("gl",  "hu");        // geolokáció
    url.searchParams.set("lr",  "lang_hu");   // magyar nyelvű találatok preferálása

    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      return reply(r.status, { error: "Google API hiba", detail: t });
    }

    const data = await r.json();
    const items = (data.items || []).map(it => {
      const link = it.link || "";
      let source = "";
      try { source = new URL(link).hostname.replace(/^www\./, ""); } catch {}
      return {
        title: it.title || "",
        snippet: it.snippet || "",
        link,
        source
      };
    });

    return reply(200, { results: items, source: "Google" });
  } catch (e) {
    return reply(500, { error: "Szerver hiba a google függvényben.", detail: String(e?.message || e) });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function reply(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors(),
      ...extraHeaders
    },
    body: body == null ? "" : JSON.stringify(body)
  };
}
