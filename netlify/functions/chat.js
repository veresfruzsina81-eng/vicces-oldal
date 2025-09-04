// netlify/functions/chat.js
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ====== Saját profil ====== */
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
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
    timeZone: tz
  });
  const ido = d.toLocaleTimeString("hu-HU", {
    hour: "2-digit", minute: "2-digit",
    timeZone: tz
  });
  return `${datum}, ${ido}`;
}
const nowHuFull = () => formatDateTime("Europe/Budapest");

/* ====== Időzónák (top ~50) ====== */
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
  "toronto": "America/Toronto",
  "kanada": "America/Toronto",
  "tokyo": "Asia/Tokyo",
  "japán": "Asia/Tokyo",
  "peking": "Asia/Shanghai",
  "kína": "Asia/Shanghai",
  "hongkong": "Asia/Hong_Kong",
  "seoul": "Asia/Seoul",
  "dél-korea": "Asia/Seoul",
  "dubai": "Asia/Dubai",
  "egyesült arab emírségek": "Asia/Dubai",
  "sydney": "Australia/Sydney",
  "ausztrália": "Australia/Sydney",
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
  return { statusCode: status, headers: { "Content-Type": "application/json", ...corsHeaders }, body: JSON.stringify(obj) };
}
const ownerLocation = () => `${OWNER_PROFILE.postalCode} ${OWNER_PROFILE.town}, ${OWNER_PROFILE.country}`;
const ownerBlurb = () => `${OWNER_PROFILE.name} (${OWNER_PROFILE.age}) — ${ownerLocation()}. ${OWNER_PROFILE.storyShort}`;
function ownerProfileBlock() {
  const o = OWNER_PROFILE;
  return [
    `${o.displayName} modellje vagyok. Íme a profil:`,
    `• Név: ${o.name}`,
    `• Kor: ${o.age}`,
    `• Hely: ${o.postalCode} ${o.town}, ${o.country}`,
    `• Rövid bemutatás: ${o.storyShort}`
  ].join("\n");
}

/* ====== Parancsok ====== */
function handleCommand(cmdRaw) {
  const cmd = (cmdRaw || "").trim().toLowerCase();
  if (cmd === "/help" || cmd === "help" || cmd === "?") {
    return [
      "Parancsok:",
      "• /profil — a fejlesztő bemutatása",
      "• /idő — aktuális magyar dátum és idő",
      "• /help — súgó"
    ].join("\n");
  }
  if (cmd === "/profil") return ownerProfileBlock();
  if (cmd === "/idő" || cmd === "/ido") return `Most ${nowHuFull()} van Magyarországon.`;
  return null;
}

/* ====== Lokális gyors válaszok (szöveg esetén) ====== */
function localTextAnswer(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return null;

  if (t.startsWith("/")) { const res = handleCommand(t); if (res) return res; }

  // város/ország idő
  for (const [key, tz] of Object.entries(zones)) {
    if (t.includes(key)) return `Most ${formatDateTime(tz)} van ${key.charAt(0).toUpperCase()+key.slice(1)}-ban/ben.`;
  }

  // sima idő/dátum (mindig Magyarország)
  if (/(mennyi az idő|hány óra|mai nap|milyen nap|hányadika|milyen dátum)/.test(t))
    return `Most ${nowHuFull()} van Magyarországon.`;

  // fejlesztő / tulaj
  if (/(ki (a )?(tulaj|készítő|fejlesztő)|ki áll a projekt mögött)/.test(t)) return ownerBlurb();
  if (/(mesélj.*tamás|ki az a tamás|horváth tamás)/.test(t)) return ownerBlurb();
  if (/(hol laksz|merre laksz|hol található a fejlesztő)/.test(t)) return `A fejlesztő helye: ${ownerLocation()}.`;

  // modell kiléte
  if (/(milyen (modell|ai)|milyen chatbot|ki vagy|ki vagy te)/.test(t)) return "Tamás modellje vagyok: ő készített és fejleszt, hogy segítsek neked bármiben. 😊";

  return null;
}

/* ====== OpenAI hívás (timeout + retry) ====== */
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
    if (!res.ok) { const txt = await res.text().catch(()=> ""); throw new Error(`OpenAI ${res.status}: ${txt}`); }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    if (retries > 0) { await new Promise(r => setTimeout(r, 350)); return callOpenAI({ model, messages, temperature, max_tokens, timeoutMs, retries: retries - 1 }); }
    throw err;
  } finally { clearTimeout(to); }
}

/* ====== Handler ====== */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  if (!OPENAI_API_KEY) return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });

  try {
    const { message, image } = JSON.parse(event.body || "{}");
    const userMsg = String(message || "").trim();

    // 1) Ha csak szöveg érkezik → lokális gyors válasz?
    if (userMsg && !image) {
      const quick = localTextAnswer(userMsg);
      if (quick) return json(200, { reply: quick });
    }

    // 2) Üzenet tartalom (text + opcionális image)
    const userContent = [];
    if (userMsg) userContent.push({ type: "text", text: userMsg });
    if (image)   userContent.push({ type: "image_url", image_url: { url: image } });
    if (image && !userMsg) userContent.unshift({ type: "text", text: "Mit látsz ezen a képen?" });

    // 3) System prompt (profil + idő + képszabályok)
    const sys = [
      "Barátságos, magyar nyelvű asszisztens vagy.",
      "Válaszaid legyenek rövidek, érthetők, segítőkészek, tegező stílusban.",
      "Ne említsd az OpenAI-t; ha a kilétedről kérdeznek, ezt mondd: 'Tamás modellje vagyok, ő készített és fejlesztett.'",
      `Alapértelmezett hely/idő: Magyarország (${nowHuFull()}).`,
      `Fejlesztői profil (ha kérdezik): ${ownerBlurb()}`,
      "Képek esetén: ha ismert személy látszik, írd le röviden. Egészségi jel esetén ne diagnosztizálj; finoman javasold orvos felkeresését. Ha valaki magáról tölt fel képet, kedvesen, tisztelettel dicsérd meg."
    ].join(" ");

    // 4) OpenAI hívás
    const reply = await callOpenAI({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userContent.length ? userContent : [{ type: "text", text: userMsg }] }
      ],
      temperature: 0.6,
      max_tokens: 400
    });

    return json(200, { reply: reply || "Rendben. Miben segíthetek még?" });

  } catch (e) {
    console.error(e);
    return json(200, { reply: "Most akadozik a kapcsolat a modellel. Írd le röviden, mire van szükséged, és segítek. 🙂" });
  }
}
