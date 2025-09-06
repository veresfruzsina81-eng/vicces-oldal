// === Tamás AI – Komplex asszisztens motor ====================================
// - Intent Router + bizalmi pontszám (SAFE MODE)
// - Kontextus-memória: last_person, last_city, last_topic
// - Web pipeline: Google CSE -> whitelist -> párhuzamos letöltés -> cheerio kinyerés
//   - Névsor (résztvevők/versenyzők)
//   - Menetrend/dátumok
//   - Rövid összefoglaló több forrásból
// - AI-only fallback rövid, emberi stílusban
// - Minőség-ellenőrzés (LLM judge)
// - Képértés (vision)
// - Barátságos, természetes köszönés (NEM „rövid válaszokat adok”)
// ============================================================================
import OpenAI from "openai";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =================== BEÁLLÍTÁSOK =================== */
const SAFE_MODE = true;          // konzervatív döntések
const SUPER_MODE = true;         // generikus kérdésnél is próbáljon netet használni
const INTENT_MIN_CONF = 0.60;    // ez alatti biztonságnál inkább visszakérdez
const MAX_IMAGE_BYTES = 2_000_000; // ~2 MB

// Web keresés whitelist (megbízható magyar források)
const WL = new Set([
  "rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu",
  "nso.hu","nemzetisport.hu"
]);

/* =================== EGYSZERŰ CACHE =================== */
// In-memory (Netlify function cold start esetén nullázódhat, de így is sokat segít)
const cache = new Map(); // kulcs: string -> { until:number, value:any }
function cacheGet(key){
  const it = cache.get(key);
  if (!it) return null;
  if (Date.now() > it.until) { cache.delete(key); return null; }
  return it.value;
}
function cacheSet(key, value, ttlMs=10*60*1000){ // 10 perc alap
  cache.set(key, { until: Date.now() + ttlMs, value });
}

/* =================== HANDLER =================== */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors() };

  try {
    let { message = "", context = {}, image = null } = JSON.parse(event.body || "{}");
    let question = (message || "").trim();

    if (!question && !image) return json({ error: "Üres üzenet." }, 400);

    // Kontextus
    const ctx = {
      last_intent: context.last_intent || null,
      last_city:   context.last_city   || null,
      last_topic:  context.last_topic  || null,
      last_person: context.last_person || null
    };

    /* ===== 0/a) Személynév kontextus (pl. "Cristiano Ronaldo" → "hány éves?") ===== */
    if (question) {
      const nameMatch = question.match(/\b([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)+)\b/);
      if (nameMatch) {
        ctx.last_person = nameMatch[1].trim();           // mentjük az aktuális nevet
      } else if (ctx.last_person && isVagueFollowUp(question)) {
        question = `${ctx.last_person} ${question}`;     // egészítjük a homályos kérdést
      }
    }

    /* ===== 0/b) Kép-ág (vision) ===== */
    if (image) {
      const len = typeof image === "string" ? image.length : 0;
      const approxBytes = Math.ceil((len * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return json({
          ok: false,
          question: "[kép]" + (question ? ` + "${question}"` : ""),
          answer: "A kép túl nagy a feldolgozáshoz. Kérlek küldd kisebb méretben (kb. 2 MB alatt).",
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
      if (!question) {
        return json({
          ok: true,
          question: "[kép]",
          answer: "Szép kép! 🙂 Most nem sikerült részletesen elemeznem, próbáld újra picit kisebb méretben.",
          meta: { ...ctx, last_intent: "vision" }
        });
      }
    }

    /* ===== 0/c) Smalltalk / köszönés (természetes) ===== */
    if (isGreeting(question)) {
      return json({
        ok: true,
        question,
        answer: "Szia! Itt vagyok — kérdezz bármiről. Ha friss infó kell, megnézem több megbízható forrásban is.",
        meta: { ...ctx, smalltalk: true }
      });
    }
    if (isSmalltalk(question)) {
      return json({
        ok: true,
        question,
        answer: "Itt vagyok és figyelek. Miről szeretnél többet tudni?",
        meta: { ...ctx, smalltalk: true }
      });
    }

    /* ===== 1) Készítő ===== */
    if (isOwnerQuestion(question)) {
      return json({
        ok: true,
        question,
        answer: "Az oldalt Horváth Tamás készítette Szabolcsbákán. Ha technikai kérdésed van, nyugodtan írd meg.",
        meta: { ...ctx, last_intent: "owner" }
      });
    }

    /* ===== 2) Intent detektálás + bizalom ===== */
    let intent = detectIntentRules(question);
    if (intent === "generic") {
      try {
        const llmIntent = await classifyIntentLLM(question);
        if (llmIntent) intent = llmIntent;
      } catch {}
    }

    // Generikus „aktuális” jel → netezzen
    if (intent === "generic" && wantsWeb(question)) intent = "news";

    // Erős híres jel → témaváltás (ne ragadjunk weather-ben)
    if (hasStrongNewsSignal(question) && intent !== "weather") {
      ctx.last_city = null;
      ctx.last_intent = "news";
      intent = "news";
    }

    // SAFE MODE: intent bizalom és óvatos öröklés
    const conf = SAFE_MODE ? intentConfidence(question) : 1;
    if (SAFE_MODE) {
      const strongNews = hasStrongNewsSignal(question);
      const strongWeather = hasStrongWeatherSignal(question);

      if (conf < INTENT_MIN_CONF && !strongNews && !strongWeather) {
        const cq = await buildClarifyingQuestion(question);
        return json({
          ok: true,
          question,
          answer: cq || "Nem teljesen világos, mire gondolsz. Egy szóval pontosítod? 🙂",
          meta: { ...ctx, last_intent: "clarify" }
        });
      }

      if (isVagueFollowUp(question)) {
        if (strongNews) intent = "news";
        else if (strongWeather && ctx.last_city) intent = "weather";
        else if (conf < INTENT_MIN_CONF) {
          const cq = await buildClarifyingQuestion(question);
          return json({
            ok: true, question,
            answer: cq || "Mire gondolsz pontosan? 🙂",
            meta:{...ctx, last_intent:"clarify"}
          });
        }
      }
    }

    // Személy + ténykérdés → AI-only (stabil, rövid)
    if (ctx.last_person && isPersonFactoid(question)) {
      const text = await answerShortDirect(`${ctx.last_person} ${question}`);
      const checked = await qualityCheck(question, text);
      const finalAns = limitToTwoSentences(mergeQuality(text, checked));
      return json({
        ok:true, question,
        answer: finalAns,
        meta:{ ...ctx, last_intent:"ai-only", last_topic: ctx.last_person }
      });
    }

    /* ===== 3) FRISS ADAT ÁGAK ===== */

    // 3/a FX
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
      return json({ ok: true, question, answer: "Most nem érem el az árfolyam API-t. Próbáld kicsit később.", meta: ctx });
    }

    // 3/b Weather — soha ne defaultoljon „Budapestre” biztos jel nélkül
    if (intent === "weather") {
      const guessCity = extractCityGuess(question) || ctx.last_city || null;
      if (!guessCity) {
        return json({
          ok: true,
          question,
          answer: "Melyik városra nézzük az időjárást? (pl. Szeged, Debrecen, London) 🙂",
          meta: { ...ctx, last_intent: "clarify-weather" }
        });
      }
      const wx = await getWeather(question, guessCity);
      ctx.last_intent = "weather";
      if (wx?.name) {
        const tMin = wx.tMin != null ? Math.round(wx.tMin) : "—";
        const tMax = wx.tMax != null ? Math.round(wx.tMax) : "—";
        const rain = wx.pop != null ? `, csapadék esély ~${wx.pop}%` : "";
        const answer =
          `${wx.name} (${wx.dateLabel}): ${tMin}–${tMax}°C${rain}.\n\n` +
          `Forrás: open-meteo.com\nhttps://open-meteo.com/`;
        ctx.last_city = wx.shortName || guessCity || ctx.last_city || null;
        ctx.last_topic = ctx.last_city;
        return json({
          ok: true, question, answer,
          meta: { ...ctx, suggest: "Érdekel az órás bontás is, vagy másik város?" }
        });
      }
      return json({ ok: true, question, answer: "Most nem sikerült időjárási adatot lekérni. Nézzük meg egy másik városra?", meta: ctx });
    }

    // 3/c News – „minden erejével” web pipeline
    if (intent === "news" || (SUPER_MODE && intent === "generic")) {
      const wantsList = /\b(résztvevők|nevsor|névsor|versenyzők|versenyzok|szereplők|szereplok)\b/i.test(question);
      const wantsSchedule = /\b(menetrend|időpont|idopont|datum|dátum|mikor|műsor|musor)\b/i.test(question);

      const richKey = `web:${normalizeHu(question)}:${wantsList}:${wantsSchedule}`;
      const cached = cacheGet(richKey);
      if (cached) {
        return json({ ok:true, question, answer: cached, meta:{...ctx, last_intent:"news", cached:true } });
      }

      const rich = await webAnswerAggressive(question, {needList:wantsList, needSchedule:wantsSchedule});
      if (rich) {
        const checked = await qualityCheck(question, rich);
        const finalAns = mergeQuality(rich, checked);
        cacheSet(richKey, finalAns, 12*60*1000); // 12 perc cache
        return json({ ok:true, question, answer: finalAns, meta: { ...ctx, last_intent:"news" } });
      }

      // fallback: snippet összefoglaló 1 linkkel
      const best = await safeSearchBest(question);
      ctx.last_intent = "news";
      ctx.last_topic = keywordsForContext(question);
      if (best) {
        const text = await answerFromSnippet(question, best.title, best.snippet);
        const ans = `${limitToTwoSentences(text)}\n\nForrás: ${hostname(best.link)}\n${best.link}`;
        const checked = await qualityCheck(question, ans);
        const finalAns = mergeQuality(ans, checked);
        return json({
          ok: true, question, answer: finalAns,
          meta: { ...ctx, source: best.link, suggest: "Szeretnéd a részleteket vagy másik forrást?" }
        });
      }
      return json({
        ok: true,
        question,
        answer: "Most nem találtam elég megbízható forrást. Egy kulcsszóval pontosítod? 🙂",
        meta: ctx
      });
    }

    /* ===== 4) AI-only ===== */
    const text = await answerShortDirect(question);
    const checked = await qualityCheck(question, text);
    const finalAns = limitToTwoSentences(mergeQuality(text, checked));
    return json({
      ok: true,
      question,
      answer: finalAns,
      meta: { ...ctx, last_intent: "ai-only", suggest: await buildFollowupSuggestion(question) }
    });

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
function deburrHu(s){
  return (s||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/ő/g,"o").replace(/ű/g,"u")
    .replace(/Ő/g,"O").replace(/Ű/g,"U");
}

/* ===== intent bizalom ===== */
function intentConfidence(q){
  const s = normalizeHu(q);
  let c = 0;
  if (/\b(árfolyam|eur|euro|eu|usd|gbp|chf|pln|ron|huf|forint)\b/.test(s)) c += 0.6; // FX
  if (/\b(időjárás|idojaras|előrejelzés|elorejelzes|hőmérséklet|homerseklet|eső|eso|holnap|ma)\b/.test(s)) c += 0.6; // Weather
  if (/\b(rtl|sztárbox|sztarbox|x-faktor|xfaktor|ukrajna|oroszország|breaking|friss|menetrend|névsor|nevsor|2025|ma|tegnap|most)\b/.test(s)) c += 0.6; // News
  if (/\b[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/.test(q)) c += 0.15;
  if (/\d{4}/.test(q)) c += 0.1;
  return Math.min(1, c);
}
function wantsWeb(q){
  const s = normalizeHu(q);
  return /\b(ma|tegnap|most|friss|legújabb|breaking|202\d|menetrend|időpont|dátum|névsor|résztvevők|ki nyert|állás)\b/.test(s);
}

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
function mergeQuality(answer, qc){
  const note = (qc||"").trim();
  if (!note) return answer;
  if (/bizonytalan|ellentmond|óvatos|lehetnek változások/i.test(note)) {
    return `${answer}\n\nMegjegyzés: ${note}`;
  }
  return answer;
}

/* ================= Intent / jelek ================= */
function detectIntentRules(q) {
  const s = normalizeHu(q);

  // --- FX: engedékeny rövid kérdésekre is ---
  const hasArfolyam = /\bárfolyam\b/.test(s);
  const rawTokens = s.split(/\s+/).filter(Boolean);
  const tokens = rawTokens.map(deburrTokenHu);
  const ccy = new Set(["eur","euro","usd","gbp","chf","pln","ron","huf","forint","eu"]);
  const hasCcy = tokens.some(t => ccy.has(t)) || /\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/i.test(q);
  if (hasArfolyam || hasCcy) return "fx";

  // --- Weather ---
  const weatherPatterns = [/\bidőjárás\b/, /\belőrejelzés\b/, /\bweather\b/, /\bhőmérséklet\b/, /\bholnap\b/];
  if (weatherPatterns.some(rx => rx.test(s))) return "weather";

  // --- News ---
  if (/\b(rtl|sztárbox|sztarbox|sztár box|résztvevők|névsor|versenyzők|hír|breaking|friss|202\d|ukrajna|oroszország|x-faktor|xfaktor|menetrend|ma|tegnap|most)\b/.test(s))
    return "news";

  return "generic";
}
function deburrTokenHu(t){
  return (t||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/ő/g,"o").replace(/ű/g,"u")
    .replace(/(?:nal|nel|ban|ben|ba|be|ra|re|rol|rol|tol|tol|nak|nek|on|en|on|n|hoz|hez|hoz|ig|val|vel|kent|nal|nel)$/,"");
}
function hasStrongNewsSignal(q){
  const s = normalizeHu(q);
  return /\b(sztárbox|sztarbox|x-faktor|xfaktor|rtl|versenyzők|nevsor|névsor|menetrend|202\d|casting|resztvevok|résztvevők)\b/.test(s);
}
function hasStrongWeatherSignal(q){
  const s = normalizeHu(q);
  return /\b(időjárás|idojaras|előrejelzés|elorejelzes|hőmérséklet|homerseklet|szél|szel|eső|eso)\b/.test(s);
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
function isVagueFollowUp(q){
  const s = normalizeHu(q).replace(/[^\p{L}\p{N}\s]/gu," ").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const stop = new Set(["ők","ok","azok","ezek","azt","ezt","mert","és","de","vagy","hogy","is","mi","milyen","hogyan","akkor","igen","nem","hadban","állnak","egymással","holnap","ma"]);
  const content = tokens.filter(t => !(stop.has(t) || t.length <= 2));
  const hasEntity = /[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/.test(q);
  return content.length === 0 || (!hasEntity && tokens.length <= 4);
}
function isPersonFactoid(q){
  const s = normalizeHu(q);
  return /\b(hány éves|mikor született|milyen magas|hol játszik|milyen poszt)\b/.test(s);
}

/* ================= Visszakérdezés / javaslat / QC ================= */
async function buildClarifyingQuestion(userText){
  const sys = "Fogalmazz 1 rövid, barátságos pontosító kérdést magyarul a felhasználónak.";
  const u   = `Felhasználó: ${userText}`;
  try { return await ask([{role:"system",content:sys},{role:"user",content:u}]); }
  catch { return ""; }
}
async function buildFollowupSuggestion(userText){
  const sys = "Adj 1 rövid javaslatot (max 12 szó), hogy mit kérdezhet legközelebb — magyarul.";
  const u   = `Felhasználó kérdése: ${userText}`;
  try { return await ask([{role:"system",content:sys},{role:"user",content:u}]); }
  catch { return ""; }
}
async function qualityCheck(question, draftAnswer){
  const sys = "Ellenőrizd röviden: a válasz állításai nincsenek-e ellentmondásban a kérdéssel; ha bizonytalan vagy változhat, jelezd 1 rövid mondattal.";
  const msg = [{role:"system", content: sys}, {role:"user", content: `Kérdés: ${question}\nVálasz: ${draftAnswer}`}];
  try { return await ask(msg); } catch { return ""; }
}

/* ================= AI-only ================= */
async function answerShortDirect(question) {
  const sys = "Adj magyarul maximum 2 mondatos, világos és emberi választ. Ne adj linket vagy forrást.";
  const user = `Kérdés: ${question}`;
  try {
    return await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  } catch {
    return "Most nem tudok részletesen válaszolni.";
  }
}

/* ================= SAFE böngészés + AGGRESSZÍV WEB PIPELINE ================= */
function extractKeywordsHu(q){
  const stop = new Set(["a","az","és","vagy","hogy","mert","is","van","volt","lesz","itt","ott","mi","mit","mikor","hol","melyik","kik","között","közül","sztár","box","ma","holnap","tegnap","most"]);
  return normalizeHu(q)
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stop.has(w));
}
function isShowbiz(q){
  const s = normalizeHu(q);
  return /\b(sztárbox|sztarbox|x-faktor|xfaktor|rtl|casting|névsor|nevsor|menetrend)\b/.test(s);
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
  const isSb = isShowbiz(question);
  url.searchParams.set("dateRestrict", `d${isSb ? 60 : (looksFresh(question) ? 7 : 14)}`);

  const res = await fetch(url);
  if (!res.ok) { console.error("[search] http", res.status, await res.text()); return null; }
  const data = await res.json();
  let items = (data.items || [])
    .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
    .filter(it => isValidHttpUrl(it.link));

  // Magyar whitelist
  items = items.filter(it => WL.has(hostname(it.link)));

  const kws = extractKeywordsHu(question);
  const kwSet = new Set(kws);
  const kwHits = (text) => {
    const s = normalizeHu(text);
    let hits = 0; for (const k of kwSet) if (k && s.includes(k)) hits++; return hits;
  };

  const preferRtl = /(^|\s)rtl(\s|\.|$)/i.test(question) || /sztárbox|sztarbox|x-faktor|xfaktor/i.test(question);
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
    const firstWL = (data.items || []).find(i => WL.has(hostname(i.link)));
    if (firstWL) return firstWL;
    return null; // inkább kérjen pontosítást, mint kétes link
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

/* ===== Web pipeline: keresés + letöltés + kinyerés több forrásból ===== */
async function webAnswerAggressive(query, {needList=false, needSchedule=false} = {}){
  const key = process.env.GOOGLE_API_KEY || process.env.Google_API_KEY;
  const cx  = process.env.GOOGLE_CX      || process.env.Google_CX;
  if (!key || !cx) return null;

  // keresés (10 találat), whitelist-szűrés
  const hits = await safeSearch(query);
  const items = (hits||[]).filter(h => WL.has(host(h.link))).slice(0,5);
  if (!items.length) return null;

  // letöltés párhuzamosan
  const limit = pLimit(3);
  const pages = (await Promise.all(items.map(it => limit(()=> fetchHtml(it.link)
      .then(html => ({...it, html})).catch(()=>null)
  )))).filter(Boolean);

  // kinyerés több cikkből
  let facts = { names: new Set(), dates: new Set(), bullets: [] };
  for (const p of pages){
    const ex = extractFromHtml(p.html, p.link, {needList, needSchedule});
    ex.names?.forEach(n => facts.names.add(n));
    ex.dates?.forEach(d => facts.dates.add(d));
    if (ex.bullets?.length) facts.bullets.push(...ex.bullets);
  }
  const names = Array.from(facts.names).slice(0,16);
  const dates = Array.from(facts.dates).slice(0,4);

  if (needList && names.length){
    const list = names.map(n=>"• "+n).join("\n");
    const src = pages.find(p => p.link.includes("rtl.hu"))?.link || pages[0].link;
    return `${list}\n\nForrás: ${host(src)}\n${src}`;
  }
  if (needSchedule && dates.length){
    const src = pages.find(p => p.link.includes("rtl.hu"))?.link || pages[0].link;
    return `Következő időpont(ok): ${dates.join(", ")}.\n\nForrás: ${host(src)}\n${src}`;
  }

  // általános rövid válasz (2 mondat + 1 link)
  const best = pages.find(p => p.link.includes("rtl.hu")) || pages[0];
  const two = (facts.bullets||[]).slice(0,2).map(s => s.replace(/\s+/g," ").trim()).filter(Boolean).join(" ");
  return `${two || "A források alapján röviden összefoglaltam a lényeget."}\n\nForrás: ${host(best.link)}\n${best.link}`;
}

/* ---- segédek a pipeline-hoz ---- */
function host(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch{ return ""; } }
async function safeSearch(q){
  const key = process.env.GOOGLE_API_KEY || process.env.Google_API_KEY;
  const cx  = process.env.GOOGLE_CX      || process.env.Google_CX;
  if(!key||!cx) return [];
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key); url.searchParams.set("cx", cx);
  url.searchParams.set("q", q); url.searchParams.set("num","10");
  url.searchParams.set("safe","active"); url.searchParams.set("hl","hu"); url.searchParams.set("gl","hu"); url.searchParams.set("lr","lang_hu");
  const r = await fetch(url); if(!r.ok) return [];
  const d = await r.json(); return (d.items||[]).map(it=>({title:it.title||"", snippet:it.snippet||"", link:it.link||""}));
}
async function fetchHtml(url){ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}}); if(!r.ok) throw 0; return await r.text(); }

/* ===== HTML kinyerők ===== */
const NAME_HINTS = /(résztvevők|névsor|nevsor|versenyzők|versenyzok|szereplők|szereplok)/i;
const DATE_HINTS = /(időpont|menetrend|dátum|datum|kezdet|start|mikor|aug|szept|okt|nov|dec|202\d)/i;

function extractFromHtml(html, url, {needList=false, needSchedule=false}={}){
  const $ = cheerio.load(html);
  const names = new Set();
  const dates = new Set();
  const bullets = [];

  // névsor
  if (needList){
    $('h1,h2,h3,h4,h5,h6,p,strong,b').each((_,el)=>{
      const t=$(el).text().trim();
      if (NAME_HINTS.test(t)){
        let blk=$(el).next();
        for(let i=0;i<8 && blk.length;i++){
          blk.find('li,strong,b').each((_,n)=>{
            const s=$(n).text().replace(/\s+/g,' ').trim();
            if (looksLikeName(s)) names.add(cleanName(s));
          });
          const para=blk.text().replace(/\s+/g,' ').trim();
          para.split(/[;,]/).forEach(x=>{const s=x.trim(); if(looksLikeName(s)) names.add(cleanName(s));});
          blk=blk.next();
        }
      }
    });
    if (!names.size){
      $('li').each((_,li)=>{ const s=$(li).text().replace(/\s+/g,' ').trim(); if (looksLikeName(s)) names.add(cleanName(s)); });
    }
  }

  // dátum/menetrend
  if (needSchedule){
    $('time').each((_,t)=>{ const d=$(t).attr('datetime')||$(t).text(); addDate(d); });
    $('p,li,span,strong,b,h2,h3').each((_,el)=>{
      const txt=$(el).text().replace(/\s+/g,' ').trim();
      if (DATE_HINTS.test(txt)) txt.match(/\b(202\d\.\s*\d{1,2}\.\s*\d{1,2}|202\d[-\/.]\d{1,2}[-\/.]\d{1,2}|augusztus\s+\d+|szeptember\s+\d+|október\s+\d+)\b/ig)
        ?.forEach(addDate);
    });
  }

  // általános: első bekezdések/alcímek
  $('p').slice(0,3).each((_,p)=>{ const t=$(p).text().replace(/\s+/g,' ').trim(); if(t) bullets.push(t); });

  return { names, dates, bullets };

  function addDate(s){ const t=(s||"").replace(/\s+/g,' ').trim(); if(t) dates.add(t); }
  function looksLikeName(s){
    const x=s.replace(/\(.*?\)|\d+\.?/g,'').trim(); const w=x.split(/\s+/).filter(Boolean);
    if(w.length<1||w.length>5) return false; const caps=w.filter(y=>/^[A-ZÁÉÍÓÖŐÚÜŰ]/.test(y));
    return caps.length>=Math.max(1,Math.round(w.length*0.6));
  }
  function cleanName(s){ return s.replace(/[-–—]\s*.*/,'').replace(/\s{2,}/g,' ').replace(/^\d+\.\s*/,'').trim(); }
}

/* ================= FX ================= */
async function getFxRate(q) {
  try {
    let S = q.toUpperCase().replace(/[.,]/g, " ");
    S = S.replace(/\bEU\b/g,"EUR").replace(/\bEURO?\b/g,"EUR"); // "eu árfolyam", "euró" → EUR
    let from = "EUR", to = "HUF";

    const mPair  = S.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/);
    const mWords = S.match(/\b(EUR|USD|GBP|CHF|PLN|RON)\b.*\b(HUF|EUR|USD|GBP|CHF|PLN|RON)\b/);

    if (mPair) { from = mPair[1]; to = mPair[2]; }
    else if (mWords && mWords[1] !== mWords[2]) { from = mWords[1]; to = mWords[2]; }
    else if (/(eur|euro|euró|eu)/i.test(q) && /(huf|forint)/i.test(q)) { from = "EUR"; to = "HUF"; }
    else if (/usd/i.test(q) && /(forint|huf)/i.test(q)) { from = "USD"; to = "HUF"; }

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
  const raw = (q||"").trim();
  const s = deburrHu(normalizeHu(raw)).replace(/[^\p{L}\s-]/gu, " ").trim();
  const stop = new Set([
    "milyen","az","idojaras","elorejelzes","van","lesz","ma","holnap","heti",
    "magyarorszagon","magyarorszag","ido","idoben","ott","itt","most","?","!"
  ]);
  const tokens = s.split(/\s+/).filter(t => t && t.length >= 3 && !stop.has(t));
  if (!tokens.length) return null;
  let cand = stripHungarianCase(tokens[tokens.length - 1]);

  const map = {
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
async function getWeather(q, preferredCity) {
  try {
    let guess = preferredCity || extractCityGuess(q) || null;
    if (!guess) return null;

    let loc = await geocode(guess);
    if (!loc && guess && !/hungary|magyar/i.test(guess)) loc = await geocode(`${guess}, Hungary`);
    if (!loc) return null; // ne defaultoljon Budapestre

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
      sourceUrl: "https://open-meteo.com/"
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
  return m ? m[0] : `data:image/jpeg;base64,${b64}`;
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
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: dataUrl } }
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
