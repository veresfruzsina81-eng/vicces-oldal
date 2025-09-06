// netlify/functions/chat.js
// Rövid, okosított asszisztens: AI + friss adat (árfolyam, időjárás, hírek 1 megbízható forrás)
// Stabilitás: http/https guard, időkorlátos fetch, barátságos fallback (ne legyen 502)

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- beállítások ---
const FETCH_TIMEOUT = 7000;              // ms – rövid, hogy ne fusson ki Netlify időből
const MAX_IMAGE_BYTES = 2_000_000;       // ~2MB
const NEWS_WHITELIST = new Set(["rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu"]);

// ===== HTTP segédek (bombabiztos) =====
function isHttpUrl(u){
  try { const p=new URL(u); return p.protocol==="http:"||p.protocol==="https:"; }
  catch { return false; }
}
function fetchWithTimeout(url, {timeoutMs=FETCH_TIMEOUT, headers={}} = {}){
  if (!isHttpUrl(url)) return Promise.resolve(null);
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), timeoutMs);
  return fetch(url, { headers, signal: ctrl.signal })
    .then(r => (r && r.ok ? r : null))
    .catch(() => null)
    .finally(() => clearTimeout(id));
}
async function fetchJson(url, opts){ const r = await fetchWithTimeout(url, opts); if(!r) return null; try{ return await r.json(); }catch{return null;} }

// ===== Közművek =====
function normalizeHu(s){ return (s||"").toLowerCase().normalize("NFC"); }
function json(body, statusCode=200){
  return { statusCode, headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}, body: JSON.stringify(body,null,2) };
}
function isGreeting(q){
  const s=normalizeHu(q).trim();
  return ["szia","hali","helló","hello","üdv","jó napot","jó estét","jó reggelt"].some(p=>s.startsWith(p));
}
async function ask(messages){
  const r = await openai.chat.completions.create({ model:"gpt-4o-mini", temperature:0.2, messages });
  return r.choices?.[0]?.message?.content?.trim() || "";
}

// ===== Intent (egyszerű) =====
function detectIntent(q){
  const s = normalizeHu(q);
  if (/\b(árfolyam|euró|euro|eur|usd|gbp|chf|pln|ron|huf|forint)\b/.test(s)) return "fx";
  if (/\b(időjárás|idojaras|hőmérséklet|homerseklet|weather|előrejelzés|elorejelzes|holnap|ma)\b/.test(s)) return "weather";
  if (/\b(hír|hirek|friss|breaking|sztárbox|sztarbox|x-faktor|xfaktor|rtl|menetrend|névsor|nevsor|mikor)\b/.test(s)) return "news";
  return "ai";
}

// ====== Árfolyam (Frankfurter) ======
async function getFx(q){
  try{
    let from="EUR", to="HUF";
    const S = q.toUpperCase().replace(/[.,]/g," ");
    const mPair  = S.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/);
    const mWords = S.match(/\b(EUR|USD|GBP|CHF|PLN|RON|HUF)\b.*\b(EUR|USD|GBP|CHF|PLN|RON|HUF)\b/);
    if (mPair) { from=mPair[1]; to=mPair[2]; }
    else if (mWords && mWords[1]!==mWords[2]) { from=mWords[1]; to=mWords[2]; }
    else if (/(eur|euro|euró|eu)/i.test(q) && /(huf|forint)/i.test(q)) { from="EUR"; to="HUF"; }

    const url = new URL("https://api.frankfurter.app/latest");
    url.searchParams.set("from",from); url.searchParams.set("to",to);
    const d = await fetchJson(url.toString());
    const rate = d?.rates?.[to]; if (!rate) return null;
    return { pair:`${from}/${to}`, rate:Number(rate), date:d.date, source:url.toString() };
  }catch{ return null; }
}

// ====== Időjárás (Open-Meteo geocoding + forecast) ======
async function geocode(city){
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", city); u.searchParams.set("count","1"); u.searchParams.set("language","hu");
  const d = await fetchJson(u.toString()); return d?.results?.[0] || null;
}
function extractCity(q){
  const m = q.match(/([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű\- ]{2,})/u);
  if (!m) return null;
  const base = m[1].trim();
  const map = { "Szabolcs":"Nyíregyháza", "bp":"Budapest", "Pest":"Budapest", "szabolcsbáka":"Szabolcsbáka" };
  return map[base] || base;
}
async function getWeather(q){
  try{
    const wantTomorrow = /\bholnap\b/i.test(q);
    const guess = extractCity(q) || "Budapest";
    const loc = await geocode(guess);
    if (!loc) return null;

    const wx = new URL("https://api.open-meteo.com/v1/forecast");
    wx.searchParams.set("latitude", String(loc.latitude));
    wx.searchParams.set("longitude", String(loc.longitude));
    wx.searchParams.set("daily","temperature_2m_min,temperature_2m_max,precipitation_probability_max");
    wx.searchParams.set("timezone", loc.timezone || "Europe/Budapest");
    wx.searchParams.set("forecast_days", wantTomorrow ? "2":"1");

    const d = await fetchJson(wx.toString());
    const idx = wantTomorrow && d?.daily?.time?.length>1 ? 1 : 0;
    return {
      name: `${loc.name}${loc.country?`, ${loc.country}`:""}`,
      label: wantTomorrow ? "holnap" : "ma",
      tMin: d?.daily?.temperature_2m_min?.[idx],
      tMax: d?.daily?.temperature_2m_max?.[idx],
      pop:  d?.daily?.precipitation_probability_max?.[idx],
      source: "https://open-meteo.com/"
    };
  }catch{ return null; }
}

// ====== Hírek (Google CSE → 1 jó találat, óvatos válasz snippetből) ======
function host(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch{ return ""; } }
async function googleBest(q){
  const key = process.env.GOOGLE_API_KEY || process.env.Google_API_KEY;
  const cx  = process.env.GOOGLE_CX      || process.env.Google_CX;
  if (!key || !cx) return null;

  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", key); u.searchParams.set("cx", cx);
  u.searchParams.set("q", q); u.searchParams.set("num","8");
  u.searchParams.set("safe","active"); u.searchParams.set("hl","hu"); u.searchParams.set("gl","hu"); u.searchParams.set("lr","lang_hu");

  const d = await fetchJson(u.toString());
  if (!d?.items?.length) return null;

  const items = d.items
    .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
    .filter(it => isHttpUrl(it.link) && NEWS_WHITELIST.has(host(it.link)));

  // pick first good item
  return items[0] || null;
}
async function newsAnswer(q){
  try{
    const best = await googleBest(q);
    if (!best) return null;
    // óvatos 2 mondatos válasz csak a snippet alapján
    const sys = "Válaszolj magyarul max 2 mondatban, kizárólag a megadott cím+snippet alapján. Ne találj ki új tényt.";
    const user = `Kérdés: ${q}\nCím: ${best.title}\nLeírás: ${best.snippet}`;
    const txt = await ask([{role:"system",content:sys},{role:"user",content:user}]);
    return `${txt}\n\nForrás: ${host(best.link)}\n${best.link}`;
  }catch{ return null; }
}

// ====== Képelemzés ======
function stripDataUrl(b64){
  if (typeof b64 !== "string") return "";
  const m = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  return m ? m[0] : `data:image/jpeg;base64,${b64}`;
}
async function analyzeImage(b64, prompt){
  try{
    const approxBytes = Math.ceil((b64.length*3)/4);
    if (approxBytes > MAX_IMAGE_BYTES) return "A kép túl nagy, kérlek 2 MB alatt küldd.";
    const messages = [{
      role:"user",
      content:[
        { type:"text", text: prompt?.trim() || "Mi látható a képen? (max 2 mondat)" },
        { type:"image_url", image_url:{ url: stripDataUrl(b64) } }
      ]
    }];
    const r = await openai.chat.completions.create({ model:"gpt-4o-mini", temperature:0.2, messages });
    return r.choices?.[0]?.message?.content?.trim() || "Szép kép! 🙂";
  }catch{ return "Most nem tudtam feldolgozni a képet."; }
}

// ====== FŐ HANDLER ======
export async function handler(event){
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" } };

  try{
    const { message="", image=null } = JSON.parse(event.body || "{}");
    const q = (message || "").trim();

    if (!q && !image) return json({ error:"Üres üzenet." }, 400);

    // Kép?
    if (image) {
      const desc = await analyzeImage(image, q);
      return json({ ok:true, question:q||"[kép]", answer: desc, meta:{ intent:"image" } });
    }

    // Köszönés
    if (isGreeting(q)) {
      return json({ ok:true, question:q, answer:"Szia! Itt vagyok — kérdezz bátran. Ha friss infó kell, gyorsan megnézem.", meta:{ intent:"greeting" }});
    }

    // Intent
    const intent = detectIntent(q);

    if (intent === "fx") {
      const fx = await getFx(q);
      if (fx?.rate){
        const [from,to] = fx.pair.split("/");
        return json({ ok:true, question:q, answer:`1 ${from} = ${fx.rate.toFixed(2)} ${to} (${fx.date}).\n\nForrás: frankfurter.app\n${fx.source}`, meta:{ intent:"fx" }});
      }
      return json({ ok:true, question:q, answer:"Most nem érem el az árfolyam API-t." });
    }

    if (intent === "weather") {
      const wx = await getWeather(q);
      if (wx?.name && wx.tMin!=null && wx.tMax!=null){
        const rain = typeof wx.pop==="number" ? `, csapadék esély ~${wx.pop}%` : "";
        return json({ ok:true, question:q, answer:`${wx.name} (${wx.label}): ${Math.round(wx.tMin)}–${Math.round(wx.tMax)}°C${rain}.\n\nForrás: open-meteo.com\n${wx.source}`, meta:{ intent:"weather" }});
      }
      return json({ ok:true, question:q, answer:"Most nem sikerült időjárási adatot lekérni." });
    }

    if (intent === "news") {
      const ans = await newsAnswer(q);
      if (ans) return json({ ok:true, question:q, answer: ans, meta:{ intent:"news" }});
      return json({ ok:true, question:q, answer:"Most nem találtam elég megbízható friss találatot." });
    }

    // AI-only (rövid)
    const sys = "Adj magyarul max 2 mondatos, világos és barátságos választ. Ne adj linket.";
    const txt = await ask([{role:"system",content:sys},{role:"user",content:q}]);
    return json({ ok:true, question:q, answer: txt || "Most nem tudok részletes választ adni." , meta:{ intent:"ai" }});

  }catch(err){
    console.error("[chat fatal]", err);
    // NE dobjunk 502-t: mindig 200-zal válaszolunk rövid hibával
    return json({ ok:false, answer:"Sajnálom, váratlan hiba történt. Próbáld meg újra kicsit később." }, 200);
  }
}
