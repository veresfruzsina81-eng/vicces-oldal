// netlify/functions/chat.js
// SAFE MODE v2: nincs oldalletöltés (nincs 502), de a Google találatokból BŐ kivonatot adunk a modellnek,
// hogy tényleg érdemi, konkrét választ adjon. + 1× "Források" blokk.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    if (!question) return json({ error: "Üres üzenet." }, 400);

    // 1) keresési terv
    const plan = buildQueryPlan(question);

    // 2) Google keresések → egyesítés + URL-szűrés
    let raw = [];
    for (const q of plan.queries) raw.push(...await googleSearch(q, plan.numPerQuery));
    raw = raw.filter(it => isValidHttpUrl(it?.link));

    // 3) rangsorolás + dedup
    const ranked = rankAndFilter(raw, plan.maxKeep);

    // 4) Prompt építés: NAGY kivonat a találatokból
    const today = new Date().toISOString().slice(0, 10);

    const sys =
      "Te Tamás barátságos magyar asszisztensed vagy. " +
      "KIZÁRÓLAG az alább megadott találatokból (cím + rövid leírások) dolgozz; ne találj ki új tényeket. " +
      "Adj magyarul tömör, de informatív választ, ami közvetlenül megválaszolja a kérdést. " +
      "Soha ne írj olyan válaszokat, mint 'rendben', 'gondolkodom', 'nem tudok böngészni'. " +
      "NE írj 'Források' blokkot – azt a rendszer teszi hozzá.";

    const user = buildPromptFromSnippetsRich({ question, today, items: ranked, intent: plan.intent });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    });

    const modelAnswer =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Sajnálom, most nem találtam megbízható információt a megadott találatokban.";

    // 5) Egyszeri, deduplikált Források blokk
    const sourcesBlock = renderSources(ranked);

    return json({
      ok: true,
      question,
      answer: modelAnswer + sourcesBlock,
      meta: { searchResults: ranked.length, intent: plan.intent, safeMode: true }
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 500);
  }
}

/* ============= helpers ============= */

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
    body: JSON.stringify(body, null, 2)
  };
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

function isValidHttpUrl(u) {
  if (typeof u !== "string") return false;
  try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; }
  catch { return false; }
}

/* ---- keresési terv ---- */
function buildQueryPlan(question) {
  const q = question.toLowerCase();
  const queries = [question];
  const add = (...xs) => xs.forEach((x) => queries.push(`${question} ${x}`));

  let intent = "generic";
  if (/\bsztárbox\b|sztarbox|sztár box/i.test(q)) {
    intent = "starbox";
    add("résztvevők", "nevek", "versenyzők", "teljes névsor", "hivatalos", "2025");
  }
  if (/\bárfolyam|eur(huf|huf)|euró árfolyam\b/i.test(q)) intent = "fx";
  if (/\bidőjárás|meteo|előrejelzés\b/i.test(q)) intent = "weather";

  return { intent, queries: [...new Set(queries)], numPerQuery: 10, maxKeep: 20 };
}

/* ---- domain súlyozás ---- */
const DOMAIN_SCORE = {
  "rtl.hu": 10, "24.hu": 9, "index.hu": 9, "telex.hu": 9, "hvg.hu": 9,
  "nemzetisport.hu": 8, "nso.hu": 8, "portfolio.hu": 9, "sportal.hu": 7,
  "blikk.hu": 7, "origo.hu": 7, "port.hu": 7, "nlc.hu": 7, "femina.hu": 6, "life.hu": 6
};

function rankAndFilter(items, maxKeep = 20) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const lk = it?.link;
    if (!isValidHttpUrl(lk)) continue;
    if (seen.has(lk)) continue;
    seen.add(lk);
    const h = host(lk);
    const base = DOMAIN_SCORE[h] || (h.endsWith(".hu") ? 6 : 3);
    const bonus =
      (it.title?.toLowerCase().includes("résztvev") ? 2 : 0) +
      (it.title?.toLowerCase().includes("lista") ? 1 : 0);
    out.push({ ...it, _score: base + bonus });
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, maxKeep);
}

/* ---- Google keresés ---- */
async function googleSearch(q, num = 10) {
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;
  if (!key || !cx) return [];

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", q);
  url.searchParams.set("num", String(num));
  url.searchParams.set("safe", "active");
  url.searchParams.set("hl", "hu");
  url.searchParams.set("gl", "hu");

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || [])
    .map(it => ({
      title: it.title,
      snippet: (it.snippet || "").replace(/\s+/g, " ").trim(),
      link: it.link
    }))
    .filter(it => isValidHttpUrl(it.link));
}

/* ---- Prompt a gazdag snippet-összefoglalóhoz ---- */
function buildPromptFromSnippetsRich({ question, today, items, intent }) {
  // nagy, egybefűzött kivonat: címek + hosszabb snippet-blokk
  const top = items.slice(0, 12);
  const combined = top.map((p, i) =>
    `# Cikk ${i + 1}
Cím: ${p.title}
Link: ${p.link}
Kivonat: ${p.snippet}`
  ).join("\n\n");

  let extra = "";
  if (intent === "starbox") {
    extra =
      "Feladat: ha a fenti kivonatok alapján szerepelnek résztvevők, adj jól olvasható listát: " +
      "• Név — 1 rövid ismertető (miért ismert) — [HIVATALOS/PLETYKA]. " +
      "Ha nincs hivatalos lista, mondd ki egyértelműen.";
  } else if (intent === "fx") {
    extra =
      "Feladat: ha szerepel konkrét árfolyam-érték, írd ki röviden (pl. 'EUR/HUF ~395'), és jelezd, hogy változhat.";
  } else if (intent === "weather") {
    extra =
      "Feladat: adj 1–2 mondatos időjárás-összefoglalót (hely, nap, hőmérséklet, csapadék), ha a kivonatok alapján megítélhető.";
  }

  const instructions =
    "Válaszolj közvetlenül a kérdésre. Ne legyen üres vagy semmitmondó ('rendben', 'gondolkodom'). " +
    "Használj konkrétumokat: neveket, dátumokat, számokat, ha a kivonatokban szerepelnek.";

  return [
    `Dátum: ${today}`,
    `Kérdés: ${question}`,
    instructions,
    extra,
    "\n--- KIVONATOK KEZDETE ---\n" + combined + "\n--- KIVONATOK VÉGE ---"
  ].join("\n");
}

/* ---- Források blokk ---- */
function renderSources(results, limit = 5) {
  const uniq = uniqueByDomain(results, limit);
  if (!uniq.length) return "";
  const lines = uniq.map(r => `• ${r.title || host(r.link)} — ${host(r.link)}\n${r.link}`);
  return `\n\nForrások:\n${lines.join("\n")}`;
}
function uniqueByDomain(list, limit = 5) {
  const map = new Map();
  for (const r of list || []) {
    const lk = r?.link;
    if (!isValidHttpUrl(lk)) continue;
    const h = host(lk);
    if (!h) continue;
    if (!map.has(h)) map.set(h, r);
    if (map.size >= limit) break;
  }
  return [...map.values()];
}
