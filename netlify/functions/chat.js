// netlify/functions/chat.js
// Hibrid asszisztens: (1) belső tudás, (2) AI-only, (3) friss adatnál API/böngészés.
// Rövid válasz (max 2 mondat), legfeljebb 1 forráslink. SAFE mód (nincs HTML-letöltés → nincs 502).

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();
    if (!question) return json({ error: "Üres üzenet." }, 400);

    // 0) Smalltalk – nincs böngészés
    if (isGreeting(question)) {
      return json({
        ok: true,
        question,
        answer: "Szia! Kérdezz bátran — rövid, lényegre törő választ adok, és ha kell, 1 megbízható forrást mutatok. 🙂",
        meta: { smalltalk: true }
      });
    }

    // 1) FIX: rólad / az oldalról szóló kérdések – nincs böngészés
    if (isOwnerQuestion(question)) {
      return json({
        ok: true,
        question,
        answer:
          "Az oldalt Horváth Tamás (Szabolcsbáka) készítette, haladó programozó. Ha technikai kérdésed van az oldalról, írd meg nyugodtan.",
        meta: { intent: "owner" }
      });
    }

    // 2) INTENT felismerés
    const intent = detectIntent(question);

    // 3) FRISS ADAT – API vagy SAFE böngészés, max 1 forrás
    if (intent === "fx") {
      const fx = await getFxRate(question);
      if (fx && fx.rate) {
        const answer =
          `(${fx.date}) ${fx.pair}: ${fx.rate.toFixed(2)}. Az árfolyam folyamatosan változik.\n\n` +
          `Forrás: frankfurter.app\n${fx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: { intent } });
      }
    }

    if (intent === "weather") {
      const wx = await getWeather(question);
      if (wx && wx.name) {
        const answer =
          `${wx.name} ${wx.dateLabel}: ${Math.round(wx.tMin)}–${Math.round(wx.tMax)}°C${wx.pop != null ? `, csapadék esély ~${wx.pop}%` : ""}. ` +
          `Az előrejelzés rendszeresen frissül.\n\n` +
          `Forrás: open-meteo.com\n${wx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: { intent } });
      }
    }

    if (intent === "news") {
      // SAFE böngészés – 1 legjobb találat
      const best = await safeSearchBest(question);
      if (best) {
        const text = await answerFromSnippet(question, best.title, best.snippet);
        const answer =
          `${limitToTwoSentences(text)}\n\n` +
          `Forrás: ${hostname(best.link)}\n${best.link}`;
        return json({ ok: true, question, answer, meta: { intent, source: best.link } });
      }
      return json({ ok: true, question, answer: "Erre most nem találtam megbízható, friss nyilvános információt." });
    }

    // 4) ALAP/ÁLTALÁNOS KÉRDÉSEK – AI-only (nincs böngészés)
    {
      const text = await answerShortDirect(question);
      return json({ ok: true, question, answer: limitToTwoSentences(text), meta: { intent: "ai-only" } });
    }
  } catch (err) {
    return json({ error: err.message || String(err) }, 500);
  }
}

/* ============== Util ============== */
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(body, statusCode = 200) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...cors() }, body: JSON.stringify(body, null, 2) };
}
const hostname = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function isValidHttpUrl(u) { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; } }

function isGreeting(q) {
  const s = q.toLowerCase().trim();
  return ["szia","hali","helló","hello","üdv","jó napot","jó estét","jó reggelt"].some(p => s === p || s.startsWith(p + "!") || s.startsWith(p + "."));
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

/* ============== Intent ============== */
function detectIntent(q) {
  const s = q.toLowerCase();
  if (/\bárfolyam|eur(huf|huf)|euró árfolyam|usd huf|usd to huf|eur to huf\b/.test(s)) return "fx";
  if (/\bidőjárás|meteo|előrejelzés|weather|hőmérséklet|holnap|ma\b/.test(s)) return "weather";
  if (/\bsztárbox|sztarbox|sztár box|hír|breaking|legfrissebb|mi történt|résztvevők|névsor|versenyzők|2025\b/.test(s)) return "news";
  return "generic";
}

/* ============== AI-only (nincs böngészés) ============== */
async function answerShortDirect(question) {
  const sys = "Adj magyarul maximum 2 mondatos, világos és pontos választ. Ne adj linket vagy forráslistát.";
  const user = `Kérdés: ${question}`;
  return ask([{ role: "system", content: sys }, { role: "user", content: user }]);
}

/* ============== SAFE böngészés (snippet) 1 linkkel ============== */
async function safeSearchBest(question) {
  const key = process.env.Google_API_KEY || process.env.GOOGLE_API_KEY;
  const cx  = process.env.Google_CX   || process.env.GOOGLE_CX;
  if (!key || !cx) return null;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", question);
  url.searchParams.set("num", "8");
  url.searchParams.set("safe", "active");
  url.searchParams.set("hl", "hu");
  url.searchParams.set("gl", "hu");

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const items = (data.items || [])
    .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
    .filter(it => isValidHttpUrl(it.link));

  if (!items.length) return null;

  // pontozás: .hu és megbízható domain + aktuális év + „hivatalos” szó
  const yearStr = String(new Date().getFullYear());
  const scoreDomain = (h) => ({
    "rtl.hu": 10, "24.hu": 9, "index.hu": 9, "telex.hu": 9, "hvg.hu": 9,
    "nemzetisport.hu": 8, "nso.hu": 8, "portfolio.hu": 9, "sportal.hu": 7,
    "blikk.hu": 6, "origo.hu": 6, "port.hu": 6, "nlc.hu": 6
  }[h] || (h.endsWith(".hu") ? 5 : 3));

  let best = null, bestScore = -1;
  for (const it of items) {
    const h = hostname(it.link);
    let s = scoreDomain(h);
    const urlLower = it.link.toLowerCase();
    if (urlLower.includes(yearStr)) s += 2;
    if (/\b2023\b|\b2024\b/.test(urlLower)) s -= 2;
    if (it.title.toLowerCase().includes("hivatalos")) s += 1;
    if (/facebook\.com|forum|hoxa|reddit|blogspot|wordpress/i.test(h)) s -= 3;
    if (s > bestScore) { best = it; bestScore = s; }
  }
  return best || items[0];
}

async function answerFromSnippet(question, title, snippet) {
  const sys =
    "Adj magyarul maximum 2 mondatos, konkrét választ a megadott rövid forrásleírás alapján. " +
    "Ne találj ki új tényt, és ne adj forráslistát.";
  const user = `Kérdés: ${question}\nForrás cím: ${title}\nForrás leírás: ${snippet}`;
  return ask([{ role: "system", content: sys }, { role: "user", content: user }]);
}

/* ============== FX (Frankfurter API) ============== */
async function getFxRate(q) {
  const m = q.toUpperCase().match(/([A-Z]{3})\s*\/?\s*([A-Z]{3})/);
  let from = "EUR", to = "HUF";
  if (m) { from = m[1]; to = m[2]; }

  const url = new URL("https://api.frankfurter.app/latest");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json(); // { date, rates: { HUF: 395.12 } }
  const rate = d?.rates?.[to];
  if (!rate) return null;

  return { pair: `${from}/${to}`, rate: Number(rate), date: d.date, sourceUrl: url.toString() };
}

/* ============== Weather (Open-Meteo API) ============== */
function stripHungarianCase(word) {
  const w = (word || "").toLowerCase().normalize("NFC");
  return w
    .replace(/[-\s]+/g, " ")
    .replace(/(?:ban|ben|ba|be|ra|re|rol|ról|ről|tol|től|nak|nek|on|en|ön|n|hoz|hez|höz|ig|val|vel|ként|nál|nél|ba|be)$/u, "");
}
function extractCityGuess(q) {
  const m = q.match(/([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű\- ]{2,})/u);
  if (!m) return null;
  const base = stripHungarianCase(m[1].trim());
  const map = { "szabolcs": "Nyíregyháza", "szabolcs-szatmár-bereg": "Nyíregyháza", "pest": "Budapest" };
  const v = map[base.toLowerCase()] || (base[0].toUpperCase() + base.slice(1));
  return v;
}
async function getWeather(q) {
  const guess = extractCityGuess(q) || "Budapest";

  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", guess);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "hu");
  const geores = await fetch(geoUrl);
  if (!geores.ok) return null;
  const geodata = await geores.json();
  const loc = geodata?.results?.[0];
  if (!loc) return null;

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
  if (!wxres.ok) return null;
  const wx = await wxres.json();
  const d = wx?.daily;
  if (!d || !d.time?.length) return null;

  const idx = wantTomorrow && d.time.length > 1 ? 1 : 0;
  return {
    name: loc.name + (loc.country ? `, ${loc.country}` : ""),
    dateLabel: wantTomorrow ? "holnap" : "ma",
    tMin: d.temperature_2m_min?.[idx],
    tMax: d.temperature_2m_max?.[idx],
    pop: typeof d.precipitation_probability_max?.[idx] === "number" ? d.precipitation_probability_max[idx] : null,
    sourceUrl: wxUrl.toString()
  };
}
