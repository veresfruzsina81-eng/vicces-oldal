// netlify/functions/chat.js
// Hibrid asszisztens: belső tudás → AI-only → friss adat (FX/Weather/API) vagy hírek (SAFE keresés).
// Rövid válasz: max 2 mondat, max 1 link. Intent: szabály + LLM. NINCS window/document!

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "", context = {} } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    const lastIntent = context.last_intent || null;

    if (!question) return json({ error: "Üres üzenet." }, 400);

    // 0) Köszönés
    if (isGreeting(question)) {
      return json({
        ok: true,
        question,
        answer: "Szia! Kérdezz bátran — rövid, lényegre törő választ adok, és ha kell, 1 megbízható forrást mutatok. 🙂",
        meta: { smalltalk: true }
      });
    }

    // 0/b) Affirmáció → kontextusfüggő follow-up
    if (isAffirmation(question)) {
      return json({
        ok: true,
        question,
        answer: buildAffirmationReply(lastIntent),
        meta: { hint: "affirmation", last_intent: lastIntent }
      });
    }

    // 1) Belső tudás – készítő
    if (isOwnerQuestion(question)) {
      return json({
        ok: true,
        question,
        answer: "Az oldalt Horváth Tamás (Szabolcsbáka) készítette, haladó programozó. Ha technikai kérdésed van az oldalról, írd meg nyugodtan.",
        meta: { intent: "owner" }
      });
    }

    // 2) Intent (szabály → LLM fallback)
    let intent = detectIntentRules(question);
    if (intent === "generic") {
      try {
        const llmIntent = await classifyIntentLLM(question);
        if (llmIntent) intent = llmIntent;
      } catch {}
    }

    // 2/b) Homályos follow-up → pontosítás
    if (intent === "generic" && isVagueFollowUp(question)) {
      return json({
        ok: true,
        question,
        answer: "Nem teljesen világos, mire gondolsz. Egy mondatban pontosítod? 🙂",
        meta: { intent: "clarify" }
      });
    }

    // 3) FRISS ADAT ÁGAK
    if (intent === "fx") {
      const fx = await getFxRate(question);
      if (fx?.rate) {
        const [base, quote] = fx.pair.split("/");
        const answer =
          `1 ${base} = ${fx.rate.toFixed(2)} ${quote} (${fx.date}).\n\n` +
          `Forrás: frankfurter.app\n${fx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: { intent: "fx" } });
      }
      return json({ ok: true, question, answer: "Most nem érem el az árfolyam API-t. Próbáld meg később." });
    }

    if (intent === "weather") {
      const wx = await getWeather(question);
      if (wx?.name) {
        const tMin = wx.tMin != null ? Math.round(wx.tMin) : "—";
        const tMax = wx.tMax != null ? Math.round(wx.tMax) : "—";
        const rain = wx.pop != null ? `, csapadék esély ~${wx.pop}%` : "";
        const answer =
          `${wx.name} (${wx.dateLabel}): ${tMin}–${tMax}°C${rain}.\n\n` +
          `Forrás: open-meteo.com\n${wx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: { intent: "weather" } });
      }
      return json({ ok: true, question, answer: "Most nem sikerült időjárási adatot lekérni. Próbáld meg később." });
    }

    if (intent === "news") {
      const NEED_NEWS_KW = /(rtl|sztárbox|sztarbox|ukrajna|oroszország|háború|béketárgyalás|fegyverszünet|x-faktor|xfaktor)/i;
      if (!NEED_NEWS_KW.test(question)) {
        return json({
          ok: true,
          question,
          answer: "Pontosan miről szeretnél friss hírt? (pl. „Ukrajna–Oroszország tárgyalások” vagy „RTL Sztárbox 2025 névsor”).",
          meta: { intent: "clarify-news" }
        });
      }
      const best = await safeSearchBest(question);
      if (best) {
        const text = await answerFromSnippet(question, best.title, best.snippet);
        const answer = `${limitToTwoSentences(text)}\n\nForrás: ${hostname(best.link)}\n${best.link}`;
        return json({ ok: true, question, answer, meta: { intent: "news", source: best.link } });
      }
      return json({
        ok: true,
        question,
        answer: "A legfrissebb információ az RTL oldalán érhető el.\n\nForrás: rtl.hu\nhttps://rtl.hu/",
        meta: { intent: "news", fallback: "no-search" }
      });
    }

    // 4) Általános kérdés – AI-only
    const text = await answerShortDirect(question);
    return json({ ok: true, question, answer: limitToTwoSentences(text), meta: { intent: "ai-only" } });

  } catch (err) {
    console.error("[chat] error:", err);
    return json({ error: err.message || String(err) }, 500);
  }
}

/* ================= Util ================= */
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
const hostname = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function isValidHttpUrl(u) { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; } }
function normalizeHu(s){ return (s||"").toLowerCase().normalize("NFC"); }

function isGreeting(q) {
  const s = normalizeHu(q).trim();
  return ["szia","hali","helló","hello","üdv","jó napot","jó estét","jó reggelt"]
    .some(p => s === p || s.startsWith(p + "!") || s.startsWith(p + "."));
}
function isAffirmation(q){
  const s = normalizeHu(q).trim();
  return /\b(ok|oké|oke|rendben|szuper|köszi|koszi|köszönöm|kosz|értem|király|szupi|nagyon jó)\b/.test(s);
}
function buildAffirmationReply(lastIntent){
  const common = "Örülök, hogy segíthettem! 🙂";
  switch (lastIntent) {
    case "fx":      return `${common} Kérsz még árfolyamot? (pl. „USD/HUF ma”, „EUR árfolyam egy hete”)`;
    case "weather": return `${common} Nézzünk másik várost, vagy órás bontást? (pl. „Szeged holnap”, „Budapest ma óránként”)`;
    case "news":    return `${common} Érdekel kapcsolódó friss hír? (pl. „RTL Sztárbox menetrend”, „Ukrajna tárgyalások állása”)`;
    case "owner":   return `${common} Segítsek technikai kérdésben az oldalról?`;
    default:        return `${common} Mit nézzünk meg legközelebb: időjárás, árfolyam vagy friss hírek?`;
  }
}
function isOwnerQuestion(q) {
  return /ki készítette|ki csinálta|készítő|fejlesztő|tulaj|kié az oldal|készítetted|horváth tamás/i.test(q);
}
function limitToTwoSentences(text) {
  const s = (text || "").replace(/\s+/g, " ").trim();
  const parts = s.split(/(?<=[.!?])\s+/).slice(0, 2);
  return parts.join(" ");
}
async function ask(messages) {
  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages
  });
  return r.choices?.[0]?.message?.content?.trim() || "";
}

/* ================= Intent ================= */
function detectIntentRules(q) {
  const s = normalizeHu(q);

  const fxPatterns = [
    /\bárfolyam\b/,
    /\b(euró|euro|eur|usd|gbp|chf|pln|ron)\b.*\b(huf|forint|árfolyam|rate)\b/,
    /\b(eur\/huf|usd\/huf|gbp\/huf|chf\/huf|pln\/huf|ron\/huf)\b/,
    /hány\s+forint\s+(egy|1)\s+(euró|euro|eur)\b/,
    /mennyi\s+(az\s+)?(euró|euro|eur)\b/
  ];
  if (fxPatterns.some(rx => rx.test(s))) return "fx";

  const weatherPatterns = [/\bidőjárás\b/, /\belőrejelzés\b/, /\bweather\b/, /\bhőmérséklet\b/];
  if (weatherPatterns.some(rx => rx.test(s))) return "weather";

  if (/\b(rtl|sztárbox|sztarbox|sztár box|résztvevők|névsor|versenyzők|hír|breaking|friss|2025|ukrajna|oroszország|x-faktor|xfaktor)\b/.test(s))
    return "news";

  return "generic";
}

async function classifyIntentLLM(question) {
  const sys = "Osztályozd a kérdést: fx | weather | news | owner | generic. Csak a címkét add vissza.";
  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "system", content: sys }, { role: "user", content: question }]
  });
  const label = r.choices?.[0]?.message?.content?.trim().toLowerCase();
  return ["fx","weather","news","owner","generic"].includes(label) ? label : null;
}

/* ================= AI-only ================= */
async function answerShortDirect(question) {
  const sys = "Adj magyarul maximum 2 mondatos, világos és pontos választ. Ne adj linket vagy forráslistát.";
  const user = `Kérdés: ${question}`;
  try {
    return await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  } catch {
    return "Most nem tudok válaszolni részletesen.";
  }
}

/* ================= SAFE böngészés (1 link) ================= */
function extractKeywordsHu(q){
  const stop = new Set(["a","az","és","vagy","hogy","mert","is","van","volt","lesz","itt","ott","mi","mit","mikor","hol","melyik","kik","között","közül","sztár","box"]);
  return normalizeHu(q)
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stop.has(w));
}

async function safeSearchBest(question) {
  const key = process.env.Google_API_KEY || process.env.GOOGLE_API_KEY;
  const cx  = process.env.Google_CX   || process.env.GOOGLE_CX;
  if (!key || !cx) { console.warn("[search] missing GOOGLE_* keys"); return null; }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", question);
  url.searchParams.set("num", "10");
  url.searchParams.set("safe", "active");
  url.searchParams.set("hl", "hu");
  url.searchParams.set("gl", "hu");

  const res = await fetch(url);
  if (!res.ok) { console.error("[search] http", res.status, await res.text()); return null; }
  const data = await res.json();
  let items = (data.items || [])
    .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
    .filter(it => isValidHttpUrl(it.link));

  // Domain fehérlista
  const whitelist = new Set(["rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu","nso.hu","nemzetisport.hu"]);
  items = items.filter(it => whitelist.has(hostname(it.link)));

  const kws = extractKeywordsHu(question);
  const kwSet = new Set(kws);
  const kwHits = (text) => {
    const s = normalizeHu(text);
    let hits = 0; for (const k of kwSet) if (k && s.includes(k)) hits++; return hits;
  };

  // Off-topic tiltás
  const blacklistWords = /(bálna|whale)/i;

  const preferRtl = /(^|\s)rtl(\s|\.|$)/i.test(question) || /sztárbox|sztarbox/i.test(question);
  const yearStr = String(new Date().getFullYear());

  let best = null, bestScore = -1;
  for (const it of items) {
    const text = `${it.title} ${it.snippet}`;
    if (blacklistWords.test(text)) continue;

    const hits = kwHits(text);
    const isGeo = /(ukrajna|oroszország|háború|béketárgyalás|fegyverszünet|front|invázió)/i.test(question);
    if (kws.length && hits < (isGeo ? 2 : 1)) continue;

    let s = 0;
    const h = hostname(it.link);
    s += { "rtl.hu":10,"24.hu":9,"index.hu":9,"telex.hu":9,"hvg.hu":9,"portfolio.hu":9,"nemzetisport.hu":8,"nso.hu":8 }[h] || 5;
    s += Math.min(hits, 3);
    const urlLower = it.link.toLowerCase();
    if (urlLower.includes(yearStr)) s += 2;
    if (/\b2023\b|\b2024\b/.test(urlLower)) s -= 2;
    if (preferRtl && h === "rtl.hu") s += 5;
    if (it.title.toLowerCase().includes("hivatalos")) s += 1;

    if (s > bestScore) { best = it; bestScore = s; }
  }

  if (!best) {
    const rtl = (data.items || []).find(i => hostname(i.link) === "rtl.hu");
    return rtl || (data.items || [])[0] || null;
  }
  return best;
}

async function answerFromSnippet(question, title, snippet) {
  const sys =
    "Magyarul válaszolj MAX 2 mondatban, kizárólag a kapott rövid forrásleírás (title+snippet) alapján. " +
    "Ha a snippet nem egyértelműen a kérdésről szól, írd: 'A megadott forrás alapján nem egyértelmű a válasz.' " +
    "Ne találj ki új tényt, ne említs forráslistát, és ne hozz be más témát.";
  const user = `Kérdés: ${question}\nForrás cím: ${title}\nForrás leírás: ${snippet}`;
  try {
    const txt = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
    return limitToTwoSentences(txt);
  } catch {
    return "A megadott forrás alapján nem egyértelmű a válasz.";
  }
}

/* ================= FX (Frankfurter API) ================= */
async function getFxRate(q) {
  try {
    const S = q.toUpperCase().replace(/[.,]/g, " ");
    let from = "EUR", to = "HUF";

    const mPair  = S.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/);
    const mWords = S.match(/\b(EUR|USD|GBP|CHF|PLN|RON)\b.*\b(HUF|EUR|USD|GBP|CHF|PLN|RON)\b/);

    if (mPair) { from = mPair[1]; to = mPair[2]; }
    else if (mWords && mWords[1] !== mWords[2]) { from = mWords[1]; to = mWords[2]; }
    else if (/eur|euro|euró/i.test(q) && /huf|forint/i.test(q)) { from = "EUR"; to = "HUF"; }
    else if (/usd/i.test(q) && /forint|huf/i.test(q)) { from = "USD"; to = "HUF"; }

    const url = new URL("https://api.frankfurter.app/latest");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);

    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const rate = d?.rates?.[to];
    if (!rate) return null;
    return { pair: `${from}/${to}`, rate: Number(rate), date: d.date, sourceUrl: url.toString() };
  } catch {
    return null;
  }
}

/* ================= Weather (Open-Meteo API) ================= */
function stripHungarianCase(word) {
  const w = normalizeHu(word);
  return w.replace(/[-\s]+/g, " ")
          .replace(/(?:ban|ben|ba|be|ra|re|rol|ról|ről|tol|től|nak|nek|on|en|ön|n|hoz|hez|höz|ig|val|vel|ként|nál|nél|ba|be)$/u, "");
}
function extractCityGuess(q) {
  const m = q.match(/([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű\- ]{2,})/u);
  if (!m) return null;
  const base = stripHungarianCase(m[1].trim());
  const map = { "szabolcsbáka":"Szabolcsbáka","szabolcs-baka":"Szabolcsbáka","szabolcs":"Nyíregyháza","szabolcs-szatmár-bereg":"Nyíregyháza","pest":"Budapest","bp":"Budapest" };
  return map[base.toLowerCase()] || (base[0].toUpperCase() + base.slice(1));
}
async function geocode(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "hu");
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.results?.[0] || null;
}
function isVagueFollowUp(q){
  const s = normalizeHu(q).replace(/[^\p{L}\p{N}\s]/gu," ").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const stop = new Set(["ők","ok","azok","ezek","azt","ezt","mert","és","de","vagy","hogy","is","mi","milyen","hogyan","akkor","igen","nem","hadban","állnak","egymással"]);
  const content = tokens.filter(t => !(stop.has(t) || t.length <= 2));
  const hasEntity = /[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/.test(q);
  return content.length === 0 || (!hasEntity && tokens.length <= 4);
}
async function getWeather(q) {
  try {
    let guess = extractCityGuess(q) || "Budapest";
    let loc = await geocode(guess);
    if (!loc && !/hungary|magyar/i.test(guess)) loc = await geocode(`${guess}, Hungary`);
    if (!loc) loc = { name: "Budapest", latitude: 47.4979, longitude: 19.0402, timezone: "Europe/Budapest", country: "Hungary" };

    const lat = loc.latitude, lon = loc.longitude;
    const tz = loc.timezone || "Europe/Budapest";
    const wantTomorrow = /\bholnap|tomorrow\b/i.test(q);

    const wxUrl = new URL("https://api.open-meteo.com/v1/forecast");
    wxUrl.searchParams.set("latitude", String(lat));
    wxUrl.searchParams.set("longitude", String(lon));
    wxUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    wxUrl.searchParams.set("timezone", tz);
    wxUrl.searchParams.set("forecast_days", wantTomorrow ? "2" : "1");

    const wxres = await fetch(wxUrl);
    if (!wxres.ok) {
      return { name: `${loc.name}, ${loc.country || ""}`.trim(), dateLabel: wantTomorrow ? "holnap" : "ma", tMin: null, tMax: null, pop: null, sourceUrl: wxUrl.toString() };
    }
    const wx = await wxres.json();
    const d = wx?.daily;
    const idx = wantTomorrow && d?.time?.length > 1 ? 1 : 0;

    return {
      name: `${loc.name}${loc.country ? `, ${loc.country}` : ""}`,
      dateLabel: wantTomorrow ? "holnap" : "ma",
      tMin: d?.temperature_2m_min?.[idx] ?? null,
      tMax: d?.temperature_2m_max?.[idx] ?? null,
      pop: typeof d?.precipitation_probability_max?.[idx] === "number" ? d.precipitation_probability_max[idx] : null,
      sourceUrl: wxUrl.toString()
    };
  } catch {
    return null;
  }
}
