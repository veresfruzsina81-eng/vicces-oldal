// netlify/functions/chat.js

exports.handler = async (event) => {
  // --- CORS (ha más domainekről is hívnád) ---
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // --- Preflight ---
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  // --- Csak POST ---
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    // --- Bejövő adat ---
    const { message = "" } = JSON.parse(event.body || "{}");

    // --- API kulcs ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Hiányzik az OPENAI_API_KEY környezeti változó." }),
      };
    }

    // --- Gyors válasz a készítőre vonatkozó kérdésekre (nem minden válasz végére!) ---
    const txt = (message || "").toLowerCase();

    const creatorTriggers = [
      "ki készítette az oldalt",
      "ki hozta létre az oldalt",
      "ki a tulajdonos",
      "ki csinálta az oldalt",
      "ki a készítő",
      "ki csinálta ezt az oldalt",
      "ki csinálta ezt a weboldalt",
      "ki hozta létre ezt az oldalt",
      "ki a honlap készítője",
      "ki csinálta a honlapot",
      "ki csinálta ezt a honlapot",
    ];

    const askAboutTamas = [
      "mesélsz róla",
      "mesélj róla",
      "ki az a horváth tamás",
      "mesélj horváth tamásról",
      "mondj pár szót horváth tamásról",
    ];

    const matchedCreator =
      creatorTriggers.some((t) => txt.includes(t)) ||
      (/ki.*(készítette|hozta létre|csinálta).*(oldal|honlap|weboldal)/i).test(message);

    const matchedAbout =
      askAboutTamas.some((t) => txt.includes(t)) ||
      (/ki az a horváth tamás|mes(é|e)lj.*horv(á|a)th tam(á|a)s/i).test(message);

    if (matchedCreator) {
      const reply =
        "Az oldalt Horváth Tamás (Szabolcsbáka) készítette — saját hobbi fejlesztésként. 😊";
      return { statusCode: 200, headers: cors, body: JSON.stringify({ reply }) };
    }

    if (matchedAbout) {
      const reply =
        "Horváth Tamás (Szabolcsbáka) hobbiprojektekben fejleszti magát web és mesterséges intelligencia témákban. Ezt az oldalt is ő készítette, hogy egy barátságos, magyar nyelvű AI beszélgetőt kínáljon. Szívesen tanul, kísérletezik és folyamatosan csiszolja a funkciókat. 🙂";
      return { statusCode: 200, headers: cors, body: JSON.stringify({ reply }) };
    }

    // --- Normál OpenAI hívás (chat.completions) ---
    const systemMsg =
      "Magyarul válaszolj, barátságosan és tömören. Ha az oldal készítőjére kérdeznek rá, a válasz: 'Az oldalt Horváth Tamás (Szabolcsbáka) készítette — hobbi fejlesztésként.' Egyébként ne említsd a készítőt.";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // ha turbót akarsz: "gpt-4-turbo"
        temperature: 0.7,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: message || "Szia!" },
        ],
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({
          error: "Upstream hiba az OpenAI-tól.",
          status: r.status,
          details: errText,
        }),
      };
    }

    const data = await r.json();
    const reply =
      data?.choices?.[0]?.message?.content?.toString() ||
      "Értem. Miben segíthetek még?";

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
