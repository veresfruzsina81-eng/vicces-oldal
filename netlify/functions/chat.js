import fetch from "node-fetch";

export async function handler(event) {
  try {
    const { message = "" } = JSON.parse(event.body || "{}");

    // Ha a kérdésben van "keresés" szó → Google-t használ
    if (message.toLowerCase().includes("keresés") || message.toLowerCase().includes("google")) {
      const query = encodeURIComponent(message.replace(/keresés|google/gi, "").trim());
      const googleRes = await fetch(`${process.env.URL}/.netlify/functions/google?q=${query}`);
      const googleData = await googleRes.json();
      return {
        statusCode: 200,
        body: JSON.stringify({ reply: `Google találat: ${googleData.results?.[0]?.title} - ${googleData.results?.[0]?.link}` })
      };
    }

    // Egyébként → OpenAI választ ad
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: message }]
      })
    });

    const data = await openaiRes.json();
    const reply = data.choices?.[0]?.message?.content || "Nem értem a kérdést.";
    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
