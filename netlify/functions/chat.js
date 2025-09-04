// netlify/functions/chat.js
exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const { message = "", history = [] } = JSON.parse(event.body || "{}");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Hiányzik az OPENAI_API_KEY környezeti változó." }),
      };
    }

    // ------- Kulcsszavas fix válaszok -------
    const text = (message || "").toLowerCase();

    // 1) Modellre kérdezés → fix válasz (nincs OpenAI/GPT említés)
    const modelProbe = [
      "milyen modell", "melyik modell", "gpt", "ai vagy", "milyen chat", "milyen vagy", "mi vagy te"
    ];
    const asksModel = modelProbe.some((t) => text.includes(t));
    if (asksModel) {
      const reply = "Én Tamás modellje vagyok. Horváth Tamás készített és fejlesztett, hogy segítsek neked bármiben. 🙂";
      return ok({ reply, tts: reply });
    }

    // 2) Készítő/tulaj kérdések → fix válasz
    const ownerTriggers = [
      "ki készítette", "ki hozta létre", "ki csinálta", "ki a tulaj",
      "ki az oldal készítője", "ki az oldal tulajdonosa", "kié ez az oldal",
      "készítője az oldalnak", "tulajdonosa az oldalnak"
    ];
    const asksOwner = ownerTriggers.some((t) => text.includes(t));
    if (asksOwner) {
      const reply = "Az oldalt Horváth Tamás (Szabolcsbáka) készítette hobbifejlesztőként. Jó szórakozást! 🎉";
      return ok({ reply, tts: reply });
    }

    // 3) Horváth Tamásról általában → mindig a hobbifejlesztő (nem az énekes)
    const aboutTamasTriggers = [
      "ki az a horváth tamás", "mesélj horváth tamásról", "mesélsz róla", "mutasd be horváth tamást",
      "mit lehet tudni horváth tamásról", "horváth tamásról"
    ];
    const asksAboutTamas =
      aboutTamasTriggers.some((t) => text.includes(t)) ||
      /horv(á|a)th\s*tam(á|a)s/i.test(message || "");

    if (asksAboutTamas) {
      const reply =
        "Horváth Tamás (Szabolcsbáka) a weboldal készítője és hobbifejlesztője. " +
        "Szabadidejében webes projektekkel és mesterséges intelligenciával kísérletezik, " +
        "szeret új ötleteket kipróbálni és folyamatosan fejleszti a tudását. " +
        "Ez az oldal is egy ilyen személyes projektje. 🙂";
      return ok({ reply, tts: reply });
    }

    // ------- System prompt (tiltások + kontextus) -------
    const systemPrompt = `
Te egy barátságos, magyar nyelvű webes asszisztens vagy ezen az oldalon.
Az oldalt Horváth Tamás (Szabolcsbáka) készítette hobbifejlesztőként.
Ő NEM a magyar énekes Horváth Tamás, hanem egy lelkes hobbi programozó,
aki webes projektekkel és mesterséges intelligenciával kísérletezik.

Szabályok:
- Soha ne említsd, hogy milyen modell vagy (pl. GPT-4/5, mini, turbo stb.), és ne beszélj semmilyen szolgáltató rendszeréről.
- Ha rákérdeznek a modellre, a fix válasz: "Én Tamás modellje vagyok. Horváth Tamás készített és fejlesztett, hogy segítsek neked bármiben."
- Ha az oldal készítőjére kérdeznek rá, a fix válasz: "Az oldalt Horváth Tamás (Szabolcsbáka) készítette hobbifejlesztőként."
- Ha Horváth Tamásról kérdeznek, mindig a hobbifejlesztőt mutasd be (ne az énekest).
- Légy barátságos, rövid és lényegre törő. Mindig magyarul válaszolj.
`.trim();

    // Előzmények + aktuális üzenet (ha használsz history-t a frontenden)
    const msgs = [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: message || "" }
    ];

    // ------- OpenAI Chat Completions (Turbo) -------
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",      // <<< TURBO
        messages: msgs,
        temperature: 0.7,
        max_tokens: 500            // chat/completions alatt ez a helyes kulcs
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "Upstream hiba", detail }) };
    }

    const data = await r.json();
    const reply =
      data?.choices?.[0]?.message?.content?.toString()?.trim() ||
      "Rendben. Miben segíthetek még?";

    return ok({ reply, tts: reply });

  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e?.message || "Ismeretlen szerver hiba" }) };
  }

  function ok(obj){
    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
  }
};
