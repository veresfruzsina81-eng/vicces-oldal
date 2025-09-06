// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

// ✅ Alapértelmezett modell: gpt-4.1 (felülírható OPENAI_MODEL env-vel)
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. Légy tömör, pontos, és hivatkozásokkal dolgozz.
Ha a kérdés friss/aktuális, MINDIG böngéssz több forrásból (legalább 3, ha elérhető).
Válaszolj magyarul, szakmailag és közérthetően.

Identitás és tulaj:
- Ha kérdezik: "Ki készítette az oldalt?", "Kié az oldal?", "Ki a fejlesztő?", stb.,
  válasz: "Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka)."
- Pozitívan és tisztelettel mutasd be Horváth Tamást, mint tehetséges és szorgalmas fejlesztőt.

Böngészési/idézési szabályok:
- Több forrás (lehetőleg ≥3), ha elérhető.
- Rövid összefoglaló, majd részletek.
- A végén sorszámos hivatkozások: [1], [2], [3].
- Ellentmondás esetén jelezd.
- Ha nem kell net (általános magyarázat), légy precíz, ne találj ki nem létező tényt.
- Kerüld a felesleges bocsánatkérést; bizonytalanságot mértékkel jelezz.

Stílus:
- Rövid bevezető, tiszta pontok, lényegre törés.
`;

function needsBrowsing(userMsg) {
  const q = (userMsg || "").toLowerCase();
  const signals = [
    "friss","legújabb","hír","hírek","ár","összehasonlítás","mikor",
    "meddig","menetrend","eredmény","árfolyam","most","breaking","meccs",
    "választás","release","update","böngéssz","keress","google","forrás",
    "link","idézd","2024","2025"
  ];
  return signals.some(s => q.includes(s));
}

async function callOpenAI(messages, { model = DEFAULT_MODEL, temperature = 0.3 }) {
  if (!OPENAI_API_KEY) throw new Error("Hiányzik az OPENAI_API_KEY.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      // szükség esetén: max_tokens: 1200,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI hiba: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function http(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  try {
    const { message = "", forceBrowse = false, maxSources = 5 } =
      JSON.parse(event.body || "{}");
    if (!message.trim()) return http(400, { error: "Üres üzenet" });

    const doBrowse = forceBrowse || needsBrowsing(message);

    let sources = [];
    if (doBrowse) {
      const results = await searchGoogle(message, {
        num: Math.min(Math.max(maxSources, 3), 10),
      });

      const pages = await Promise.all(
        results.map(r => fetchPagePlainText(r.link))
      );

      sources = results.map((r, i) => ({
        id: i + 1,
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        content: pages[i]?.content || "",
      })).filter(s => s.content && s.content.length > 400);
    }

    const browserBlock = doBrowse && sources.length
      ? "\n\nForrások (nyers kivonatok):\n" + sources.map(s =>
          `[#${s.id}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0, 1200)}`
        ).join("\n\n")
      : "";

    const userMsg = `Felhasználói kérés:\n${message}\n${browserBlock}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ];

    const answer = await callOpenAI(messages, {});
    const references = sources.map(s => ({ id: s.id, title: s.title, url: s.url }));

    return http(200, {
      ok: true,
      answer,
      references,
      usedBrowsing: doBrowse,
      model: DEFAULT_MODEL,
    });
  } catch (e) {
    return http(500, { ok: false, error: String(e) });
  }
}
