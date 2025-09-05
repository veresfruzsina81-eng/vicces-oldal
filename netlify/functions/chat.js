// netlify/functions/chat.js
export async function handler(event) {
  try {
    const { message = "" } = JSON.parse(event.body || "{}");

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Hiányzik az üzenet." }),
      };
    }

    // Ha a felhasználó friss adatot kér (pl. "árfolyam", "mikor", "legújabb")
    let googleResults = null;
    if (/árfolyam|mai|legújabb|mikor|hírek|aktuális/i.test(message)) {
      const googleResponse = await fetch(`${process.env.URL}/.netlify/functions/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: message }),
      });

      if (googleResponse.ok) {
        const data = await googleResponse.json();
        googleResults = data.results
          .slice(0, 3) // csak az első 3 találat
          .map(r => `🔹 ${r.title} – ${r.link}`)
          .join("\n");
      }
    }

    // GPT-5 API hívás (OpenAI)
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5", // GPT-5 modell
        messages: [
          { role: "system", content: "Te Tamás barátságos, magyar asszisztensed vagy. Légy tömör, segítőkész, hétköznapi nyelven válaszolj." },
          { role: "user", content: message },
          ...(googleResults ? [{ role: "system", content: `Friss adatok a Google keresésből:\n${googleResults}` }] : []),
        ],
      }),
    });

    if (!aiResponse.ok) {
      return {
        statusCode: aiResponse.status,
        body: JSON.stringify({ error: "OpenAI API hiba", detail: await aiResponse.text() }),
      };
    }

    const aiData = await aiResponse.json();
    const reply = aiData.choices?.[0]?.message?.content || "Nem találtam választ.";

    return {
      statusCode: 200,
      body: JSON.stringify({ reply }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Chat hiba", detail: error.message }),
    };
  }
}
