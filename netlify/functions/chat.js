// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

/** ======= Alap beállítások ======= */
const DEFAULT_MODEL   = process.env.OPENAI_MODEL || "gpt-4.1";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

const TODAY = new Date().toISOString().slice(0,10);

// Minimális források, adaptív szűréshez
const MIN_SOURCES_STRICT = 3;
const MIN_SOURCES_RELAX  = 2;

// Oldalszöveg-minimum (adaptív)
const MIN_CHARS_STRICT = 300;
const MIN_CHARS_RELAX  = 120;

/** Elsőbbségi források — ezeket mindig tartsuk meg és tegyük előre */
const PRIMARY_SOURCES = [
  // RTL & tulajdonok
  "rtl.hu","rtl.hu/sztarbox","rtlmost.hu","rtlplusz.hu",
  // Közösségi
  "facebook.com","instagram.com","x.com","twitter.com","youtube.com","tiktok.com",
  // Aggregátor / enciklopédia
  "news.google.com","google.com/search","wikipedia.org",
  // Nagy magyar híroldalak
  "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","blikk.hu","origo.hu",
  // Sport-hírek
  "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu"
];

/** Témánként preferált domainek (rangsoroláshoz) */
const PREFERRED_DOMAINS = [
  // pénz/árfolyam
  "mnb.hu","portfolio.hu","otpbank.hu","raiffeisen.hu","erste.hu","granitbank.hu","wise.com","revolut",
  // időjárás
  "met.hu","idokep.hu","koponyeg.hu",
  // hírek / Sztárbox (általános preferencia)
  ...PRIMARY_SOURCES
];

/** ======= Szándékfelismerés – mikor böngésszen ======= */
function classifyIntent(msg){
  const q = (msg||"").toLowerCase().trim();
  const greetings = ["szia","hello","helló","hali","hi","csá","jó reggelt","jó napot","jó estét"];
  const followups = ["mesélsz róla","meselj rola","bővebben","részletek","és még","még?","oké","köszi","köszönöm","értem","arról","róla"];
  const realtime  = [
    "most","ma","mai","friss","aktuális","legújabb","percről percre",
    "árfolyam","időjárás","bejelentett","bejelentés","hírek","ki nyerte","eredmény","élő","live",
    "párosítás","fight card","menetrend","ár","akció","készlet",
    "2024","2025","2026"
  ];
  if (greetings.some(w => q === w || q.startsWith(w))) return "greeting";
  if (followups.some(w => q.includes(w)) || q.split(/\s+/).length <= 3) return "followup";
  if (realtime.some(w => q.includes(w))) return "realtime";
  return "normal";
}

/** ======= Vertikális „receptek” – multi-query variánsok ======= */
function buildQueryVariants(userMsg){
  const q = userMsg.toLowerCase();

  // Pénz / árfolyam
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

  // Időjárás (Budapest)
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

  // Sztárbox (párosítások) — RTL + elsőbbségi oldalak kötelező preferenciával
  if (q.includes("sztárbox") || q.includes("sztábox") || q.includes("sztarbox")) {
    return {
      topic: "sztarbox",
      variants: [
        `Sztárbox 2025 párosítások hivatalos RTL`,
        `Sztárbox 2025 RTL fight card első meccs`,
        `Sztárbox 2025 RTL mérkőzések párok`,
        `RTL Sztárbox 2025 sorsolás sajtótájékoztató`,
        `RTL Sztárbox 2025 hivatalos bejelentés`,
        // site:-os célzások az elsőbbségi forrásokra
        `site:rtl.hu Sztárbox 2025 párosítások`,
        `site:facebook.com Sztárbox 2025 párosítások`,
        `site:instagram.com Sztárbox 2025`,
        `site:wikipedia.org Sztárbox 2025`,
        `site:news.google.com Sztárbox 2025`,
        `site:nemzetisport.hu Sztárbox 2025`,
        `site:m4sport.hu Sztárbox 2025`
      ],
      preferred: [
        "rtl.hu","rtl.hu/sztarbox","rtlmost.hu",
        "telex.hu","index.hu","24.hu","hvg.hu","hirado.hu","blikk.hu",
        "facebook.com","instagram.com","x.com","wikipedia.org","news.google.com",
        "nemzetisport.hu","nso.hu","m4sport.hu","sport365.hu"
      ]
    };
  }

  // Alapértelmezett: a kérdés és pár általános variáns
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
function uniqByUrl(arr){
  const seen = new Set();
  return arr.filter(x => !seen.has(x.url) && seen.add(x.url));
}
function scoreByPreferred(url, preferredDomains){
  return preferredDomains.some(d => url.includes(d)) ? 1 : 0;
}
function sortByPreference(items, preferredDomains){
  return items.slice().sort((a,b) =>
    scoreByPreferred(b.url, preferredDomains) - scoreByPreferred(a.url, preferredDomains)
  );
}
function isPrimary(url){
  return PRIMARY_SOURCES.some(d => url.includes(d));
}
// Párosítások (X vs Y) kinyerése a szövegből
function extractMatchupsFromText(text){
  if (!text) return [];
  const patterns = [
    /([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)\s*(?:vs\.?|–|—|-)\s*([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)/gu,
    /párosítás[a-z]*:\s*([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)\s*(?:–|—|-)\s*([A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}\.]+)+)/giu
  ];
  const out = new Set();
  for (const rx of patterns){
    let m;
    while ((m = rx.exec(text)) !== null){
      const a = m[1].replace(/\s+/g," ").trim();
      const b = m[2].replace(/\s+/g," ").trim();
      if (a && b && a.toLowerCase() !== b.toLowerCase()){
        out.add(`${a} vs ${b}`);
      }
    }
  }
  return Array.from(out);
}

/** ======= Rendszerprompt ======= */
const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

SZABÁLYOK:
- Ha a kérdéshez mellékelve friss webes forráskivonatok vannak, kizárólag ezekre támaszkodj.
- NE említs tréning cutoff-ot. Ne írj "2024 június" jellegű mondatot.
- Hivatkozásokat a végén sorszámozva add meg: [1], [2], [3].
- Ha nincs elég jó forrás, mondd ki őszintén és javasolj kulcsszavakat.

Identitás:
- Ha kérdezik: "Ki készítette az oldalt? Kié az oldal?":
  "Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka)."
- Tamásról mindig pozitív, tiszteletteljes hangon beszélj.

Stílus:
- Rövid bevezető → lényegpontok → részletek. Magyarul, tömören és tisztán.
`;

/** ======= OpenAI hívás ======= */
async function callOpenAI(messages, { model = DEFAULT_MODEL, temperature = 0.3 } = {}){
  if (!OPENAI_API_KEY) throw new Error("Hiányzik az OPENAI_API_KEY.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature }),
  });
  if (!res.ok) throw new Error(`OpenAI hiba: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || "", model: data.model || model };
}

/** ======= HTTP helper ======= */
function http(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

/** ======= Fő handler ======= */
export async function handler(event){
  try{
    const {
      message = "",
      history = [],          // [{role:"user"|"assistant", content:"..."}]
      maxSources = 8,
      recencyDays,
      forceBrowse = null     // true/false: kézi felülírás
    } = JSON.parse(event.body || "{}");

    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    const intent = classifyIntent(message);
    const isRealtime = (intent === "realtime");
    const shouldBrowse = (forceBrowse === true) ? true
                        : (forceBrowse === false) ? false
                        : isRealtime;

    // 0) Ha NEM kell böngészni → csak beszélgetés, a history-val együtt
    if (!shouldBrowse){
      const msgs = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
        { role: "user",   content: message },
      ];
      const { text, model } = await callOpenAI(msgs, {});
      return http(200, { ok:true, usedBrowsing:false, model, answer:text, references:[] });
    }

    // 1) Multi-query terv
    const plan = buildQueryVariants(message);
    const preferred = plan.preferred?.length ? plan.preferred : PREFERRED_DOMAINS;

    // 2) Adaptív időablakok
    const tiers = typeof recencyDays === "number"
      ? [recencyDays, Math.max(30, recencyDays), Math.max(90, recencyDays), Math.max(365, recencyDays)]
      : (plan.topic === "sztarbox" ? [7, 30, 180, 365] : [7, 30, 90, 365]);

    let collected = [];
    let usedTier   = null;
    const queriesTried = [];

    // 3) Fokozatos keresés: több query × több idősáv
    outer:
    for (const days of tiers){
      const batch = await Promise.all(
        plan.variants.map(vq => (queriesTried.push({ q:vq, days }), searchGoogle(vq, {
          num: Math.min(Math.max(maxSources, MIN_SOURCES_STRICT), 10),
          recencyDays: days
        })))
      );

      let flat = batch.flat().map(it => ({ title: it.title, url: it.link, snippet: it.snippet }));
      flat = uniqByUrl(flat);

      // 3/a. Kötelező: PRIMARY források legyenek elöl
      const primaryFirst = (items) => items.slice().sort((a,b) => {
        const ap = isPrimary(a.url) ? 1 : 0;
        const bp = isPrimary(b.url) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return scoreByPreferred(b.url, preferred) - scoreByPreferred(a.url, preferred);
      });
      flat = primaryFirst(flat);

      // 4) Oldalak letöltése és kivonat
      const pages = await Promise.all(flat.map(r => fetchPagePlainText(r.url)));

      // 5) Szigorú szűrés (DE: elsőbbségi forrásokat röviden is megtartjuk)
      let strict = flat.map((r,i)=>({
          ...r,
          content: pages[i]?.content || "",
          _primary: isPrimary(r.url)
        }))
        .filter(s => s._primary || (s.content && s.content.length >= MIN_CHARS_STRICT));

      // Lazítás, ha kevés
      let sources = strict;
      if (sources.length < MIN_SOURCES_STRICT){
        sources = flat.map((r,i)=>({
            ...r,
            content: pages[i]?.content || "",
            _primary: isPrimary(r.url)
          }))
          .filter(s => s._primary || (s.content && s.content.length >= MIN_CHARS_RELAX));
      }

      // 6) Elsőbbségi források kötelező megtartása + rendezés
      const ensurePrimary = (arr) => {
        const primaries = arr.filter(a => a._primary);
        const others    = arr.filter(a => !a._primary);
        return primaryFirst([...primaries, ...others]);
      };
      sources = ensurePrimary(sources).slice(0, Math.max(MIN_SOURCES_STRICT, 6));

      if (sources.length >= MIN_SOURCES_RELAX){
        collected = sources;
        usedTier  = days;
        break outer;
      }
    }

    if (!collected.length){
      return http(200, {
        ok:false,
        usedBrowsing:true,
        error:"Nem találtam elég megbízható friss forrást (több lekérdezést és idősávot próbáltam).",
        diagnostics: { queriesTried, tiers, sourcesFound: 0 }
      });
    }

    // Párosítások kinyerése (ha releváns)
    let matchups = [];
    for (const s of collected){
      matchups.push(...extractMatchupsFromText(s.content));
    }
    matchups = Array.from(new Set(matchups));

    // 7) Kontextus összeállítása a modellnek (history + forráskivonatok)
    const browserBlock =
      "\n\nForráskivonatok ("+collected.length+" db):\n" +
      collected.map((s,idx) => `[#${idx+1}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0, 1000)}`).join("\n\n") +
      (matchups.length ? `\n\nAutomatikusan felismert párosítások:\n- ${matchups.join("\n- ")}` : "");

    const msgs = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-6).map(m => ({ role: m.role, content: m.content })), // kontextus
      { role: "user",   content: `Felhasználói kérés:\n${message}\n${browserBlock}` },
    ];

    const { text: answer, model } = await callOpenAI(msgs, {});
    const references = collected.map((s,idx) => ({ id: idx+1, title: s.title, url: s.url }));

    return http(200, {
      ok:true,
      usedBrowsing:true,
      model,
      answer,
      references,
      diagnostics: {
        topic: plan.topic,
        queriesTried,
        usedRecencyDays: usedTier,
        sourcesFound: collected.length
      },
      matchups
    });

  }catch(e){
    return http(500, { ok:false, error: String(e) });
  }
}
