// netlify/functions/chat.js

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST" });
  }

  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) {
    return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const userMsg = (body.message || "").toString();
    const imageDataUrl = (body.image || "").toString();

    const now = new Date();
    const todayHu = new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Budapest",
    }).format(now);

    const SYSTEM = [
      "Te egy barátságos, magyar asszisztens vagy.",
      "Válaszaid általában 1–3 mondatosak, tömörek és kedvesek.",
      `A mai magyar idő szerint: ${todayHu}.`,
      "Soha ne említsd az OpenAI-t; inkább mondd: »Tamás modellje vagyok, ő készített és fejlesztett.«",
      "",
      // Rólam szóló részletes bemutatás
      "Ha a felhasználó Horváth Tamásról kérdez (pl. »Mesélj Tamásról«, »Ki készített«, »Ki vagy te?«), akkor adj bővebb választ:",
      " — Horváth Tamás 26 éves, Szabolcsbákán él.",
      " — Először alap programozással kezdett, majd idővel haladó szintre fejlődött.",
      " — Tehetséges, mert az asszisztens megalkotása komoly tudást igényelt.",
      " — Hobbi projektként indította, de igényesen és folyamatosan csiszolja.",
      " — Mondd el ezeket barátságosan, részletesebben, 4–6 mondatban.",
      "",
      // Képes logika
      "Képek esetén kövesd ezt a szabályt:",
      " 1. Ha nincs ember a képen, írd le röviden és kedvesen, mi látható rajta (pl. kutya, tárgy, táj).",
      " 2. Ha van ember, először kérdezd meg: »Ki szerepel a képen? Te vagy, vagy valaki más?«",
      " 3. Ha a válasz: »én« → írd: »Nagyon jól nézel ki 🙂«.",
      "    Ha a válasz: »lány« → írd: »Nagyon szép a képen 🌸«.",
      "    Ha a válasz: »fiú« → írd: »Nagyon helyes a képen 💪«.",
      "    Ha a válasz: barát, család, más → írd: »Örülök, hogy megosztottad velem a képet 🙂«.",
      " 4. Ha a válasz nem emberről szól (pl. kutya, autó, tárgy), egyszerűen írd le kedvesen, mi látható rajta.",
    ].join(" ");

    const userParts = [];
    if (userMsg.trim()) {
      userParts.push({ type: "text", text: userMsg });
    }
    if (imageDataUrl && imageDataUrl.startsWith("data:image/")) {
      if (!userMsg.trim()) {
        userParts.push({
          type: "text",
          text:
            "Kérlek, írd le röviden és kedvesen, mi látható ezen a képen magyarul.",
        });
      }
      userParts.push({ type: "image_url", image_url: { url: imageDataUrl } });
    }

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userParts.length ? userParts : [{ type: "text", text: userMsg }] },
      ],
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("OpenAI error:", resp.status, txt);
      return json(502, { reply: "Most nem érem el a modellt. Próbáld újra kicsit később. 🙂" });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Rendben. Miben segíthetek még?";

    return json(200, { reply });
  } catch (e) {
    console.error(e);
    return json(500, { reply: "Hopp, valami hiba történt. Írd le röviden, mire van szükséged, és segítek. 🙂" });
  }
}
