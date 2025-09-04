// netlify/functions/chat.js
// Teljesen javított Netlify Function a chathez (OpenAI Chat Completions)

exports.handler = async (event) => {
  // --- CORS (ha később más domainekről is hívnád) ---
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  // Csak POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    // --- Bejövő adatok ---
    const { message = "" } = JSON.parse(event.body || "{}");

    // --- API kulcs ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Hiányzó OPENAI_API_KEY env var" }),
      };
    }

    // --- Külön logika: ha rákérdeznek a készítőre, válasz azonnal (nem hívunk API-t) ---
    const text = (message || "").toLowerCase();
    const creatorTriggers = [
      "ki készítette az oldalt",
      "ki hozta létre az oldalt",
      "ki az oldal készítője",
      "ki a tulajdonos",
      "ki csinálta az oldalt",
      "készítő",
      "tulajdonos",
    ];
    const askedCreator = creatorTriggers.some(t => text.includes(t));
    if (askedCreator) {
      const reply =
        "Az oldalt Horváth Tamás (Szabolcsbáka) hozta létre, egyedi fejlesztéssel. Kellemes beszélgetést! 🎉";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply }),
      };
    }

    // --- Rendszerüzenet (viselkedés) ---
    const systemMsg = {
      role: "system",
      content:
        "Magyarul válaszolj, barátságosan és tömören. Ne ismételgesd ugyanazt a mondatot. " +
        "Ha nem egyértelmű a kérdés, tegyél fel rövid visszakérdést.",
    };

    // --- OpenAI hívás (chat.completions) ---
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Olyan modellt használj, ami biztosan támogatja a chat.completions-t.
        // Ha neked más modell van beállítva, azt írd ide.
        model: "gpt-4o-mini",
        messages: [
          systemMsg,
          { role: "user", content: message || "" }
        ],
        // FONTOS: ne 'max_tokens'-t használj (nem támogatott) hanem ezt:
        max_completion_tokens: 300
        // 'temperature'-t szándékosan NEM küldünk, hogy ne legyen kompatibilitási hiba.
      }),
    });

    if (!resp.ok) {
      // próbáljuk kiolvasni a hiba-JSON-t
      let info = "";
      try { info = await resp.text(); } catch {}
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({
          error: "Upstream hiba az OpenAI felől (chat.completions).",
          status: resp.status,
          info,
        }),
      };
    }

    const data = await resp.json();
    const reply =
      data?.choices?.[0]?.message?.content?.toString().trim() ||
      "Rendben, miben segíthetek még?";

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e?.message || "Szerver hiba" }),
    };
  }
};
