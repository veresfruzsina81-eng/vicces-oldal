// netlify/functions/google.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: "",
      };
    }

    // ---- Robusztus lekérdezés-olvasás ----
    let q;

    // 1) Normál Netlify mező
    if (event.queryStringParameters && (event.queryStringParameters.q || event.queryStringParameters.query)) {
      q = event.queryStringParameters.q || event.queryStringParameters.query;
    }

    // 2) rawQuery fallback (pl. "q=id%C5%91j%C3%A1r%C3%A1s+Budapest")
    if (!q && typeof event.rawQuery === "string") {
      const usp = new URLSearchParams(event.rawQuery);
      q = usp.get("q") || usp.get("query");
    }

    // 3) Biztonsági fallback: próbáljuk meg az URL-t (ritkán kell)
    if (!q && typeof event.rawUrl === "string") {
      const urlObj = new URL(event.rawUrl);
      q = urlObj.searchParams.get("q") || urlObj.searchParams.get("query");
    }

    if (!q || !q.trim()) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Hiányzik a keresési lekérdezés (query).",
          debug: {
            queryStringParameters: event.queryStringParameters || null,
            rawQuery: event.rawQuery || null,
            rawUrl: event.rawUrl || null,
          },
        }),
      };
    }

    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    const GOOGLE_CX = process.env.GOOGLE_CX;

    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Hiányzik a GOOGLE_API_KEY vagy a GOOGLE_CX környezeti változó." }),
      };
    }

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", GOOGLE_API_KEY);
    url.searchParams.set("cx", GOOGLE_CX);
    url.searchParams.set("q", q);
    url.searchParams.set("num", "5"); // 1–10

    const r = await fetch(url.toString());
    if (!r.ok) {
      const txt = await r.text();
      return {
        statusCode: r.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Google API hiba", status: r.status, body: txt }),
      };
    }

    const data = await r.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        ok: true,
        query: q,
        results: (data.items || []).map(it => ({
          title: it.title,
          link: it.link,
          snippet: it.snippet,
          source: "Google",
        })),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Szerver hiba", detail: String(err) }),
    };
  }
};
