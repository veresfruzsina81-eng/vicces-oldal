// === Tamás AI – Profi asszisztens motor (HARDENED) ===========================
// - Intent router + kontextusmemória (last_city/person/topic)
// - Web pipeline: Google CSE -> whitelist -> párhuzamos letöltés -> cheerio kinyerés
//   * Névsor (résztvevők/versenyzők) / Menetrend / Rövid összefoglaló több forrásból
// - AI-only fallback (emberi, max 2 mondat)
// - Minőség-ellenőrzés (LLM judge) + follow-up javaslat
// - Képértés (vision)
// - HIBAVÉDELEM: szigorú URL-validáció mindenhol + bombabiztos fetchHtml()
// ============================================================================
import OpenAI from "openai";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =================== BEÁLLÍTÁSOK =================== */
const SAFE_MODE = true;
const SUPER_MODE = true;          // generikus kérdésnél is használhat netet
const INTENT_MIN_CONF = 0.60;     // ez alatt inkább visszakérdez
const MAX_IMAGE_BYTES = 2_000_000;

const WL = new Set([
  "rtl.hu","telex.hu","index.hu","24.hu","hvg.hu","portfolio.hu",
  "nso.hu","nemzetisport.hu","444.hu","magyarnemzet.hu"
]);

/* =================== EGYSZERŰ CACHE =================== */
const cache = new Map();
function cacheGet(k){ const it=cache.get(k); if(!it) return null; if(Date.now()>it.until){cache.delete(k);return null;} return it.value; }
function cacheSet(k,v,ttl=12*60*1000){ cache.set(k,{until:Date.now()+ttl,value:v}); }

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

    // --- 0/a) személynév kontextus
    if (question) {
      const m = question.match(/\b([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)+)\b/);
      if (m) ctx.last_person = m[1].trim();
      else if (ctx.last_person && isVagueFollowUp(question)) question = `${ctx.last_person} ${question}`;
    }

    // --- 0/b) kép ág
    if (image) {
      const approxBytes = Math.ceil((image.length*3)/4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return json({ ok:false, question:"[kép]", answer:"A kép túl nagy. Kérlek 2 MB alatt küldd el.", meta:{...ctx,last_intent:"vision"} });
      }
      const desc = await analyzeImage(image, question);
      if (desc) return json({ ok:true, question:question||"[kép]", answer:limitToTwoSentences(desc), meta:{...ctx,last_intent:"vision"} });
      if (!question) return json({ ok:true, question:"[kép]", answer:"Szép kép! 🙂 Most nem sikerült elemezni, próbáld kicsit kisebb méretben.", meta:{...ctx,last_intent:"vision"} });
    }

    // --- 0/c) smalltalk/köszönés
    if (isGreeting(question)) {
      return json({ ok:true, question, answer:"Szia! Itt vagyok — kérdezz bátran. Ha friss infó kell, több megbízható forrásból is megnézem.", meta:{...ctx,smalltalk:true} });
    }
    if (isSmalltalk(question)) {
      return json({ ok:true, question, answer:"Figyelek. Miben segíthetek most?", meta:{...ctx,smalltalk:true} });
    }

    // --- 1) készítő
    if (isOwnerQuestion(question)) {
      return json({ ok:true, question, answer:"Az oldalt Horváth Tamás készítette Szabolcsbákán. Technikai kérdés? Írd meg nyugodtan.", meta:{...ctx,last_intent:"owner"} });
    }

    // --- 2) intent + bizalom
    let intent = detectIntentRules(question);
    if (intent === "generic") { try{ const li=await classifyIntentLLM(question); if(li) intent=li; }catch{} }

    if (intent === "generic" && wantsWeb(question)) intent = "news";
    if (hasStrongNewsSignal(question) && intent !== "weather") { ctx.last_city = null; intent = "news"; }

    const conf = SAFE_MODE ? intentConfidence(question) : 1;
    if (SAFE_MODE) {
      const strongNews = hasStrongNewsSignal(question);
      const strongWeather = hasStrongWeatherSignal(question);
      if (conf < INTENT_MIN_CONF && !strongNews && !strongWeather) {
        const cq = await buildClarifyingQuestion(question);
        return json({ ok:true, question, answer: cq || "Nem teljesen világos, mire gondolsz. Egy szóval pontosítod? 🙂", meta:{...ctx,last_intent:"clarify"} });
      }
      if (isVagueFollowUp(question)) {
        if (strongNews) intent="news";
        else if (strongWeather && ctx.last_city) intent="weather";
        else if (conf < INTENT_MIN_CONF) {
          const cq = await buildClarifyingQuestion(question);
          return json({ ok:true, question, answer: cq || "Mire gondolsz pontosan? 🙂", meta:{...ctx,last_intent:"clarify"} });
        }
      }
    }

    // --- személy + tény → AI only
    if (ctx.last_person && isPersonFactoid(question)) {
      const t = await answerShortDirect(`${ctx.last_person} ${question}`);
      const qc = await qualityCheck(question, t);
      return json({ ok:true, question, answer: limitToTwoSentences(mergeQuality(t,qc)), meta:{...ctx,last_intent:"ai-only",last_topic:ctx.last_person} });
    }

    // --- 3) FRISS ADAT ÁGAK ---
    // FX
    if (intent === "fx") {
      const fx = await getFxRate(question);
      if (fx?.rate) {
        const [base,quote] = fx.pair.split("/");
        return json({ ok:true, question, answer:`1 ${base} = ${fx.rate.toFixed(2)} ${quote} (${fx.date}).\n\nForrás: frankfurter.app\n${fx.sourceUrl}`, meta:{...ctx,last_intent:"fx"} });
      }
      return json({ ok:true, question, answer:"Most nem érem el az árfolyam API-t. Próbáld meg később.", meta:{...ctx,last_intent:"fx"} });
    }

    // Weather
    if (intent === "weather") {
      const guessCity = extractCityGuess(question) || ctx.last_city || null;
      if (!guessCity) {
        return json({ ok:true, question, answer:"Melyik városra nézzük az időjárást? (pl. Szeged, Debrecen, London) 🙂", meta:{...ctx,last_intent:"clarify-weather"} });
      }
      const wx = await getWeather(question, guessCity);
      if (wx?.name) {
        const tMin = wx.tMin!=null?Math.round(wx.tMin):"—";
        const tMax = wx.tMax!=null?Math.round(wx.tMax):"—";
        const rain = wx.pop!=null?`, csapadék esély ~${wx.pop}%`:"";
        ctx.last_city = wx.shortName || guessCity;
        return json({ ok:true, question, answer:`${wx.name} (${wx.dateLabel}): ${tMin}–${tMax}°C${rain}.\n\nForrás: open-meteo.com\nhttps://open-meteo.com/`, meta:{...ctx,last_intent:"weather",last_topic:ctx.last_city,suggest:"Érdekel az órás bontás is, vagy másik város?"} });
      }
      return json({ ok:true, question, answer:"Most nem sikerült időjárási adatot lekérni. Nézzük meg egy másik városra?", meta:{...ctx,last_intent:"weather"} });
    }

    // News / Super mode
    if (intent === "news" || (SUPER_MODE && intent === "generic")) {
      const wantsList = /\b(résztvevők|nevsor|névsor|versenyzők|versenyzok|szereplők|szereplok)\b/i.test(question);
      const wantsSchedule = /\b(menetrend|időpont|idopont|datum|dátum|mikor|műsor|musor)\b/i.test(question);

      const key = `web:${normalizeHu(question)}:${wantsList}:${wantsSchedule}`;
      const cached = cacheGet(key);
      if (cached) return json({ ok:true, question, answer: cached, meta:{...ctx,last_intent:"news",cached:true} });

      const rich = await webAnswerAggressive(question, {needList:wantsList, needSchedule:wantsSchedule});
      if (rich) {
        const qc = await qualityCheck(question, rich);
        const finalAns = mergeQuality(rich,qc);
        cacheSet(key, finalAns);
        return json({ ok:true, question, answer: finalAns, meta:{...ctx,last_intent:"news"} });
      }

      const best = await safeSearchBest(question);
      if (best) {
        const text = await answerFromSnippet(question, best.title, best.snippet);
        const ans = `${limitToTwoSentences(text)}\n\nForrás: ${hostname(best.link)}\n${best.link}`;
        const qc = await qualityCheck(question, ans);
        return json({ ok:true, question, answer: mergeQuality(ans,qc), meta:{...ctx,last_intent:"news",source:best.link,suggest:"Szeretnéd a részleteket vagy másik forrást?"} });
      }
      return json({ ok:true, question, answer:"Most nem találtam elég megbízható forrást. Egy kulcsszóval pontosítod? 🙂", meta:{...ctx,last_intent:"news"} });
    }

    // --- 4) AI-only
    const text = await answerShortDirect(question);
    const qc = await qualityCheck(question, text);
    return json({ ok:true, question, answer: limitToTwoSentences(mergeQuality(text,qc)), meta:{...ctx,last_intent:"ai-only",suggest:await buildFollowupSuggestion(question)} });

  } catch (err) {
    // ide csak programhiba jut el – NEM dobunk fel link-hibát a usernek
    console.error("[chat] fatal error:", err);
    return json({ ok:false, answer:"Sajnálom, valami váratlan hiba történt a feldolgozás közben." }, 200);
  }
}

/* ================= Util ================= */
function cors(){ return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}; }
function json(body,statusCode=200){ return { statusCode, headers:{ "Content-Type":"application/json; charset=utf-8", ...cors() }, body: JSON.stringify(body,null,2) }; }
const hostname = (u)=>{ try{ return new URL(u).hostname.replace(/^www\./,""); }catch{ return ""; } };
function normalizeHu(s){ return (s||"").toLowerCase().normalize("NFC"); }
function deburrHu(s){ return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ő/g,"o").replace(/ű/g,"u").replace(/Ő/g,"O").replace(/Ű/g,"U"); }

// --- SZIGORÚ URL-GUARD (minden fetch előtt ezt használjuk)
function isValidUrl(u){
  try{
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  }catch{
    return false;
  }
}

/* ===== jelek / intent ===== */
function intentConfidence(q){
  const s = normalizeHu(q);
  let c = 0;
  if (/\b(árfolyam|eur|euro|eu|usd|gbp|chf|pln|ron|huf|forint)\b/.test(s)) c += 0.6;
  if (/\b(időjárás|idojaras|előrejelzés|elorejelzes|hőmérséklet|homerseklet|eső|eso|holnap|ma)\b/.test(s)) c += 0.6;
  if (/\b(rtl|sztárbox|sztarbox|x-faktor|xfaktor|ukrajna|oroszország|breaking|friss|menetrend|névsor|nevsor|202\d|ma|tegnap|most)\b/.test(s)) c += 0.6;
  if (/\b[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/.test(q)) c += 0.15;
  if (/\d{4}/.test(q)) c += 0.1;
  return Math.min(1,c);
}
function wantsWeb(q){ return /\b(ma|tegnap|most|friss|legújabb|breaking|202\d|menetrend|időpont|dátum|névsor|résztvevők|ki nyert|állás)\b/.test(normalizeHu(q)); }
function isGreeting(q){ const s=normalizeHu(q).trim(); return ["szia","hali","helló","hello","üdv","jó napot","jó estét","jó reggelt"].some(p=>s.startsWith(p)); }
function isSmalltalk(q){ return /\b(mizu|mi újság|miujsag|hogy vagy|csá|csumi|na mi van|na mi ujsag)\b/.test(normalizeHu(q)); }
function isOwnerQuestion(q){ return /ki készítette|ki csinálta|készítő|fejlesztő|tulaj|kié az oldal|készítetted|horváth tamás/i.test(q); }
function limitToTwoSentences(t){ const s=(t||"").replace(/\s+/g," ").trim(); return s.split(/(?<=[.!?])\s+/).slice(0,2).join(" "); }
async function ask(messages){ const r=await openai.chat.completions.create({ model:"gpt-4o-mini", temperature:0.2, messages }); return r.choices?.[0]?.message?.content?.trim()||""; }
function mergeQuality(a,qc){ const n=(qc||"").trim(); if(!n) return a; if(/bizonytalan|ellentmond|óvatos|változhat/i.test(n)) return `${a}\n\nMegjegyzés: ${n}`; return a; }

function detectIntentRules(q){
  const s = normalizeHu(q);
  const hasArfolyam = /\bárfolyam\b/.test(s);
  const tokens = s.split(/\s+/).filter(Boolean).map(deburrTokenHu);
  const ccy = new Set(["eur","euro","usd","gbp","chf","pln","ron","huf","forint","eu"]);
  const hasCcy = tokens.some(t=>ccy.has(t)) || /\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/i.test(q);
  if (hasArfolyam || hasCcy) return "fx";

  if ([/\bidőjárás\b/,/\belőrejelzés\b/,/\bweather\b/,/\bhőmérséklet\b/,/\bholnap\b/].some(rx=>rx.test(s))) return "weather";

  if (/\b(rtl|sztárbox|sztarbox|sztár box|résztvevők|névsor|versenyzők|hír|breaking|friss|202\d|ukrajna|oroszország|x-faktor|xfaktor|menetrend|ma|tegnap|most)\b/.test(s)) return "news";
  return "generic";
}
function deburrTokenHu(t){ return (t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ő/g,"o").replace(/ű/g,"u").replace(/(?:nal|nel|ban|ben|ba|be|ra|re|rol|tol|nak|nek|on|en|n|hoz|hez|ig|val|vel|kent)$/,""); }
function hasStrongNewsSignal(q){ return /\b(sztárbox|sztarbox|x-faktor|xfaktor|rtl|versenyzők|nevsor|névsor|menetrend|202\d|casting|resztvevok|résztvevők)\b/.test(normalizeHu(q)); }
function hasStrongWeatherSignal(q){ return /\b(időjárás|idojaras|előrejelzés|elorejelzes|hőmérséklet|homerseklet|szél|szel|eső|eso)\b/.test(normalizeHu(q)); }
function isVagueFollowUp(q){ const s=normalizeHu(q).replace(/[^\p{L}\p{N}\s]/gu," ").trim(); const tokens=s.split(/\s+/).filter(Boolean); const stop=new Set(["ők","ok","azok","ezek","azt","ezt","mert","és","de","vagy","hogy","is","mi","milyen","hogyan","akkor","igen","nem","hadban","állnak","egymással","holnap","ma"]); const content=tokens.filter(t=>!(stop.has(t)||t.length<=2)); const hasEntity=/[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+/.test(q); return content.length===0||(!hasEntity&&tokens.length<=4); }
function isPersonFactoid(q){ return /\b(hány éves|mikor született|milyen magas|hol játszik|milyen poszt)\b/.test(normalizeHu(q)); }

/* ===== visszakérdezés / javaslat / QC ===== */
async function buildClarifyingQuestion(u){ try{ return await ask([{role:"system",content:"Fogalmazz 1 rövid, barátságos pontosító kérdést magyarul."},{role:"user",content:`Felhasználó: ${u}`}]); }catch{ return ""; } }
async function buildFollowupSuggestion(u){ try{ return await ask([{role:"system",content:"Adj 1 rövid javaslatot (max 12 szó), hogy mit kérdezhet legközelebb — magyarul."},{role:"user",content:`Felhasználó kérdése: ${u}`}]); }catch{ return ""; } }
async function qualityCheck(q,a){ try{ return await ask([{role:"system",content:"Ellenőrizd röviden: a válasz állításai nincsenek-e ellentmondásban a kérdéssel; ha bizonytalan vagy változhat, jelezd 1 rövid mondattal."},{role:"user",content:`Kérdés: ${q}\nVálasz: ${a}`}]); }catch{ return ""; } }

/* ================= AI-only ================= */
async function answerShortDirect(question){
  try{
    return await ask([{role:"system",content:"Adj magyarul max 2 mondatos, világos és emberi választ. Ne adj linket."},{role:"user",content:`Kérdés: ${question}`}]);
  }catch{ return "Most nem tudok részletesen válaszolni."; }
}

/* ================= SAFE böngészés + WEB PIPELINE ================= */
function extractKeywordsHu(q){
  const stop=new Set(["a","az","és","vagy","hogy","mert","is","van","volt","lesz","itt","ott","mi","mit","mikor","hol","melyik","kik","között","közül","sztár","box","ma","holnap","tegnap","most"]);
  return normalizeHu(q).replace(/[^\p{L}\p{N}\s]/gu," ").split(/\s+/).filter(w=>w.length>=4 && !stop.has(w));
}
function isShowbiz(q){ return /\b(sztárbox|sztarbox|x-faktor|xfaktor|rtl|casting|névsor|nevsor|menetrend)\b/.test(normalizeHu(q)); }

async function safeSearchBest(question){
  const key=process.env.GOOGLE_API_KEY||process.env.Google_API_KEY;
  const cx =process.env.GOOGLE_CX     ||process.env.Google_CX;
  if(!key||!cx){ console.warn("[search] missing GOOGLE_*"); return null; }

  const url=new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key",key); url.searchParams.set("cx",cx);
  url.searchParams.set("q",question); url.searchParams.set("num","10");
  url.searchParams.set("safe","active"); url.searchParams.set("hl","hu"); url.searchParams.set("gl","hu"); url.searchParams.set("lr","lang_hu");
  url.searchParams.set("dateRestrict", `d${isShowbiz(question)?60:(looksFresh(question)?7:14)}`);

  const res=await fetch(url); if(!res.ok){ console.error("[search] http",res.status,await res.text()); return null; }
  const data=await res.json();
  let items=(data.items||[])
    .map(it=>({title:it.title||"",snippet:it.snippet||"",link:it.link||""}))
    .filter(it=>it.link && isValidUrl(it.link));      // szigorú guard
  items = items.filter(it=>WL.has(hostname(it.link)));

  const kws=extractKeywordsHu(question); const kwSet=new Set(kws);
  const kwHits=(text)=>{ const s=normalizeHu(text); let h=0; for(const k of kwSet) if(k&&s.includes(k)) h++; return h; };
  const preferRtl=/rtl/i.test(question)||/sztárbox|sztarbox|x-faktor|xfaktor/i.test(question);
  let best=null,score=-1,year=String(new Date().getFullYear());

  for(const it of items){
    const hits=kwHits(`${it.title} ${it.snippet}`); if(kws.length&&hits<1) continue;
    const h=hostname(it.link).toLowerCase();
    let s=({ "rtl.hu":10,"24.hu":9,"index.hu":9,"telex.hu":9,"hvg.hu":9,"portfolio.hu":9,"nemzetisport.hu":8,"nso.hu":8,"444.hu":8,"magyarnemzet.hu":8 }[h]||5)+Math.min(hits,3);
    if(it.link.toLowerCase().includes(year)) s+=2;
    if(preferRtl && h==="rtl.hu") s+=5;
    if(s>score){ best=it; score=s; }
  }

  if(!best){
    const firstWL=(data.items||[])
      .map(it=>({title:it.title||"",snippet:it.snippet||"",link:it.link||""}))
      .find(i=>i.link && isValidUrl(i.link) && WL.has(hostname(i.link)));
    return firstWL||null;
  }
  return best;
}
async function answerFromSnippet(question,title,snippet){
  try{
    const txt=await ask([{role:"system",content:"Magyarul válaszolj MAX 2 mondatban, csak a (title+snippet) alapján. Ha nem elég egyértelmű, írd: 'A megadott forrás alapján nem egyértelmű a válasz.'"}, {role:"user",content:`Kérdés: ${question}\nForrás cím: ${title}\nForrás leírás: ${snippet}`}]);
    return limitToTwoSentences(txt);
  }catch{ return "A megadott forrás alapján nem egyértelmű a válasz."; }
}

/* --- teljes web pipeline --- */
async function webAnswerAggressive(query,{needList=false,needSchedule=false}={}){
  const key=process.env.GOOGLE_API_KEY||process.env.Google_API_KEY;
  const cx =process.env.GOOGLE_CX     ||process.env.Google_CX;
  if(!key||!cx) return null;

  const hits=await safeSearch(query);
  const items=(hits||[])
    .filter(h=>h && h.link && isValidUrl(h.link))
    .filter(h=>WL.has(host(h.link)))
    .slice(0,5);
  if(!items.length) return null;

  const limit=pLimit(3);
  const pages=(await Promise.all(
    items.map(it=>limit(async()=>{
      const html=await fetchHtml(it.link);    // bombabiztos
      if(!html) return null;
      return {...it, html};
    }))
  )).filter(Boolean);
  if(!pages.length) return null;

  const facts={names:new Set(), dates:new Set(), bullets:[]};
  for(const p of pages){
    const ex=extractFromHtml(p.html,p.link,{needList,needSchedule});
    ex.names?.forEach(n=>facts.names.add(n));
    ex.dates?.forEach(d=>facts.dates.add(d));
    if(ex.bullets?.length) facts.bullets.push(...ex.bullets);
  }
  const names=Array.from(facts.names).slice(0,16);
  const dates=Array.from(facts.dates).slice(0,4);

  if(needList && names.length){
    const list=names.map(n=>"• "+n).join("\n");
    const src=pages.find(p=>p.link.includes("rtl.hu"))?.link || pages[0].link;
    return `${list}\n\nForrás: ${host(src)}\n${src}`;
  }
  if(needSchedule && dates.length){
    const src=pages.find(p=>p.link.includes("rtl.hu"))?.link || pages[0].link;
    return `Következő időpont(ok): ${dates.join(", ")}.\n\nForrás: ${host(src)}\n${src}`;
  }

  const best=pages.find(p=>p.link.includes("rtl.hu"))||pages[0];
  const two=(facts.bullets||[]).slice(0,2).map(s=>s.replace(/\s+/g," ").trim()).filter(Boolean).join(" ");
  return `${two || "A források alapján röviden összefoglaltam a lényeget."}\n\nForrás: ${host(best.link)}\n${best.link}`;
}

function host(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch{ return ""; } }
async function safeSearch(q){
  const key=process.env.GOOGLE_API_KEY||process.env.Google_API_KEY;
  const cx =process.env.GOOGLE_CX     ||process.env.Google_CX;
  if(!key||!cx) return [];
  const url=new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key",key); url.searchParams.set("cx",cx);
  url.searchParams.set("q",q); url.searchParams.set("num","10");
  url.searchParams.set("safe","active"); url.searchParams.set("hl","hu"); url.searchParams.set("gl","hu"); url.searchParams.set("lr","lang_hu");
  const r=await fetch(url); if(!r.ok) return [];
  const d=await r.json();
  return (d.items||[])
    .map(it=>({title:it.title||"",snippet:it.snippet||"",link:it.link||""}))
    .filter(it=>it.link && isValidUrl(it.link));     // szigorú guard
}

/* ---- bombabiztos fetchHtml ---- */
async function fetchHtml(url){
  // csak tiszta http/https URL mehet át
  if (!url || typeof url !== "string") return null;
  if (!/^https?:\/\//i.test(url)) { console.warn("[skip fetch] bad url:", url); return null; }
  try{
    const r=await fetch(url,{ headers:{ "User-Agent":"Mozilla/5.0 TamásAI" }});
    if(!r.ok) return null;
    return await r.text();
  }catch{ return null; }
}

/* ===== HTML kinyerők ===== */
const NAME_HINTS=/(résztvevők|névsor|nevsor|versenyzők|versenyzok|szereplők|szereplok)/i;
const DATE_HINTS=/(időpont|menetrend|dátum|datum|kezdet|start|mikor|aug|szept|okt|nov|dec|202\d)/i;

function extractFromHtml(html,url,{needList=false,needSchedule=false}={}){
  const $=cheerio.load(html);
  const names=new Set(); const dates=new Set(); const bullets=[];

  if(needList){
    $('h1,h2,h3,h4,h5,h6,p,strong,b').each((_,el)=>{
      const t=$(el).text().trim();
      if(NAME_HINTS.test(t)){
        let blk=$(el).next();
        for(let i=0;i<8 && blk.length;i++){
          blk.find('li,strong,b').each((_,n)=>{
            const s=$(n).text().replace(/\s+/g,' ').trim();
            if(looksLikeName(s)) names.add(cleanName(s));
          });
          const para=blk.text().replace(/\s+/g,' ').trim();
          para.split(/[;,]/).forEach(x=>{const s=x.trim(); if(looksLikeName(s)) names.add(cleanName(s));});
          blk=blk.next();
        }
      }
    });
    if(!names.size){
      $('li').each((_,li)=>{ const s=$(li).text().replace(/\s+/g,' ').trim(); if(looksLikeName(s)) names.add(cleanName(s)); });
    }
  }

  if(needSchedule){
    $('time').each((_,t)=>{ const d=$(t).attr('datetime')||$(t).text(); addDate(d); });
    $('p,li,span,strong,b,h2,h3').each((_,el)=>{
      const txt=$(el).text().replace(/\s+/g,' ').trim();
      if(DATE_HINTS.test(txt)) txt.match(/\b(202\d\.\s*\d{1,2}\.\s*\d{1,2}|202\d[-\/.]\d{1,2}[-\/.]\d{1,2}|augusztus\s+\d+|szeptember\s+\d+|október\s+\d+)\b/ig)?.forEach(addDate);
    });
  }

  $('p').slice(0,3).each((_,p)=>{ const t=$(p).text().replace(/\s+/g,' ').trim(); if(t) bullets.push(t); });

  return { names, dates, bullets };

  function addDate(s){ const t=(s||"").replace(/\s+/g,' ').trim(); if(t) dates.add(t); }
  function looksLikeName(s){ const x=s.replace(/\(.*?\)|\d+\.?/g,'').trim(); const w=x.split(/\s+/).filter(Boolean); if(w.length<1||w.length>5) return false; const caps=w.filter(y=>/^[A-ZÁÉÍÓÖŐÚÜŰ]/.test(y)); return caps.length>=Math.max(1,Math.round(w.length*0.6)); }
  function cleanName(s){ return s.replace(/[-–—]\s*.*/,'').replace(/\s{2,}/g,' ').replace(/^\d+\.\s*/,'').trim(); }
}

/* ================= FX ================= */
async function getFxRate(q){
  try{
    let S=q.toUpperCase().replace(/[.,]/g," ").replace(/\bEU\b/g,"EUR").replace(/\bEURO?\b/g,"EUR");
    let from="EUR",to="HUF";
    const mPair=S.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/);
    const mWords=S.match(/\b(EUR|USD|GBP|CHF|PLN|RON)\b.*\b(HUF|EUR|USD|GBP|CHF|PLN|RON)\b/);
    if(mPair){ from=mPair[1]; to=mPair[2]; }
    else if(mWords && mWords[1]!==mWords[2]){ from=mWords[1]; to=mWords[2]; }
    else if(/(eur|euro|euró|eu)/i.test(q) && /(huf|forint)/i.test(q)){ from="EUR"; to="HUF"; }
    else if(/usd/i.test(q) && /(forint|huf)/i.test(q)){ from="USD"; to="HUF"; }

    const url=new URL("https://api.frankfurter.app/latest"); url.searchParams.set("from",from); url.searchParams.set("to",to);
    const r=await fetch(url); if(!r.ok) return null; const d=await r.json(); const rate=d?.rates?.[to]; if(!rate) return null;
    return { pair:`${from}/${to}`, rate:Number(rate), date:d.date, sourceUrl:url.toString() };
  }catch{ return null; }
}

/* ================= Weather ================= */
function stripHungarianCase(word){ const w=normalizeHu(word); return w.replace(/[-\s]+/g," ").replace(/(?:ban|ben|ba|be|ra|re|rol|ról|ről|tol|től|nak|nek|on|en|ön|n|hoz|hez|höz|ig|val|vel|ként|nál|nél)$/u,""); }
function extractCityGuess(q){
  const s=deburrHu(normalizeHu((q||"").trim())).replace(/[^\p{L}\s-]/gu," ").trim();
  const stop=new Set(["milyen","az","idojaras","elorejelzes","van","lesz","ma","holnap","heti","magyarorszagon","magyarorszag","ido","idoben","ott","itt","most"]);
  const tokens=s.split(/\s+/).filter(t=>t&&t.length>=3 && !stop.has(t)); if(!tokens.length) return null;
  let cand=stripHungarianCase(tokens[tokens.length-1]);
  const map={"szabolcsbaka":"Szabolcsbáka","szabolcs-baka":"Szabolcsbáka","bp":"Budapest","pest":"Budapest"};
  if(map[cand]) return map[cand];
  return cand.charAt(0).toUpperCase()+cand.slice(1);
}
async function geocode(name){
  if(!name) return null;
  const url=new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name",name); url.searchParams.set("count","1"); url.searchParams.set("language","hu");
  const res=await fetch(url); if(!res.ok) return null;
  const data=await res.json(); return data?.results?.[0]||null;
}
async function getWeather(q,preferredCity){
  try{
    let guess=preferredCity||extractCityGuess(q)||null; if(!guess) return null;
    let loc=await geocode(guess); if(!loc && guess && !/hungary|magyar/i.test(guess)) loc=await geocode(`${guess}, Hungary`); if(!loc) return null;
    const lat=loc.latitude, lon=loc.longitude, tz=loc.timezone||"Europe/Budapest"; const wantTomorrow=/\bholnap|tomorrow\b/i.test(q);
    const wxUrl=new URL("https://api.open-meteo.com/v1/forecast"); wxUrl.searchParams.set("latitude",String(lat)); wxUrl.searchParams.set("longitude",String(lon)); wxUrl.searchParams.set("daily","temperature_2m_max,temperature_2m_min,precipitation_probability_max"); wxUrl.searchParams.set("timezone",tz); wxUrl.searchParams.set("forecast_days",wantTomorrow?"2":"1");
    const wxres=await fetch(wxUrl);
    const base={ shortName:loc.name, name:`${loc.name}${loc.country?`, ${loc.country}`:""}`, dateLabel: wantTomorrow?"holnap":"ma", sourceUrl:"https://open-meteo.com/" };
    if(!wxres.ok) return {...base,tMin:null,tMax:null,pop:null};
    const wx=await wxres.json(); const d=wx?.daily; const idx=wantTomorrow && d?.time?.length>1 ? 1 : 0;
    return {...base, tMin:d?.temperature_2m_min?.[idx]??null, tMax:d?.temperature_2m_max?.[idx]??null, pop: typeof d?.precipitation_probability_max?.[idx]==="number"?d.precipitation_probability_max[idx]:null };
  }catch{ return null; }
}

/* ================= Vision ================= */
function stripDataUrlPrefix(b64){
  if(typeof b64!=="string") return "";
  const m=b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  return m? m[0] : `data:image/jpeg;base64,${b64}`;
}
async function analyzeImage(imageBase64OrDataUrl,promptText){
  try{
    const dataUrl=stripDataUrlPrefix(imageBase64OrDataUrl);
    const userPrompt=(promptText&&promptText.trim())?promptText.trim():"Rovid magyar leiras kerem: mi lathato a kepen? (max 2 mondat)";
    const messages=[{ role:"user", content:[ {type:"text",text:userPrompt}, {type:"image_url", image_url:{ url:dataUrl }} ] }];
    const r=await openai.chat.completions.create({ model:"gpt-4o-mini", temperature:0.2, messages });
    return r.choices?.[0]?.message?.content?.trim() || "";
  }catch{ return ""; }
}
