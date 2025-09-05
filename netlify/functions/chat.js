// Netlify Function: chat.js
// Cél: nem mellébeszélős, keresésre képes magyar asszisztens.
// - POST body: { question?: string, messages?: [{role,content}], force_search?: boolean }
// - Env: OPENAI_API_KEY (kötelező), OPENAI_MODEL_PREF (opcionális: pl. "gpt-5"),
//        BING_API_KEY (opcionális – ha van, Bing Web Search), különben DuckDuckGo fallback.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL_PREF || "gpt-4o-mini"; // Írhatod: "gpt-5", ha elérhető a fiókodban
const BING_KEY = process.env.BING_API_KEY;
const BING_ENDPOINT = "https://api.bing.microsoft.com/v7.0/search";

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  if (event.httpMethod !== "POST") return err("Use POST");

  if (!OPENAI_API_KEY) {
    return err("OPENAI_API_KEY hiányzik a Netlify environment variables közül.", 500);
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const userText = extractUserText(body);
    const messages = normalizeToMessages(body, userText);

    // Döntsük el, kell-e keresés
    let searchBundle = null;
    const wantSearch = !!body.force_search || needsSearch(userText);

    if (wantSearch) {
      searchBundle = await smartSearch(userText);
    }

    // Összeállítjuk a modellnek átadott inputot
    const input = buildPrompt(messages, searchBundle);

    // OpenAI Responses API
    const aiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input,
        temperature: 0.5,
        max_output_tokens: 450,
      }),
    });

    if (!aiRes.ok) {
      const txt = await safeText(aiRes);
      return err(`OpenAI hiba (${aiRes.status}): ${txt || aiRes.statusText}`, 502);
    }

    const data = await aiRes.json();
    const reply =
      data?.output_text ||
      data?.output?.[0]?.content?.[0]?.text ||
      data?.choices?.[0]?.message?.content ||
      "Elnézést, most nem sikerült választ adnom.";

    return ok({
      reply,
      usedSearch: !!searchBundle,
      sources: searchBundle?.sources?.map(s => s.url) || [],
      model: MODEL,
    });
  } catch (e) {
    return err(e?.message || "Ismeretlen hiba", 500);
  }
};

// ---------- Segédfüggvények ----------

function extractUserText(body) {
  if (typeof body?.question === "string" && body.question.trim()) return body.question.trim();
  const last = Array.isArray(body?.messages) ? body.messages.slice().reverse().find(m => m?.role === "user") : null;
  if (last?.content) return String(last.content);
  return "";
}

function normalizeToMessages(body, userText) {
  if (Array.isArray(body?.messages) && body.messages.length) return body.messages;
  if (userText) return [{ role: "user", content: userText }];
  return [{ role: "user", content: "Szia!" }];
}

// Mikor kell friss webkeresés?
function needsSearch(text = "") {
  const t = text.toLowerCase();
  const hotWords = [
    "ma", "holnap", "most", "jelenlegi", "árfolyam", "ár", "élő", "időjárás",
    "meccs", "mérkőzés", "következő", "menetrend", "program", "nyitvatartás",
    "kik a résztvevők", "résztvevők", "ki játszik", "hír", "friss", "mai",
    "jegyár", "határidő", "deadline", "koncert", "premier"
  ];
  return hotWords.some(w => t.includes(w));
}

// Kereső: Bing (ha van kulcs), különben DuckDuckGo Instant Answer fallback
async function smartSearch(query) {
  try {
    if (BING_KEY) {
      const url = new URL(BING_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("mkt", "hu-HU");
      url.searchParams.set("count", "8");
      const r = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": BING_KEY }
      });
      if (!r.ok) throw new Error(`Bing ${r.status}`);
      const j = await r.json();
      const items = (j.webPages?.value || []).map(x => ({
        title: x.name, snippet: x.snippet, url: x.url
      }));
      return { provider: "Bing", sources: items.slice(0, 6) };
    }
  } catch { /* megyünk a fallbackra */ }

  // DuckDuckGo fallback (nem teljes értékű webkereső, de ad gyors összefoglalót)
  const ddg = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`);
  const d = await ddg.json();
  const items = [];
  if (d?.Abstract) items.push({ title: d.Heading || "Összefoglaló", snippet: d.Abstract, url: d.AbstractURL || "https://duckduckgo.com" });
  if (Array.isArray(d?.RelatedTopics)) {
    for (const rt of d.RelatedTopics) {
      if (rt?.Text && rt?.FirstURL) items.push({ title: rt.Text.slice(0, 80), snippet: rt.Text, url: rt.FirstURL });
      if (items.length >= 6) break;
    }
  }
  return items.length ? { provider: "DuckDuckGo", sources: items } : null;
}

// Prompt építés: kemény “ne mellébeszélj” stílus + forrás-szabályok
function buildPrompt(messages, searchBundle) {
  const system = [
    "Te egy magyar, barátságos, de nagyon konkrét asszisztens vagy.",
    "Ne mellébeszélj. A kérdésre közvetlen, rövid (max 5–7 mondat) választ adj.",
    "Ha a témához friss adatok kellenek és kaptál találati listát, kizárólag azokból dolgozz.",
    "Ne találj ki forrásokat. Ha a találatok nem elégségesek, mondd meg őszintén.",
    "Ha van számszerű adat (időpont, ár, árfolyam, résztvevők neve), írd le.",
    "A végén tüntesd fel: Forrás: domain1, domain2… (max 3)."
  ].join(" ");

  let convo = `SYSTEM: ${system}\n`;
  for (const m of messages) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    convo += `${m.role.toUpperCase()}: ${c}\n`;
  }

  if (searchBundle?.sources?.length) {
    const srcBlock = searchBundle.sources
      .map((s, i) => `[#${i + 1}] ${s.title} — ${s.snippet} (${s.url})`)
      .join("\n");
    convo += `\nSYSTEM: Itt vannak a találatok (${searchBundle.provider}). Csak ezekből dolgozz:\n${srcBlock}\n`;
  }

  return convo;
}

// --- Util ---
async function safeText(res) { try { return await res.text(); } catch { return ""; } }
function ok(obj) { return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(message, code = 400) { return { statusCode: code, headers: cors(), body: JSON.stringify({ error: message }) }; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}
