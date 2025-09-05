// netlify/functions/chat.js
// Teljes chat backend: OpenAI + Google-keresés (Programozható Keresőmotor)
// Bemenet: POST { message: "felhasználói kérdés" }
// Kimenet: { reply: "...", sources: [{title, link}] }

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Ha szeretnél később modellt váltani, add meg env-ben: OPENAI_MODEL
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // biztonságos alapértelmezés

// Egyszerű magyar detektálás, hogy kell-e friss webes infó:
function needsWebSearch(q) {
  if (!q) return false;
  const s = q.toLowerCase();

  // Kifejezetten “aktuális” kulcsszavak
  const hotWords = [
    "most", "ma", "majd", "aktuális", "friss", "éppen",
    "árfolyam", "időjárás", "forint", "euró", "usd", "btc",
    "hírek", "hír", "mai", "holnap", "mikor lesz", "következő meccs",
    "menetrend", "élő", "live", "eredmény", "verseny", "program", "esemény"
  ];
  if (hotWords.some(w => s.includes(w))) return true;

  // “Keress”, “nézz utána” jellegű kérés
  if (/(keres(s|) |nézz|kutass|google|bing|forrás)/i.test(s)) return true;

  return false;
}

// Szépítés: forrás-lista -> "Forrás: domain1, domain2"
function sourcesFooter(items = []) {
  if (!items.length) return "";
  const domains = [...new Set(items.map(it => {
    try {
      const u = new URL(it.link);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return it.link;
    }
  }))];
  return `\n\nForrás: ${domains.join(", ")}`;
}

// A saját Google-funkció meghívása (a Netlifyon futó google.js)
async function googleSearch(query) {
  // URL-encoding fontos!
  const url = `/.netlify/functions/google?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google függvény hiba: ${res.status} ${txt}`);
  }
  const data = await res.json();
  // Elvárt forma: { results: [{title, link, snippet, source}] }
  return (data && Array.isArray(data.results)) ? data.results : [];
}

exports.handler = async (event) => {
  // CORS – ha kell a böngészőből közvetlen hívni
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Csak POST engedélyezett." }),
      };
    }

    if (!OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Hiányzik az OPENAI_API_KEY környezeti változó." }),
      };
    }

    const { message } = JSON.parse(event.body || "{}");
    if (!message || typeof message !== "string") {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Hiányzik a 'message' mező a törzsben." }),
      };
    }

    // Döntés: kell-e webkeresés?
    let searchResults = [];
    if (needsWebSearch(message)) {
      try {
        searchResults = await googleSearch(message);
      } catch (e) {
        // Ha a keresés elhasal, attól még válaszoljon a modell
        searchResults = [];
      }
    }

    // Kontextus a modellnek – magyar, okos, nem mellébeszélős stílus:
    const systemPrompt = `
Te egy magyar nyelvű, tömör és pontos AI asszisztens vagy.
- Soha ne találj ki adatot.
- Ha tartalmazok forrásokat (domain/link), akkor támaszkodj rájuk a tényekhez.
- Adj rövid, lényegre törő választ, utána külön sorban írj "Forrás:"-t a domainekkel, ha vannak.
- Ha nincs friss forrás, akkor halkan jelezd, hogy általános tudás alapján válaszolsz.
- Stílus: segítőkész, de nem mellébeszélős.
`.trim();

    // A forrásokból “kivonat” a modellnek (max 3-5 link)
    const contextFromWeb = searchResults.slice(0, 5).map((r, i) => {
      const safeTitle = (r.title || "").slice(0, 180);
      const safeSnippet = (r.snippet || "").slice(0, 400);
      const safeLink = (r.link || "").slice(0, 500);
      return `[#${i + 1}] ${safeTitle}\n${safeSnippet}\nLink: ${safeLink}`;
    }).join("\n\n");

    const messages = [
      { role: "system", content: systemPrompt },
      ...(contextFromWeb
        ? [{ role: "system", content: `Friss webes kontextus:\n\n${contextFromWeb}` }]
        : []),
      { role: "user", content: message }
    ];

    // OpenAI Chat Completions hívás
    const oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.3,
      })
    });

    if (!oaRes.ok) {
      const txt = await oaRes.text().catch(() => "");
      throw new Error(`OpenAI hiba: ${oaRes.status} ${txt}`);
    }

    const oaJson = await oaRes.json();
    const reply = (oaJson.choices && oaJson.choices[0]?.message?.content) || "Sajnálom, nem tudok most válaszolni.";

    const body = {
      reply: reply + sourcesFooter(searchResults.slice(0, 5)),
      sources: searchResults.slice(0, 5), // ha a frontenden listázni szeretnéd
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(body),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
