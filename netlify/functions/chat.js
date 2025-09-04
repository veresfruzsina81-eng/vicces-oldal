// netlify/functions/chat.js
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ====== OWNER PROFILE ====== */
const OWNER_PROFILE = {
  name: "Horváth Tamás",
  displayName: "Tamás",
  age: 26,
  town: "Szabolcsbáka",
  postalCode: "4547",   // ha eltér, írd át
  country: "Magyarország",
  storyShort:
    "Kezdésként alap programozással foglalkozott, később haladó szintre lépett. Tehetséges fejlesztő; az asszisztens megalkotása komoly szakmai tudást igényelt."
};

/* ====== Idő formázók (always Europe/Budapest) ====== */
function nowHu() {
  return new Date().toLocaleDateString("hu-HU", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
    timeZone: "Europe/Budapest"
  });
}
function nowHuFull() {
  const d = new Date();
  const datum = d.toLocaleDateString("hu-HU", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
    timeZone: "Europe/Budapest"
  });
  const ido = d.toLocaleTimeString("hu-HU", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Budapest"
  });
  return `${datum}, ${ido}`;
}

/* ====== Segédek ====== */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(status, obj) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(obj)
  };
}
function ownerLocation() {
  const { town, postalCode, country } = OWNER_PROFILE;
  return `${postalCode} ${town}, ${country}`;
}
function ownerBlurb() {
  const { name, age, storyShort } = OWNER_PROFILE;
  return `${name} (${age}) — ${ownerLocation()}. ${storyShort}`;
}
function ownerProfileBlock() {
  const { name, displayName, age, town, postalCode, country, storyShort } = OWNER_PROFILE;
  return [
    `${displayName} modellje vagyok. Íme a profil:`,
    `• Név: ${name}`,
    `• Kor: ${age}`,
    `• Hely: ${postalCode} ${town}, ${country}`,
    `• Rövid bemutatás: ${storyShort}`
  ].join("\n");
}

/* ====== Parancsok ====== */
function handleCommand(cmdRaw) {
  const cmd = (cmdRaw || "").trim().toLowerCase();
  if (cmd === "/help" || cmd === "help" || cmd === "?") {
    return [
      "Elérhető parancsok:",
      "• /profil — a fejlesztő részletes bemutatása",
      "• /idő — aktuális dátum és idő (hu-HU)",
      "• /help — ez a súgó",
    ].join("\n");
  }
  if (cmd === "/profil") return ownerProfileBlock();
  if (cmd === "/idő" || cmd === "/ido") return `Most ${nowHuFull()}.`;
  return null;
}

/* ====== Lokális gyors válaszok ====== */
function localAnswer(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return null;

  if (t.startsWith("/")) {
    const res = handleCommand(t);
    if (res) return res;
  }

  // rólad
  const aboutOwner = [
    /ki (a )?(tulaj|készítő|fejlesztő)/,
    /(mesélj|mondj.*|írj.*) (tamásról|a készítőről|a fejlesztőről)/,
    /(ki az a tamás|horváth tamás)/,
    /(ki áll a projekt mögött|kinek a projektje|ki csinálta)/,
    /(fejlesztő bemutatkozás|bemutatkozás a fejlesztőről)/,
    /(rólam|engem) (kérdez|érdekel|írj|mutass be)/,
    /(készítő.*adat|fejlesztő.*adat|készítő.*info|fejlesztő.*info)/,
  ].some(rx => rx.test(t));
  if (aboutOwner) return ownerBlurb();

  // hely
  const aboutLocation = [
    /(hol laksz|merre laksz|merre található a fejlesztő|hol található a fejlesztő)/,
    /(melyik városban|melyik településen)/,
    /(irányítószám|postai irányítószám|postal code)/,
    /(hol van a készítő|hol élsz)/,
  ].some(rx => rx.test(t));
  if (aboutLocation) return `A fejlesztő helye: ${ownerLocation()}.`;

  // modell
  if (/(milyen (modell|ai)|milyen chatbot|ki vagy|ki vagy te)/.test(t)) {
    return "Tamás modellje vagyok: ő készített és fejleszt, hogy segítsek neked bármiben. 😊";
  }

  // dátum/idő
  if (/(mai (nap|dátum|idő)|hányadika|milyen dátum|mennyi az idő|hány óra)/.test(t)) {
    return `Most ${nowHuFull()}.`;
  }

  // következő napok
  if (/(következő napok|holnap|héten)/.test(t)) {
    const napok = ["vasárnap","hétfő","kedd","szerda","csütörtök","péntek","szombat"];
    let out = [];
    let d = new Date();
    for (let i = 1; i <= 5; i++) {
      d = new Date(d.getTime() + 86400000);
      out.push(`${d.toLocaleDateString('hu-HU',{timeZone:'Europe/Budapest'})} — ${napok[d.getDay()]}`);
    }
    return "Következő napok:\n" + out.join("\n");
  }

  // súgó
  if (/(segítség|súgó|mit tudsz|parancsok)/.test(t)) return handleCommand("/help");

  return null;
}

/* ====== OpenAI hívás timeout + retry ====== */
async function callOpenAI({ model, messages, temperature = 0.6, max_tokens = 400, timeoutMs = 12000, retries = 1 }) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature, max_tokens }),
      signal: controller.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${txt}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 350));
      return callOpenAI({ model, messages, temperature, max_tokens, timeoutMs, retries: retries - 1 });
    }
    throw err;
  } finally { clearTimeout(to); }
}

/* ====== Handler ====== */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  if (!OPENAI_API_KEY) return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });

  try {
    const { message } = JSON.parse(event.body || "{}");
    const userMsg = String(message || "").trim();
    if (!userMsg) return json(200, { reply: "Írj pár szót, és segítek. 🙂" });

    const quick = localAnswer(userMsg);
    if (quick) return json(200, { reply: quick });

    const sys = [
      "Barátságos, magyar nyelvű asszisztens vagy.",
      "Válaszaid legyenek rövidek, érthetők, segítőkészek, tegező stílusban.",
      "Ne említsd az OpenAI-t vagy a kulcsot; ha a kilétedről kérdeznek, ezt mondd: 'Tamás modellje vagyok, ő készített és fejlesztett.'",
      `Dátum/idő: ${nowHuFull()}.`,
      `Fejlesztői profil (ha kérdezik): ${ownerBlurb()}`
    ].join(" ");

    const reply = await callOpenAI({
      model: DEFAULT_MODEL,
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg }
      ]
    });

    return json(200, { reply: reply || "Rendben. Miben segíthetek még?" });
  } catch (e) {
    console.error(e);
    return json(200, { reply: "Most akadozik a kapcsolat a modellel. Röviden írd le, mire van szükséged, és segítek! 🙂" });
  }
}
