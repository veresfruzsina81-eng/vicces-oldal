export async function handler(event) {
  // CORS / preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  try {
    const { message = "", history = [] } = JSON.parse(event.body || "{}");

    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ reply: "Szerver hiba 😕", error: "Hiányzik az OPENAI_API_KEY" })
      };
    }

    const system = `
Te Tamás barátságos, magyar asszisztensed vagy. Légy tömör, segítőkész, hétköznapi nyelven válaszolj.
Kerüld a felesleges bocsánatkérést. Ha érzékeny/18+ kérdés jön, maradj udvarias és informatív.
Ne beszélj az OpenAI-ról; ha rákérdeznek a modelledre: "Tamás modellje vagyok".
`;

    // A Responses API "input" mezője tartalomblokkok listáját várja.
    // Összeállítjuk: system + (history) + user message
    const inputs = [
      { role: "system", content: [{ type: "text", text: system }] },
      ...normalizeHistory(history),
      { role: "user", content: [{ type: "text", text: message }] },
    ];

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: inputs,
        max_output_tokens: 600,
        temperature: 0.55
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return { statusCode: r.status, headers: cors(), body: JSON.stringify({ reply: "Szerver hiba 😕", error: txt }) };
    }

    const data = await r.json();
    const reply = (data.output_text || "").trim() || "Rendben!";

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ reply: "Hopp, most nem sikerült. Próbáld újra kérlek! 😊", error: String(e?.message || e) })
    };
  }
}

// Segédek
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function normalizeHistory(historyArr) {
  // Elvárt input: [{role:'user'|'bot'|'assistant', text:'...'}, ...]
  // Responses API-hoz konvertáljuk.
  if (!Array.isArray(historyArr)) return [];
  return historyArr.slice(-20).map(m => {
    const role = (m.role === 'user') ? 'user' : 'assistant';
    // (óvatosságból limitálunk szöveghosszt)
    const text = String(m.text || '').slice(0, 4000);
    return { role, content: [{ type: "text", text }] };
  });
}
