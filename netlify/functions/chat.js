// netlify/functions/chat.js
// Teljes chat backend: OKOS mód + Google-keresés + források
// Env: OPENAI_API_KEY, GOOGLE_API_KEY, GOOGLE_CX

import fetch from "node-fetch";

/** Heurisztika: mikor kell netes keresés */
function needsSearch(q) {
  if (!q) return false;
  const s = q.toLowerCase();

  // erős triggerek
  const hard = [
    "árfolyam", "mikor lesz", "időpont", "helyszín",
    "jegyár", "ár", "hány", "mennyi", "legutóbbi",
    "legfrissebb", "breaking", "friss hír", "élő",
    "live score", "eredmény", "kik a résztvevők",
    "résztvevők", "schedule", "menetrend"
  ];
  if (hard.some(k => s.includes(k))) return true;

  // általános "keresés" minták
  if (/\b(keres|keress|keresés|googl(e|izz)|nézd meg|kutass)\b/.test(s)) return true;

  // ha konkrét évszám, dátum, ma/holnap/stb.
  if (/\b(202\d|202\d|ma|holnap|jövő hét|jövő hónap)\b/.test(s)) return true;

  // ha tipikusan változó tényleges adatot kér
  if (/\b(árfolyam|időjárás|árak|táblázat|statisztika|nyitvatartás)\b/.test(s)) return true;

  return false;
}

/** Biztonságos domain listázás a forrásokhoz */
function extractDomains(items = []) {
  const domains = [];
  for (const it of items.slice(0, 5)) {
    try {
      const u = new URL(it.link || it.url || "");
      const host = u.hostname.replace(/^www\./, "");
      if (host && !domains.includes(host)) domains.push(host);
    } catch (_) {}
  }
  return domains;
}

/** Meghívjuk a saját google functiont */
async function runGoogle(query, hostHeader) {
  // saját domain (Netlify prod): pl. tamas-ai.netlify.app
  const host = (process.env.URL || "").replace(/^https?:\/\//, "") || hostHeader || "";
  const base = host ? `https://${host}` : "";
  const url = `${base}/.netlify/functions/google?q=${encodeURIComponent(query)}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google function hiba: ${resp.status} ${text}`);
  }
  return resp.json(); // { items: [...] }
}

/** OpenAI összefoglalás / válaszkészítés */
async function runOpenAI({ prompt, maxTokens = 700 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Hiányzik az OPENAI_API_KEY környezeti változó.");

  const body = {
    model: "gpt-4o-mini", // stabil, gyors, olcsó
    messages: [
      {
        role: "system",
        content:
          "Te egy magyar nyelvű asszisztens vagy. Légy pontos, tömör és tényszerű. Ha vannak források, a végén írj 'Források: domain1, domain2 (Google)'. Ne találj ki dolgokat."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.2,
    max_tokens: maxTokens
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI hiba: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "Nem sikerült választ generálni.";
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Csak POST engedélyezett." }) };
    }

    const { message = "" } = JSON.parse(event.body || "{}");
    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Hiányzik az üzenet (message)." }) };
    }

    const doSearch = needsSearch(message);
    let reply = "";
    let sourcesNote = "";
    let items = [];

    if (doSearch) {
      // 1) Google találatok
      const googleData = await runGoogle(message, event.headers?.host);
      items = googleData?.items || [];

      // készítsünk összefoglaló promptot
      const domains = extractDomains(items);
      const snippets = items.slice(0, 6).map((it, i) => {
        const title = it.title || it.name || "";
        const snippet = it.snippet || it.summary || it.snippetHtml || "";
        const link = it.link || it.url || "";
        return `#${i + 1} Cím: ${title}\nKivonat: ${snippet}\nLink: ${link}`;
      }).join("\n\n");

      const prompt =
        `Feladat: foglald össze és válaszold meg a felhasználó kérdését a lenti friss találatok alapján. ` +
        `Légy rövid, konkrét, dátumozz, és ha kell, adj felsorolást. Ha nem elég megbízható a forrás, jelezd.\n\n` +
        `Kérdés: ${message}\n\n` +
        `Találatok:\n${snippets}\n\n` +
        `Ha válaszolsz, a végére tedd: Források: ${domains.join(", ")} (Google)`;

      reply = await runOpenAI({ prompt });
      if (!reply.includes("Források:") && domains.length) {
        sourcesNote = `\n\nForrások: ${domains.join(", ")} (Google)`;
      }
    } else {
      // 2) Sima GPT válasz (nincs netes keresés)
      const prompt =
        `Válaszolj magyarul tömören és hasznosan. Ha a kérdés friss adatot igényelne, ` +
        `jelezd udvariasan, hogy „Ha szeretnéd, meg tudom keresni a neten is – csak írd: keress rá.”\n\n` +
        `Kérdés: ${message}`;
      reply = await runOpenAI({ prompt, maxTokens: 500 });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: (reply || "Nem találtam elég információt.") + (sourcesNote || ""),
        sources: extractDomains(items)
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
