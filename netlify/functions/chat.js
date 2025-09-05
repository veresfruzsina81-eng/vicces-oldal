// netlify/functions/chat.js
// TELJES JAVÍTOTT VERZIÓ – GPT-5 + Google keresés

import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Egyszerű detektor: kell-e webes keresés?
function needsSearch(q) {
  if (!q) return false;
  const s = q.toLowerCase();

  const needles = [
    "árfolyam", "időjárás", "holnap", "ma", "most", "élő",
    "legfrissebb", "aktuális", "mai", "mikor lesz", "következő meccs",
    "eredmény", "állás", "nyitvatartás", "ár", "árak", "jegyár",
    "breaking", "hír", "hírek", "percről percre", "keresd meg", "googlizd",
    "keress rá", "nézd meg", "google"
  ];

  return needles.some(k => s.includes(k));
}

// --- OpenAI hívás (GPT-5)
async function askOpenAI({ system, user, temperature = 1 }) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5",
      temperature: temperature,   // <-- mindig ponttal!
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
  return data?.choices?.[0]?.message?.content?.trim() || "Sajnálom, most nem tudtam választ adni.";
}

// --- Google keresés a saját Netlify functionön át
async function googleSearch(query) {
  const url = `/.netlify/functions/google?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Google function hiba: ${resp.status} ${txt}`);
  }
  return await resp.json();
}

// --- Netlify handler
export const handler = async (event) => {
  try {
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

    // --- Ha friss infó kell → Google + GPT-5 összefoglaló
    if (doSearch) {
      try {
        const searchData = await googleSearch(message);

        const system =
          "Te egy magyar AI asszisztens vagy. A kapott keresési találatok alapján adj pontos, rövid összefoglalót. A végére tegyél 'Források:' listát max. 5 linkkel.";
        const user =
          `Felhasználói kérdés: "${message}"\n\n` +
          `Google találatok:\n` +
          JSON.stringify(searchData?.results ?? [], null, 2);

        const summary = await askOpenAI({ system, user, temperature: 1 });

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            reply: summary,
            meta: { source: "Google", count: (searchData?.results || []).length }
          })
        };
      } catch (err) {
        // Ha Google nem megy → fallback OpenAI
        const fallback = await askOpenAI({
          system: "Te egy magyar AI asszisztens vagy. Válaszolj világosan, hasznosan.",
          user: `Kérdés: ${message}\n\nMegjegyzés: a webes keresés hibára futott, csak általános tudásból válaszolj.`,
          temperature: 0.3
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

    // --- Egyébként: tisztán GPT-5
    const system =
      "Te egy magyar AI asszisztens vagy. Légy barátságos, tömör és lényegre törő.";
    const answer = await askOpenAI({ system, user: message, temperature: 1 });

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
