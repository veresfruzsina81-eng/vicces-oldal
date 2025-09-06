// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL  = process.env.OPENAI_MODEL || "gpt-4.1";
const TODAY = new Date().toISOString().slice(0,10);
const CURRENT_YEAR = new Date().getFullYear();

/* =======================
   0) Általános beállítások
   ======================= */

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

const GOOGLE_FIRST       = true;
const PREFERRED_LIMIT    = 6;
const STAGE1_MIN_UNIQUE  = 4;
const MAX_RESULTS_TOTAL  = 12;
const DATE_RESTRICT      = "d90";

/* =========================================
   1) Speciális fix válaszok + felismerők
   ========================================= */

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

const OWNER_ANSWER = `Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka).
A rendszer felépítése, a böngészési képességek és az összes okos funkció az ő egyedi munkájának és kitartó fejlesztésének köszönhető.`;

/* ---------- Kimenet-szűrő: tiltsuk a hamis "OpenAI készítette" állítást ---------- */
function sanitizeIdentity(text){
  if (!text) return text;
  let out = text;
  const badClaims = [
    /openai (k[eé]sz[ií]tette|fejlesztette|hozta l[eé]tre|üzemelteti)/i,
    /(az oldalt|a rendszert)[^.!?]{0,40}openai[^.!?]{0,20}(k[eé]sz[ií]tette|fejlesztette)/i,
    /engem az openai fejlesztett/i
  ];
  if (badClaims.some(rx => rx.test(out))) {
    out = out
      .replace(/openai/gi, "Horváth Tamás (Szabolcsbáka)")
      .replace(/(k[eé]sz[ií]tette|fejlesztette|hozta l[eé]tre|üzemelteti)/gi, "készítette és fejleszti");
  }
  return out;
}

/* ---------- String normalizáló ---------- */
function _norm(s){
  return (s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\s]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

/* ----- Tulaj/fejlesztő kérdés ----- */
const OWNER_PHRASES = [
  "ki keszitette","ki hozta letre","ki csinalta","ki a tulaj","ki a fejleszto","kinek a tulajdona",
  "kiae az oldal","ki a gazdaja","kik keszitettek","kik fejlesztettek","ki az alkoto","ki az uzemelteto","ki uzemelteti",
  "ki keszitett engem","ki fejlesztett engem","ki hozott letre teged","ki csinalt teged"
];
function isOwnerQuestion(msg){
  const q = _norm(msg);
  return OWNER_PHRASES.some(p => q.includes(p)) ||
         /\bki.*(keszitette|hozta letre|csinalta|fejleszto|tulaj|alkoto|uzemelteti)\b/.test(q);
}

/* ----- Internet/okosság kérdés ----- */
const PHRASES_EXPLICIT = [
  "van neted","van interneted","van netes eleresed","van internetes hozzaferesed",
  "hozzafersz az internethez","hozzafer az internethez","hozzaferesed van a nethez",
  "internetes hozzaferes","net hozzaferes","van internet hozzaferesed",
  "bongeszni tudsz","tudsz bongeszni","bongeszel a neten","bongeszol a neten",
  "keresel a neten","keresel a google ben","googlizol","google zel","googlezel",
  "forrasokat adsz","forrasokat hozol","honnan az info","honnan tudod az infot",
  "okos ai vagy","okos al vagy","profi ai","mennyire okos vagy","intelligens vagy e",
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
  if (/van.*net|van.*internet|bonges(z|sz)|googliz|google zel|googlezel/.test(q)) return true;
  return false;
}

/* ----- Pontos magyar idő ----- */
const TIME_QUESTIONS = [
  "hany ora van magyarorszagon","mennyi az ido magyarorszagon","hany ora van budapesten",
  "mennyi az ido budapesten","pontos ido magyarorszagon","pontos ido budapest"
];
function isHungaryTimeQuestion(msg){
  const q = _norm(msg);
  if (TIME_QUESTIONS.some(p => q.includes(p))) return true;
  return /(hany ora|mennyi az ido|pontos ido).*(magyarorszagon|budapesten|mo|hu)/.test(q);
}
function formatHuTime(zone = "Europe/Budapest"){
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('hu-HU', { timeZone: zone, year:'numeric', month:'long', day:'numeric', weekday:'long' }).format(now);
  const fmtTime = new Intl.DateTimeFormat('hu-HU', { timeZone: zone, hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(now);
  const tzName  = new Intl.DateTimeFormat('hu-HU', { timeZone: zone, timeZoneName:'short' }).format(now).split(' ').pop();
  return { fmtDate, fmtTime, tzName };
}

/* ----- Találós kérdés mód ----- */
const RIDDLE_TRIGGERS = [
  "talalos kerdes","talalosk","talalost","adj egy talalos","meg egy talalos",
  "johet a kovetkezo","kovetkezo talalos","meg egyet","meg egy feladvany","uj feladvany","adnal egy feladvanyt"
];
const GIVE_UP_TRIGGERS = ["feladom","nem tudom","passz","passzolom","nem megy"];

function isRiddleRequest(msg){
  const q = _norm(msg);
  if (RIDDLE_TRIGGERS.some(p => q.includes(p))) return true;
  if (/^mi az[:,]/.test(q) || /mi az ami/.test(q)) return true; // klasszikus forma
  return false;
}
function isGiveUp(msg){
  const q = _norm(msg);
  return GIVE_UP_TRIGGERS.some(p => q.includes(p));
}
// egyszerű Levenshtein hasonlóság
function similarity(a,b){
  a=_norm(a); b=_norm(b);
  if (!a || !b) return 0;
  if (a===b) return 1;
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+cost);
    }
  }
  const dist = dp[m][n];
  const maxLen = Math.max(m,n);
  return 1 - dist/maxLen; // 0..1
}

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

async function makeRiddle(){
  const sys = "Adj EGY magyar találós kérdést. Csak JSON-t adj vissza, semmi mást.";
  const user = `Válasz JSON-ben:
{
 "riddle": "<rövid, frappáns találós kérdés>",
 "answer": "<egy szavas vagy rövid válasz>",
 "hint": "<1 rövid tipp>"
}
Fontos: ne legyen obszcén vagy érzékeny téma; a válasz legyen egyszerű (pl. 'nap', 'árnyék', 'kulcs').`;

  const out = await callOpenAI([
    {role:"system", content:sys},
    {role:"user", content:user}
  ], { model: DEFAULT_MODEL, temperature: 0.7 });

  try{
    const json = JSON.parse(out.text.replace(/```json|```/g,"").trim());
    const riddle = String(json.riddle||"").trim();
    const answer = String(json.answer||"").trim();
    const hint   = String(json.hint||"").trim();
    if (!riddle || !answer) throw new Error("Hiányos riddle JSON");
    return { riddle, answer, hint };
  }catch(e){
    return { riddle:"Mi az: este jön, reggel megy, de sosem alszik?", answer:"nap", hint:"Égi jelenség." };
  }
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
   4) Rendszer prompt
   ======================= */

const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

Szabályok:
- Ne írj nyers URL-t és ne tegyél külön "Források:" szekciót a válaszba; a rendszer külön mutatja a hivatkozásokat.
- Ha forráskivonatok érkeznek, kizárólag azokra támaszkodj. Ha kevés az erős forrás, jelezd őszintén.
- Sztárbox kérdéseknél az aktuális évad (${CURRENT_YEAR}) adatait használd; a régi évadokra vonatkozó sorokat hagyd ki.
- Párosításokat csak akkor állíts, ha a forráskivonatokban egyértelműen szerepelnek.
- Közérthetően, tömören válaszolj magyarul.
- Ne állítsd, hogy nincs internet-hozzáférés; a rendszer szükség esetén keres és forrásokat idéz.

Identitás és tulajdon:
- Az oldalt és a rendszert **nem az OpenAI** készítette. Tilos azt állítani vagy sugallni, hogy az OpenAI fejlesztette vagy üzemelteti.
- A tulajdonos/fejlesztő neve csak kifejezett kérdésre említhető: **Horváth Tamás (Szabolcsbáka)**.
- Találós kérdés esetén elsődlegesen a megfejtésre törekedj röviden; magyarázatot csak kérésre adj.
`;

/* =======================
   5) HTTP helper
   ======================= */

function http(statusCode, body){
  return { statusCode, headers:{ "Content-Type":"application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

/* =======================
   6) Handler
   ======================= */

export async function handler(event){
  try{
    const payload = JSON.parse(event.body || "{}");
    const { message = "", history = [], maxSources = 6, debug = false, context = {} } = payload;
    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    // Kontextus (pl. aktív találós kérdés)
    let meta = context || {};
    const activeRiddle = meta?.riddle || null;

    // 1) Tulaj/fejlesztő kérdés
    if (isOwnerQuestion(message)) {
      return http(200, {
        ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
        answer: OWNER_ANSWER, references: [],
        meta: { ...meta, riddle:null, override:"owner", ts: Date.now() }
      });
    }

    // 2) Pontos magyar idő
    if (isHungaryTimeQuestion(message)) {
      const { fmtDate, fmtTime, tzName } = formatHuTime("Europe/Budapest");
      const answer =
        `🕒 Mostani magyar idő (Europe/Budapest): **${fmtTime}** (${tzName})\n` +
        `Dátum: ${fmtDate}\n\n` +
        `A fenti időt helyben számoltam ki (időzóna: Europe/Budapest, automatikus téli/nyári idő).`;
      return http(200, {
        ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
        answer, references: [], meta:{ ...meta, override:"hu-time", ts: Date.now() }
      });
    }

    // 3) Találós kérdés mód — új feladvány
    if (isRiddleRequest(message) || (activeRiddle && /kovetkezo|meg egy|uj feladvany/.test(_norm(message)))) {
      const r = await makeRiddle();
      meta = { ...meta, riddle: { answer: r.answer, hint: r.hint, norm: _norm(r.answer) } };
      return http(200, {
        ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
        answer: `Persze! Itt egy találós kérdés:\n\n${r.riddle}`,
        references: [], meta:{ ...meta, override:"riddle-new", ts: Date.now() }
      });
    }

    // 3/b) Találós kérdés — feladás
    if (activeRiddle && isGiveUp(message)) {
      const sol = activeRiddle.answer || "—";
      meta = { ...meta, riddle: null };
      return http(200, {
        ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
        answer: `Semmi baj! 🙂 A helyes megoldás: **${sol}**.\nJöhet egy másik találós kérdés?`,
        references: [], meta:{ ...meta, override:"riddle-giveup", ts: Date.now() }
      });
    }

    // 3/c) Találós kérdés — tipp értékelése
    if (activeRiddle) {
      const guess = _norm(message);
      const target = activeRiddle.norm;
      const sim = similarity(guess, target);
      if (sim >= 0.85 || guess.includes(target) || target.includes(guess)) {
        meta = { ...meta, riddle: null };
        return http(200, {
          ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
          answer: `Helyes! ✅ Megfejtés: **${activeRiddle.answer}**.\nJöhet még egy találós kérdés?`,
          references: [], meta:{ ...meta, override:"riddle-correct", ts: Date.now() }
        });
      } else if (sim >= 0.55) {
        return http(200, {
          ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
          answer: `Majdnem! 😉 Tipp: **${activeRiddle.hint}**.\nPróbálod még, vagy *feladod*?`,
          references: [], meta:{ ...meta, override:"riddle-close", ts: Date.now() }
        });
      } else {
        return http(200, {
          ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
          answer: `Nem ez az. Tipp: **${activeRiddle.hint}**.\nPróbálod tovább, vagy *feladod*?`,
          references: [], meta:{ ...meta, override:"riddle-try", ts: Date.now() }
        });
      }
    }

    // 4) Internet/okosság kérdés
    if (isInternetQuestion(message)) {
      return http(200, {
        ok:true, usedBrowsing:false, model: DEFAULT_MODEL,
        answer: LONG_INTERNET_ANSWER, references: [],
        meta:{ ...meta, riddle:null, override:"internet", ts: Date.now() }
      });
    }

    // 5) Döntés: böngésszünk-e?
    const intent = classifyIntent(message);
    const shouldBrowse = (intent === "realtime");

    // 6) OFFLINE ág
    if (!shouldBrowse){
      const msgs = [
        { role:"system", content:SYSTEM_PROMPT },
        ...history.slice(-8).map(m=>({ role:m.role, content:m.content })),
        { role:"user", content:message }
      ];
      const { text, model } = await callOpenAI(msgs,{});
      const clean = sanitizeIdentity(text);
      return http(200,{ ok:true, usedBrowsing:false, model, answer: clean, references:[], meta:{ ...meta, ts: Date.now(), intent } });
    }

    // 7) ONLINE ág – kétfázisú Google-keresés + forráskivonatok
    const plan = buildQueryVariants(message);
    const { results: hits, stage } = await stagedSearch(plan);

    if (!hits.length){
      return http(200,{ ok:false, usedBrowsing:true, error:"Nem találtam elég hiteles forrást.", diagnostics:{ plan, stage }, meta:{ ...meta, ts: Date.now() } });
    }

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
    const clean = sanitizeIdentity(answer);
    const references = hits.map((s,i)=>({ id:i+1, title:s.title, url:s.link }));

    return http(200, {
      ok:true, usedBrowsing:true, model, answer: clean, references,
      meta:{ ...meta, ts: Date.now(), searchStage: stage, intent },
      diagnostics: debug ? { plan, previewUrls: hits.map(h=>h.link).slice(0,10) } : undefined
    });

  }catch(e){
    return http(500,{ ok:false, error:String(e) });
  }
}
