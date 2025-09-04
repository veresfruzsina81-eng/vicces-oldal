// Netlify Function – OpenAI hívás + speciális válaszok H.T-ről
exports.handler = async (event) => {
  // CORS (ha később más domainről is hívnád)
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
    const { messages = [] } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "Missing OPENAI_API_KEY env var" };
    }

    // ---- Speciális triggerek (nem hív OpenAI-t, azonnal válaszol)
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";

    // 1) „Ki hozta létre az oldalt?” jellegű kérdések
    const creatorTriggers = [
      "ki hozta létre az oldalt",
      "ki készítette az oldalt",
      "ki a tulajdonos",
      "ki csinálta az oldalt",
      "tulajdonosa az oldalnak",
      "kié ez az oldal",
      "ki hozta létre ezt az oldalt",
    ];
    if (creatorTriggers.some(t => lastUser.includes(t))) {
      const reply = "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!";
      return { statusCode: 200, headers: { ...cors, "Content-Type":"application/json" }, body: JSON.stringify({ reply }) };
    }

    // 2) „Ki az a Horváth Tamás?” / „Mutasd be H.T-t” jellegű kérdések
    const htTriggers = [
      "ki az a horváth tamás",
      "mutasd be horváth tamást",
      "mesélj horváth tamásról",
      "ki az a h.t",
      "mutasd be h.t",
      "ki az a ht",
      "ki az a horvath tamas",
      "mutasson be horváth tamást",
      "mutasson be h.t"
    ];
    if (htTriggers.some(t => lastUser.includes(t))) {
      const reply =
        "Horváth Tamás (Szabolcsbáka) az oldal tulajdonosa és fejlesztője. " +
        "Hobbi szinten foglalkozik webes projektekkel és mesterséges intelligenciával. " +
        "Ezt az oldalt is ő készítette, hogy barátságos, magyar nyelvű AI beszélgetést kínáljon.";
      return { statusCode: 200, headers: { ...cors, "Content-Type":"application/json" }, body: JSON.stringify({ reply }) };
    }

    // ---- Általános OpenAI hívás
    const systemMsg = {
      role: "system",
      content:
        "Magyarul válaszolj, barátságosan, tömören, lényegre törően. " +
        "Ha rákérdeznek az oldal készítőjére, a válasz: 'Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!' " +
        "Ha a felhasználó bemutatást kér Horváth Tamásról, adj rövid, udvarias bemutatást (az előző mondatban szereplő információkra támaszkodva, új adatot ne találj ki)."
    };

    const out = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [systemMsg, ...messages],
      }),
    });

    if (!out.ok) {
      const t = await out.text();
      return { statusCode: out.status, headers: cors, body: t };
    }

    const j = await out.json();
    const reply = j.choices?.[0]?.message?.content?.trim() || "Rendben.";
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type":"application/json" },
      body: JSON.stringify({ reply }),
    };

  } catch (e) {
    return {
      statusCode: 500, headers: cors,
      body: JSON.stringify({ error: e?.message || "Szerver hiba" })
    };
  }
};
