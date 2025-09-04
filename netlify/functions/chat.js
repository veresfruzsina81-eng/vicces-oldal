// netlify/functions/chat.js
// Node 18+ (Netlify) – OpenAI Chat Completions

exports.handler = async (event) => {
  // --- CORS (preflight + engedélyek) ---
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    // --- Kéréstörzs ---
    const { messages = [] } = JSON.parse(event.body || "{}");

    // --- API kulcs ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Hiányzik az OPENAI_API_KEY környezeti változó." }),
      };
    }

    // --- Kulcsszavas gyorsválaszok (oldalkészítő + bemutatkozás) ---
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";

    // 1) Ki készítette / ki a tulajdonos kérdések
    const makerTriggers = [
      "ki hozta létre az oldalt", "ki a tulajdonos", "ki készítette az oldalt",
      "ki csinálta az oldalt", "készítette az oldalt", "tulajdonosa az oldalnak",
      "kié ez az oldal", "ki az oldal készítője"
    ];
    if (makerTriggers.some(t => lastUser.includes(t))) {
      const reply =
        "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést! 🎉";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      };
    }

    // 2) “Ki az a Horváth Tamás?” – hosszabb bemutató
    const bioTriggers = [
      "ki az a horváth tamás", "mesélj horváth tamásról", "mutasd be horváth tamást",
      "ki horváth tamás", "horváth tamás bemutatása"
    ];
    if (bioTriggers.some(t => lastUser.includes(t))) {
      const reply =
        "Horváth Tamás (Szabolcsbáka) a webhely tulajdonosa és fejlesztője. " +
        "Hobbi szinten foglalkozik egyszerű webes projektekkel, felhő-alapú hosztinggal és " +
        "mesterséges intelligenciával. Az oldal célja, hogy barátságos, magyar nyelvű AI " +
        "beszélgetést kínáljon, amely segít gyors válaszokban, ötletelésben vagy tanulásban. " +
        "Tamás fontosnak tartja az átláthatóságot és az adatbiztonságot, ezért az oldal " +
        "nyílt, érthető módon jelzi, hogy az OpenAI API-t használja. Ha kérdésed van az " +
        "oldal működéséről vagy fejlesztési tervekről, szívesen válaszol!";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ reply })
      };
    }

    // --- System üzenet (stílus) ---
    const systemMsg = {
      role: "system",
      content:
        "Magyarul válaszolj, barátságosan és tömören. Légy hasznos, udvarias és világos."
    };

    // --- OpenAI hívás (temperature NINCS – a modell így kéri) ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [systemMsg, ...messages],
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return {
        statusCode: r.status,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `OpenAI hívás sikertelen (${r.status}).`,
          details: errText?.slice(0, 500)
        }),
      };
    }

    const data = await r.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sajnálom, most nem tudok válaszolni. Próbáld meg újra kérlek!";

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Szerver hiba", message: String(e?.message || e) }),
    };
  }
};
