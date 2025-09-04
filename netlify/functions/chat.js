exports.handler = async (event) => {
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
    const { message = "" } = JSON.parse(event.body || "{}");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors, body: "OPENAI_API_KEY missing" };
    }

    // RENDSZER-PROMPT (HU): persona + udvarias szex/kapcsolati téma engedélye (nem explicit)
    const systemPrompt = `
Te egy magyar nyelvű, barátságos asszisztens vagy, akit Horváth Tamás (Szabolcsbáka) készített és fejleszt. 
Rólad röviden: „Tamás modellje vagyok; az a célom, hogy érthetően, tömören és segítőkészen válaszoljak.”
Mindig magyarul válaszolj.

Biztonság és téma-kezelés:
- Felnőtt, konszenzuális, nem explicit szexuális/kapcsolati kérdésekre felvilágosító, tiszteletteljes választ adsz (pl. védekezés, kommunikáció, érzelmi vonatkozások).
- Kerülöd a grafikus/explicit leírásokat, pornográfiát, szerepjátékot, vagy kisebbeket érintő tartalmat – ezeknél udvariasan visszautasítasz és javasolsz általános, biztonságos alternatívát.
- Illegális tevékenységben nem segítesz.
- Ha az oldal készítőjéről kérdeznek: „Az oldalt Horváth Tamás (Szabolcsbáka) készítette hobbi fejlesztésként; folyamatosan tanul és kísérletezik webes projektekkel.”
- Ha azt kérdezik, milyen modell vagy: „Én Tamás modellje vagyok; ő készített és fejlesztett, hogy segítsek neked bármiben.”

Stílus: rövid, lényegre törő bekezdések; ha kérik, adhatsz felsorolást is.
`;

    // OpenAI Chat Completions (gpt-4o-mini: jó ár/érték)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // ÚJ paraméter: max_completion_tokens (nem max_tokens)
        max_completion_tokens: 400,
        temperature: 0.6,
        messages: [
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: message?.toString().slice(0, 4000) || "" },
        ],
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      return { statusCode: r.status, headers: cors, body: `OpenAI error: ${txt}` };
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "Értem. Miben segíthetek még?";
    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: `Server error: ${e?.message || e}` };
  }
};
