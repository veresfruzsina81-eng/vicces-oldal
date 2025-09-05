// netlify/functions/chat.js

// Netlify Node 18+ alatt a fetch globálisan elérhető, nem kell a node-fetch
// const fetch = require("node-fetch");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Eldönti, érdemes-e weben keresni
function wantsWebSearch(text) {
  if (!text) return false;
  const q = text.toLowerCase();

  if (q.includes("ne keress") || q.includes("net nélkül")) return false;

  const needles = [
    "árfolyam", "árfolyama", "időjárás", "ma", "holnap", "most", "friss",
    "következő meccs", "mikor lesz", "résztvevők", "menetrend", "állás",
    "hírek", "ki nyert", "jegyár", "élő", "stream", "2024", "2025", "dátum"
  ];
  if (needles.some(n => q.includes(n))) return true;

  return /(\?|mi |mikor |hol |mennyi |hogyan|hogy )/.test(q);
}

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Csak POST kérés engedélyezett." });
  }

  try {
    const { message } = JSON.parse(event.body || "{}");
    const userMsg = (message || "").trim();
    if (!userMsg) return json(400, { error: "Kérlek, adj meg egy üzenetet (message)." });

    // „van neted?” jellegű kérdésekre röviden
    if (/van.*internet(ed)?|tudsz.*böngészni|böngészel\??/i.test(userMsg)) {
      return json(200, {
        reply: "Igen – tudok Google-lel keresni. Írj konkrét kérdést (pl. „euró árfolyam ma”, „időjárás Budapest holnap”), és hozok forrásokat is.",
        meta: { source: "asszisztens" }
      });
    }

    // 1) Webkeresés (ha érdemes)
    let searchResults = null;
    if (wantsWebSearch(userMsg)) {
      const hdrs = event.headers || {};
      const forwardedHost = (hdrs["x-forwarded-host"] || hdrs.host || "").replace(/\/+$/, "");
      const siteURL = process.env.URL || process.env.DEPLOY_PRIME_URL || (forwardedHost ? `https://${forwardedHost}` : "");
      const googleFn = siteURL ? `${siteURL}/.netlify/functions/google` : "/.netlify/functions/google";

      try {
        const r = await fetch(`${googleFn}?q=${encodeURIComponent(userMsg)}`);
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.results) && data.results.length) {
            // Normalizálás: biztosítsuk a source mezőt a link hostjával
            searchResults = data.results.slice(0, 5).map(it => ({
              title: it.title || "",
              snippet: it.snippet || "",
              link: it.link || "",
              source: it.source || host(it.link || "")
            }));
          }
        }
      } catch (_) {
        // csendben bukik → fallback GPT-only
      }
    }

    // 2) Ha vannak találatok → kérjünk összefoglalót OpenAI-tól, forrás deduplikációval
    if (searchResults && searchResults.length) {
      const context = searchResults
        .map((r, i) => `#${i + 1} [${r.source}] ${r.title}\n${r.snippet}\nLink: ${r.link}`)
        .join("\n\n");

      const system =
        "Magyar asszisztens vagy. Légy tényszerű, tömör és egyértelmű. " +
        "Kizárólag a megadott kivonatokra támaszkodj; ha nem elég a bizonyíték, mondd ki röviden. " +
        "A válasz végére írj 'Források:' alatt legfeljebb 3 domaint.";

      const prompt =
        `Kérdés: """${userMsg}"""\n\nForrás-jelöltek (kivonat):\n${context}\n\n` +
        "Válaszolj magyarul, a legfontosabb tényekkel, dátumokkal ha vannak. Ne találj ki új tényeket.";

      const summary = await askOpenAI(system, prompt);

      // domain deduplikáció link alapján (ha source nincs/rossz, host(link))
      const domains = [...new Set(searchResults.map(r => r.source || host(r.link)).filter(Boolean))].slice(0, 3);
      const forras = domains.length ? `\n\nForrások: ${domains.join(", ")}` : "";

      return json(200, {
        reply: summary + forras,
        sources: searchResults.map(r => ({ title: r.title, link: r.link, source: r.source || host(r.link) })),
        meta: { mode: "web+gpt", engine: "Google+OpenAI" }
      });
    }

    // 3) Nincs találat → tiszta GPT
    const system =
      "Magyar asszisztens vagy. Légy világos, barátságos és lényegre törő. Adj pontos, rövid válaszokat.";
    const answer = await askOpenAI(system, userMsg);

    return json(200, { reply: answer, meta: { mode: "gpt-only", source: "OpenAI" } });

  } catch (e) {
    return json(500, { error: "Szerver hiba a chat függvényben.", detail: String(e?.message || e) });
  }
};

// ========== OpenAI hívó ==========
async function askOpenAI(system, user) {
  if (!OPENAI_API_KEY) {
    return "Fejlesztői mód: nincs beállítva OPENAI_API_KEY, ezért nem tudok GPT-választ adni.";
  }

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ]
    })
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI hiba: ${r.status} ${t}`);
  }

  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || "Elnézést, nem találtam megfelelő választ.";
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
