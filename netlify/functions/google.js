// netlify/functions/google.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const { GOOGLE_API_KEY, GOOGLE_CX } = process.env;
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      return reply(500, { error: "Hiányzik a GOOGLE_API_KEY vagy a GOOGLE_CX környezeti változó." });
    }

    const q = (event.queryStringParameters && event.queryStringParameters.q || "").trim();
    if (!q) return reply(400, { error: "Hiányzik a keresési lekérdezés (query)." });

    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: GOOGLE_CX,
      q,
      num: "5",
      safe: "off",
      lr: "lang_hu",
      gl: "hu",
    });

    const r = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);
    if (!r.ok) {
      const t = await r.text();
      return reply(r.status, { error: "Google API hiba", detail: t });
    }

    const json = await r.json();
    const items = (json.items || []).map(it => ({
      title: it.title,
      snippet: it.snippet,
      link: it.link,
      source: (new URL(it.link)).hostname.replace(/^www\./, "")
    }));

    return reply(200, { results: items, source: "Google" });
  } catch (e) {
    return reply(500, { error: "Szerver hiba a google függvényben.", detail: String(e?.message || e) });
  }
};

function reply(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  };
}
