// Hibrid asszisztens: AI-only válaszok + friss adatok (időjárás/árfolyam/hírek) + beszélgetés-követés + VISION.
// Rövid válasz: max 2 mondat, max 1 link. A frontend opcionálisan küld `context`-et, amit frissítve visszaadunk.

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    const { message = "", context = {}, image = null } = JSON.parse(event.body || "{}");
    const question = (message || "").trim();

    // engedjük az image-only kérést is
    if (!question && !image) return json({ error: "Üres üzenet." }, 400);

    // Kontextus kezdőértékek
    const ctx = {
      last_intent: context.last_intent || null,
      last_city: context.last_city || null,
      last_topic: context.last_topic || null
    };

    // ===== 0/a) KÉP-ÁG (ha van kép, előre vesszük) =====
    const MAX_IMAGE_BYTES = 2_000_000; // ~2MB
    if (image) {
      const len = typeof image === "string" ? image.length : 0;
      const approxBytes = Math.ceil((len * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return json({
          ok: false,
          question: "[kép]" + (question ? ` + "${question}"` : ""),
          answer: "A kép túl nagy a feldolgozáshoz. Kérlek küldd kisebb méretben (max ~2 MB).",
          meta: { ...ctx, last_intent: "vision" }
        });
      }
      const visionText = (await analyzeImage(image, question)) || "";
      if (visionText) {
        return json({
          ok: true,
          question: question || "[kép]",
          answer: limitToTwoSentences(visionText),
          meta: { ...ctx, last_intent: "vision" }
        });
      }
      // ha nem sikerült a vizuális elemzés, essünk vissza a normál logikára (ha van szöveg)
      if (!question) {
        return json({
          ok: true,
          question: "[kép]",
          answer: "Szép kép! 🙂 Most nem sikerült részletesen elemeznem, próbáld újra később.",
          meta: { ...ctx, last_intent: "vision" }
        });
      }
    }

    // ===== 0/b) Köszönés / smalltalk =====
    if (isGreeting(question)) {
      return json({
        ok: true,
        question,
        answer: "Szia! Kérdezz bátran — rövid, lényegre törő választ adok, és ha kell, 1 megbízható forrást mutatok. 🙂",
        meta: { ...ctx, smalltalk: true }
      });
    }
    if (isSmalltalk(question)) {
      return json({
        ok: true,
        question,
        answer: "Semmi extra, itt vagyok. Meséljem a friss infókat, vagy valami konkrétban segítsek? 😉",
        meta: { ...ctx, smalltalk: true }
      });
    }

    // ===== 1) Készítő =====
    if (isOwnerQuestion(question)) {
      return json({
        ok: true,
        question,
        answer: "Az oldalt Horváth Tamás készítette Szabolcsbákán. Haladó szintű programozó, hobbi-projekt. 🙂",
        meta: { ...ctx, last_intent: "owner" }
      });
    }

    // ===== 2) Intent =====
    let intent = detectIntentRules(question);
    if (intent === "generic") {
      try {
        const llmIntent = await classifyIntentLLM(question);
        if (llmIntent) intent = llmIntent;
      } catch {}
    }
    if (isVagueFollowUp(question)) {
      if (ctx.last_intent === "weather" && ctx.last_city) intent = "weather";
      else if (ctx.last_intent === "news" && ctx.last_topic) intent = "news";
      else if (ctx.last_intent === "fx") intent = "fx";
    }

    // ===== 3) FRISS ADAT =====
    if (intent === "fx") {
      const fx = await getFxRate(question);
      ctx.last_intent = "fx";
      ctx.last_topic = "fx";
      if (fx?.rate) {
        const [base, quote] = fx.pair.split("/");
        const answer =
          `1 ${base} = ${fx.rate.toFixed(2)} ${quote} (${fx.date}).\n\n` +
          `Forrás: frankfurter.app\n${fx.sourceUrl}`;
        return json({ ok: true, question, answer, meta: ctx });
      }
      return json({ ok: true, question, answer: "Most nem érem el az árfolyam API-t. Próbáld később.", meta: ctx });
    }

    if (intent === "weather") {
      const guessCity = extractCityGuess(question) || ctx.last_city || null;
      const wx = await getWeather(question, guessCity);
      ctx.last_intent = "weather";
      if (wx?.name) {
        const tMin = wx.tMin != null ? Math.round(wx.tMin) : "—";
        const tMax = wx.tMax != null ? Math.round(wx.tMax) : "—";
        const rain = wx.pop != null ? `, csapadék esély ~${wx.pop}%` : "";
        const answer =
          `${wx.name} (${wx.dateLabel}): ${tMin}–${tMax}°C${rain}.\n\n` +
          `Forrás: open-meteo.com\n${wx.sourceUrl}`;
        ctx.last_city = wx.shortName || guessCity || ctx.last_city || null;
        ctx.last_topic = ctx.last_city;
        return json({ ok: true, question, answer, meta: ctx });
      }
      return json({ ok: true, question, answer: "Most nem sikerült időjárási adatot lekérni. Próbáld később.", meta: ctx });
    }

    if (intent === "news" || (intent === "generic" && looksFresh(question))) {
      const best = await safeSearchBest(question);
      ctx.last_intent = "news";
      ctx.last_topic = keywordsForContext(question);
      if (best) {
        const text = await answerFromSnippet(question, best.title, best.snippet);
        const answer = `${limitToTwoSentences(text)}\n\nForrás: ${hostname(best.link)}\n${best.link}`;
        return json({ ok: true, question, answer, meta: { ...ctx, source: best.link } });
      }
      return json({
        ok: true,
        question,
        answer: "Most nem találtam elég friss és megbízható forrást. Pontosítsunk egy kicsit? 🙂",
        meta: ctx
      });
    }

    // ===== 4) AI-only =====
    const text = await answerShortDirect(question);
    return json({ ok: true, question, answer: limitToTwoSentences(text), meta: { ...ctx, last_intent: "ai-only" } });

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
function isSmalltalk(q){
  const s = normalizeHu(q);
  return /\b(mizu|mi újság|miujsag|hogy vagy|csá|csumi|na mi van|na mi ujsag)\b/.test(s);
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

  const weatherPatterns = [/\bidőjárás\b/, /\belőrejelzés\b/, /\bweather\b/, /\bhőmérséklet\b/, /\bholnap\b/];
  if (weatherPatterns.some(rx => rx.test(s))) return "weather";

  if (/\b(rtl|sztárbox|sztarbox|sztár box|résztvevők|névsor|versenyzők|hír|breaking|friss|2025|ukrajna|oroszország|x-faktor|xfaktor|menetrend|ma|tegnap|most)\b/.test(s))
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

function looksFresh(q){
  const s = normalizeHu(q);
  return /\b(ma|tegnap|holnap|most|friss|breaking|legujabb|utolso)\b/.test(s);
}
function keywordsForContext(q){
  return normalizeHu(q)
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .split(/\s+/).filter(w => w && w.length >= 4).slice(0,3).join(" ");
}

/* ================= AI-only ================= */
async function answerShortDirect(question) {
  const sys = "Adj magyarul maximum 2 mondatos, világos és emberi választ. Ne adj linket vagy forrást.";
  const user = `Kérdés: ${question}`;
  try {
    return await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  } catch {
    return "Most nem tudok válaszolni részletesen.";
  }
}

/* ================= SAFE böngészés (1 link) ================= */
function extractKeywordsHu(q){
  const stop = new Set(["a","az","és","vagy","hogy","mert","is","van","volt","lesz","itt","ott","mi","mit","mikor","hol","melyik","kik","között","közül","sztár","box","ma","holnap","tegnap","most"]);
  return normalizeHu(q)
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stop.has(w));
}

async function safeSearchBest(question) {
  const key = process.env.GOOGLE_API_KEY || process.env.Google_API_KEY;
  const cx  = process.env.GOOGLE_CX      || process.env.Google_CX;
  if (!key || !cx) { console.warn("[search] missing GOOGLE_* keys"); return null; }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", question);
  url.searchParams.set("num", "10");
  url.searchParams.set("safe", "active");
  url.searchParams.set("hl", "hu");
  url.searchParams.set("gl", "hu");
  url.searchParams.set("lr", "lang_hu");
  url.searchParams.set("dateRestrict", `d${looksFresh(question) ? 7 : 14}`);

  const res = await fetch(url);
  if (!res.ok) { console.error("[search] http", res.status, await res.text()); return null; }
  const data = await res.json();
  let items = (data.items || [])
    .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
    .filter(it => isValidHttpUrl(it.link));

  const whitelist = new Set(["rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu","nso.hu","nemzetisport.hu"]);
  items = items.filter(it => whitelist.has(hostname(it.link)));

  const kws = extractKeywordsHu(question);
  const kwSet = new Set(kws);
  const kwHits = (text) => {
    const s = normalizeHu(text);
    let hits = 0; for (const k of kwSet) if (k && s.includes(k)) hits++; return hits;
  };

  const preferRtl = /(^|\s)rtl(\s|\.|$)/i.test(question) || /sztárbox|sztarbox/i.test(question);
  let best = null, bestScore = -1, yearStr = String(new Date().getFullYear());

  for (const it of items) {
    const text = `${it.title} ${it.snippet}`;
    const hits = kwHits(text);
    if (kws.length && hits < 1) continue;

    let s = 0;
    const h = hostname(it.link);
    s += { "rtl.hu":10,"24.hu":9,"index.hu":9,"telex.hu":9,"hvg.hu":9,"portfolio.hu":9,"nemzetisport.hu":8,"nso.hu":8 }[h] || 5;
    s += Math.min(hits, 3);
    const urlLower = it.link.toLowerCase();
    if (urlLower.includes(yearStr)) s += 2;
    if (preferRtl && h === "rtl.hu") s += 5;

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
    "Ha a snippet nem egyértelmű a kérdésre, írd: 'A megadott forrás alapján nem egyértelmű a válasz.' " +
    "Ne találj ki új tényt, ne adj forráslistát.";
  const user = `Kérdés: ${question}\nForrás cím: ${title}\nForrás leírás: ${snippet}`;
  try {
    const txt = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
    return limitToTwoSentences(txt);
  } catch {
    return "A megadott forrás alapján nem egyértelmű a válasz.";
  }
}

/* ================= FX ================= */
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

/* ================= Weather ================= */
function stripHungarianCase(word) {
  const w = normalizeHu(word);
  return w.replace(/[-\s]+/g, " ")
          .replace(/(?:ban|ben|ba|be|ra|re|rol|ról|ről|tol|től|nak|nek|on|en|ön|n|hoz|hez|höz|ig|val|vel|ként|nál|nél)$/u, "");
}
function extractCityGuess(q) {
  const s = normalizeHu(q).replace(/[^\p{L}\s-]/gu, " ").trim();
  const stop = new Set([
    "milyen","az","idojaras","elorejelzes","van","lesz","ma","holnap","heti","magyarorszagon","magyarorszag","ido","idoben","ott","itt","most"
  ]);
  const tokens = s.split(/\s+/).filter(t => t && t.length >= 3 && !stop.has(t));
  if (!tokens.length) return null;
  let cand = stripHungarianCase(tokens[tokens.length - 1]);

  const map = {
    "szabolcsbáka":"Szabolcsbáka",
    "szabolcsbaka":"Szabolcsbáka",
    "szabolcs-baka":"Szabolcsbáka",
    "bp":"Budapest",
    "pest":"Budapest"
  };
  if (map[cand]) return map[cand];
  return cand.charAt(0).toUpperCase() + cand.slice(1);
}
async function geocode(name) {
  if (!name) return null;
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
  const stop = new Set(["ők","ok","azok","ezek","azt","ezt","mert","és","de","vagy","hogy","is","mi","milyen","hogyan","akkor","igen","nem","hadban","állnak","egymással","holnap","ma"]);
  const content = tokens.filter(t => !(stop.has(t) || t.length <= 2));
  const hasEntity = /[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/.test(q);
  return content.length === 0 || (!hasEntity && tokens.length <= 4);
}
async function getWeather(q, preferredCity) {
  try {
    let guess = preferredCity || extractCityGuess(q) || null;
    let loc = guess ? await geocode(guess) : null;
    if (!loc && guess && !/hungary|magyar/i.test(guess)) loc = await geocode(`${guess}, Hungary`);
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
    const baseInfo = {
      shortName: loc.name,
      name: `${loc.name}${loc.country ? `, ${loc.country}` : ""}`,
      dateLabel: wantTomorrow ? "holnap" : "ma",
      sourceUrl: wxUrl.toString()
    };
    if (!wxres.ok) return { ...baseInfo, tMin: null, tMax: null, pop: null };

    const wx = await wxres.json();
    const d = wx?.daily;
    const idx = wantTomorrow && d?.time?.length > 1 ? 1 : 0;

    return {
      ...baseInfo,
      tMin: d?.temperature_2m_min?.[idx] ?? null,
      tMax: d?.temperature_2m_max?.[idx] ?? null,
      pop: typeof d?.precipitation_probability_max?.[idx] === "number" ? d.precipitation_probability_max[idx] : null
    };
  } catch {
    return null;
  }
}

/* ================= Vision (képértés) ================= */
function stripDataUrlPrefix(b64){
  if (typeof b64 !== "string") return "";
  const m = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  return m ? m[0] : `data:image/jpeg;base64,${b64}`; // ha nem teljes dataURL, egészítjük
}
async function analyzeImage(imageBase64OrDataUrl, promptText){
  try{
    const dataUrl = stripDataUrlPrefix(imageBase64OrDataUrl);
    const userPrompt = (promptText && promptText.trim())
      ? promptText.trim()
      : "Rovid magyar leiras kerem: mi lathato a kepen? (max 2 mondat)";

    const messages = [{
      role: "user",
      content: [
        { type: "input_text", text: userPrompt },
        { type: "input_image", image_url: dataUrl }
      ]
    }];

    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages
    });
    return r.choices?.[0]?.message?.content?.trim() || "";
  }catch(e){
    console.error("[vision] error:", e);
    return "";
  }
}
