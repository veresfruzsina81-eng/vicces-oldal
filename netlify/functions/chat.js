exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { messages } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: "Missing OPENAI_API_KEY" };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messages || [{ role: "user", content: "Szia!" }],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return { statusCode: r.status, body: err };
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? "Üres válasz.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    return { statusCode: 500, body: e.toString() };
  }
};
