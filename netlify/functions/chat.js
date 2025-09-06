// netlify/functions/chat.js
// Stabil + okosított asszisztens: AI + árfolyam + időjárás + hírek (2 forrás, safe) + kép + mini-memória
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ====== beállítások ====== */
const FETCH_TIMEOUT = 9000;                 // rövid, hogy ne fusson ki
const MAX_IMAGE_BYTES = 2_000_000;          // ~2MB
const NEWS_WHITELIST = new Set(["rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu"]);
const TODAY_ISO = new Date().toISOString().slice(0,10); // ma
const DOB_MAP = { "cristiano ronaldo":"1985-02-05" };

/* ====== util ====== */
function json(body, statusCode=200){
  return {
    statusCode,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type"
    },
    body: JSON.stringify(body,null,2)
  };
}
function normalizeHu(s){ return (s||"").toLowerCase().normalize("NFC"); }
function host(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch{ return ""; } }
function isHttpUrl(u){ try{ const p=new URL(u); return p.protocol==="http:"||p.protocol==="https:"; } catch{ return false; } }

function fetchWithTimeout(url, {timeoutMs=FETCH_TIMEOUT, headers={}} = {}){
  if (!isHttpUrl(url)) return Promise.resolve(null);
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), timeoutMs);
  return fetch(url, { headers, signal: ctrl.signal })
    .then(r => (r && r.ok ? r : null))
    .catch(() => null)
    .finally(() => clearTimeout(id));
}
async function fetchJson(url, opts){
  const r1 = await fetchWithTimeout(url, opts);
  if (r1) { try { return await r1.json(); } catch {} }
  const r2 = await fetchWithTimeout(url, opts);
  if (!r2) return null;
  try { return await r2.json(); } catch { return null; }
}

async function ask(messages){
  const r = await openai.chat.completions.create({ model:"gpt-4o-mini", temperature:0.2, messages });
  return r.choices?.[0]?.message?.content?.trim() || "";
}
function isGreeting(q){
  const s=normalizeHu(q).trim();
  return ["szia","hali","helló","hello","üdv","jó napot","jó estét","jó reggelt"].some(p=>s.startsWith(p));
}

function calcAge(dobIso, todayIso=TODAY_ISO){
  const [Y,M,D] = todayIso.split("-").map(n=>parseInt(n,10));
  const [y,m,d] = dobIso.split("-").map(n=>parseInt(n,10));
  let age = Y - y;
  if (M < m || (M===m && D < d)) age--;
  return age;
}

/* ====== intent ====== */
function detectIntent(q){
  const s = normalizeHu(q);
  if (/\b(árfolyam|euró|euro|eur|usd|gbp|chf|pln|ron|huf|forint)\b/.test(s)) return "fx";
  if (/\b(időjárás|idojaras|hőmérséklet|homerseklet|weather|előrejelzés|elorejelzes|holnap|ma)\b/.test(s)) return "weather";
  if (/\b(hír|hirek|friss|breaking|sztárbox|sztarbox|x-faktor|xfaktor|rtl|menetrend|névsor|nevsor|mikor|ki nyert)\b/.test(s)) return "news";
  return "ai";
}

/* ====== árfolyam ====== */
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

/* ====== időjárás (mini-memória) ====== */
function extractCity(q){
  const m = q.match(/([A-ZÁÉÍÓÖŐÚÜŰ][A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű\- ]{2,})/u);
  if (!m) return null;
  const base = m[1].trim();
  const map = { "Szabolcs":"Nyíregyháza", "bp":"Budapest", "Pest":"Budapest", "szabolcsbáka":"Szabolcsbáka" };
  return map[base] || base;
}
async function geocodeCity(name){
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", name); u.searchParams.set("count","1"); u.searchParams.set("language","hu");
  const d = await fetchJson(u.toString()); return d?.results?.[0] || null;
}
async function getWeather(q, context){
  try{
    const wantTomorrow = /\bholnap\b/i.test(q);
    let city = extractCity(q);
    if (!city && (/\b(ma|holnap)\b/i.test(q)) && context?.last_city) city = context.last_city; // mini memória

    city = city || "Budapest";
    const loc = await geocodeCity(city);
    if (!loc) return null;

    const wx = new URL("https://api.open-meteo.com/v1/forecast");
    wx.searchParams.set("latitude", String(loc.latitude));
    wx.searchParams.set("longitude", String(loc.longitude));
    wx.searchParams.set("daily","temperature_2m_min,temperature_2m_max,precipitation_probability_max");
    wx.searchParams.set("timezone", loc.timezone || "Europe/Budapest");
    wx.searchParams.set("forecast_days", wantTomorrow ? "2":"1");

    const d = await fetchJson(wx.toString());
    if (!d?.daily?.temperature_2m_min || !d?.daily?.temperature_2m_max) return null;
    const idx = wantTomorrow && d.daily.time?.length>1 ? 1 : 0;

    return {
      name: `${loc.name}${loc.country?`, ${loc.country}`:""}`,
      shortName: loc.name,
      label: wantTomorrow ? "holnap" : "ma",
      tMin: d.daily.temperature_2m_min[idx],
      tMax: d.daily.temperature_2m_max[idx],
      pop:  d.daily.precipitation_probability_max?.[idx],
      source: "https://open-meteo.com/"
    };
  }catch{ return null; }
}

/* ====== hírek: 2 forrásos „lite” aggregátor + szigorú snippet fallback ====== */
async function googleTop(q){
  const key = process.env.GOOGLE_API_KEY || process.env.Google_API_KEY;
  const cx  = process.env.GOOGLE_CX      || process.env.Google_CX;
  if (!key || !cx) return [];

  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", key); u.searchParams.set("cx", cx);
  u.searchParams.set("q", q); u.searchParams.set("num","10");
  u.searchParams.set("safe","active"); u.searchParams.set("hl","hu"); u.searchParams.set("gl","hu"); u.searchParams.set("lr","lang_hu");

  const d = await fetchJson(u.toString());
  if (!d?.items?.length) return [];
  return d.items
    .map(it => ({ title: it.title || "", snippet: it.snippet || "", link: it.link || "" }))
    .filter(it => isHttpUrl(it.link) && NEWS_WHITELIST.has(host(it.link)));
}

async function summarizeTwoSources(q){
  const hits = await googleTop(q);
  const items = hits.slice(0,2);
  if (!items.length) return null;

  // letöltés nélkül is elég: cím + snippet → LLM 2 mondat, mindkét forrás feltüntetése
  const pack = items.map(it => `Forrás: ${host(it.link)}\nCím: ${it.title}\nLeírás: ${it.snippet}`).join("\n---\n");
  const sys = "Válaszolj magyarul max 2 mondatban, kizárólag a megadott cím+snippetek alapján. Ne találj ki új tényt vagy dátumot.";
  const txt = await ask([{role:"system",content:sys},{role:"user",content:`Kérdés: ${q}\n\n${pack}`}]);

  const srcs = items.map(it => `• ${host(it.link)}\n${it.link}`).join("\n");
  return `${txt}\n\nForrások:\n${srcs}`;
}

async function newsStrictSnippet(q){
  const hits = await googleTop(q);
  const best = hits[0];
  if (!best) return null;

  const title = (best.title || "").trim();
  const snippet = (best.snippet || "").trim();
  const hasDate = /\b(20\d{2}|jan|feb|márc|mar|ápr|apr|máj|maj|jun|jún|júl|jul|aug|szept|okt|nov|dec)\b/i.test(snippet);

  const line1 = title ? `A ${host(best.link)} cikke: ${title}` : `Forrás: ${host(best.link)}`;
  const line2 = snippet ? `A leírás szerint: ${snippet}` : `Rövid leírás nem áll rendelkezésre.`;
  const note  = hasDate ? "" : " (Dátum nem szerepel a snippetben.)";

  return `${line1}\n${line2}${note}\n\nForrás: ${host(best.link)}\n${best.link}`;
}

/* ====== képelemzés ====== */
function stripDataUrl(b64){
  if (typeof b64 !== "string") return "";
  const m = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  return m ? m[0] : `data:image/jpeg;base64,${b64}`;
}
async function analyzeImage(b64, prompt){
  try{
    const approx = Math.ceil((b64.length*3)/4);
    if (approx > MAX_IMAGE_BYTES) return "A kép túl nagy, kérlek 2 MB alatt küldd.";
    const messages = [{
      role:"user",
      content:[
        { type:"text", text: (prompt?.trim() || "Mi látható a képen? (max 2 mondat)") },
        { type:"image_url", image_url:{ url: stripDataUrl(b64) } }
      ]
    }];
    const r = await openai.chat.completions.create({ model:"gpt-4o-mini", temperature:0.2, messages });
    return r.choices?.[0]?.message?.content?.trim() || "Szép kép! 🙂";
  }catch{ return "Most nem tudtam feldolgozni a képet."; }
}

/* ====== fő handler ====== */
export async function handler(event){
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers:{
    "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}};

  try{
    const { message="", image=null, context={} } = JSON.parse(event.body || "{}");
    const q = (message || "").trim();
    const ctx = {
      last_city:   context.last_city   || null,
      last_person: context.last_person || null,
      last_topic:  context.last_topic  || null
    };

    if (!q && !image) return json({ error:"Üres üzenet." }, 400);

    // kép
    if (image) {
      const desc = await analyzeImage(image, q);
      return json({ ok:true, question:q||"[kép]", answer: desc, meta:{ ...ctx, intent:"image" } });
    }

    // köszönés
    if (isGreeting(q)) {
      return json({ ok:true, question:q, answer:"Szia! Itt vagyok — kérdezz bátran. Ha friss infó kell, ránézek több forrásra is.", meta:{ ...ctx, intent:"greeting" }});
    }

    // életkor gyorskezelés (ismert DOB)
    if (/\bhány éves\b/i.test(q)) {
      const key = Object.keys(DOB_MAP).find(k => q.toLowerCase().includes(k));
      if (key) {
        const age = calcAge(DOB_MAP[key], TODAY_ISO);
        const name = key.split(" ").map(s=>s[0].toUpperCase()+s.slice(1)).join(" ");
        return json({ ok:true, question:q, answer:`${name} ${age} éves (szül.: ${DOB_MAP[key]}).`, meta:{ ...ctx, intent:"ai", last_person:name }});
      }
    }

    const intent = detectIntent(q);

    // árfolyam
    if (intent === "fx") {
      const fx = await getFx(q);
      if (fx?.rate){
        const [from,to] = fx.pair.split("/");
        return json({ ok:true, question:q, answer:`1 ${from} = ${fx.rate.toFixed(2)} ${to} (${fx.date}).\n\nForrás: frankfurter.app\n${fx.source}`, meta:{ ...ctx, intent:"fx" }});
      }
      return json({ ok:true, question:q, answer:"Most nem érem el az árfolyam API-t." });
    }

    // időjárás (mini memória)
    if (intent === "weather") {
      const wx = await getWeather(q, ctx);
      if (wx?.name && wx.tMin!=null && wx.tMax!=null){
        const rain = typeof wx.pop==="number" ? `, csapadék esély ~${wx.pop}%` : "";
        return json({ ok:true, question:q, answer:`${wx.name} (${wx.label}): ${Math.round(wx.tMin)}–${Math.round(wx.tMax)}°C${rain}.\n\nForrás: open-meteo.com\n${wx.source}`, meta:{ ...ctx, intent:"weather", last_city: wx.shortName }});
      }
      return json({ ok:true, question:q, answer:"Most nem sikerült időjárási adatot lekérni." });
    }

    // hírek: 2 forrás összefoglaló → ha nem megy, szigorú snippet fallback
    if (intent === "news") {
      const two = await summarizeTwoSources(q);
      if (two) return json({ ok:true, question:q, answer: two, meta:{ ...ctx, intent:"news" }});
      const strict = await newsStrictSnippet(q);
      if (strict) return json({ ok:true, question:q, answer: strict, meta:{ ...ctx, intent:"news" }});
      return json({ ok:true, question:q, answer:"Most nem találtam elég megbízható friss találatot." });
    }

    // AI-only (mai napra kényszerítve számol)
    const sys = `Adj magyarul max 2 mondatos, világos választ. Ma: ${TODAY_ISO}.
Ha életkort számolsz, a születésnapból a mai napig számolj. Ha nem vagy biztos, kérdezz vissza röviden. Ne adj linket.`;
    const txt = await ask([{role:"system",content:sys},{role:"user",content:q}]);
    return json({ ok:true, question:q, answer: txt || "Most nem tudok részletes választ adni.", meta:{ ...ctx, intent:"ai" }});

  }catch(err){
    console.error("[chat fatal]", err);
    return json({ ok:false, answer:"Sajnálom, váratlan hiba történt. Próbáld meg újra kicsit később." }, 200);
  }
}
