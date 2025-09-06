// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

/** ======= Alap beállítások ======= */
const DEFAULT_MODEL   = process.env.OPENAI_MODEL || "gpt-4.1";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

const TODAY = new Date().toISOString().slice(0,10);

// Minimális források, de adaptívan lazítjuk
const MIN_SOURCES_STRICT = 3;
const MIN_SOURCES_RELAX  = 2;

// Oldalszöveg-minimum (adaptív)
const MIN_CHARS_STRICT = 300;
const MIN_CHARS_RELAX  = 120;

// Preferált domainek (prioritás szerinti rendezéshez)
const PREFERRED_DOMAINS = [
  // pénz/árfolyam
  "mnb.hu","portfolio.hu","bank","otpbank.hu","raiffeisen.hu","erste.hu","granitbank.hu","revolut","wise.com",
  // időjárás
  "met.hu","idokep.hu","koponyeg.hu",
  // hazai hírek / Sztárbox
  "rtl.hu","rtlmost.hu","telex.hu","index.hu","24.hu","blikk.hu","hirado.hu","hvg.hu"
];

/** ======= Szándékfelismerés – mikor NE böngésszen ======= */
function classifyIntent(msg){
  const q = (msg||"").toLowerCase().trim();
  const greet = ["szia","hello","helló","hali","hi","csá","jó reggelt","jó napot","jó estét"];
  const trivial = ["köszönöm","koszi","köszi","hogy vagy","mi újság","mit tudsz","segíts"];
  if (greet.some(w => q === w || q.startsWith(w))) return "greeting";
  if (trivial.includes(q) || q.length <= 3) return "smalltalk";
  return "normal";
}

/** ======= Vertikális „receptek” – query-expanziók ======= */
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
        `portfolio eurhuf árfolyam`,
      ],
      preferred: ["mnb.hu","portfolio.hu","otpbank.hu","raiffeisen.hu","erste.hu","wise.com"]
    };
  }

  // Időjárás
  if (q.includes("időjárás") && (q.includes("bp") || q.includes("budapest") || q.includes("budapesten"))) {
    return {
      topic: "weather",
      variants: [
        `Budapest időjárás mai óránkénti ${TODAY}`,
        `Budapest weather today hourly`,
        `OMSZ met.hu Budapest előrejelzés ${TODAY}`,
        `Időkép Budapest radar`,
        `Köpönyeg Budapest ma`,
      ],
      preferred: ["met.hu","idokep.hu","koponyeg.hu"]
    };
  }

  // Sztárbox (több variáció, hogy „sztábox” elgépelést is eltalálja)
  if (q.includes("sztárbox") || q.includes("sztábox") || q.includes("sztarbox")) {
    return {
      topic: "sztarbox",
      variants: [
        `Sztárbox 2025 résztvevők bejelentve RTL ${TODAY}`,
        `Sztárbox 2025 szereplők`,
        `RTL Sztárbox 2025 hivatalos`,
        `Sztárbox 2025 indulók lista`,
        `Sztárbox műsorvezetők 2025`,
      ],
      preferred: ["rtl.hu","telex.hu","index.hu","24.hu","blikk.hu","hirado.hu","hvg.hu","rtlmost.hu"]
    };
  }

  // Alapértelmezett (általános): a felhasználói kérdés és pár variáció
  return {
    topic: "general",
    variants: [
      userMsg,
      `${userMsg} ${TODAY}`,
      `${userMsg} magyar hír`,
      `${userMsg} hivatalos oldal`,
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

/** ======= Rendszerprompt ======= */
const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

SZABÁLYOK:
- Ha a kérdéshez mellékelve friss webes forráskivonatok vannak, akkor kizárólag ezekre támaszkodj.
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
    const { message = "", maxSources = 8, recencyDays } = JSON.parse(event.body || "{}");
    const intent = classifyIntent(message);
    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    // 0) Köszönés / small talk → NEM böngészünk
    if (intent === "greeting" || intent === "smalltalk"){
      const msgs = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: message },
      ];
      const { text, model } = await callOpenAI(msgs, {});
      return http(200, { ok:true, usedBrowsing:false, model, answer:text, references:[] });
    }

    // 1) Multi-query terv
    const plan = buildQueryVariants(message);
    const preferred = plan.preferred?.length ? plan.preferred : PREFERRED_DOMAINS;

    // 2) Adaptív időablakok (szűktől a tágabbig)
    const tiers = typeof recencyDays === "number"
      ? [recencyDays, Math.max(30, recencyDays), Math.max(90, recencyDays), Math.max(365, recencyDays)]
      : [7, 30, 90, 365];

    let collected = [];
    let usedTier   = null;
    let queriesTried = [];

    // 3) Fokozatos keresés: több query × több idősáv
    outer:
    for (const days of tiers){
      // Párhuzamos keresések az adott idősávban
      const batch = await Promise.all(
        plan.variants.map(vq => (queriesTried.push({ q:vq, days }), searchGoogle(vq, {
          num: Math.min(Math.max(maxSources, MIN_SOURCES_STRICT), 10),
          recencyDays: days
        })))
      );

      // Eredmények összegyűjtése és deduplikálása
      let flat = batch.flat().map(it => ({ title: it.title, url: it.link, snippet: it.snippet }));
      flat = uniqByUrl(flat);

      // Előresorolás preferált domainek szerint
      flat = sortByPreference(flat, preferred);

      // Oldalak letöltése és kivonat
      const pages = await Promise.all(flat.map(r => fetchPagePlainText(r.url)));

      // Kétlépcsős szűrés: szigorú → lazább
      let strict = flat.map((r,i)=>({ ...r, content: pages[i]?.content || "" }))
                       .filter(s => s.content && s.content.length >= MIN_CHARS_STRICT);

      let sources = strict;
      if (sources.length < MIN_SOURCES_STRICT){
        // lazítás
        sources = flat.map((r,i)=>({ ...r, content: pages[i]?.content || "" }))
                      .filter(s => s.content && s.content.length >= MIN_CHARS_RELAX);
      }

      // Ismét preferencia szerinti rendezés és vágás
      sources = sortByPreference(sources, preferred).slice(0, Math.max(MIN_SOURCES_STRICT, 6));

      if (sources.length >= MIN_SOURCES_RELAX){
        collected = sources;
        usedTier  = days;
        break outer;
      }
    }

    // 4) Ha még mindig kevés forrás → őszinte jelzés
    if (!collected.length){
      return http(200, {
        ok:false,
        usedBrowsing:true,
        error:"Nem találtam elég megbízható friss forrást (több lekérdezést és idősávot próbáltam).",
        diagnostics: { queriesTried, tiers, sourcesFound: 0 }
      });
    }

    // 5) Összeállítás a modellnek
    const browserBlock =
      "\n\nForráskivonatok ("+collected.length+" db):\n" +
      collected.map((s,idx) => `[#${idx+1}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0, 1000)}`).join("\n\n");

    const msgs = [
      { role: "system", content: SYSTEM_PROMPT },
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
      diagnostics: { topic: plan.topic, queriesTried, usedRecencyDays: usedTier, sourcesFound: collected.length }
    });

  }catch(e){
    return http(500, { ok:false, error: String(e) });
  }
}
