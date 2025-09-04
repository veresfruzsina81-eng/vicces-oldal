exports.handler = async (event) => {
  // ---- CORS (ha később más domainekről is hívnád) ----
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
    // ---- Bejövő adatok ----
    const { messages = [], message = "" } = JSON.parse(event.body || "{}");

    // API kulcs
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Missing OPENAI_API_KEY env var" }),
      };
    }

    // ---- Kulcsszavas válaszok (branding) ----
    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content?.toLowerCase() ||
      message.toLowerCase?.() ||
      "";

    // „Ki hozta létre…” / „Ki az a Horváth Tamás?” jellegű kérdések
    const creatorTriggers = [
      "ki hozta létre az oldalt",
      "ki készítette az oldalt",
      "ki a tulajdonos",
      "ki csinálta az oldalt",
      "tulajdonosa az oldalnak",
      "ki az oldal készítője",
    ];

    const whoIsHTTriggers = [
      "ki az a horváth tamás",
      "mesélsz horváth tamásról",
      "ki horváth tamás",
      "horváth tamásról",
      "mutasd be horváth tamást",
    ];

    if (creatorTriggers.some((t) => lastUser.includes(t))) {
      const reply = "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!";
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
    }

    if (whoIsHTTriggers.some((t) => lastUser.includes(t))) {
      const reply =
        "Horváth Tamás (Szabolcsbáka) az oldal tulajdonosa és fejlesztője. Hobbiszinten foglalkozik webes projektekkel és mesterséges intelligenciával. " +
        "Ezen az oldalon barátságos, magyar nyelvű AI beszélgetést kínál.";
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
    }

    // ---- Rendszerüzenet (stílus / szerep) ----
    const systemMsg = {
      role: "system",
      content:
        "Magyarul válaszolj, barátságosan és tömören. " +
        "Ha rákérdeznek az oldal készítőjére, a válasz: 'Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!'",
    };

    // A front-end néha `message` mezőt küld külön; illesszük a messages sorába.
    const mergedMessages = [...messages];
    if (message && !messages?.length) {
      mergedMessages.push({ role: "user", content: message });
    }

    // ---- OpenAI hívás ----
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [systemMsg, ...mergedMessages],
        // FONTOS: az új Chat Completions API nem támogatja a `max_tokens` mezőt,
        // helyette `max_completion_tokens` kell:
        max_completion_tokens: 500,
        // Temperature-t inkább kihagyjuk, mert egyes modellek hibát adnak rá.
        // Ha szeretnéd: pl. temperature: 1
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      // Visszaadjuk a hiba üzenetet a kliensnek
      const msg = data?.error?.message || `OpenAI error (status ${r.status})`;
      return {
        statusCode: 502,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: msg }),
      };
    }

    const reply = data?.choices?.[0]?.message?.content?.trim?.() || "Rendben, szívesen segítek! Miben lehetek hasznodra?";
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e?.message || "Szerver hiba" }),
    };
  }
};
