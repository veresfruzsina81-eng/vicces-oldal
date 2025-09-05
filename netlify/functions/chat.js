// netlify/functions/chat.js
// Böngészős, forrás-alapú válaszoló – HU híroldal preferencia, dátum/idézet, deduplikált "Források"

import OpenAI from "openai";
import cheerio from "cheerio";
import pLimit from "p-limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    if (!question) return json({ error: "Üres üzenet." }, 400);

    // 1) Keresési terv (HU kifejezések + szinonimák)
    const plan = buildQueryPlan(question);

    // 2) Google keresés(ek) -> egyesítés, domain-súlyozás, dedup
    const rawResults = [];
    for (const q of plan.queries) rawResults.push(...await googleSearch(q, plan.numPerQuery));
    const ranked = rankAndFilter(rawResults, plan.maxKeep);

    // 3) Oldalak letöltése + főszöveg, meta, dátum (párhuzamosan)
    const pages = await fetchAndExtract(ranked.slice(0, plan.fetchLimit));

    // 4) Grounded válasz az összegyűjtött szövegekből (nincs hallu)
    const today = new Date().toISOString().slice(0, 10);

    const sys =
      "Te Tamás barátságos magyar asszisztensed vagy. " +
      "KIZÁRÓLAG a megadott források tartalmából dolgozz; ne találj ki új tényeket. " +
      "Ha a források nem tartalmazzák a választ, mondd ki, hogy jelenleg nem publikus / nem található. " +
      "Adj magyarul tömör, de informatív választ. NE írj külön 'Források' blokkot – azt a rendszer teszi hozzá. " +
      "Ha több forrás eltér, jelezd röviden az ellentmondást.";

    const user = buildGroundedPrompt({ question, today, pages, intent: plan.intent });

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
      "Sajnálom, most nem találtam megbízható információt a megadott forrásokban.";

    // 5) Egyszeri, deduplikált „Források” blokk (domain szerint)
    const sourcesBlock = renderSources(ranked);

    return json({
      ok: true,
      question,
      answer: modelAnswer + sourcesBlock,
      meta: {
        searchResults: ranked.length,
        fetchedPages: pages.length,
        intent: plan.intent
      }
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 500);
  }
}

/* ===================== Helpers ===================== */

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

function buildQueryPlan(question) {
  const q = question.toLowerCase();
  const queries = [question];
  const add = (...xs) => xs.forEach((x) => queries.push(`${question} ${x}`));

  let intent = "generic";
  if (/\bsztárbox\b|sztarbox|sztár box/i.test(q)) {
    intent = "starbox";
    add("résztvevők", "nevek", "versenyzők", "teljes névsor", "lineup", "hivatalos", "2025");
  }
  if (/\bárfolyam|eur(huf|huf)|euró árfolyam\b/i.test(q)) intent = "fx";
  if (/\bidőjárás|meteo|előrejelzés\b/i.test(q)) intent = "weather";

  return {
    intent,
    queries: [...new Set(queries)],
    numPerQuery: 8,
    maxKeep: 18,
    fetchLimit: 6
  };
}

// Minőségi .hu híroldalak preferálása (nem hard block, csak súlyozás)
const DOMAIN_SCORE = {
  "rtl.hu": 10, "24.hu": 9, "index.hu": 9, "telex.hu": 9, "blikk.hu": 7, "origo.hu": 7,
  "hvg.hu": 9, "sportal.hu": 7, "nemzetisport.hu": 8, "nso.hu": 8, "port.hu": 7,
  "nlc.hu": 7, "femina.hu": 6, "life.hu": 6, "portfolio.hu": 9
};

function rankAndFilter(items, maxKeep = 18) {
  const seenLink = new Set();
  const scored = [];

  for (const it of items || []) {
    const link = it.link || it.url;
    if (!link) continue;
    if (seenLink.has(link)) continue;
    seenLink.add(link);

    const h = host(link);
    const base = DOMAIN_SCORE[h] || (h.endsWith(".hu") ? 6 : 3);
    const score = base + (it.title?.toLowerCase().includes("résztvev") ? 2 : 0);
    scored.push({ ...it, _score: score });
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, maxKeep);
}

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
  const items = (data.items || []).map(it => ({
    title: it.title, snippet: it.snippet, link: it.link
  }));
  return items;
}

async function fetchAndExtract(results) {
  const limit = pLimit(3);
  const tasks = results.map(r =>
    limit(async () => {
      try {
        // Guard: csak valódi http(s) URL-ek
        if (!r.link || !/^https?:\/\//i.test(r.link)) return null;

        const res = await fetch(r.link, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TamasAI/1.0)",
            "Accept-Language": "hu-HU,hu;q=0.9"
          },
          redirect: "follow"
        });
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("text/html")) return null;
        const html = await res.text();
        const meta = extractMeta(html);
        const text = extractMainText(html);
        return { ...r, text: truncate(text, 7000), ...meta };
      } catch { return null; }
    })
  );
  return (await Promise.all(tasks)).filter(Boolean);
}

function extractMeta(html) {
  const $ = cheerio.load(html);
  const pick = (sel, attr) => $(sel).attr(attr) || "";

  // Cím/desc
  const title =
    $("meta[property='og:title']").attr("content") ||
    $("meta[name='twitter:title']").attr("content") ||
    $("title").text() ||
    "";

  const description =
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content") ||
    "";

  // Dátum (minél pontosabb)
  const published =
    $("meta[property='article:published_time']").attr("content") ||
    $("meta[name='article:published_time']").attr("content") ||
    $("time[datetime]").attr("datetime") ||
    $("meta[itemprop='datePublished']").attr("content") ||
    "";

  return { metaTitle: (title || "").trim(), metaDescription: (description || "").trim(), publishedAt: (published || "").trim() };
}

function extractMainText(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,template,iframe,header,footer,nav,aside").remove();
  const pick =
    $("article").text() ||
    $("main").text() ||
    $("div[itemprop='articleBody']").text() ||
    $("body").text();
  return pick.replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s);

function buildGroundedPrompt({ question, today, pages, intent }) {
  // Maximum 6 forrás blokk rövidített kivonattal + meta/dátum
  const blocks = pages.map((p, i) => {
    const head = `### Forrás ${i + 1}
Cím: ${p.metaTitle || p.title || ""}
Dátum: ${p.publishedAt || "ismeretlen"}
Link: ${p.link}
Rövid leírás: ${p.metaDescription || p.snippet || ""}
Részlet a cikkből:
${(p.text || "").slice(0, 1200)}
`;
    return head;
  }).join("\n");

  // Intent-specifikus kérés a válasz szerkezetére
  let extra = "";
  if (intent === "starbox") {
    extra =
      "Feladat: Ha a forrásokban szerepelnek a résztvevők, adj listát: " +
      "• Név — 1 rövid ismertető (miért ismert) — [HIVATALOS/PLETYKA], és ha kiderül, melyik forrásból származik (pl. 'RTL.hu cikk, 2025-06-01'). " +
      "Ha nincs teljes névsor vagy csak pletykák vannak, mondd ki egyértelműen.";
  } else if (intent === "fx") {
    extra = "Feladat: Ha szerepel konkrét árfolyam-érték, írd le röviden (pl. 'EUR/HUF ~395 ma'), és jelezd, hogy az érték változhat.";
  } else if (intent === "weather") {
    extra = "Feladat: Adj 1-2 mondatos időjárás-összefoglalót (hely, nap, hőmérséklet, csapadék), ha a források tartalmazzák.";
  }

  return [
    `Dátum: ${today}`,
    `Kérdés: ${question}`,
    extra,
    "Válasz: tömör, de informatív magyar összefoglaló. NE írj külön 'Források' listát.",
    "\n--- Forráskivonatok ---\n" + blocks
  ].join("\n");
}

function renderSources(results, limit = 5) {
  const uniq = uniqueByDomain(results, limit);
  if (!uniq.length) return "";
  const lines = uniq.map(r => `• ${r.title || host(r.link)} — ${host(r.link)}\n${r.link}`);
  return `\n\nForrások:\n${lines.join("\n")}`;
}
function uniqueByDomain(list, limit = 5) {
  const map = new Map();
  for (const r of list || []) {
    const h = host(r.link || "");
    if (!h) continue;
    if (!map.has(h)) map.set(h, r);
    if (map.size >= limit) break;
  }
  return [...map.values()];
}
