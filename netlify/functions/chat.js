// netlify/functions/chat.js
// SAFE MODE: nincs oldal-letöltés → nincs 502. Válasz a Google találatok (cím + snippet) alapján.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    if (!question) return json({ error: "Üres üzenet." }, 400);

    // 1) Keresési terv
    const plan = buildQueryPlan(question);

    // 2) Google keresés(ek) → egyesítés + URL-szűrés
    let raw = [];
    for (const q of plan.queries) raw.push(...await googleSearch(q, plan.numPerQuery));
    raw = raw.filter(it => isValidHttpUrl(it?.link)); // masszív szűrés

    // 3) Súlyozás + deduplikálás
    const ranked = rankAndFilter(raw, plan.maxKeep);

    // 4) Grounded válasz a TALÁLATOKBÓL (csak cím + snippet). Nincs HTML fetch → nincs 502.
    const today = new Date().toISOString().slice(0, 10);
    const sys =
      "Te Tamás barátságos magyar asszisztensed vagy. " +
      "KIZÁRÓLAG az alább megadott találatok (cím + rövid leírás) tartalmából dolgozz; ne találj ki új tényeket. " +
      "Ha a találatok nem tartalmazzák a választ, mondd ki, hogy jelenleg nem publikus / nem található. " +
      "Adj magyarul tömör, de informatív választ. NE írj külön 'Források' blokkot – azt a rendszer teszi hozzá.";
    const user = buildPromptFromSnippets({ question, today, items: ranked, intent: plan.intent });

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

    // 5) Egyszeri, deduplikált Források
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

/* ================= Helpers ================= */

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

/* ---- Keresési terv ---- */
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

  return { intent, queries: [...new Set(queries)], numPerQuery: 8, maxKeep: 18 };
}

/* ---- Domain-súlyozás ---- */
const DOMAIN_SCORE = {
  "rtl.hu": 10, "24.hu": 9, "index.hu": 9, "telex.hu": 9, "hvg.hu": 9,
  "nemzetisport.hu": 8, "nso.hu": 8, "portfolio.hu": 9, "sportal.hu": 7,
  "blikk.hu": 7, "origo.hu": 7, "port.hu": 7, "nlc.hu": 7, "femina.hu": 6, "life.hu": 6
};

function rankAndFilter(items, maxKeep = 18) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const lk = it?.link;
    if (!isValidHttpUrl(lk)) continue;
    if (seen.has(lk)) continue;
    seen.add(lk);
    const h = host(lk);
    const base = DOMAIN_SCORE[h] || (h.endsWith(".hu") ? 6 : 3);
    const bonus = it.title?.toLowerCase().includes("résztvev") ? 2 : 0;
    out.push({ ...it, _score: base + bonus });
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, maxKeep);
}

/* ---- Google keresés (csak tiszta http/https linkek) ---- */
async function googleSearch(q, num = 8) {
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
    .map(it => ({ title: it.title, snippet: it.snippet, link: it.link }))
    .filter(it => isValidHttpUrl(it.link));
}

/* ---- Prompt a snippets alapú válaszhoz ---- */
function buildPromptFromSnippets({ question, today, items, intent }) {
  const blocks = items.slice(0, 10).map((p, i) => `### Találat ${i + 1}
Cím: ${p.title}
Link: ${p.link}
Rövid leírás: ${p.snippet}
`).join("\n");

  let extra = "";
  if (intent === "starbox") {
    extra =
      "Ha a találatok említenek résztvevőket, adj listát: • Név — 1 rövid ismertető — [HIVATALOS/PLETYKA], " +
      "és jelezd röviden, melyik találatban szerepel. Ha nincs hivatalos lista, mondd ki.";
  } else if (intent === "fx") {
    extra = "Ha szerepel konkrét árfolyam-érték a találatokban, írd le röviden (pl. 'EUR/HUF ~395'), és jelezd, hogy változhat.";
  } else if (intent === "weather") {
    extra = "Adj 1–2 mondatos időjárás-összefoglalót, ha a találatok erre elég információt adnak.";
  }

  return [
    `Dátum: ${today}`,
    `Kérdés: ${question}`,
    extra,
    "Válasz: tömör, de informatív magyar összefoglaló. NE írj külön 'Források' listát.",
    "\n--- Találatok ---\n" + blocks
  ].join("\n");
}

/* ---- Forrásblokk ---- */
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
