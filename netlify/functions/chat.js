// netlify/functions/web-answer.js
//
// Funkció: Binggel keres, a találatokból GPT-vel konkrét, hivatkozott választ generál.
// Modell: OPENAI_MODEL (pl. gpt-5), ha nem elérhető, automatikus visszaesés gpt-4o-ra.
// Fallback: ha a Bing hibázik, próbál DDG Instant Answer összefoglalót adni.
//
// ENV: OPENAI_API_KEY, BING_API_KEY, (opcionális) OPENAI_MODEL=gpt-5

const OPENAI_MODEL_PREF = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const BING_KEY = process.env.BING_API_KEY;

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok:false, error: "Method Not Allowed" });
    }

    if (!OPENAI_KEY) {
      return json(500, { ok:false, error: "Hiányzik az OPENAI_API_KEY." });
    }
    if (!BING_KEY) {
      // engedjük tovább DDG fallback-re, de jelezzük
      console.warn("Figyelem: nincs BING_API_KEY, DDG fallback lesz.");
    }

    const { question = "", maxSources = 5, market = "hu-HU" } = parseBody(event.body);
    const q = String(question || "").trim();
    if (!q) return json(400, { ok:false, error: "Hiányzó kérdés." });

    // 1) KERESÉS: Bing → top N forrás
    let sources = [];
    let provider = "Bing";
    if (BING_KEY) {
      const bing = await bingSearch(q, { count: maxSources, mkt: market });
      sources = bing.sources;
      provider = bing.provider;
    }

    // Fallback: ha nincs Bing találat, próbáljunk DDG-t
    if (!sources.length) {
      const ddg = await ddgInstant(q);
      if (ddg) {
        sources = ddgToSources(ddg).slice(0, Math.max(3, maxSources));
        provider = "DuckDuckGo";
      }
    }

    // Ha továbbra sincs semmi, válaszolj korrektül, röviden
    if (!sources.length) {
      return json(200, {
        ok: true,
        answer:
          "Elnézést, most nem találtam megbízható forrást erre a kérdésre. " +
          "Megpróbáljam más kulcsszavakkal vagy hivatalos oldalakkal?",
        sources: [],
        provider
      });
    }

    // 2) ÖSSZEFOGLALÁS: GPT-vel készítsünk konkrét, magyar választ
    const sys = buildSystemPrompt();
    const ctx = sourcesToContext(sources);

    const messages = [
      { role: "system", content: sys },
      { role: "user", content: `Kérdés: ${q}\n\nForráskivonatok:\n${ctx}` }
    ];

    const ai = await callOpenAI(messages);
    if (!ai.ok) {
      return json(502, { ok:false, error: `OpenAI hiba: ${ai.error}` });
    }
    const answer = (ai.data.choices?.[0]?.message?.content || "").trim();

    return json(200, {
      ok: true,
      answer: ensureSourceTag(answer, provider), // ha kimaradt, odatesszük a "Forrás: ..."
      sources,
      provider
    });

  } catch (err) {
    console.error(err);
    return json(500, { ok:false, error: `Szerver hiba: ${err.message}` });
  }
};

// --------------------- Segédek ---------------------

function json(status, obj) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj)
  };
}

function parseBody(body) {
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function bingSearch(query, { count = 5, mkt = "hu-HU" } = {}) {
  try {
    const url = "https://api.bing.microsoft.com/v7.0/search?" + new URLSearchParams({
      q: query,
      mkt,
      setLang: mkt.split("-")[0],
      count: String(Math.min(Math.max(count, 1), 10)),
      textDecorations: "true",
      responseFilter: "Webpages"
    });

    const r = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": BING_KEY }
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Bing error:", r.status, t);
      return { sources: [], provider: "Bing" };
    }
    const j = await r.json();
    const arr = j.webPages?.value || [];
    const sources = arr.slice(0, count).map((it, i) => ({
      id: i + 1,
      name: it.name || it.url || "Találat",
      url: it.url,
      snippet: (it.snippet || "").replace(/\s+/g, " ").trim()
    }));
    return { sources, provider: "Bing" };
  } catch (e) {
    console.error("Bing fetch fail:", e);
    return { sources: [], provider: "Bing" };
  }
}

// DDG Instant Answer – kulcs nélkül, gyors összefoglaló
async function ddgInstant(query) {
  try {
    const url = "https://api.duckduckgo.com/?" + new URLSearchParams({
      q: query, format: "json", no_html: "1", skip_disambig: "1"
    });
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function ddgToSources(ddg) {
  const out = [];
  if (ddg.AbstractURL || ddg.AbstractText) {
    out.push({
      id: 1,
      name: ddg.Heading || ddg.AbstractURL || "DuckDuckGo",
      url: ddg.AbstractURL || "https://duckduckgo.com",
      snippet: ddg.AbstractText || ""
    });
  }
  if (Array.isArray(ddg.RelatedTopics)) {
    ddg.RelatedTopics.forEach((t, i) => {
      if (t.FirstURL && t.Text) {
        out.push({
          id: out.length + 1,
          name: t.Text.slice(0, 120),
          url: t.FirstURL,
          snippet: t.Text
        });
      }
    });
  }
  return out;
}

function sourcesToContext(sources) {
  return sources
    .map(s => `[#${s.id}] ${s.name}\n${s.url}\nKivonat: ${s.snippet}`)
    .join("\n\n");
}

// OKOSÍTÓ rendszerprompt (mellébeszélés tiltás, konkrétumok erőltetése)
function buildSystemPrompt() {
  const now = new Date().toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });
  return (
    "Magyar asszisztens vagy. A felhasználó kérdésére PONTOS, TÖMÖR és KONKRÉT választ adsz az alábbi forráskivonatok ALAPJÁN." +
    "\nSzabályok a maximális pontosságért:" +
    "\n- 5–7 mondatban válaszolj. Mellébeszélés tilos." +
    "\n- Ha találsz konkrét adatot (időpont, dátum, név, szám), FOGLALD bele." +
    "\n- Minden lényeges állítás végére tegyél szögletes hivatkozást a forrás sorszámával: [1], [2], [3]." +
    "\n- Ha a források ellentmondanak, jelezd röviden." +
    "\n- Időérzékeny témáknál figyelmeztess: az adatok változhatnak." +
    "\n- Soha ne írd, hogy 'nézz utána' vagy 'nem tudom'; ha kevés a forrás, foglald össze, amid van, és jelezd, hogy előzetes." +
    "\n- Légy barátságos, de szakmai; kerüld a felesleges körítést." +
    `\n- Helyi idő: ${now} (Europe/Budapest).`
  );
}

// OpenAI hívás automatikus model fallback-kel (gpt-5 → gpt-4o)
async function callOpenAI(messages) {
  let model = OPENAI_MODEL_PREF;
  const body = (m) => JSON.stringify({ model: m, temperature: 0.2, messages });

  // első próbálkozás (pref modell, pl. gpt-5)
  let r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: body(model)
  });

  if (!r.ok) {
    const txt = await r.text();
    // ha a modell nem elérhető, essünk vissza gpt-4o-ra
    if (/model_not_found|unsupported_model|not available/i.test(txt) && model !== "gpt-4o") {
      model = "gpt-4o";
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json"
        },
        body: body(model)
      });
      if (!r.ok) {
        return { ok:false, error: await r.text() };
      }
      return { ok:true, data: await r.json(), modelUsed: model };
    }
    return { ok:false, error: txt };
  }
  return { ok:true, data: await r.json(), modelUsed: model };
}

// Ha a modell nem írta le, hogy "Forrás: ...", egészítsük ki a végén.
function ensureSourceTag(answer, provider) {
  if (!answer) return "";
  const tag = `Forrás: ${provider}`;
  const has = new RegExp(`Forrás:\\s*${provider}`, "i").test(answer);
  return has ? answer : `${answer}\n\n${tag}`;
}
