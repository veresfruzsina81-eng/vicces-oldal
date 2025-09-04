exports.handler = async (event) => {
  // CORS beállítások
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
    const messages = JSON.parse(event.body || "{}").messages || [];
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "Missing OPENAI_API_KEY env var" };
    }

    // Speciális válasz, ha rákérdeznek a készítőre
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content.toLowerCase() || "";
    if (lastUser.includes("ki az a horváth tamás") || lastUser.includes("ki készítette az oldalt")) {
      const reply = "Horváth Tamás (Szabolcsbáka) az oldal készítője és fejlesztője. Hobbi szinten foglalkozik webes projektekkel és mesterséges intelligenciával.";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      };
    }

    // Alap system üzenet
    const systemMsg = {
      role: "system",
      content: "Magyarul válaszolj, barátságosan és röviden. Ha rákérdeznek az oldal készítőjére, a válasz: Horváth Tamás (Szabolcsbáka)."
    };

    // API hívás GPT-4o-mini modellel
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",   // <<< Olcsó modell
        messages: [systemMsg, ...messages],
        temperature: 0.7,
      }),
    });

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content || "Sajnálom, hiba történt.";

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
