// netlify/functions/chat.js
exports.handler = async (event) => {
  // --- CORS ---
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const { message = "" } = JSON.parse(event.body || "{}");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "Missing OPENAI_API_KEY" };
    }

    // --- CSAK ILYEN KÉRDÉSEKNÉL válaszoljuk meg a tulaj/credits sort ---
    const low = (message || "").toLowerCase();
    const triggers = [
      "ki hozta létre az oldalt",
      "ki az oldal készítője",
      "ki készítette az oldalt",
      "ki csinálta az oldalt",
      "tulajdonosa az oldalnak",
      "ki a tulajdonos",
    ];
    if (triggers.some(t => low.includes(t))) {
      const reply = "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply }),
      };
    }

    // --- Normál OpenAI hívás (NINCS temperature / max_tokens, hogy ne legyen hiba) ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Magyarul válaszolj, barátságosan és tömören." },
          { role: "user", content: message || "" }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      return { statusCode: 502, headers: cors, body: "Upstream error: " + txt.slice(0,160) };
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Rendben. Miben segíthetek még?";

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: "Szerver hiba: " + (e?.message || e),
    };
  }
};
