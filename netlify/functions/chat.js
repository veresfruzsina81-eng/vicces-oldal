// netlify/functions/chat.js
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ====== OWNER PROFILE ====== */
const OWNER_PROFILE = {
  name: "Horváth Tamás",
  displayName: "Tamás",
  age: 26,
  town: "Szabolcsbáka",
  postalCode: "4547",
  country: "Magyarország",
  storyShort:
    "Kezdésként alap programozással foglalkozott, később haladó szintre lépett. Tehetséges fejlesztő; az asszisztens megalkotása komoly szakmai tudást igényelt."
};

/* ====== Idő formázók ====== */
function formatDateTime(tz) {
  const d = new Date();
  const datum = d.toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    timeZone: tz
  });
  const ido = d.toLocaleTimeString("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz
  });
  return `${datum}, ${ido}`;
}
function timeInZone(city, tz) {
  return `Most ${formatDateTime(tz)} van ${city}-ban/ben.`;
}
function nowHuFull() {
  return formatDateTime("Europe/Budapest");
}

/* ====== Időzóna lista (~50 fontos város/ország) ====== */
const zones = {
  "budapest": "Europe/Budapest",
  "magyarország": "Europe/Budapest",
  "london": "Europe/London",
  "anglia": "Europe/London",
  "paris": "Europe/Paris",
  "franciaország": "Europe/Paris",
  "berlin": "Europe/Berlin",
  "németország": "Europe/Berlin",
  "madrid": "Europe/Madrid",
  "spanyolország": "Europe/Madrid",
  "roma": "Europe/Rome",
  "olaszország": "Europe/Rome",
  "athen": "Europe/Athens",
  "görögország": "Europe/Athens",
  "moszkva": "Europe/Moscow",
  "oroszország": "Europe/Moscow",
  "new york": "America/New_York",
  "usa": "America/New_York",
  "washington": "America/New_York",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "chicago": "America/Chicago",
  "mexikó": "America/Mexico_City",
  "brazilia": "America/Sao_Paulo",
  "argentina": "America/Argentina/Buenos_Aires",
  "tokyo": "Asia/Tokyo",
  "japán": "Asia/Tokyo",
  "peking": "Asia/Shanghai",
  "kína": "Asia/Shanghai",
  "hongkong": "Asia/Hong_Kong",
  "seoul": "Asia/Seoul",
  "dél-korea": "Asia/Seoul",
  "sydney": "Australia/Sydney",
  "ausztrália": "Australia/Sydney",
  "toronto": "America/Toronto",
  "kanada": "America/Toronto",
  "dubai": "Asia/Dubai",
  "egyesült arab emírségek": "Asia/Dubai",
  "istanbul": "Europe/Istanbul",
  "törökország": "Europe/Istanbul",
  "cairo": "Africa/Cairo",
  "egyiptom": "Africa/Cairo",
  "nairobi": "Africa/Nairobi",
  "kenya": "Africa/Nairobi",
  "cape town": "Africa/Johannesburg",
  "dél-afrika": "Africa/Johannesburg"
};

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
      "• /idő — aktuális magyar dátum és idő",
      "• /help — ez a súgó",
    ].join("\n");
  }
  if (cmd === "/profil") return ownerProfileBlock();
  if (cmd === "/idő" || cmd === "/ido") return `Most ${nowHuFull()} van Magyarországon.`;
  return null;
}

/* ====== Lokális gyors válaszok ====== */
function localAnswer(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return null;

  // Parancs
  if (t.startsWith("/")) {
    const res = handleCommand(t);
    if (res) return res;
  }

  // Időzóna keresés
  for (const [key, tz] of Object.entries(zones)) {
    if (t.includes(key)) {
      const cityName = key.charAt(0).toUpperCase() + key.slice(1);
      return timeInZone(cityName, tz);
    }
  }

  // Ha időt kérdez, de nincs város: mindig Magyarország
  if (/(mennyi az idő|hány óra|mai nap|milyen nap|hányadika|milyen dátum)/.test(t)) {
    return `Most ${nowHuFull()} van Magyarországon.`;
  }

  // Fejlesztő / tulaj
  if (/(ki (a )?(tulaj|készítő|fejlesztő)|ki áll a projekt mögött)/.test(t)) {
    return ownerBlurb();
  }

  if (/(mesélj.*tamás|ki az a tamás|horváth tamás)/.test(t)) {
    return ownerBlurb();
  }

  // Lakhely
  if (/(hol laksz|merre laksz|hol található a fejlesztő)/.test(t)) {
    return `A fejlesztő helye: ${ownerLocation()}.`;
  }

  // Modell kiléte
  if (/(milyen (modell|ai)|milyen chatbot|ki vagy|ki vagy te)/.test(t)) {
    return "Tamás modellje vagyok: ő készített és fejleszt, hogy segítsek neked bármiben. 😊";
  }

  return null;
}

/* ====== OpenAI hívás ====== */
async function callOpenAI({ model, messages, temperature = 0.6, max_tokens = 400 }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature, max_tokens })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
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
      `Alapértelmezett hely: Magyarország (${nowHuFull()}).`,
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
    return json(200, { reply: "Most akadozik a kapcsolat a modellel. Írd le röviden, mire van szükséged, és segítek. 🙂" });
  }
}
