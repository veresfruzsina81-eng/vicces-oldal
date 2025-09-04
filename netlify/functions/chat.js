// netlify/functions/chat.js
exports.handler = async (event) => {
  // CORS (későbbi bővítéshez jó, most is ártalmatlan)
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const { messages = [] } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "Missing OPENAI_API_KEY env var" };
    }

    // --- Külön logika: ki hozta létre / ki Horváth Tamás? ---
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";
    const creatorTriggers = [
      "ki hozta létre az oldalt",
      "ki készítette az oldalt",
      "ki a tulajdonos",
      "ki csinálta az oldalt",
      "tulajdonosa az oldalnak",
      "ki csinálta ezt az oldalt",
      "ki hozta létre ezt az oldalt"
    ];
    const introTriggers = [
      "ki az a horváth tamás",
      "mesélj horváth tamásról",
      "mutasd be horváth tamást",
      "ki az horváth tamás"
    ];

    if (creatorTriggers.some(t => lastUser.includes(t))) {
      const reply = "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      };
    }

    if (introTriggers.some(t => lastUser.includes(t))) {
      const reply = "Horváth Tamás Szabolcsbákán élő hobbi fejlesztő. Webes projektekkel és mesterséges intelligenciával foglalkozik; ezt az oldalt is ő készítette, hogy barátságos, magyar nyelvű AI beszélgetést kínáljon.";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      };
    }

    // --- Normál OpenAI hívás ---
    const systemMsg = {
      role: "system",
      content:
        "Magyarul válaszolj, barátságosan és tömören. Ha rákérdeznek az oldal készítőjére, a válasz: 'Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!'"
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [systemMsg, ...messages],
        temperature: 0.6
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return {
        statusCode: 500,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: data?.error?.message || "Szerver hiba" })
      };
    }

    const reply = data?.choices?.[0]?.message?.content?.trim() || "Rendben, miben segíthetek?";
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e?.message || "Szerver hiba" })
    };
  }
};
