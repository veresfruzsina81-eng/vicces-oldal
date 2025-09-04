exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const { message } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "Missing API key" };
    }

    // Ha a felhasználó rákérdez ki a készítő → fix válasz
    const lower = (message || "").toLowerCase();
    if (lower.includes("ki hozta létre") || lower.includes("ki készítette") || lower.includes("ki az oldal készítője")) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          reply: "Az oldalt Horváth Tamás (Szabolcsbáka) készítette. 😊",
        }),
      };
    }

    // Minden más megy az OpenAI-hoz
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: message,
        max_completion_tokens: 200,
      }),
    });

    const data = await r.json();
    const answer = data.output?.[0]?.content?.[0]?.text || "Értem. Miben segíthetek még?";
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ reply: answer }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e.message || "Szerver hiba" }),
    };
  }
};
