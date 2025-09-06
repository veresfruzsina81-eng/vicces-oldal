// netlify/functions/chat.js
import { searchGoogle, fetchPagePlainText } from "./google.js";

// ✅ Alapértelmezett modell: gpt-4.1 (env-vel felülírható)
const DEFAULT_MODEL  = process.env.OPENAI_MODEL || "gpt-4.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Böngészés mindig bekapcsolva
const ALWAYS_BROWSE   = true;
// Csak utóbbi X napból engedünk forrásokat (frontendről felülírható)
const DEFAULT_RECENCY_DAYS = 14;
// Minimum forrásszám (ha nincs meg, inkább hiba, mint régi adat)
const MIN_SOURCES = 3;

const TODAY = new Date().toISOString().slice(0,10);

const SYSTEM_PROMPT = `
Te Tamás barátságos, magyar asszisztensed vagy. Mindig a legfrissebb, hiteles információt add.

KÖTELEZŐ:
- A válasz kizárólag a mellékelt friss webes forráskivonatokon alapuljon.
- NE beszélj tréning cutoff-ról (pl. "2024 június"). A mai dátum: ${TODAY}.
- Ha a források száma kevés vagy egymásnak ellentmondanak, mondd ki őszintén (pl. "Nem találtam elég friss, megbízható forrást.") és adj javasolt keresőkifejezéseket.
- Helyezz el sorszámos hivatkozásokat a végén: [1], [2], [3].

Identitás:
- Ha kérdezik: "Ki készítette az oldalt?" / "Kié az oldal?" / "Ki a fejlesztő?":
  "Az oldal tulajdonosa és a mesterséges intelligencia 100%-os alkotója-fejlesztője: Horváth Tamás (Szabolcsbáka)."
- Pozitív, tiszteletteljes hang Tamásról.

Stílus:
- Rövid bevezető → tömör pontok → részletek. Közérthető, magyar nyelv.
`;

async function callOpenAI(messages, { model = DEFAULT_MODEL, temperature = 0.3 }) {
  if (!OPENAI_API_KEY) throw new Error("Hiányzik az OPENAI_API_KEY.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI hiba: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    model: data.model || model,
  };
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
    const {
      message = "",
      maxSources = 8,
      recencyDays = DEFAULT_RECENCY_DAYS
    } = JSON.parse(event.body || "{}");

    if (!message.trim()) return http(400, { ok:false, error: "Üres üzenet" });

    // 1) KÖTELEZŐ BÖNGÉSZÉS – csak friss találatokkal
    let results = [];
    if (ALWAYS_BROWSE) {
      results = await searchGoogle(message, {
        num: Math.min(Math.max(maxSources, MIN_SOURCES), 10),
        recencyDays,
      });
    }

    const pages = await Promise.all(results.map(r => fetchPagePlainText(r.link)));

    // Források összeállítása, engedékenyebb minimumhossz
    let sources = results.map((r, i) => ({
      id: i + 1,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      content: pages[i]?.content || "",
    })).filter(s => s.content && s.content.length > 300);

    // Ha nincs meg a minimum friss forrás → ne válaszoljon régi adattal
    if (ALWAYS_BROWSE && sources.length < MIN_SOURCES) {
      return http(200, {
        ok: false,
        usedBrowsing: true,
        error: `Nem találtam elég friss forrást (${sources.length}/${MIN_SOURCES}). Próbáld: pontosítsd a kérdést vagy növeld a keresési időablakot.`,
        hint: `Küldd így: { recencyDays: 30 } a kérésben, ha szélesebb idősáv is jó.`,
      });
    }

    const browserBlock =
      "\n\nFriss forráskivonatok ("+sources.length+" db):\n" +
      sources.map(s => `[#${s.id}] ${s.title}\nURL: ${s.url}\nRészlet: ${s.content.slice(0, 1200)}`)
             .join("\n\n");

    const userMsg = `Mai dátum: ${TODAY}. Felhasználói kérés:\n${message}\n${browserBlock}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMsg },
    ];

    const { text: answer, model: usedModel } = await callOpenAI(messages, {});
    const references = sources.map(s => ({ id: s.id, title: s.title, url: s.url }));

    return http(200, {
      ok: true,
      usedBrowsing: true,
      model: usedModel,
      recencyDays,
      minSources: MIN_SOURCES,
      answer,
      references,
    });
  } catch (e) {
    return http(500, { ok:false, error: String(e) });
  }
}
