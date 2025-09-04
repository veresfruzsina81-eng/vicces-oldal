// netlify/functions/chat.js
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST" });
  }

  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) {
    return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });
  }

  try {
    const { message } = JSON.parse(event.body || "{}");
    const now = new Date();
    const today = now.toLocaleDateString("hu-HU", { year:"numeric", month:"2-digit", day:"2-digit", weekday:"long" });

    const payload = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Barátságos magyar asszisztens vagy. Röviden, érthetően, segítőkészen válaszolj. " +
            "Ne mondj semmit az OpenAI-ról; mondd azt: 'Tamás modellje vagyok, ő készített és fejlesztett.' " +
            `A mai dátum: ${today}. Ha kérdezik, magyar formátumban add meg.`
        },
        { role: "user", content: message || "" }
      ],
      temperature: 0.6,
      max_tokens: 400
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("OpenAI error:", r.status, text);
      return json(502, { reply: "Most nem érem el a modellt. Próbáld meg újra kicsit később. 🙂" });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "Rendben. Miben segíthetek még?";
    return json(200, { reply });

  } catch (e) {
    console.error(e);
    return json(500, { reply: "Hopp, hiba történt. Írd le röviden, mire van szükséged, és segítek. 🙂" });
  }
}

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(obj)
  };
}
