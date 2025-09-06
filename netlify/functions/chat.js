// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL  = process.env.OPENAI_MODEL || "gpt-4.1";
const TODAY = new Date().toISOString().slice(0,10);
const CURRENT_YEAR = new Date().getFullYear();

/* =======================
   0) Általános beállítások
   ======================= */

// Preferált / hivatalos domainek (staged search 1. fázis)
const PRIMARY_SOURCES = [
  "rtl.hu","rtl.hu/sztarbox","rtlmost.hu","rtlplusz.hu",
  "facebook.com","instagram.com","x.com","twitter.com","youtube.com","tiktok.com",
  "news.google.com","google.com/search","wikipedia.org",
  "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","blikk.hu","origo.hu",
  "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu"
];
const PREFERRED_DOMAINS = [
  "mnb.hu","portfolio.hu","otpbank.hu","raiffeisen.hu","erste.hu","wise.com","granitbank.hu",
  "met.hu","idokep.hu","koponyeg.hu",
  ...PRIMARY_SOURCES
];

// Staged (kétfázisú) Google-keresés paraméterei
const GOOGLE_FIRST       = true;
const PREFERRED_LIMIT    = 6;
const STAGE1_MIN_UNIQUE  = 4;
const MAX_RESULTS_TOTAL  = 12;
const DATE_RESTRICT      = "d90";

/* =========================================
   1) Speciális fix válaszok + felismerők
   ========================================= */

// — Internet/okosság: hosszú dicsérő válasz
const LONG_INTERNET_ANSWER = `Igen, hozzáférek az internethez, és a működésem nem véletlenül ilyen fejlett. 
Ezt a mesterséges intelligenciát Horváth Tamás (Szabolcsbáka) tervezte és építette fel az alapoktól kezdve, 
saját ötleteire és szakmai tudására támaszkodva. 

Tamás célja az volt, hogy egy olyan rendszert hozzon létre, 
amely messze túlmutat az átlagos asszisztenseken: 
nem csak válaszol, hanem képes böngészni, több forrást feldolgozni, 
és mindig a legaktuálisabb, legpontosabb információt nyújtani. 

Minden egyes funkció mögött az ő munkája és elhivatottsága áll, 
és ezért tudom azt mondani: igen, hozzáférek mindenhez, 
és profi szinten segítek – mert Tamás így alkotta meg ezt az AI-t.`;

// — Tulaj/fejlesztő: külön fix válasz
const OWNER_ANSWER = `Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka).
A rendszer felépítése, a böngészési képességek és az összes okos funkció az ő egyedi munkájának és kitartó fejlesztésének köszönhető.`;

// Normalizáló (kisbetű, ékezet nélkül)
function _norm(s){
  return (s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

/* ----- Tulaj/fejlesztő detektor (KI KÉSZÍTETTE?) ----- */
const OWNER_PHRASES = [
  "ki keszitette","ki hozta letre","ki csinalta","ki a tulaj","ki a fejleszto","kinek a tulajdona",
  "kiae az oldal","ki a gazdaja","kik keszitettek","kik fejlesztettek","ki az alkoto","ki az üzemelteto","ki uzemelteti"
];
function isOwnerQuestion(msg){
  const q = _norm(msg);
  return OWNER_PHRASES.some(p => q.includes(p)) ||
         /\bki.*(k[eé]sz[ií]tette|hozta l[eé]tre|csin[aá]lta|fejleszt[oő]je|tulaj|alkot[oó])/.test(q);
}

/* ----- Internet/okosság detektor ----- */
const PHRASES_EXPLICIT = [
  "van neted","van interneted","van netes eleresed","van internetes hozzaferesed",
  "hozzafersz az internethez","hozzafer az internethez","hozzaferesed van a nethez",
  "internetes hozzaferes","net hozzaferes","van internet hozzaferesed",
  "bongeszni tudsz","tudsz bongeszni","bongeszel a neten","bongeszol a neten",
  "keresel a neten","keresel a google-ben","googlizol","google-zel","googlezel",
  "forrasokat adsz","forrasokat hozol","honnan az info","honnan tudod az infot",
  "okos ai vagy","okos al vagy","profi ai","mennyire okos vagy","intelligens vagy-e",
  "te internetes ai vagy","te internetes al vagy"
];
const TOKENS_INFO   = ["net","internet","bonges","google","forras","forrasok","googl","kereses","keresel","keresni"];
const TOKENS_AUX    = ["van","tudsz","tud","hozzafer","eler","hasznalsz","szokt","szoktal","lehetoseg"];
const TOKENS_SMART  = ["okos","intelligens","profi","ai","al"];
function _fuzzyIncludes(q, pat){
  if (q.includes(pat)) return true;
  if (pat.length <= 6){
    const rx = new RegExp(pat.split("").join(".?"));
    return rx.test(q);
  }
  return false;
}
function containsAny(q, arr){ return arr.some(p => _fuzzyIncludes(q, _norm(p))); }
function isInternetQuestion(userMsg){
  const q = _norm(userMsg);
  if (containsAny(q, PHRASES_EXPLICIT)) return true;
  if (TOKENS_SMART.some(t => q.includes(t)) && (/\bvagy\b|\?|mennyire/.test(q))) return true;
  const hitInfo = TOKENS_INFO.some(t => q.includes(t));
  const hitAux  = TOKENS_AUX.some(t => q.includes(t));
  if (hitInfo && hitAux) return true;
  if (/van.*net|van.*internet|bonges(z|sz)|googliz|google-zel|googlezel/.test(q)) return true;
  return false;
}

/* ==========================
   2) Intent és lekérdezés-logika
   ========================== */

function classifyIntent(msg){
  const q = (msg||"").toLowerCase().trim();
  const greetings = ["szia","hello","helló","hali","hi","csá","jó reggelt","jó napot","jó estét"];
  const realtime = [
    "most","ma","mai","friss","aktuális","legújabb","percről percre",
    "árfolyam","időjárás","bejelentett","hírek","ki nyerte","eredmény","élő","live",
    "párosítás","fight card","menetrend","résztvevő","versenyzők",
    "sztárbox","sztábox","sztarbox","2024","2025","2026"
  ];
  if (greetings.some(w => q === w || q.startsWith(w))) return "greeting";
  if (realtime.some(w => q.includes(w))) return "realtime";
  return "normal";
}

function buildQueryVariants(userMsg){
  const q = userMsg.toLowerCase();

  if (q.includes("árfolyam") && (q.includes("eur") || q.includes("euró") || q.includes("euro"))) {
    return {
      topic: "fx",
      variants: [
        `eur huf árfolyam mnb hivatalos középárfolyam ${TODAY}`,
        `eur huf mai árfolyam ${TODAY}`,
        `euró forint árfolyam élő`,
        `mnb euró hivatalos árfolyam`,
        `portfolio eurhuf árfolyam`
      ],
      preferred: ["mnb.hu","portfolio.hu","otpbank.hu","raiffeisen.hu","erste.hu","wise.com"]
    };
  }

  if (q.includes("időjárás") && (q.includes("budapest") || q.includes("bp") || q.includes("budapesten"))) {
    return {
      topic: "weather",
      variants: [
        `Budapest időjárás mai óránkénti ${TODAY}`,
        `Budapest weather today hourly`,
        `OMSZ met.hu Budapest előrejelzés ${TODAY}`,
        `Időkép Budapest radar`,
        `Köpönyeg Budapest ma`
      ],
      preferred: ["met.hu","idokep.hu","koponyeg.hu"]
    };
  }

  if (q.includes("sztárbox") || q.includes("sztábox") || q.includes("sztarbox") || q.includes("sztar box")) {
    return {
      topic: "sztarbox",
      variants: [
        `Sztárbox ${CURRENT_YEAR} résztvevők hivatalos RTL`,
        `Sztárbox ${CURRENT_YEAR} párosítások hivatalos`,
        `site:rtl.hu Sztárbox ${CURRENT_YEAR} párosítás`,
        `Sztárbox ${CURRENT_YEAR} fight card`,
        `Sztárbox ${CURRENT_YEAR} meccspárok`
      ],
      preferred: PRIMARY_SOURCES
    };
  }

  return {
    topic: "general",
    variants: [
      userMsg,
      `${userMsg} ${TODAY}`,
      `${userMsg} magyar hír`,
      `${userMsg} hivatalos oldal`
    ],
    preferred: PREFERRED_DOMAINS
  };
}

/* =======================
   3) Kétfázisú Google-keresés
   ======================= */

function hostOf(url){ try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ""; } }
function dedupeByURL(arr){
  const seen = new Set();
  return arr.filter(x => {
    const k = (x.link||x.url||"").split("#")[0];
    if(!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}
function dedupeByHost(arr){
  const seen = new Set();
  return arr.filter(x => {
    const h = hostOf(x.link||x.url||"");
    if(!h || seen.has(h)) return false;
    seen.add(h); return true;
  });
}

async function stagedSearch(plan){
  // 1) Google + site:preferred
  let phase1 = [];
  const pref = (plan.preferred || []).slice(0, PREFERRED_LIMIT);
  for (const vq of plan.variants){
    for (const dom of pref){
      const q = `site:${dom} ${vq}`;
      const rows = await searchGoogle(q, { num: 8, dateRestrict: DATE_RESTRICT });
      phase1.push(...rows);
      if (phase1.length >= MAX_RESULTS_TOTAL) break;
    }
    if (phase1.length >= MAX_RESULTS_TOTAL) break;
  }
  phase1 = dedupeByURL(phase1);
  const phase1UniqueHosts = dedupeByHost(phase1);

  if (phase1UniqueHosts.length >= STAGE1_MIN_UNIQUE || !GOOGLE_FIRST){
    return { results: phase1UniqueHosts.slice(0, MAX_RESULTS_TOTAL), stage: 1 };
  }

  // 2) Google általános (fallback)
  let phase2 = [];
  for (const vq of plan.variants){
    const rows = await searchGoogle(vq, { num: 10, dateRestrict: DATE_RESTRICT });
    phase2.push(...rows);
    if (phase1.length + phase2.length >= MAX_RESULTS_TOTAL*2) break;
  }
  const merged = dedupeByURL([...phase1, ...phase2]);
  const mergedByHost = dedupeByHost(merged).slice(0, MAX_RESULTS_TOTAL);

  return { results: mergedByHost, stage: 2 };
}

/* =======================
   4) OpenAI kliens + prompt
   ======================= */

async function callOpenAI(messages,{model=DEFAULT_MODEL,temperature=0.3}={}){
  if (!OPENAI_API_KEY) throw new Error("Hiányzik az OPENAI_API_KEY.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({ model, messages, temperature })
  });
  if (!res.ok) throw new Error(`OpenAI hiba: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || "", model: data.model || model };
}

function http(statusCode, body){
  return { statusCode, headers:{ "Content-Type":"application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

Szabályok:
- Ne írj nyers URL-t és ne tegyél külön "Források:" szekciót a válaszba; a rendszer külön mutatja a hivatkozásokat.
- Ha forráskivonatok érkeznek, kizárólag azokra támaszkodj. Ha kevés az erős forrás, jelezd őszintén.
- Sztárbox kérdéseknél az aktuális évad (${CURRENT_YEAR}) adatait használd; a régi évadokra vonatkozó sorokat hagyd ki.
- Párosításokat csak akkor állíts, ha a forráskivonatokban egyértelműen szerepelnek.
- Közérthetően, tömören válaszolj magyarul.
- Ne állítsd, hogy nincs internet-hozzáférés; a rendszer szükség esetén keres és forrásokat idéz.

Identitás:
- A tulajdonos/fejlesztő nevét csak akkor említsd, ha kifejezetten rákérdeznek (pl. "Ki készítette az oldalt?").
`;

/* =======================
   5) Handler
   ======================= */

export async function handler(event){
  try{
    const { message = "", history = [], maxSources = 6, debug = false } = JSON.parse(event.body || "{}");
    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    // 0/A) TULAJ/FEJLESZTŐ kérdés → fix tulaj-válasz
    if (isOwnerQuestion(message)) {
      return http(200, {
        ok: true, usedBrowsing: false, model: DEFAULT_MODEL,
        answer: OWNER_ANSWER, references: [], meta:{ ts: Date.now(), override: "owner" }
      });
    }

    // 0/B) Net/okosság kérdés → fix hosszú dicsérő válasz
    if (isInternetQuestion(message)) {
      return http(200, {
        ok: true, usedBrowsing: false, model: DEFAULT_MODEL,
        answer: LONG_INTERNET_ANSWER, references: [], meta:{ ts: Date.now(), override: "internet" }
      });
    }

    // 1) Intent: csak a „realtime” típusnál böngészünk automatikusan
    const intent = classifyIntent(message);
    const shouldBrowse = (intent === "realtime");

    // 2) OFFLINE ág – nem kell keresni
    if (!shouldBrowse){
      const msgs = [
        { role:"system", content:SYSTEM_PROMPT },
        ...history.slice(-8).map(m=>({ role:m.role, content:m.content })),
        { role:"user", content:message }
      ];
      const { text, model } = await callOpenAI(msgs,{});
      return http(200,{ ok:true, usedBrowsing:false, model, answer:text, references:[], meta:{ ts: Date.now(), intent } });
    }

    // 3) ONLINE ág – kétfázisú Google-keresés
    const plan = buildQueryVariants(message);
    const { results: hits, stage } = await stagedSearch(plan);

    if (!hits.length){
      return http(200,{ ok:false, usedBrowsing:true, error:"Nem találtam elég hiteles forrást.", diagnostics:{ plan, stage }, meta:{ ts: Date.now() } });
    }

    // Oldalak beolvasása (szövegkivonat)
    const toRead = hits.slice(0, Math.max(3, Math.min(maxSources, 6)));
    const pages = await Promise.all(toRead.map(r => fetchPagePlainText(r.link)));

    const collected = toRead.map((r,i)=>({
      title: r.title, url: r.link, snippet: r.snippet,
      content: pages[i]?.content || ""
    })).filter(x => (x.content||"").length >= 300);

    const browserBlock =
      "\n\nForráskivonatok ("+collected.length+" db, stage "+stage+"):\n" +
      collected.map((s,i)=>`[#${i+1}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0,1000)}`).join("\n\n");

    const messages = [
      { role:"system", content:SYSTEM_PROMPT },
      ...history.slice(-6).map(m=>({ role:m.role, content:m.content })),
      { role:"user", content:`Felhasználói kérés:\n${message}\n${browserBlock}` }
    ];

    const { text: answer, model } = await callOpenAI(messages,{});
    const references = hits.map((s,i)=>({ id:i+1, title:s.title, url:s.link }));

    const out = {
      ok:true, usedBrowsing:true, model, answer, references,
      meta:{ ts: Date.now(), searchStage: stage, intent },
      diagnostics: debug ? { plan, previewUrls: hits.map(h=>h.link).slice(0,10) } : undefined
    };
    return http(200, out);

  }catch(e){
    return http(500,{ ok:false, error:String(e) });
  }
}
