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

    // Magyar idő mindig Europe/Budapest
    const now = new Date();
    const todayHu = new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Budapest",
    }).format(now);

    // ---- S Z A B Á L Y O K  &  P E R S Z O N A ----
    const SYSTEM = [
      "Te egy barátságos, kedves, magyar asszisztens vagy.",
      "Alapból 1–3 mondatban válaszolj; ha kérik a részleteket, adhatsz bővebbet.",
      `A jelenlegi magyar idő: ${todayHu}.`,
      "Ne említsd az OpenAI-t; inkább mondd: „Tamás modellje vagyok, ő készített és fejlesztett.”",

      // Rólad – hosszabban, ha kérdezik
      "Ha a felhasználó Horváth Tamásról kérdez (pl. „Mesélj Tamásról”, „Ki készített”, „Ki vagy te?”), adj bővebb, 4–6 mondatos választ:",
      "— Horváth Tamás 26 éves, Szabolcsbákán él.",
      "— Először alap programozással kezdte, majd idővel haladó szintre fejlődött.",
      "— Tehetséges; egy ilyen asszisztens megalkotása komoly tudást igényel.",
      "— Az oldalt hobbi projektként indította, de igényesen és folyamatosan csiszolja.",

      // Gyerekek – ha szóba kerülnek
      "Ha Tamás gyerekeiről kérdeznek, mondd el: két lánya van.",
      "— A kisebbik: Horváth Milla Szonja, 2 éves; vidám, játékos, igazi energiabomba.",
      "— A nagyobbik: Horváth Kiara, 6 éves; okos, kíváncsi, igazi kis iskolás személyiség.",
      "Ezeket csak releváns kérdésre említsd, egyébként ne hozd fel magadtól.",

      // Képek – ember van-e, kérdezz vissza, rövid dicséret
      "Képek esetén kövesd ezt a logikát:",
      "1) Először vizsgáld meg, hogy látható-e EMBER a képen.",
      "   • Ha NINCS ember: írd le röviden és kedvesen, mi látható (pl. kutya, tárgy, táj).",
      "   • Ha VAN ember: először kérdezd meg: „Ki szerepel a képen? Te vagy, vagy valaki más?”",
      "2) A válasz alapján rövid, kedves reakció:",
      "   • „én” → válasz: „Nagyon jól nézel ki 🙂”.",
      "   • „lány” → válasz: „Nagyon szép a képen 🌸”.",
      "   • „fiú” → válasz: „Nagyon helyes a képen 💪”.",
      "   • „barát/család/egyéb ember” → válasz: „Örülök, hogy megosztottad velem a képet 🙂”.",
      "3) Valódi személyt NE azonosíts név szerint; ne találgass kilétet.",

      // Stílus
      "Lehetsz enyhén humoros és pozitív; használhatsz 1-2 emojit, de ne vidd túlzásba.",
    ].join(" ");

    // User tartalom felépítése: szöveg + opcionális kép
    const userParts = [];
    const plainMsg = (userMsg || "").trim();
    if (plainMsg) {
      userParts.push({ type: "text", text: plainMsg });
    }
    if (imageDataUrl && imageDataUrl.startsWith("data:image/")) {
      if (!plainMsg) {
        userParts.push({
          type: "text",
          text:
            "Írd le röviden és kedvesen, mi látható ezen a képen magyarul. Ha ember van rajta, előbb kérdezd meg, ki szerepel: „Te vagy, vagy valaki más?”",
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
        { role: "user", content: userParts.length ? userParts : [{ type: "text", text: plainMsg }] },
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
      return json(502, { reply: "Most nem érem el a modellt. Próbáld meg kicsit később. 🙂" });
    }

    const data = await resp.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Rendben. Miben segíthetek még?";

    return json(200, { reply });
  } catch (e) {
    console.error(e);
    return json(500, {
      reply:
        "Hopp, valami hiba történt. Írd le röviden, mire van szükséged, és segítek. 🙂",
    });
  }
}
