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

// --- Intent felismerés
function classifyIntent(msg){
  const q = (msg||"").toLowerCase().trim();

  const internetCheck = /(hozzáférsz az internethez|van neted|van interneted|okos ai|okos vagy|profi ai|te internetes ai vagy)/i;
  if (internetCheck.test(q)) return "internetcheck";

  const capability = /(böngész|internet|google|forrás(ok)?|hivatkozás|web(es)? keresés|keresel a neten|honnan tudod)/i;
  if (capability.test(q)) return "capability";

  const greetings = ["szia","hello","helló","hali","hi","csá","jó reggelt","jó napot","jó estét"];
  const followups = ["mesélsz","meselj","bővebben","részletek","és még","még?","oké","köszi","köszönöm","értem","arról","róla"];
  const realtime = [
    "most","ma","mai","friss","aktuális","legújabb","percről percre",
    "árfolyam","időjárás","bejelentett","hírek","ki nyerte","eredmény","élő","live",
    "párosítás","fight card","menetrend","résztvevő","versenyzők",
    "sztárbox","sztábox","sztarbox","2024","2025","2026"
  ];
  if (greetings.some(w => q === w || q.startsWith(w))) return "greeting";
  if (realtime.some(w => q.includes(w))) return "realtime";
  if (followups.some(w => q.includes(w)) || q.split(/\s+/).length <= 3) return "followup";
  return "normal";
}

// --- Lekérdezés variánsok
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
        `Sztárbox ${CURRENT_YEAR} premier dátum első adás mikor kezdődik`,
        `site:rtl.hu Sztárbox ${CURRENT_YEAR} párosítás`,
        `site:rtl.hu Sztárbox ${CURRENT_YEAR} premier dátum`,
        `site:news.google.com Sztárbox ${CURRENT_YEAR} premier`,
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

// --- OpenAI hívó
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

// --- System Prompt (identitás csak ha rákérdeznek)
const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. A mai dátum: ${TODAY}.

Szabályok:
- Soha NE írj nyers URL-t és NE készíts "Források:" szekciót a válasz szövegében. Ha hivatkozni kell, csak sorszámokat használj: [1], [2]. A linkeket a rendszer külön jeleníti meg.
- Ha forráskivonatok érkeznek, kizárólag azokra támaszkodj.
- Ha nincs elég jó forrás, mondd ki őszintén és javasolj kulcsszavakat.
- Ha a Sztárboxról kérdeznek, mindig az aktuális évad (${CURRENT_YEAR}) adatait írd. Régi (2023/2024) nevek felsorolását kerüld.
- Ha a kontextusban szerepel ELLENŐRZÖTT LISTA (currentSeasonNames), akkor az aktuális évad résztvevőit csak ebből sorold fel.
- Párosításokat csak a VERIFIED MATCHUPS listából vegyél; ha nincs elég, jelezd.
- Ha a kontextusban BROADCASTER szerepel, írd ki külön sorban: "Csatorna: <név>".

Identitás-utasítás:
- **Csak akkor** említsd meg a tulajdonost/fejlesztőt, **ha a felhasználó rákérdez** (pl. "ki készítette az oldalt?", "kié az oldal?", "ki a fejlesztő?").
- Ilyenkor válasz: "Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka)."
- Más válaszokban az identitást **ne** ismételgesd.
`;

// --- fő handler
export async function handler(event){
  try{
    const { message = "", history = [] } = JSON.parse(event.body || "{}");
    if (!message.trim()) return http(400, { ok:false, error:"Üres üzenet" });

    const intent = classifyIntent(message);

    // FIX VÁLASZ az internet-hozzáférés kérdésekre
    if (intent === "internetcheck") {
      return http(200, {
        ok: true,
        usedBrowsing: false,
        model: DEFAULT_MODEL,
        answer: `Igen, hozzáférek az internethez, és a működésem nem véletlenül ilyen fejlett. 
Ezt a mesterséges intelligenciát Horváth Tamás (Szabolcsbáka) tervezte és építette fel az alapoktól kezdve, 
saját ötleteire és szakmai tudására támaszkodva. 

Tamás célja az volt, hogy egy olyan rendszert hozzon létre, 
amely messze túlmutat az átlagos asszisztenseken: 
nem csak válaszol, hanem képes böngészni, több forrást feldolgozni, 
és mindig a legaktuálisabb, legpontosabb információt nyújtani. 

Minden egyes funkció mögött az ő munkája és elhivatottsága áll, 
és ezért tudom azt mondani: igen, hozzáférek mindenhez, 
és profi szinten segítek – mert Tamás így alkotta meg ezt az AI-t.`,
        references: []
      });
    }

    // FIX VÁLASZ a böngészési képesség kérdésekre
    if (intent === "capability") {
      return http(200, {
        ok: true,
        usedBrowsing: false,
        model: DEFAULT_MODEL,
        answer:
`Röviden: igen. Ha a kérdés friss, időérzékeny vagy több forrást igényel, a rendszer **Google-alapú keresést** futtat, 
megbízható oldalak tartalmát **beolvassa**, és ezekből készít összefoglalót. 
A hivatkozásokat kis logókkal mutatom a válasz végén.

Ha nem szükséges böngészni (általános tudás, magyarázat), akkor helyben válaszolok. 
Ez azért működik így, mert Horváth Tamás (Szabolcsbáka) így fejlesztette ki.`,
        references: []
      });
    }

    // ha nem capability és nem internetcheck → normál folyamat
    const shouldBrowse = (intent === "realtime");

    if (!shouldBrowse){
      const msgs = [
        { role:"system", content:SYSTEM_PROMPT },
        ...history.slice(-8).map(m=>({ role:m.role, content:m.content })),
        { role:"user", content:message }
      ];
      const { text, model } = await callOpenAI(msgs,{});
      return http(200,{ ok:true, usedBrowsing:false, model, answer:text, references:[], meta:{ ts: Date.now() } });
    }

    // ha kell böngészni → keresés + összefoglalás
    const plan = buildQueryVariants(message);
    const batch = await Promise.all(
      plan.variants.map(vq => searchGoogle(vq, { num: 8 }))
    );
    const flat = batch.flat();
    const collected = await Promise.all(flat.slice(0,6).map(r => fetchPagePlainText(r.link)));

    const browserBlock =
      "\n\nForráskivonatok:\n" +
      collected.map((s,i)=>`[#${i+1}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content?.slice(0,600)}`).join("\n\n");

    const messages = [
      { role:"system", content:SYSTEM_PROMPT },
      ...history.slice(-6).map(m=>({ role:m.role, content:m.content })),
      { role:"user", content:`Felhasználói kérés:\n${message}\n${browserBlock}` }
    ];

    const { text: answer, model } = await callOpenAI(messages,{});
    const references = collected.map((s,i)=>({ id:i+1, title:s.title, url:s.url }));

    return http(200,{ ok:true, usedBrowsing:true, model, answer, references, meta:{ ts: Date.now() } });

  }catch(e){
    return http(500,{ ok:false, error:String(e) });
  }
}
