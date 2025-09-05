// netlify/functions/chat.js
// Csak OpenAI + ingyenes DuckDuckGo/Wikipedia keresés
// ENV: OPENAI_API_KEY (kötelező)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---------- Ingyenes web-keresés ----------
async function smartWebSearch(query) {
  // DuckDuckGo
  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    const j = await r.json();
    const chunks = [];
    if (j.AbstractText) chunks.push(j.AbstractText);
    if (Array.isArray(j.RelatedTopics)) {
      for (const t of j.RelatedTopics.slice(0, 3)) {
        if (t && typeof t.Text === "string") chunks.push(t.Text);
      }
    }
    if (chunks.length) {
      return { text: chunks.join("\n\n"), source: "DuckDuckGo" };
    }
  } catch (_) {}

  // Wikipédia fallback
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
    );
    if (r.ok) {
      const j = await r.json();
      if (j.extract) return { text: j.extract, source: "Wikipedia" };
    }
  } catch (_) {}

  return { text: null, source: null };
}

// ---------- OpenAI hívás ----------
async function askOpenAI({ userQuestion, webContext }) {
  if (!OPENAI_API_KEY) {
    throw new Error("Hiányzik az OPENAI_API_KEY környezeti változó.");
  }

  const messages = [
    {
      role: "system",
      content: `Te egy barátságos magyar asszisztens vagy. Válaszaid legyenek rövidek, pontosak, és használd a Web-kivonatot, ha van.`,
    },
    {
      role: "user",
      content: `Kérdés: ${userQuestion}\n\nWeb-kivonat:\n${webContext || "—"}`,
    },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o", // fix modell, nem kell env változó
      messages,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI hiba: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  return (
    data?.choices?.[0]?.message?.content?.trim() ||
    "Sajnálom, most nem tudok választ adni."
  );
}

// ---------- Netlify handler ----------
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: { "Access-Control-Allow-Origin": "*" }, body: "Csak POST." };
    }

    const body = JSON.parse(event.body || "{}");
    const userQuestion = (body.message || "").toString().trim();

    if (!userQuestion) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Hiányzik a 'message' mező." }),
      };
    }

    // Web keresés
    const web = await smartWebSearch(userQuestion);
    const webContext = web.text || "";

    // OpenAI válasz
    const answer = await askOpenAI({ userQuestion, webContext });

    // Forrás hozzáadása
    const withSource = answer + (web.source ? `\n\nForrás: ${web.source}` : "");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ reply: withSource }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        reply: "Hiba történt: " + (err && err.message ? err.message : "ismeretlen hiba"),
      }),
    };
  }
};
