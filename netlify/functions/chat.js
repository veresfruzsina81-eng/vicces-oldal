// netlify/functions/chat.js
// TELJES KÉSZ FÁJL – csak bemásolod és kész.

// Node fetch az API hívásokhoz
import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Egyszerű detektor: kell-e webes keresés ehhez a kérdéshez?
function needsSearch(q) {
  if (!q) return false;
  const s = q.toLowerCase();

  // kulcsszavak: árfolyam, időjárás, menetrend, „mikor lesz”, „legfrissebb”, stb.
  const needles = [
    "árfolyam", "időjárás", "holnap", "ma", "most", "élő",
    "legfrissebb", "aktuális", "mai", "mikor lesz", "következő meccs",
    "eredmény", "állás", "nyitvatartás", "ár", "árak", "jegyár",
    "breaking", "hír", "hírek", "percről percre", "keresd meg", "googlizd",
    "keress rá", "nézd meg", "google"
  ];

  return needles.some(k => s.includes(k));
}

// --- GPT-5 hívás (általános válasz vagy összefoglaló generálás)
async function askOpenAI({ system, user, temperature = 0.3 }) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5",
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenAI hiba: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  const reply = data?.choices?.[0]?.message?.content?.trim() || "Sajnálom, most nem tudtam választ adni.";
  return reply;
}

// --- Google keresés a saját Netlify functionön át
async function googleSearch(query) {
  const url = `/.netlify/functions/google?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Google function hiba: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  // elvárt forma: { results: [ { title, snippet, link, source }, ... ] }
  return data;
}

// --- Netlify handler
export const handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Csak POST engedélyezett." })
      };
    }

    const { message } = JSON.parse(event.body || "{}");
    if (!message || typeof message !== "string") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Hiányzik az üzenet (message)." })
      };
    }

    const doSearch = needsSearch(message);

    // Ha friss/aktuális dolognak tűnik → Google + összefoglaló
    if (doSearch) {
      try {
        const searchData = await googleSearch(message);

        // Elkészítjük az összefoglalót GPT-5-tel
        const system =
          "Te egy magyar AI asszisztens vagy. Válaszolj tömören, világosan. A kapott keresési találatok alapján adj hasznos, ellenőrizhető választ. A végére tegyél 'Források:' listát, felsorolva a releváns linkeket (max. 5).";
        const user =
          `Felhasználói kérdés: "${message}"\n\n` +
          `Itt vannak a Google-tól kapott találatok JSON-ként:\n` +
          JSON.stringify(searchData?.results ?? [], null, 2) +
          `\n\nKészíts összefoglalót (magyarul), és a végén adj 'Források:' felsorolást a linkekkel.`;

        const summary = await askOpenAI({ system, user, temperature: 0.2 });

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            reply: summary,
            meta: { source: "Google", count: (searchData?.results || []).length }
          })
        };
      } catch (err) {
        // Ha a Google hívás elszáll, még mindig válaszolunk GPT-5-tel
        const fallback = await askOpenAI({
          system: "Te egy magyar AI asszisztens vagy. Válaszolj világosan, hasznosan.",
          user: `Kérdés: ${message}\n\nMegjegyzés: a webes keresés most hibára futott, ezért csak általános tudásból válaszolj.`
        });

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            reply: fallback,
            meta: { source: "OpenAI (fallback)", error: String(err?.message || err) }
          })
        };
      }
    }

    // Egyébként: tisztán GPT-5
    const system =
      "Te egy magyar AI asszisztens vagy. Légy barátságos, tömör és lényegre törő. Ha a kérés aktuális, valós idejű adatokat igényelne, javasold, hogy írja: 'keresd meg' vagy 'googlizd meg', és akkor webes keresést végzel.";
    const answer = await askOpenAI({ system, user: message, temperature: 0.5 });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ reply: answer, meta: { source: "OpenAI" } })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Szerver hiba a chat funkcióban.", detail: String(e?.message || e) })
    };
  }
};
