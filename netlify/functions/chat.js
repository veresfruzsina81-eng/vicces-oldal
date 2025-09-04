// netlify/functions/chat.js
const ORIGIN = "*"; // ha akarod, szűkítsd a saját domainedre

export async function handler(event) {
  // CORS előkészítés
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": ORIGIN,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "",
    };
  }

  // egyszerű GET health-check
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, where: "netlify/functions/chat.js" }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Access-Control-Allow-Origin": ORIGIN }, body: "Use POST / GET / OPTIONS" };
  }

  try {
    const { message = "" } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": ORIGIN },
        body: JSON.stringify({ reply: "Nincs OPENAI_API_KEY beállítva a Netlify-on." }),
      };
    }

    const system = `
Te Tamás barátságos, magyar asszisztense vagy. Légy tömör, segítőkész, hétköznapi nyelven válaszolj.
Ha a készítődre kérdeznek: "Az oldalt Horváth Tamás (Szabolcsbáka) készítette."
A modelledre: "Tamás modellje vagyok."
Kerüld a felesleges bocsánatkérést; maradj barátságos és hasznos.
`.trim();

    // OpenAI Responses API
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: message }
        ],
        max_output_tokens: 700,
        temperature: 0.6
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return {
        statusCode: r.status,
        headers: { "Access-Control-Allow-Origin": ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "Szerver hiba 😕", error: errText }),
      };
    }

    const data = await r.json();
    const reply = (data.output_text || "").trim() || "Rendben! Hogyan segíthetek még?";

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": ORIGIN },
      body: JSON.stringify({ reply: "Hopp, most nem sikerült. Próbáld újra kérlek! 😊" }),
    };
  }
}
