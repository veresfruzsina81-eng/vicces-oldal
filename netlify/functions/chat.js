// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL  = process.env.OPENAI_MODEL || "gpt-4.1";
const TODAY = new Date().toISOString().slice(0,10);
const CURRENT_YEAR = new Date().getFullYear();

// --- Forrásprior
const PRIMARY_SOURCES = [
  "rtl.hu","rtl.hu/sztarbox","rtlmost.hu","rtlplusz.hu",
  "facebook.com","instagram.com","x.com","twitter.com","youtube.com","tiktok.com",
  "news.google.com","google.com/search","wikipedia.org",
  "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","blikk.hu","origo.hu",
  "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu"
];

const TRUSTED_MATCHUP_DOMAINS = [
  "rtl.hu","rtlmost.hu","rtlplusz.hu",
  "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","origo.hu","blikk.hu",
  "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu",
  "facebook.com","instagram.com","x.com","twitter.com","youtube.com","tiktok.com",
  "news.google.com","wikipedia.org"
];

const PREFERRED_DOMAINS = [
  "mnb.hu","portfolio.hu","otpbank.hu","raiffeisen.hu","erste.hu","wise.com","granitbank.hu",
  "met.hu","idokep.hu","koponyeg.hu",
  ...PRIMARY_SOURCES
];

// --- Intent
function classifyIntent(msg){
  const q = (msg||"").toLowerCase().trim();
  const greetings = ["szia","hello","helló","hali","hi","csá","jó reggelt","jó napot","jó estét"];
  const followups = ["mesélsz","meselj","bővebben","részletek","és még","még?","oké","köszi","köszönöm","értem","arról","róla"];
  const realtime = [
    "most","ma","mai","friss","aktuális","legújabb","percről percre",
    "árfolyam","időjárás","bejelentett","hírek","ki nyerte","eredmény","élő","live",
    "párosítás","fight card","menetrend",
    "résztvevő","versenyzők",
    "2024","2025","2026","sztárbox","sztábox","sztarbox"
  ];
  if (greetings.some(w => q === w || q.startsWith(w))) return "greeting";
  if (realtime.some(w => q.includes(w))) return "realtime";
  if (followups.some(w => q.includes(w)) || q.split(/\s+/).length <= 3) return "followup";
  return "normal";
}

// --- Query variánsok
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
        `Sztárbox ${CURRENT_YEAR} párosítások RTL`,
        `site:rtl.hu Sztárbox ${CURRENT_YEAR}`,
        `site:news.google.com Sztárbox ${CURRENT_YEAR}`,
        `Sztárbox ${CURRENT_YEAR} indulók`
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

// --- Segédek
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

// --- Régi évad törlés
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

// --- Névkinyerés
const NAME_STOPWORDS = new Set([
  "Sztárboxban","Elkezdődött","Reggeli","Házon","Boxing","Kings","Exek",
  "Security","Hell","Adam","Marcsii","Előző","Korábbi","Versenyzők","Lista",
  "Részletes","Hivatalos","RTL","Verseny","Indul","Bemutatkozik","Kezdés"
]);
function looksLikeHuNameToken(tok){ return /^[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű-]{2,}$/.test(tok); }
function extractPersonNamesHu(text){
  if (!text) return [];
  const out = new Set();
  const rx = /([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű-]{2,})\s+([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű-]{2,})/gu;
  let m;
  while ((m = rx.exec(text)) !== null){
    const a = m[1], b = m[2];
    if (!looksLikeHuNameToken(a) || !looksLikeHuNameToken(b)) continue;
    if (NAME_STOPWORDS.has(a) || NAME_STOPWORDS.has(b)) continue;
    out.add(`${a} ${b}`);
  }
  return [...out];
}
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
    if (a.curr >= 2 && a.prev === 0){ allow.push(name); }
  }
  allow.sort((a,b)=> (agg[b].curr - agg[a].curr) || (agg[b].hits - agg[a].hits));
  return { allow, raw: agg };
}

// --- Párosítások
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

// --- Csatorna + kezdés (RTL esetén 1 forrás is elég, „előzetes”)
function extractBroadcasterAndDate(collected, year){
  const out = {
    broadcaster: null,
    premiereDate: null,
    premiereConfidence: null, // 'multi' vagy 'trusted'
    proofs: { broadcaster: [], date: [] }
  };

  const CH_RX = /\b(RTL(?:\s*Klub)?|RTL\s*\+|RTL\s*Plusz|RTL\s*csatorna)\b/i;
  const MONTHS = "jan|febr?|már|mar|ápr|apr|máj|maj|jún|jun|júl|jul|aug|szept?|okt|nov|dec";
  const DATE_RX = new RegExp(
    `\\b(20\\d{2}|${year})[\\.\\-/\\s]*(${MONTHS})[\\.]?\\s*(\\d{1,2})\\b|\\b(${MONTHS})[\\.]?\\s*(\\d{1,2})\\b`,
    "i"
  );

  const hostOf = (u)=>{ try{ return new URL(u).hostname.replace(/^www\\./,""); }catch{ return ""; } };
  const isTrusted = (h)=> /rtl\\.|telex\\.hu|index\\.hu|24\\.hu|hvg\\.hu|nemzetisport\\.hu|m4sport\\.hu/i.test(h);

  const dateMentions = new Map();
  let anyTrustedDate = null;

  for (const s of collected){
    const url = s.url || ""; const host = hostOf(url);
    const text = (s.content || "").slice(0, 6000);

    if (CH_RX.test(text)) {
      if (!out.broadcaster && /rtl\\./i.test(host)) out.broadcaster = "RTL";
      out.proofs.broadcaster.push({ host, url });
    }

    const dm = text.match(DATE_RX);
    if (dm){
      const raw = dm[0];
      if (!dateMentions.has(raw)) dateMentions.set(raw, new Set());
      dateMentions.get(raw).add(host);
      if (!anyTrustedDate && isTrusted(host)) anyTrustedDate = raw;
      out.proofs.date.push({ host, url, raw });
    }
  }

  if (!out.broadcaster){
    for (const s of collected){
      const h = hostOf(s.url||"");
      if (/rtl\\./i.test(h)) { out.broadcaster = "RTL"; break; }
    }
  }

  let bestMulti = null, bestCount = 0;
  for (const [raw, hosts] of dateMentions.entries()){
    const c = hosts.size;
    if (c > bestCount){ bestCount = c; bestMulti = raw; }
  }

  if (bestMulti && bestCount >= 2){
    out.premiereDate = bestMulti;
    out.premiereConfidence = "multi";
  } else if (anyTrustedDate){
    out.premiereDate = anyTrustedDate;
    out.premiereConfidence = "trusted";
  }

  return out;
}

// --- Prompt
const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

Szabályok:
- Soha NE írj nyers URL-t és NE készíts "Források:" szekciót a válasz szövegében. Ha hivatkozni kell, csak sorszámokat használj: [1], [2]. A linkeket a rendszer külön jeleníti meg.
- Ha forráskivonatok érkeznek, kizárólag azokra támaszkodj. Cutoff-ot ne említs.
- Ha nincs elég jó forrás, mondd ki őszintén és javasolj kulcsszavakat.
- Ha a Sztárboxról kérdeznek, mindig az aktuális évad (${CURRENT_YEAR}) adatait írd. Régi (2023/2024) nevek felsorolását kerüld.
- Ha a kontextusban szerepel ELLENŐRZÖTT LISTA (currentSeasonNames), akkor az aktuális évad résztvevőit csak ebből sorold fel.
- Párosításokat csak akkor sorolj fel, ha a kontextus VERIFIED MATCHUPS listát ad. Ha nincs elég, jelezd.
- Ha a kontextusban BROADCASTER szerepel, írd ki külön sorban: "Csatorna: <név>".
- Ha a kontextusban PREMIERE DATE szerepel, írd ki külön sorban: "Kezdés: <dátum>". Ha a bizalmi szint 'trusted', jelezd: "(előzetes)".

Identitás:
- "Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka)."

Stílus:
- Rövid bevezető → lényegpontok → részletek. Magyarul, tömören.
`;

// --- OpenAI
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

// --- fő handler
export async function handler(event){
  try{
    const { message = "", history = [], maxSources = 8, recencyDays, forceBrowse = null, debug = false } =
      JSON.parse(event.body || "{}");
    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    const intent = classifyIntent(message);
    const shouldBrowse = (forceBrowse===true) ? true
                        : (forceBrowse===false) ? false
                        : (intent === "realtime");

    // OFFLINE
    if (!shouldBrowse){
      const msgs = [
        { role:"system", content:SYSTEM_PROMPT },
        ...history.slice(-8).map(m=>({ role:m.role, content:m.content })),
        { role:"user", content:message }
      ];
      const { text, model } = await callOpenAI(msgs,{});
      return http(200,{ ok:true, usedBrowsing:false, model, answer:text, references:[], meta:{ ts: Date.now() } });
    }

    // ONLINE
    const plan = buildQueryVariants(message);
    const preferred = plan.preferred?.length ? plan.preferred : PREFERRED_DOMAINS;

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
          num: Math.min(Math.max(maxSources, 6), 10),
          recencyDays: days
        })))
      );

      let flat = uniqByUrl(batch.flat().map(it => ({ title: it.title, url: it.link, snippet: it.snippet })));
      flat = sortPrimaryFirst(flat, preferred);

      const flatTop = flat.slice(0, 8);
      let pages = await Promise.all(flatTop.map(r => fetchPagePlainText(r.url)));

      if (plan.topic === "sztarbox"){
        pages = pages.map(p => ({ ...p, content: removeOldSeasons(p.content) }));
      }

      const PRIMARY_MIN = plan.topic === "sztarbox" ? 60 : 120;
      let sources = flatTop.map((r,i)=>({
          ...r, content: pages[i]?.content || "", _primary: isPrimary(r.url)
        }))
        .filter(s => (s._primary && s.content && s.content.length >= PRIMARY_MIN) ||
                     (!s._primary && s.content && s.content.length >= 200));

      sources = sortPrimaryFirst(sources, preferred).slice(0, 6);
      if (sources.length >= 2){ collected = sources; usedTier = days; break outer; }
    }

    if (!collected.length){
      return http(200,{
        ok:false, usedBrowsing:true,
        error:"Nem találtam elég hiteles forrást.",
        diagnostics:{ topic:plan.topic, queriesTried }
      });
    }

    // Résztvevők
    let currentSeasonNames = [];
    let namesDiagnostics = null;
    if (plan.topic === "sztarbox"){
      const contents = collected.map(s => s.content || "");
      const agg = aggregateNames(contents, CURRENT_YEAR);
      currentSeasonNames = agg.allow;
      namesDiagnostics = agg.raw;
    }

    // Párosítások
    const { verified: verifiedMatchups, raw: matchupsRaw } = aggregateMatchupsFromSources(collected);
    const matchups = verifiedMatchups.map(v => v.pair);

    // Csatorna + kezdés
    const bd = extractBroadcasterAndDate(collected, CURRENT_YEAR);
    const broadcasterInfo = bd.broadcaster || null;
    const premiereInfo = bd.premiereDate || null;
    const premiereConf = bd.premiereConfidence || null;

    const browserBlock =
      "\n\nForráskivonatok ("+collected.length+" db):\n" +
      collected.map((s,i)=>`[#${i+1}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0,1000)}`).join("\n\n") +
      (currentSeasonNames.length ? `\n\nELLENŐRZÖTT LISTA (aktuális évad ${CURRENT_YEAR}):\n- ${currentSeasonNames.join("\n- ")}` : "") +
      (matchups.length ? `\n\nVERIFIED MATCHUPS:\n- ${matchups.join("\n- ")}` : `\n\nVERIFIED MATCHUPS: nincs elég.`) +
      (broadcasterInfo ? `\n\nBROADCASTER (ellenőrzött): ${broadcasterInfo}` : "") +
      (premiereInfo ? `\n\nPREMIERE DATE (${premiereConf||'unknown'}): ${premiereInfo}` : "");

    const messages = [
      { role:"system", content:SYSTEM_PROMPT },
      ...history.slice(-6).map(m=>({ role:m.role, content:m.content })),
      { role:"user", content:`Felhasználói kérés:\n${message}\n${browserBlock}` }
    ];

    const { text: answer, model } = await callOpenAI(messages,{});
    const references = collected.map((s,i)=>({ id:i+1, title:s.title, url:s.url }));

    const base = {
      ok:true, usedBrowsing:true, model, answer, references,
      meta:{ ts: Date.now() },
      diagnostics:{ topic:plan.topic, usedRecencyDays: usedTier, sourcesFound: collected.length },
      currentSeasonNames,
      verifiedMatchups: verifiedMatchups.map(v => ({ pair: v.pair, sources: v.sources.slice(0,5) })),
      broadcaster: broadcasterInfo || null,
      premiereDate: premiereInfo || null,
      premiereConfidence: premiereConf || null
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
