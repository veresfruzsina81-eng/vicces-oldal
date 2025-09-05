// SAFE MODE (stabil, nincs 502) + smalltalk + "Rendben."-védő retry + 1× Források

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };
  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    if (!question) return json({ error: "Üres üzenet." }, 400);

    // 0) Smalltalk/köszönés – gyors, barátságos válasz (nincs böngészés)
    if (isGreeting(question)) {
      return json({
        ok: true,
        question,
        answer:
          "Szia! Itt vagyok, segítek. Kérdezz bármit – ha kell, böngészek és forrásokat is mutatok. 🙂",
        meta: { safeMode: true, smalltalk: true }
      });
    }

    // 1) Keresési terv
    const plan = buildQueryPlan(question);

    // 2) Google keresés(ek) → egyesítés + URL-szűrés
    let hits = [];
    for (const q of plan.queries) hits.push(...await googleSearch(q, plan.numPerQuery));
    hits = hits.filter(it => isValidHttpUrl(it?.link));
    if (!hits.length) {
      return json({
        ok: true, question,
        answer: "Nem találtam megbízható találatot. Lehet, hogy még nem publikus az információ.",
        meta: { searchResults: 0, intent: plan.intent, safeMode: true }
      });
    }

    // 3) Súlyozás + deduplikálás
    const ranked = rankAndFilter(hits, plan.maxKeep);

    // 4) Nagy, összefűzött kontextus a modellnek
    const sys =
      "Te Tamás barátságos magyar asszisztensed vagy. " +
      "KIZÁRÓLAG az alább megadott találatok (cím + rövid leírás) tartalmából dolgozz; ne találj ki új tényeket. " +
      "Adj konkrét, lényegre törő választ magyarul. NE írj külön 'Források' blokkot – azt a rendszer teszi hozzá. " +
      "Ha nincs elég információ a találatokban, mondd ki világosan, hogy jelenleg nem publikus / nem található.";
    const user = buildPromptFromSnippetsRich({ question, items: ranked, intent: plan.intent });

    let modelAnswer = await ask(sys, user);

    // 5) "Rendben." / túl rövid válasz elleni védelem → 1× retry másik utasítással
    if (isEmptyish(modelAnswer)) {
      const sys2 =
        "Adj KONKRÉT választ magyarul a megadott találatok alapján (szám/névsor/összefoglaló). " +
        "TILOS 'Rendben' vagy hasonló üres választ adni. NE írj 'Források' blokkot.";
      const user2 = user + "\n\nFIGYELEM: Ne adj üres visszajelzést – írj tényleges tartalmat.";
      modelAnswer = await ask(sys2, user2);
      if (isEmptyish(modelAnswer)) {
        modelAnswer = "A találatok alapján nem tudok biztos, konkrét választ adni – valószínűleg még nem publikus.";
      }
    }

    // 6) Egyszeri, deduplikált Források
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

/* ============== Helpers ============== */
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

// köszönés detektálás
function isGreeting(q) {
  const s = q.toLowerCase().trim();
  const pats = ["szia", "hali", "helló", "hello", "csá", "jó napot", "jó estét", "jó reggelt", "üdv"];
  return pats.some(p => s === p || s.startsWith(p + "!") || s.startsWith(p + "."));
}

// üres / "rendben" válasz detektálás
function isEmptyish(ans) {
  if (!ans) return true;
  const a = ans.trim().toLowerCase();
  if (a.length < 8) return true;
  const bad = ["rendben", "ok", "oké", "oke", "okey", "oké.", "rendben."];
  return bad.includes(a);
}

// egyszerű OpenAI hívó
async function ask(systemContent, userContent) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [{ role: "system", content: systemContent }, { role: "user", content: userContent }]
  });
  return res.choices?.[0]?.message?.content?.trim() || "";
}

/* ---- Keresési terv ---- */
function buildQueryPlan(question) {
  const q = question.toLowerCase();
  const queries = [question];
  const add = (...xs) => xs.forEach(x => queries.push(`${question} ${x}`));

  let intent = "generic";
  if (/\bsztárbox\b|sztarbox|sztár box/i.test(q)) {
    intent = "starbox";
    add("résztvevők", "nevek", "versenyzők", "teljes névsor", "hivatalos", "2025");
  }
  if (/\bárfolyam|eur(huf|huf)|euró árfolyam\b/i.test(q)) intent = "fx";
  if (/\bidőjárás|meteo|előrejelzés\b/i.test(q)) intent = "weather";

  return { intent, queries: [...new Set(queries)], numPerQuery: 10, maxKeep: 20 };
}

/* ---- Domain-súlyozás ---- */
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
      (it.title?.toLowerCase().includes("hivatalos") ? 1 : 0);
    out.push({ ...it, _score: base + bonus });
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, maxKeep);
}

/* ---- Google keresés ---- */
async function googleSearch(q, num = 10) {
  const key = process.env.Google_API_KEY || process.env.GOOGLE_API_KEY;
  const cx  = process.env.Google_CX   || process.env.GOOGLE_CX;
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

/* ---- Rich prompt a snippets-hez (összefűzve) ---- */
function buildPromptFromSnippetsRich({ question, items, intent }) {
  // 12 legjobb találat, összefűzve
  const joined = items.slice(0, 12).map((p, i) =>
`[${i + 1}] Cím: ${p.title}
Link: ${p.link}
Leírás: ${p.snippet}
`).join("\n");

  let extra = "";
  if (intent === "starbox") {
    extra =
      "Ha a találatok említenek résztvevőket, adj listát: • Név — 1 rövid ismertető — [HIVATALOS/PLETYKA]. " +
      "Ha nincs hivatalos lista, mondd ki egyértelműen. Ha ellentmondás van, jelezd.";
  } else if (intent === "fx") {
    extra = "Ha szerepel konkrét árfolyam a találatokban, írd le röviden (pl. 'EUR/HUF ~395 ma'), és jelezd, hogy változhat.";
  } else if (intent === "weather") {
    extra = "Adj 1–2 mondatos időjárás-összefoglalót (hely, nap, hőmérséklet, csapadék), ha a találatok alapján megítélhető.";
  }

  const answerShape =
    "Válaszformátum: Kezdd a KONKRÉT válasszal 1–2 mondatban (névsor/szám/tény). " +
    "Utána adj rövid magyarázatot 1–3 mondatban. NE írj 'Források' listát.";

  return [
    `Kérdés: ${question}`,
    extra,
    answerShape,
    "\n--- Találatok (összefűzve) ---\n" + joined
  ].join("\n");
}

/* ---- Forrásblokk ---- */
function renderSources(results, limit = 6) {
  const uniq = uniqueByDomain(results, limit);
  if (!uniq.length) return "";
  const lines = uniq.map(r => `• ${r.title || host(r.link)} — ${host(r.link)}\n${r.link}`);
  return `\n\nForrások:\n${lines.join("\n")}`;
}
function uniqueByDomain(list, limit = 6) {
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
