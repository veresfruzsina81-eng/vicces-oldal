// netlify/functions/chat.js
//
// Cél: nem mellébeszélős, friss WEB-keresős magyar asszisztens.
// Források: Bing (ha van kulcs), Wikipedia (ingyen), DuckDuckGo (fallback).
// Modell: OPENAI_MODEL (pl. gpt-5), ha nem elérhető, automatikusan gpt-4o.
//
// Env változók (Netlify -> Site settings -> Environment variables):
//   OPENAI_API_KEY (kötelező)
//   OPENAI_MODEL   (opcionális, pl. "gpt-5")
//   BING_API_KEY   (opcionális; ha nincs, marad a Wikipedia + DDG fallback)

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const BING_KEY = process.env.BING_API_KEY;

export const handler = async (event) => {
  // CORS
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  if (event.httpMethod !== "POST") return err("Use POST");

  if (!OPENAI_KEY) return err("Hiányzik az OPENAI_API_KEY.", 500);

  try {
    const body = safeParse(event.body);
    const question = (body?.question || body?.message || "").toString().trim();
    if (!question) return ok({ reply: "Írd be, mire vagy kíváncsi. 🙂" });

    // kell-e webkeresés?
    const force = !!body?.force_search;
    const needs = force || needsSearch(question);

    // 1) webforrások gyűjtése
    let sources = [];
    let providers = [];
    if (needs) {
      // Bing (ha van kulcs)
      if (BING_KEY) {
        const b = await bingSearch(question, 6);
        if (b.length) {
          sources.push(...b);
          providers.push("Bing");
        }
      }
      // Wikipedia HU/EN kiegészítő kivonat
      const w = await wikiSearch(question, 3);
      if (w.length) {
        sources.push(...w);
        providers.push("Wikipedia");
      }
      // DuckDuckGo fallback, ha még mindig szegényes
      if (sources.length < 2) {
        const d = await ddgInstant(question, 4);
        if (d.length) {
          sources.push(...d);
          providers.push("DuckDuckGo");
        }
      }
    }

    // 2) összefoglaló kérése a modelltől – “okosító” prompttal
    const sys = buildSystemPrompt();
    const ctx = sourcesToContext(sources);
    const messages = [
      { role: "system", content: sys },
      { role: "user", content: contextUserBlock(question, ctx) }
    ];

    const ai = await callOpenAI(messages);
    if (!ai.ok) return err(`OpenAI hiba: ${ai.error}`, 502);

    let answer = (ai.data.choices?.[0]?.message?.content || "").trim();
    if (!answer) answer = "Elnézést, most nem tudtam érdemi választ adni.";

    // forrás-lábléc kényszerítése
    if (sources.length) {
      const domains = dedupe(
        sources.map(s => hostOf(s.url)).filter(Boolean)
      ).slice(0, 3); // max 3 domain kiírva
      const tag = `Forrás: ${domains.join(", ")}`;
      if (!/forrás:/i.test(answer)) answer += `\n\n${tag}`;
    }

    return ok({
      reply: answer,
      sources: sources.slice(0, 6),            // a kliensnek linklistához
      providers: dedupe(providers),            // pl. ["Bing","Wikipedia"]
      usedSearch: !!sources.length,
      modelUsed: ai.modelUsed || OPENAI_MODEL,
    });

  } catch (e) {
    return err(e.message || "Ismeretlen hiba", 500);
  }
};

// ---------------- segédek ----------------

function ok(obj){ return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(msg, code=400){ return { statusCode: code, headers: cors(), body: JSON.stringify({ error: msg }) }; }
function cors(){ return {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type, Authorization",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS"
};}
function safeParse(t){ try{return JSON.parse(t||"{}")}catch{return{}} }
function dedupe(arr){ return [...new Set(arr)]; }
function hostOf(u){ try{ return new URL(u).host.replace(/^www\./,""); }catch{return ""} }

function needsSearch(t=""){
  const s = t.toLowerCase();
  const keys = [
    "ma","most","holnap","jelenlegi","árfolyam","ár","időjárás","élő",
    "mikor","következő","menetrend","jegyár","résztvevő","résztvevők",
    "ki az","mi az","hír","friss","premier","deadline","határidő","ellenfél","eredmény"
  ];
  return keys.some(k => s.includes(k));
}

function buildSystemPrompt(){
  const now = new Date().toLocaleString("hu-HU", { timeZone:"Europe/Budapest" });
  return [
    "Magyar asszisztens vagy. Adj PONTOS, TÖMÖR és KONKRÉT választ.",
    "Mellébeszélés tilos. 5–7 mondatban foglald össze a lényeget.",
    "Ha kaptál forráskivonatot, csak abból dolgozz; ne találj ki adatot.",
    "Ha találsz konkrétumot (időpont, dátum, név, szám), írd bele.",
    "Ha a források ellentmondanak, jelezd röviden.",
    "Időérzékeny témáknál szólj, hogy változhat.",
    "A válasz végén jelenjen meg: Forrás: <domainek>, ha van forrás.",
    `Helyi idő: ${now} (Europe/Budapest).`
  ].join(" ");
}

function contextUserBlock(question, ctx){
  if (!ctx) return `Kérdés: ${question}`;
  return `Kérdés: ${question}\n\nForráskivonatok:\n${ctx}\n\nKérlek, csak ezekből adj választ.`;
}

function sourcesToContext(sources){
  if (!sources?.length) return "";
  return sources.map((s,i)=>`[#${i+1}] ${s.title}\n${s.url}\nKivonat: ${s.snippet}`).join("\n\n");
}

// ---- webforrások ----

async function bingSearch(q, max=6){
  try{
    const url = "https://api.bing.microsoft.com/v7.0/search?" + new URLSearchParams({
      q, mkt:"hu-HU", setLang:"hu", count:String(max), responseFilter:"Webpages", textDecorations:"true"
    });
    const r = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": BING_KEY }});
    if (!r.ok) return [];
    const j = await r.json();
    const arr = j.webPages?.value || [];
    return arr.slice(0, max).map(v=>({
      title: v.name || v.url,
      url: v.url,
      snippet: (v.snippet||"").replace(/\s+/g," ").trim()
    }));
  }catch{ return []; }
}

async function wikiSearch(q, max=3){
  // HU először, ha nincs érdemi, fallback EN
  const hu = await wikiOnce("hu", q, max);
  if (hu.length) return hu;
  return await wikiOnce("en", q, max);
}
async function wikiOnce(lang, q, max){
  try{
    const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
      action:"query", list:"search", srsearch:q, format:"json", origin:"*"
    });
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    const hits = (j?.query?.search || []).slice(0, max);
    return hits.map(h=>({
      title: h.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/\s/g,"_"))}`,
      snippet: (h.snippet||"").replace(/<\/?span[^>]*>/g,"").replace(/&quot;/g,'"')
    }));
  }catch{ return []; }
}

async function ddgInstant(q, max=4){
  try{
    const url = "https://api.duckduckgo.com/?" + new URLSearchParams({
      q, format:"json", no_html:"1", skip_disambig:"1"
    });
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    const out = [];
    if (j.AbstractText){
      out.push({ title: j.Heading || "DuckDuckGo összefoglaló", url: j.AbstractURL || "https://duckduckgo.com", snippet: j.AbstractText });
    }
    if (Array.isArray(j.RelatedTopics)){
      for (const t of j.RelatedTopics){
        if (t.Text && t.FirstURL){
          out.push({ title: t.Text.slice(0,100), url: t.FirstURL, snippet: t.Text });
          if (out.length >= max) break;
        }
      }
    }
    return out;
  }catch{ return []; }
}

// ---- OpenAI ----

async function callOpenAI(messages){
  // Automatikus visszaesés gpt-4o-ra, ha a megadott modell nem érhető el
  let model = OPENAI_MODEL;
  const body = (m)=>JSON.stringify({ model:m, temperature:0.2, messages });

  let r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${OPENAI_KEY}`, "Content-Type":"application/json" },
    body: body(model)
  });

  if (!r.ok){
    const t = await r.text();
    if (/model_not_found|unsupported_model|not available/i.test(t) && model !== "gpt-4o"){
      model = "gpt-4o";
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{ "Authorization":`Bearer ${OPENAI_KEY}`, "Content-Type":"application/json" },
        body: body(model)
      });
      if (!r.ok) return { ok:false, error: await r.text() };
      return { ok:true, data: await r.json(), modelUsed: model };
    }
    return { ok:false, error: t };
  }
  return { ok:true, data: await r.json(), modelUsed: model };
}
