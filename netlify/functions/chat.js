// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

/** ======= Alap beállítások ======= */
const DEFAULT_MODEL  = process.env.OPENAI_MODEL || "gpt-4.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TODAY = new Date().toISOString().slice(0,10);
const CURRENT_YEAR = new Date().getFullYear(); // 2025

// Adaptív küszöbök
const MIN_SOURCES_STRICT = 3;
const MIN_SOURCES_RELAX  = 2;
const MIN_CHARS_STRICT   = 300;
const MIN_CHARS_RELAX    = 120;

// Hány URL-ről töltsünk le szöveget a sebesség miatt
const MAX_PAGES_TO_FETCH = 8;

/** Elsőbbségi források – ezeket mindig megtartjuk és előresoroljuk */
const PRIMARY_SOURCES = [
  // RTL / tulajdon
  "rtl.hu","rtl.hu/sztarbox","rtlmost.hu","rtlplusz.hu",
  // közösségi
  "facebook.com","instagram.com","x.com","twitter.com","youtube.com","tiktok.com",
  // aggregátor / enciklopédia
  "news.google.com","google.com/search","wikipedia.org",
  // nagy magyar híroldalak
  "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","blikk.hu","origo.hu",
  // sport
  "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu"
];

/** Párosításokhoz számított „megbízható” domainek */
const TRUSTED_MATCHUP_DOMAINS = [
  "rtl.hu","rtlmost.hu","rtlplusz.hu",
  "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","origo.hu","blikk.hu",
  "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu",
  "facebook.com","instagram.com","x.com","twitter.com","youtube.com","tiktok.com",
  "news.google.com","wikipedia.org"
];

/** Általános preferenciák (rangsoroláshoz) */
const PREFERRED_DOMAINS = [
  "mnb.hu","portfolio.hu","otpbank.hu","raiffeisen.hu","erste.hu","granitbank.hu","wise.com","revolut",
  "met.hu","idokep.hu","koponyeg.hu",
  ...PRIMARY_SOURCES
];

/** ======= INTENT – mikor böngésszen ======= */
function classifyIntent(msg){
  const q = (msg||"").toLowerCase().trim();
  const greetings = ["szia","hello","helló","hali","hi","csá","jó reggelt","jó napot","jó estét"];
  const followups = ["mesélsz róla","meselj rola","bővebben","részletek","és még","még?","oké","köszi","köszönöm","értem","arról","róla"];

  // Realtime kulcsszavak – BŐVÍTVE a "résztvevők/szereplők/indulók/versenyzők"-kel
  const realtime = [
    "most","ma","mai","friss","aktuális","legújabb","percről percre",
    "árfolyam","időjárás","bejelentett","bejelentés","hírek","ki nyerte","eredmény","élő","live",
    "párosítás","fight card","menetrend","ár","akció","készlet",
    "résztvevő","résztvevők","szereplő","szereplők","induló","indulók","versenyző","versenyzők",
    "2024","2025","2026"
  ];

  if (greetings.some(w => q === w || q.startsWith(w))) return "greeting";
  if (realtime.some(w => q.includes(w))) return "realtime";         // ⬅ realtime előrébb!
  if (followups.some(w => q.includes(w)) || q.split(/\s+/).length <= 3) return "followup";
  return "normal";
}

/** ======= Query-variánsok (témafüggő) ======= */
function buildQueryVariants(userMsg){
  const q = userMsg.toLowerCase();

  // EUR/HUF árfolyam
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

  // Budapest időjárás
  if (q.includes("időjárás") && (q.includes("bp") || q.includes("budapest") || q.includes("budapesten"))) {
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

  // SZTÁRBOX – résztvevők & párosítások (gyors és célzott)
  if (q.includes("sztárbox") || q.includes("sztábox") || q.includes("sztarbox") || q.includes("sztar box")) {
    return {
      topic: "sztarbox",
      variants: [
        `Sztárbox ${CURRENT_YEAR} résztvevők hivatalos RTL`,
        `Sztárbox ${CURRENT_YEAR} párosítások RTL`,
        `site:rtl.hu Sztárbox ${CURRENT_YEAR}`,
        `site:news.google.com Sztárbox ${CURRENT_YEAR}`,
        `Sztárbox ${CURRENT_YEAR} indulók`
      ],
      preferred: [
        "rtl.hu","rtl.hu/sztarbox","rtlmost.hu","rtlplusz.hu",
        "news.google.com","wikipedia.org",
        "facebook.com","instagram.com","x.com","youtube.com","tiktok.com",
        "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","blikk.hu",
        "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu"
      ]
    };
  }

  // Alapértelmezett
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

/** ======= Segédfüggvények ======= */
function uniqByUrl(arr){ const s=new Set(); return arr.filter(x=>!s.has(x.url)&&s.add(x.url)); }
function scoreByPreferred(url, preferred){ return preferred.some(d=>url.includes(d)) ? 1 : 0; }
function isPrimary(url){ return PRIMARY_SOURCES.some(d => url.includes(d)); }
function isTrustedDomain(url){ return TRUSTED_MATCHUP_DOMAINS.some(d => url.includes(d)); }
function sortPrimaryFirst(items, preferred){
  return items.slice().sort((a,b)=>{
    const ap = isPrimary(a.url)?1:0, bp = isPrimary(b.url)?1:0;
    if (ap!==bp) return bp-ap;
    return scoreByPreferred(b.url, preferred)-scoreByPreferred(a.url, preferred);
  });
}

// „X vs Y” felismerő (párosítások)
function extractMatchupsFromText(text){
  if (!text) return [];
  const rxs = [
    /([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)\s*(?:vs\.?|–|—|-)\s*([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)/gu,
    /párosítás[a-z]*:\s*([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)\s*(?:–|—|-)\s*([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)/giu
  ];
  const out = new Set();
  for (const rx of rxs){ let m; while((m=rx.exec(text))!==null){
    const a=m[1].replace(/\s+/g," ").trim(), b=m[2].replace(/\s+/g," ").trim();
    if (a && b && a.toLowerCase()!==b.toLowerCase()) out.add(`${a} vs ${b}`);
  }}
  return [...out];
}

// 2025 fókusz: dobjuk ki a 2023/2024/„előző évad/korábbi” sorokat
function removeOldSeasons(text){
  if (!text) return "";
  return text
    .split(/[\r\n]+/g)
    .map(l => l.trim())
    .filter(l => {
      if (/\b2023\b/.test(l) || /\b2024\b/.test(l)) return false;
      if (/előző évad|korábbi évad/i.test(l)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

// Magyar 2–3 szavas személynevek kinyerése
function extractPersonNamesHu(text){
  if (!text) return [];
  const rx = /([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+){1,2})/gu;
  const out = new Set();
  let m;
  while ((m = rx.exec(text)) !== null){
    const name = m[1].replace(/\s+/g, " ").trim();
    if (name.length >= 5) out.add(name);
  }
  return [...out];
}

// Nevek: kontextus pontozása (2025/idén/aktuális vs régi)
function scoreNamesByContext(text, year){
  const names = extractPersonNamesHu(text);
  const y = String(year);
  const CURR = new RegExp(`\\b(${y}|idén|aktuális|${y}[-\\s]?ös)\\b`, "i");
  const PREV = /\b(2023|2024|korábbi|előző)\b/i;
  const map = {};
  for (const n of names){
    const idx = text.indexOf(n);
    let curr = 0, prev = 0;
    if (idx >= 0){
      const ctx = text.slice(Math.max(0, idx-120), idx+120);
      if (CURR.test(ctx)) curr++;
      if (PREV.test(ctx)) prev++;
    }
    map[n] = { curr, prev };
  }
  return map;
}

// Nevek összesítése több forrásból: legalább 2 "curr" és 0 "prev"
function aggregateNames(sourcesContents, year){
  const agg = {};
  for (const content of sourcesContents){
    const scored = scoreNamesByContext(content, year);
    for (const [name, s] of Object.entries(scored)){
      if (!agg[name]) agg[name] = { curr:0, prev:0, hits:0 };
      agg[name].curr += s.curr;
      agg[name].prev += s.prev;
      agg[name].hits += 1;
    }
  }
  const allow = [];
  for (const [name, a] of Object.entries(agg)){
    if (a.curr >= 2 && a.prev === 0){
      allow.push(name);
    }
  }
  allow.sort((a,b)=> (agg[b].curr - agg[a].curr) || (agg[b].hits - agg[a].hits));
  return { allow, raw: agg };
}

// Nevek normalizálása és párok aggregálása (≥2 domain + van trusted)
function normName(s){ return s.replace(/\s+/g," ").trim(); }
function normPair(a,b){
  const A = normName(a), B = normName(b);
  return A.localeCompare(B, "hu", {sensitivity:"base"}) <= 0 ? `${A} vs ${B}` : `${B} vs ${A}`;
}
function aggregateMatchupsFromSources(collected){
  const map = {};
  for (const s of collected){
    const text = s.content || "";
    const url  = s.url || "";
    const trusted = isTrustedDomain(url);
    const pairs = extractMatchupsFromText(text);
    for (const p of pairs){
      const m = /^(.+?)\s+vs\s+(.+)$/.exec(p);
      if (!m) continue;
      const key = normPair(m[1], m[2]);
      if (!map[key]) map[key] = { domains:new Set(), anyTrusted:false, examples:[] };
      try { map[key].domains.add(new URL(url).hostname.replace(/^www\./,'')); } catch {}
      map[key].anyTrusted = map[key].anyTrusted || trusted;
      const idx = text.indexOf(m[0]);
      const ctx = idx>=0 ? text.slice(Math.max(0,idx-80), idx+80) : "";
      if (map[key].examples.length < 2) map[key].examples.push({ url, ctx });
    }
  }
  const verified = [];
  for (const [k,v] of Object.entries(map)){
    if (v.domains.size >= 2 && v.anyTrusted){
      verified.push({ pair:k, sources:[...v.domains], anyTrusted:v.anyTrusted, examples:v.examples });
    }
  }
  verified.sort((a,b)=> b.sources.length - a.sources.length);
  return { verified, raw: map };
}

/** ======= Rendszerprompt ======= */
const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

Szabályok:
- Ha forráskivonatok érkeznek, kizárólag azokra támaszkodj. Cutoff-ot ne említs.
- Hivatkozásokat sorszámozva add meg: [1], [2], [3].
- Ha nincs elég jó forrás, mondd ki őszintén és javasolj kulcsszavakat.
- Ha a Sztárbox résztvevőiről/párosításairól kérdeznek, mindig az aktuális évad (${CURRENT_YEAR}) adatait írd. Régi (2023/2024) nevek felsorolását kerüld.
- Ha a kontextusban szerepel ELLENŐRZÖTT LISTA (currentSeasonNames), akkor a Sztárbox aktuális évadának résztvevőit csak ebből sorold fel.
- Sztárbox párosításokat csak akkor sorolj fel, ha azok a kontextusban szereplő, ellenőrzött listában (VERIFIED MATCHUPS) is benne vannak. Ha nincs ilyen lista, jelezd, hogy a teljes hivatalos párosítás még nem biztosan ismert.
- Ne tüntess fel „női/férfi/súlycsoport” kategóriát, ha a források nem mondják ki egyértelműen.

Identitás:
- "Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka)."

Stílus:
- Rövid bevezető → lényegpontok → részletek. Magyarul, tömören.
`;

/** ======= OpenAI hívó ======= */
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

/** ======= HTTP helper ======= */
function http(statusCode, body){
  return { statusCode, headers:{ "Content-Type":"application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

/** ======= Handler ======= */
export async function handler(event){
  try{
    const {
      message = "",
      history = [],           // [{role:"user"|"assistant", content:"..."}]
      maxSources = 8,
      recencyDays,
      forceBrowse = null,
      debug = false           // 👈 ha true, részletes diagnosztikát adunk vissza
    } = JSON.parse(event.body || "{}");
    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    const intent = classifyIntent(message);
    const shouldBrowse = (forceBrowse===true) ? true
                        : (forceBrowse===false) ? false
                        : (intent === "realtime");

    // --- OFFLINE ág (nem böngészünk) ---
    if (!shouldBrowse){
      const msgs = [
        { role:"system", content:SYSTEM_PROMPT },
        ...history.slice(-8).map(m=>({ role:m.role, content:m.content })),
        { role:"user", content:message }
      ];
      const { text, model } = await callOpenAI(msgs,{});
      return http(200,{ ok:true, usedBrowsing:false, model, answer:text, references:[] });
    }

    // --- ONLINE ág (multi-query, adaptív) ---
    const plan = buildQueryVariants(message);
    const preferred = plan.preferred?.length ? plan.preferred : PREFERRED_DOMAINS;

    // Időablakok: Sztárboxnál 0→365→180→90→30 (0 = nincs dateRestrict)
    const tiers = (typeof recencyDays === "number")
      ? [recencyDays, Math.max(90,recencyDays), Math.max(365,recencyDays)]
      : (plan.topic==="sztarbox" ? [0,365,180,90,30] : [7,30,90,365]);

    let collected = [];
    let usedTier = null;
    const queriesTried = [];

    outer:
    for (const days of tiers){
      const batch = await Promise.all(
        plan.variants.map(vq => (queriesTried.push({q:vq, days}), searchGoogle(vq, {
          num: Math.min(Math.max(maxSources, MIN_SOURCES_STRICT), 10),
          recencyDays: days
        })))
      );

      let flat = uniqByUrl(batch.flat().map(it => ({ title: it.title, url: it.link, snippet: it.snippet })));
      flat = sortPrimaryFirst(flat, preferred);

      // csak az első 8 oldalról töltünk le szöveget (gyors!)
      const flatTop = flat.slice(0, MAX_PAGES_TO_FETCH);
      let pages = await Promise.all(flatTop.map(r => fetchPagePlainText(r.url)));

      // 🎯 Sztárbox: 2025 fókusz – dobjuk a régi évad-sorokat
      const isSztar = plan.topic === "sztarbox";
      if (isSztar){
        pages = pages.map(p => ({ ...p, content: removeOldSeasons(p.content) }));
      }

      const PRIMARY_MIN = isSztar ? 60 : MIN_CHARS_RELAX;

      // szigorú
      let strict = flatTop.map((r,i)=>({
          ...r,
          content: pages[i]?.content || "",
          _primary: isPrimary(r.url)
        }))
        .filter(s =>
          (s._primary && s.content && s.content.length >= PRIMARY_MIN) ||
          (!s._primary && s.content && s.content.length >= MIN_CHARS_STRICT)
        );

      // lazítás
      let sources = strict;
      const minStrict = isSztar ? 2 : MIN_SOURCES_STRICT;
      if (sources.length < minStrict){
        sources = flatTop.map((r,i)=>({
            ...r,
            content: pages[i]?.content || "",
            _primary: isPrimary(r.url)
          }))
          .filter(s =>
            (s._primary && s.content && s.content.length >= PRIMARY_MIN) ||
            (!s._primary && s.content && s.content.length >= MIN_CHARS_RELAX)
          );
      }

      sources = sortPrimaryFirst(sources, preferred).slice(0, Math.max(3,6));
      if (sources.length >= (isSztar ? 2 : MIN_SOURCES_RELAX)){
        collected = sources;
        usedTier = days;
        break outer;
      }
    }

    // utolsó fallback: no-dateRestrict + 10 találat
    if (!collected.length){
      const last = await Promise.all(plan.variants.map(vq => searchGoogle(vq, { num: 10, recencyDays: 0 })));
      let flat = uniqByUrl(last.flat().map(it => ({ title: it.title, url: it.link, snippet: it.snippet })));
      flat = sortPrimaryFirst(flat, preferred);

      const flatTop = flat.slice(0, MAX_PAGES_TO_FETCH);
      let pages2 = await Promise.all(flatTop.map(r => fetchPagePlainText(r.url)));
      const isSztar = plan.topic === "sztarbox";
      if (isSztar){
        pages2 = pages2.map(p => ({ ...p, content: removeOldSeasons(p.content) }));
      }
      const PRIMARY_MIN = isSztar ? 60 : MIN_CHARS_RELAX;

      let sources2 = flatTop.map((r,i)=>({
          ...r, content: pages2[i]?.content || "",
          _primary: isPrimary(r.url)
        }))
        .filter(s => (s._primary && s.content && s.content.length >= PRIMARY_MIN) ||
                     (!s._primary && s.content && s.content.length >= MIN_CHARS_RELAX));

      sources2 = sortPrimaryFirst(sources2, preferred).slice(0, 6);

      if (sources2.length >= 1){
        collected = sources2;
        usedTier = 0;
      } else {
        return http(200,{
          ok:false, usedBrowsing:true,
          error:"Sztárbox: nem találtam elég hiteles forrást (fallback sem).",
          diagnostics:{ topic:plan.topic, triedNoDateRestrict:true, previewUrls: flat.slice(0,10).map(x=>x.url) }
        });
      }
    }

    // ✅ Résztvevők (csak 2025-ös kontextus alapján, ≥2 forrás)
    let currentSeasonNames = [];
    let namesDiagnostics = null;
    if (plan.topic === "sztarbox"){
      const contents = collected.map(s => s.content || "");
      const agg = aggregateNames(contents, CURRENT_YEAR);
      currentSeasonNames = agg.allow;
      namesDiagnostics = agg.raw;
    }

    // ✅ Párosítások (≥2 külön domain + van trusted)
    const { verified: verifiedMatchups, raw: matchupsRaw } = aggregateMatchupsFromSources(collected);
    const matchups = verifiedMatchups.map(v => v.pair);

    // Kontextus az LLM-nek
    const browserBlock =
      "\n\nForráskivonatok ("+collected.length+" db):\n" +
      collected.map((s,i)=>`[#${i+1}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0,1000)}`).join("\n\n") +
      (currentSeasonNames.length ? `\n\nELLENŐRZÖTT LISTA (aktuális évad ${CURRENT_YEAR}):\n- ${currentSeasonNames.join("\n- ")}` : "") +
      (matchups.length
        ? `\n\nVERIFIED MATCHUPS (több forrás alapján):\n- ${matchups.join("\n- ")}`
        : `\n\nVERIFIED MATCHUPS: nincs elég, jelezd a bizonytalanságot.`);

    const messages = [
      { role:"system", content:SYSTEM_PROMPT },
      ...history.slice(-6).map(m=>({ role:m.role, content:m.content })),
      { role:"user", content:`Felhasználói kérés:\n${message}\n${browserBlock}` }
    ];

    const { text: answer, model } = await callOpenAI(messages,{});
    const references = collected.map((s,i)=>({ id:i+1, title:s.title, url:s.url }));

    const base = {
      ok:true, usedBrowsing:true, model, answer, references,
      diagnostics:{ topic:plan.topic, usedRecencyDays: usedTier, sourcesFound: collected.length },
      currentSeasonNames,
      verifiedMatchups: verifiedMatchups.map(v => ({ pair: v.pair, sources: v.sources.slice(0,5) }))
    };

    if (debug){
      base.debug = {
        queriesTried,
        previewUrls: collected.map(x=>x.url).slice(0,10),
        namesDiagnostics: Object.fromEntries(Object.entries(namesDiagnostics||{}).slice(0,15)),
        matchupsDebug: Object.fromEntries(Object.entries(matchupsRaw||{}).slice(0,10))
      };
    }

    return http(200, base);

  }catch(e){
    return http(500,{ ok:false, error:String(e) });
  }
}
