// netlify/functions/chat.js
// Chat (GPT-4-Turbo) + STT (Whisper) egyben, készítőre vonatkozó kérdésekre stabil, részletes válasz.
// Netlify env: OPENAI_API_KEY

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return err(500, "Hiányzik az OPENAI_API_KEY.");

    // ---- Kérés beolvasás
    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return err(400, "Érvénytelen JSON"); }

    // ---- Különkezelés: készítőre kérdezés
    const lastUserText = (
      (Array.isArray(body.messages) && [...body.messages].reverse().find(m => m.role === "user")?.content) ||
      body.message || ""
    ).toString().trim();

    const low = lastUserText.toLowerCase();
    const CREATOR_TRIGGERS = [
      "ki hozta létre az oldalt", "ki készítette az oldalt", "ki az oldal készítője",
      "ki a tulajdonos", "ki csinálta az oldalt", "készítő", "tulajdonos",
      "ki az a horváth tamás", "mesélj a készítőről", "mesélj róla", "ki csinálta ezt az oldalt"
    ];

    if (lastUserText && CREATOR_TRIGGERS.some(t => low.includes(t))) {
      return ok({
        reply: creatorResponse({ detailed: /mesélj|mutass be|bemutatás/.test(low) })
      });
    }

    // ---- Ha HANG jött (iOS/Android fallback – Whisper STT)
    if (body.audio_b64) {
      const heard = await transcribeWhisper({
        apiKey, audio_b64: body.audio_b64, mime: body.mime || "audio/webm"
      });
      const history = Array.isArray(body.history) ? body.history : [];

      // Ha a hallott szöveg is a készítőről kérdez, azonnal adjuk a fix bemutatót
      if ((heard || "").toLowerCase() && CREATOR_TRIGGERS.some(t => (heard || "").toLowerCase().includes(t))) {
        return ok({ stt: heard, reply: creatorResponse({ detailed: /mesélj|mutass be|bemutatás/.test((heard||"").toLowerCase()) }) });
      }

      const reply = await chatTurbo({
        apiKey,
        messages: composeMessages(history, heard),
        // Mindig Turbo:
        model: "gpt-4-turbo"
      });
      return ok({ stt: heard, reply });
    }

    // ---- Szöveges chat
    const messages = Array.isArray(body.messages)
      ? body.messages
      : (lastUserText ? [{ role: "user", content: lastUserText }] : []);

    const reply = await chatTurbo({
      apiKey,
      messages: composeMessages(messages),
      model: "gpt-4-turbo"
    });

    return ok({ reply });

  } catch (e) {
    return err(500, e?.message || "Ismeretlen szerver hiba");
  }

  // ---- Segédfüggvények
  function ok(obj){ return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) }; }
  function err(code, msg){ return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: msg }) }; }
};

// ---- Üzenet-összeállítás: mindig magyar rendszerprompt + kontextus
function composeMessages(historyOrMessages = [], lastUserUtterance = "") {
  const systemMsg = {
    role: "system",
    content:
      "Te egy segítő, barátságos magyar asszisztens vagy. Mindig magyarul válaszolj, " +
      "természetesen és érthetően. Ha a felhasználó kéri, adj példát, hasonlatot, " +
      "de ne beszélj üresen és ne ismételgesd ugyanazt."
  };

  const base = Array.isArray(historyOrMessages) ? historyOrMessages : [];
  const msgs = [systemMsg, ...base];

  if (lastUserUtterance) msgs.push({ role: "user", content: lastUserUtterance });
  return msgs;
}

// ---- Stabil bemutatkozó válasz a készítőre
function creatorResponse({ detailed = true } = {}) {
  if (!detailed) {
    return "Az oldalt Horváth Tamás (Szabolcsbáka) készítette. 😊";
  }
  return (
    "Az oldalt Horváth Tamás készítette (Szabolcsbáka). 💡 H.T hobbiprogramozó, " +
    "aki saját kedvére és gyakorlásként fejleszt webes projekteket. Főleg egyszerű, " +
    "kreatív ötletekből indul ki, majd lépésről lépésre bővíti őket: dizájn, funkciók, " +
    "és közben folyamatosan fejleszti a tudását (HTML/CSS/JS, API-k, hosztolás). " +
    "Célja, hogy minél jobb, átláthatóbb és élvezetesebb élményt adjon — ezért is frissítgeti " +
    "és csiszolja az oldalt. Ha bármi ötleted van, szívesen fogadja! 🚀"
  );
}

// ---- OpenAI: Whisper STT
async function transcribeWhisper({ apiKey, audio_b64, mime }) {
  const bin = Buffer.from(audio_b64, "base64");
  const blob = new Blob([bin], { type: mime || "audio/webm" });
  const fd = new FormData();
  fd.append("file", blob, "audio.webm");
  fd.append("model", "whisper-1");
  fd.append("language", "hu");

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: fd
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || `Whisper hiba (HTTP ${r.status})`;
    throw new Error(msg);
  }
  return (data.text || "").toString();
}

// ---- OpenAI: Chat (Turbo)
async function chatTurbo({ apiKey, messages, model = "gpt-4-turbo" }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 600
    })
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || `OpenAI hiba (HTTP ${r.status})`;
    throw new Error(msg);
  }
  return (data?.choices?.[0]?.message?.content || "").toString().trim();
}
