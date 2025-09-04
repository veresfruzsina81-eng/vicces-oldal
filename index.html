exports.handler = async (event) => {
  // CORS – ha kell más oldalról is hívni
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
    const { messages = [] } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "Missing OPENAI_API_KEY env var" };
    }

    // Legutóbbi user üzenet
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";

    // KULCShangok a „ki hozta létre…” kérdéshez
    const triggers = [
      "ki hozta létre az oldalt",
      "ki készítette az oldalt",
      "ki a tulajdonos",
      "ki hozta létre ezt az oldalt",
      "ki csinálta az oldalt",
      "készítette az oldalt",
      "tulajdonosa az oldalnak"
    ];

    const match = triggers.some(t => lastUser.includes(t));
    if (match) {
      const reply = "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      };
    }

    // System-instrukció: magyar, barátságos, rövid
    const systemMsg = {
      role: "system",
      content:
        "Magyarul válaszolj, barátságosan és tömören. Ha rákérdeznek az oldal készítőjére," +
        " a válasz: 'Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!'"
    };

    // OpenAI hívás
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [systemMsg, ...messages],
        temperature: 0.6,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return { statusCode: r.status, headers: cors, body: t || "Upstream error" };
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content || "Hopp, nem jött válasz.";
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
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
