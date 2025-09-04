exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const { messages, model = "gpt-4o-mini", temperature = 0.7 } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: "Missing OPENAI_API_KEY env var" };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature })
    });
    if (!r.ok) return { statusCode: r.status, body: await r.text() };

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content || "Nincs válasz.";
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
  } catch (e) { return { statusCode: 500, body: String(e) }; }
};
