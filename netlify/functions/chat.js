// netlify/functions/chat.js
// Hibrid asszisztens okos intent-felismeréssel (szabály + LLM).
// Rövid válasz (max 2 mondat), max 1 link. Debug logok.

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    console.log("[chat] incoming:", question);
    if (!question) return json({ error: "Üres üzenet." }, 400);

    // Smalltalk
    if (isGreeting(question)) {
      return json({
        ok: true,
        question,
        answer: "Szia! Kérdezz bátran — rövid, lényegre törő választ adok, és ha kell, 1 megbízható forrást mutatok. 🙂",
        meta: { smalltalk: true }
      });
    }

    // Belső tudás – rólad / az oldalról
    if (isOwnerQuestion(question)) {
      return json({
        ok: true,
        question,
        answer: "Az oldalt Horváth Tamás (Szabolcsbáka) készítette, haladó programozó. Ha technikai kérdésed van az oldalról, írd meg nyugodtan.",
        meta: { intent: "owner" }
      });
    }

    // 1) Gyors intent szabályok
    let intent = detectIntentRules(question);
    console.log("[chat] rule intent:", intent);

    // 2) Ha még generic, kérjünk LLM-et CSAK osztályozásra
    if (intent === "generic") {
      try {
        const llmIntent = await classifyIntentLLM(question);
        if (llmIntent) intent = llmIntent;
        console.log("[chat] llm intent:", intent);
      } catch (e) {
        console.warn("[chat] llm intent error:", e.message || String(e));
      }
    }

    // --- FRISS ADAT ágazatok ---
    if (intent === "fx") {
      const fx = await getFxRate(question);
      console.log("[chat] fx:", fx);
      if (fx?.rate) {
        const answer =
          `(${fx.date}) ${fx.pair}: ${fx.rate.toFixed(2)}. Az árfolyam folyamatosan változik.\n\n` +
          `Forrás: frankfurter.app\n${fx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: { intent } });
      }
      // Biztonságos rövid fallback
      return json({ ok: true, question, answer: "Nem érem el most az árfolyam API-t. Próbáld újra később." });
    }

    if (intent === "weather") {
      const wx = await getWeather(question);
      console.log("[chat] weather:", wx);
      if (wx?.name) {
        const answer =
          `${wx.name} ${wx.dateLabel}: ${wx.tMin != null ? Math.round(wx.tMin) : "—"}–${wx.tMax != null ? Math.round(wx.tMax) : "—"}°C` +
          `${wx.pop != null ? `, csapadék esély ~${wx.pop}%` : ""}. ` +
          `Az előrejelzés rendszeresen frissül.\n\n` +
          `Forrás: open-meteo.com\n${wx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: { intent } });
      }
      return json({ ok: true, question, answer: "Most nem sikerült időjárási adatot lekérni. Próbáld meg újra kicsit később." });
    }

    if (intent === "news") {
      const best = await safeSearchBest(question);
      console.log("[chat] news best:", best?.link);
      if (best) {
        const text = await answerFromSnippet(question, best.title, best.snippet);
        const answer = `${limitToTwoSentences(text)}\n\nForrás: ${hostname(best.link)}\n${best.link}`;
        return json({ ok: true, question, answer, meta: { intent, source: best.link } });
      }
      // Ha nincs keresőkulcs, tisztelettel irány az RTL kezdőlap
      return json({
        ok: true,
        question,
        answer: "A legfrissebb információt az RTL oldalán találod.\n\nForrás: rtl.hu\nhttps://rtl.hu/",
        meta: { intent, fallback: "no-search" }
      });
    }

    // --- Általános / alap kérdés – AI only ---
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

function isGreeting(q) {
  const s = q.toLowerCase().trim();
  return ["szia","hali","helló","hello","üdv","jó napot","jó estét","jó reggelt"]
    .some(p => s === p || s.startsWith(p + "!") || s.startsWith(p + "."));
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
// 1) Szabály alapú gyors felismerés (magyar példákkal)
function detectIntentRules(q) {
  const s = q.toLowerCase();

  // FX: „mennyi egy euró”, „hány forint egy euró”, „eur árfolyam”, „eur huf”, „usd forint”, stb.
  const fxPatterns = [
    /\bárfolyam\b/,
    /\b(euró|euro|eur|usd|gbp|chf|pln|ron)\b.*\b(huf|forint|árfolyam|rate)\b/,
    /\b(eur\/huf|usd\/huf|gbp\/huf|chf\/huf|pln\/huf|ron\/huf)\b/,
    /hány\s+forint\s+(egy|1)\s+(euró|euro|eur)\b/,
    /mennyi\s+(az\s+)?(euró|euro|eur)\b/
  ];
  if (fxPatterns.some(rx => rx.test(s))) return "fx";

  // Weather: csak explicit időjárás szavak (ne triggerelje a "ma/holnap" önmagában)
  const weatherPatterns = [
    /\bidőjárás\b/, /\belőrejelzés\b/, /\bweather\b/, /\bhőmérséklet\b/
  ];
  if (weatherPatterns.some(rx => rx.test(s))) return "weather";

  // News/RTL/Sztárbox
  if (/\b(rtl|sztárbox|sztarbox|sztár box|résztvevők|névsor|versenyzők|hír|breaking|friss|2025)\b/.test(s))
    return "news";

  return "generic";
}

// 2) LLM-osztályozó fallback (csak intentet kérünk)
async function classifyIntentLLM(question) {
  const sys =
    "Feladat: osztályozd a kérdést az egyik kategóriába: fx, weather, news, owner, generic. " +
    "fx = deviza/árfolyam; weather = időjárás; news = aktuális hírek/sztárbox/rtl; owner = oldal készítője; egyéb = generic. " +
    "Csak a címkét add vissza.";
  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "system", content: sys }, { role: "user", content: question }]
  });
  const label = r.choices?.[0]?.message?.content?.trim().toLowerCase();
  return ["fx", "weather", "news", "owner", "generic"].includes(label) ? label : null;
}

/* ================= AI-only ================= */
async function answerShortDirect(question) {
  const sys = "Adj magyarul maximum 2 mondatos, világos és pontos választ. Ne adj linket vagy forráslistát.";
  const user = `Kérdés: ${question}`;
  try {
    return await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  } catch (e) {
    console.error("[ai-only] error:", e);
    return "Most nem tudok válaszolni részletesen.";
  }
}

/* ================= SAFE böngészés (1 link) ================= */
async function safeSearchBest(question) {
  const key = process.env.Google_API_KEY || process.env.GOOGLE_API_KEY;
  const cx  = process.env.Google_CX   || process.env.GOOGLE_CX;
  if (!key || !cx) {
    console.warn("[search] missing GOOGLE_API_KEY/GOOGLE_CX");
    return null;
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", question);
  url.searchParams.set("num", "8");
  url.searchParams.set("safe", "active");
  url.searchParams.set("hl", "hu");
  url.searchParams.set("gl", "hu");

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[search] http error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const items = (data.items || [])
      .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
      .filter(it => isValidHttpUrl(it.link));
    console.log("[search] items:", items.length);
    if (!items.length) return null;

    const preferRtl = /(^|\s)rtl(\s|\.|$)/i.test(question) || /sztárbox|sztarbox/i.test(question);
    const yearStr = String(new Date().getFullYear());

    const scoreDomain = (h) => {
      const base = {
        "rtl.hu": 10, "24.hu": 9, "index.hu": 9, "telex.hu": 9, "hvg.hu": 9,
        "portfolio.hu": 9, "nemzetisport.hu": 8, "nso.hu": 8
      }[h] || (h.endsWith(".hu") ? 5 : 3);
      return base;
    };

    let best = null, bestScore = -1;
    for (const it of items) {
      const h = hostname(it.link);
      let s = scoreDomain(h);
      const urlLower = it.link.toLowerCase();
      if (urlLower.includes(yearStr)) s += 2;
      if (/\b2023\b|\b2024\b/.test(urlLower)) s -= 2;
      if (preferRtl && h === "rtl.hu") s += 5;
      if (it.title.toLowerCase().includes("hivatalos")) s += 1;
      if (/facebook\.com|hoxa|reddit|blogspot|wordpress/i.test(h)) s -= 4;
      if (s > bestScore) { best = it; bestScore = s; }
    }
    return best || items[0];
  } catch (e) {
    console.error("[search] error:", e);
    return null;
  }
}

async function answerFromSnippet(question, title, snippet) {
  const sys = "Adj magyarul maximum 2 mondatos, konkrét választ a megadott rövid forrásleírás alapján. Ne találj ki új tényt, és ne adj forráslistát.";
  const user = `Kérdés: ${question}\nForrás cím: ${title}\nForrás leírás: ${snippet}`;
  try {
    return await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  } catch (e) {
    console.error("[search->answer] error:", e);
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
    if (!r.ok) {
      console.error("[fx] http:", r.status, await r.text());
      return null;
    }
    const d = await r.json();
    const rate = d?.rates?.[to];
    if (!rate) {
      console.error("[fx] missing rate", to, "payload:", d);
      return null;
    }
    return { pair: `${from}/${to}`, rate: Number(rate), date: d.date, sourceUrl: url.toString() };
  } catch (e) {
    console.error("[fx] error:", e);
    return null;
  }
}

/* ================= Weather (Open-Meteo API) ================= */
function stripHungarianCase(word) {
  const w = (word || "").toLowerCase().normalize("NFC");
  return w.replace(/[-\s]+/g, " ")
          .replace(/(?:ban|ben|ba|be|ra|re|rol|ról|ről|tol|től|nak|nek|on|en|ön|n|hoz|hez|höz|ig|val|vel|ként|nál|nél|ba|be)$/u, "");
}
function extractCityGuess(q) {
  // „Budapesten”, „Szegeden”, „Szabolcsban” stb.
  const m = q.match(/([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű\- ]{2,})/u);
  if (!m) return null;
  const base = stripHungarianCase(m[1].trim());
  const map = {
    "szabolcs": "Nyíregyháza", "szabolcs-szatmár-bereg": "Nyíregyháza",
    "pest": "Budapest", "bp": "Budapest"
  };
  return map[base.toLowerCase()] || (base[0].toUpperCase() + base.slice(1));
}
async function getWeather(q) {
  try {
    let guess = extractCityGuess(q) || "Budapest";
    console.log("[weather] guess:", guess);

    // 1. próbálkozás
    let loc = await geocode(guess);
    // 2. ha nincs, próbáljuk explicit „City, Country” formában
    if (!loc && !/hungary|magyar/i.test(guess)) loc = await geocode(`${guess}, Hungary`);
    // 3. végső fallback
    if (!loc) {
      console.warn("[weather] geocoding failed → fallback Budapest");
      loc = { name: "Budapest", latitude: 47.4979, longitude: 19.0402, timezone: "Europe/Budapest", country: "Hungary" };
    }

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
      console.error("[weather] forecast http:", wxres.status, await wxres.text());
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
  } catch (e) {
    console.error("[weather] error:", e);
    return null;
  }
}
async function geocode(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "hu");
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[weather] geocoding http:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data?.results?.[0] || null;
}
