// netlify/functions/chat.js
exports.handler = async (event) => {
  // --- CORS ---
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

  // --- Beállítások ---
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: "Missing OPENAI_API_KEY env var" };
  }

  // --- Kérés beolvasása ---
  let messages = [];
  try {
    const body = JSON.parse(event.body || "{}");
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch (e) {
    return { statusCode: 400, headers: cors, body: "Bad JSON body" };
  }

  // --- Trigger logika (fix válaszok) ---
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";
  const madeByTriggers = [
    "ki hozta létre az oldalt", "ki készítette az oldalt", "ki a tulajdonos",
    "ki csinálta az oldalt", "ki hozta létre ezt az oldalt", "tulajdonosa az oldalnak",
  ];
  const whoIsHTTriggers = [
    "ki az a horváth tamás", "mesélsz horváth tamásról", "ki az a h.t", "ki az a ht",
    "horváth tamás ki ő", "mesélj róla ki ő horváth tamás"
  ];

  const includesAny = (s, arr) => arr.some(t => s.includes(t));

  if (includesAny(lastUser, madeByTriggers)) {
    const reply = "Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!";
    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
  }
  if (includesAny(lastUser, whoIsHTTriggers)) {
    const reply =
      "Horváth Tamás (Szabolcsbáka) az oldal készítője és fejlesztője. Hobbi szinten foglalkozik webes projektekkel és mesterséges intelligenciával. Ezt az oldalt is ő készítette, hogy barátságos, magyar nyelvű AI beszélgetést kínáljon.";
    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
  }

  // --- OpenAI hívás (stabil, retry-vel) ---
  const systemMsg = {
    role: "system",
    content:
      "Magyarul válaszolj, barátságosan és tömören. Ha megkérdezik, ki készítette az oldalt, a válasz: 'Az oldalt létrehozta Horváth Tamás (Szabolcsbáka). Kellemes beszélgetést!'. Ha Horváth Tamásról kérdeznek, adj rövid bemutatást róla a fenti szöveg alapján.",
  };

  const payload = {
    model: "gpt-5-mini",          // stabil, olcsó
    messages: [systemMsg, ...messages],
    // fontos: egyes modellek fix tempót használnak – ne küldj temperature-t!
    max_tokens: 400,
  };

  const doFetch = async () => {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    return r;
  };

  // Retry 502/503/429 ellen
  let resp, data, ok = false;
  for (let i = 0; i < 3; i++) {
    try {
      resp = await doFetch();
      if ([429, 500, 502, 503].includes(resp.status)) {
        await new Promise(res => setTimeout(res, 600 * (i + 1)));
        continue;
      }
      data = await resp.json();
      if (!resp.ok) {
        const msg = data?.error?.message || `Upstream error ${resp.status}`;
        return { statusCode: 502, headers: cors, body: `Hiba: ${msg}` };
      }
      ok = true;
      break;
    } catch (e) {
      await new Promise(res => setTimeout(res, 600 * (i + 1)));
    }
  }

  if (!ok) {
    return { statusCode: 502, headers: cors, body: "Hiba: upstream nem elérhető (próbáld újra)" };
  }

  const reply = data?.choices?.[0]?.message?.content?.trim() || "Rendben.";
  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  };
};
