// Google Custom Search proxy (ESM). HU preferencia + frissesség szűrő + opcionális whitelist/site szűkítés.
// Használat példa:
//   /.netlify/functions/google?q=rtl%20sztarbox&type=news&fr=7
//   /.netlify/functions/google?q=idojaras%20Szabolcsbaka
// Query paramok:
//   q   : kötelező keresőkifejezés
//   type: "news" | "web" (alap: web) – news esetén alapból szűkebb frissesség
//   fr  : napok száma frissességre (1..30), alap: news=7, web=14
//   site: opcionális domain-szűkítés (pl. "rtl.hu" vagy "site:.hu")

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return reply(204, null, cors());

  try {
    const { GOOGLE_API_KEY, GOOGLE_CX } = process.env;
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      return reply(500, { error: "Hiányzik a GOOGLE_API_KEY vagy a GOOGLE_CX környezeti változó." });
    }

    const params = event.queryStringParameters || {};
    const qRaw   = (params.q || "").trim();
    const type   = (params.type || "web").toLowerCase();
    const fr     = clampInt(params.fr, type === "news" ? 7 : 14, 1, 30);
    const site   = (params.site || "").trim(); // pl. "rtl.hu" vagy "site:.hu"

    if (!qRaw) return reply(400, { error: "Hiányzik a keresési lekérdezés (q)." });

    // Opcionális site-szűkítés beépítése a query-be
    const q = site
      ? `${qRaw} ${site.includes("site:") ? site : `site:${site}`}`
      : qRaw;

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key",  GOOGLE_API_KEY);
    url.searchParams.set("cx",   GOOGLE_CX);
    url.searchParams.set("q",    q);
    url.searchParams.set("num",  "10");
    url.searchParams.set("safe", "active");
    url.searchParams.set("hl",   "hu");
    url.searchParams.set("gl",   "hu");
    url.searchParams.set("lr",   "lang_hu");
    url.searchParams.set("dateRestrict", `d${fr}`);

    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      return reply(r.status, { error: "Google API hiba", detail: t });
    }

    const data = await r.json();
    let items = (data.items || []).map(it => shapeItem(it));

    // Opcionális: magyar minőségi whitelist – ha szeretnéd, kapcsold be.
    // const whitelist = new Set(["rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu","nso.hu","nemzetisport.hu"]);
    // items = items.filter(it => it.source && whitelist.has(it.source));

    return reply(200, {
      results: items,
      source: "Google",
      freshness_days: fr,
      type,
      query_used: q
    });
  } catch (e) {
    return reply(500, { error: "Szerver hiba a google függvényben.", detail: String(e?.message || e) });
  }
}

/* ---------------- util ---------------- */
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
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(), ...extraHeaders },
    body: body == null ? "" : JSON.stringify(body)
  };
}

function clampInt(v, def, min, max){
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function shapeItem(it){
  const link = it?.link || "";
  let source = "";
  try { source = new URL(link).hostname.replace(/^www\./, ""); } catch {}
  return {
    title: it?.title || "",
    snippet: it?.snippet || "",
    link,
    source
  };
}
