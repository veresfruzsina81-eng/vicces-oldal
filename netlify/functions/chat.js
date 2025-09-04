exports.handler = async (event) => {
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
    const { message } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "API key missing" }),
      };
    }

    // Egyedi szabályok
    let customReply = null;
    const lowerMsg = (message || "").toLowerCase();

    if (lowerMsg.includes("ki készítette") || lowerMsg.includes("ki hozta létre")) {
      customReply = "Az oldalt Horváth Tamás (Szabolcsbáka) készítette hobbi fejlesztésként. Ő egy lelkes programozó, aki folyamatosan fejleszti a tudását és új projekteket próbál ki.";
    }
    if (lowerMsg.includes("mesélj róla") || lowerMsg.includes("mesélj horváth tamásról")) {
      customReply = "Horváth Tamás Szabolcsbákáról származik, és hobbi szinten foglalkozik webes projektekkel, fejlesztéssel és mesterséges intelligencia alapú megoldások kipróbálásával. Az oldalt is tanulási és kísérletezési céllal készítette.";
    }

    // Ha van előre megadott válasz
    if (customReply) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ reply: customReply }),
      };
    }

    // OpenAI API hívás turbó modellel
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",   // <<< Itt turbó van
        messages: [
          { role: "system", content: "Te egy barátságos magyar asszisztens vagy, természetesen válaszolj minden kérdésre magyar nyelven." },
          { role: "user", content: message }
        ],
        max_completion_tokens: 300
      })
    });

    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const reply = data.choices[0].message.content.trim();

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ reply }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
