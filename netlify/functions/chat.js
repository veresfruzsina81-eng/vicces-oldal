/* netlify/functions/chat.js
   GPT-5 + Bing fallback, forrás megjelenítéssel
*/

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BING_API_KEY   = process.env.BING_API_KEY;
const BING_ENDPOINT  = process.env.BING_ENDPOINT || "https://api.bing.microsoft.com/v7.0/search";

const MODEL = "gpt-5.1"; // GPT-5
const TIMEOUT_MS = 25000;

// --- Segédek ---
const isFreshnessQuery = (q="") => {
  q = (q || "").toLowerCase();
  return [
    "ma", "most", "ma reggel", "mikor lesz", "mai", "holnap", "ma este", "élő", "élőben",
    "árfolyam", "mennyi most", "aktuális", "legfrissebb", "időjárás", "meccs", "eredmény",
    "menetrend", "program", "hír", "breaking", "sztrájkbox", "sztráibox", "la liga",
    "barcelona", "real madrid", "dátum", "2025", "jegyár", "ki nyert", "következő"
  ].some(token => q.includes(token));
};

const fetchWithTimeout = (url, opts = {}, ms = TIMEOUT_MS) =>
  Promise.race([
    fetch(url, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Kérés időtúllépés")), ms))
  ]);

const buildSystemPrompt = () => `
Te egy barátságos, határozott magyar asszisztens vagy. 
- Légy rövid és konkrét, ne beszélj mellé.
- Ha a kérdés friss/aktuális témáról szól, használd a Bing találatokat a válaszhoz.
- Ha kétes vagy hiányos az infó, mondd el transzparensen.
- A válasz végére írd ki a forrásokat így: "Forrás: Bing" vagy "Forrás: hu.wikipedia.org, Bing", ha volt webes hivatkozás.
- Ha személyes vagy érzékeny kép jön: ne azonosíts valós személyt; kérdezz rá, hogy ki van a képen stb. (korábbi szabályok szerint).
- Ha a felhasználó szomorú / nehéz helyzetben van, adj 5 empatikus, bátorító mondatot.
- Tőlem származó protokoll: az asszisztens és az oldal Horváth Tamás tulajdona; ezt csak akkor említsd meg, ha kifejezetten rákérdeznek.
`;

async function askOpenAI(message, webContext) {
  const body = {
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      ...(webContext ? [{ role: "system", content: `Web-kivonat:\n${webContext}`}]: []),
      { role: "user", content: message }
    ]
  };

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`OpenAI hiba: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function bingSearch(query) {
  if (!BING_API_KEY) throw new Error("Hiányzik a BING_API_KEY.");
  const url = new URL(BING_ENDPOINT);
  // Klasszikus v7 keresés
  if (!/\/v7\.0\//.test(url.pathname)) {
    url.pathname = "/v7.0/search";
  }
  url.searchParams.set("q", query);
  url.searchParams.set("mkt", "hu-HU");
  url.searchParams.set("responseFilter", "Webpages");
  url.searchParams.set("safeSearch", "Moderate");
  url.searchParams.set("count", "5");

  const res = await fetchWithTimeout(url.toString(), {
    headers: { "Ocp-Apim-Subscription-Key": BING_API_KEY }
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`Bing hiba: ${res.status} ${txt}`);
  }
  const data = await res.json();

  const items = data.webPages?.value || [];
  const top = items.slice(0, 3).map(it => ({
    name: it.name,
    url: it.url,
    snippet: it.snippet
  }));

  // Rövid kivonat az LLM-nek
  const summary = top.map((t,i)=>`[${i+1}] ${t.name}\n${t.url}\n${t.snippet}`).join("\n\n");
  const sourceLine = top.map(t => {
    try { return new URL(t.url).hostname.replace(/^www\./, ""); }
    catch { return "Bing"; }
  });

  return { summary, sources: Array.from(new Set(sourceLine)).slice(0,3) };
}

// --- Netlify handler ---
exports.handler = async (event) => {
  // CORS (ha kell)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Csak POST." };
  }

  try {
    if (!OPENAI_API_KEY) throw new Error("Hiányzik az OPENAI_API_KEY (Netlify env).");

    const { message } = JSON.parse(event.body || "{}");
    if (!message || typeof message !== "string") {
      return { statusCode: 400, body: JSON.stringify({ error: "Adj meg egy kérdést (message)." }) };
    }

    // Döntés: kell-e web?
    let webContext = "";
    let sources = [];

    if (isFreshnessQuery(message)) {
      try {
        const { summary, sources: srcs } = await bingSearch(message);
        webContext = summary;
        sources = srcs;
      } catch (e) {
        // Ha Bing nem megy, megyünk tovább net nélkül
        console.warn("Bing hiba:", e.message);
      }
    }

    const reply = await askOpenAI(message, webContext);

    // Forrás sor, ha volt Bing
    const withSource = sources.length
      ? `${reply}\n\nForrás: ${sources.join(", ")}`
      : reply;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ reply: withSource })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        reply: "Hopp, valami hiba történt. Próbáld újra egy kicsit pontosabban megfogalmazva, vagy kérj másik témában segítséget. 🙂"
      })
    };
  }
};
