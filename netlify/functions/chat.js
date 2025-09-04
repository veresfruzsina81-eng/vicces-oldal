// netlify/functions/chat.js

exports.handler = async (event) => {
  // --- CORS / preflight ---
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    // --- Környezeti változó ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Hiányzik az OPENAI_API_KEY" }),
      };
    }

    // --- Kérés beolvasása ---
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "Érvénytelen JSON" }),
      };
    }

    // Frontendünk jellemzően { message: "..." }-t küld
    const incomingMessage = (body.message || "").toString().trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!incomingMessage && messages.length === 0) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "Hiányzó üzenet (message / messages)" }),
      };
    }

    // --- Gyors, fix válaszok (branding) ---
    const lastUser =
      (messages
        .slice()
        .reverse()
        .find((m) => m.role === "user")?.content ||
        incomingMessage ||
        ""
      ).toLowerCase();

    const creatorTriggers = [
      "ki hozta létre az oldalt",
      "ki készítette az oldalt",
      "ki a tulajdonos",
      "ki csinálta az oldalt",
      "tulajdonosa az oldalnak",
      "ki az oldal készítője",
      "kié ez az oldal",
    ];
    if (creatorTriggers.some((t) => lastUser.includes(t))) {
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({
          reply:
            "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!",
        }),
      };
    }

    const whoIsHTTriggers = [
      "ki az a horváth tamás",
      "mesélj horváth tamásról",
      "mutasd be horváth tamást",
      "ki horváth tamás",
      "horváth tamásról",
    ];
    if (whoIsHTTriggers.some((t) => lastUser.includes(t))) {
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({
          reply:
            "Horváth Tamás (Szabolcsbáka) az oldal tulajdonosa és fejlesztője. Hobbiszinten webes projektekkel és mesterséges intelligenciával foglalkozik; célja egy barátságos, magyar nyelvű AI-beszélgetés biztosítása.",
        }),
      };
    }

    // --- Rendszer üzenet (mindig magyar válasz) ---
    const systemMsg = {
      role: "system",
      content:
        "Mindig magyarul válaszolj. Légy barátságos, érthető és tömör. " +
        "Ha az oldal készítőjéről kérdeznek, mondd: 'Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!'",
    };

    // Összeállított kontextus: system + (opcionális) korábbi üzenetek + mostani user üzenet
    const convo = [systemMsg];
    if (messages.length) {
      // ha a front-end messages tömböt küld
      convo.push(...messages);
    } else if (incomingMessage) {
      // ha csak egyetlen üzenet érkezett
      convo.push({ role: "user", content: incomingMessage });
    }

    // --- OpenAI Chat Completions hívás ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: convo,
        // új API: max_tokens helyett ezt kell használni:
        max_completion_tokens: 500,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      return {
        statusCode: 502,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({
          error:
            data?.error?.message ||
            `OpenAI hiba (HTTP ${r.status})`,
        }),
      };
    }

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Rendben, miben segíthetek?";

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e?.message || "Ismeretlen szerver hiba" }),
    };
  }
};
