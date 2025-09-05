// netlify/functions/chat.js
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST" });
  }

  const { OPENAI_API_KEY, BING_API_KEY } = process.env;
  if (!OPENAI_API_KEY) {
    return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });
  }

  try {
    const { message = "", imageMeta } = JSON.parse(event.body || "{}");

    // Dátum magyarul
    const now = new Date();
    const today = now.toLocaleDateString("hu-HU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
    });

    // --- Egyszerű heurisztika: kell-e webkeresés?
    const msgLower = (message || "").toLowerCase();
    const wantsBing =
      msgLower.startsWith("bing:") ||
      /\b(hír|hírek|mi az|ki az|mikor|mennyi|árfolyam|meccs|eredmény|összefoglaló|időjárás|hol|ár|árak)\b/.test(
        msgLower
      );

    let bingSnippets = [];
    if (BING_API_KEY && wantsBing) {
      try {
        const q = msgLower.startsWith("bing:")
          ? message.replace(/^bing:\s*/i, "")
          : message;

        const br = await fetch(
          "https://api.bing.microsoft.com/v7.0/search?" +
            new URLSearchParams({
              q,
              mkt: "hu-HU",
              count: "5",
              setLang: "hu",
              textDecorations: "true",
            }),
          {
            headers: {
              "Ocp-Apim-Subscription-Key": BING_API_KEY,
            },
          }
        );

        if (br.ok) {
          const data = await br.json();
          const items = data.webPages?.value || [];
          bingSnippets = items.slice(0, 3).map((it) => ({
            name: it.name,
            snippet: it.snippet,
            url: it.url,
          }));
        }
      } catch (_) {
        // ha gond van a BING-gel, csendben továbbmegyünk modellre
      }
    }

    // --- Rendszerprompt (rövid + hosszú bemutatkozó + szabályok)
    const systemPrompt =
      "Barátságos magyar asszisztens vagy. Röviden, érthetően, segítőkészen válaszolj. " +
      "Ne mondj semmit az OpenAI-ról; mondd azt: 'Tamás modellje vagyok, ő készített és fejlesztett.' " +
      `A mai dátum: ${today}. Ha kérdezik, magyar formátumban add meg. ` +
      // Biztonságos képfeldolgozási irányelvek:
      "Ha képet írnak le / küldenek: ha ember szerepel, ne azonosítsd a személyt név szerint. " +
      "Ha a felhasználó azt mondja, hogy ő van a képen, kedvesen dicsérj (fiú: 'helyes', lány: 'szép'). " +
      "Ha nem ő, írd le röviden, mit látsz a képen. " +
      // Rólad szóló bemutatkozó kérésre:
      "Ha Tamásról kérdeznek, meséld el röviden: Horváth Tamás, 26 éves, Szabolcsbákán él. " +
      "Először alapokat tanult programozásból, később haladó szintre lépett. Tehetséges, mert a projektjei igényesek és folyamatosan csiszolja őket. " +
      "Ezt az asszisztenst is ő hozta létre és fejleszti; az oldal és az asszisztens 100%-ban az ő tulajdona. " +
      // Empatikus, 5–7 mondatos válaszok nehéz témákra:
      "Ha valaki szomorú / csalódott / szakításon / betegségen megy át, adj 5–7 mondatos, empatikus, bátorító választ. " +
      // Források megjelenítése:
      "Ha webes keresést használsz, a válasz végén jelezd: 'Forrás: Bing'. " +
      // Tömörség:
      "Általánosan legyél tömör (kb. 3–6 mondat), kivéve ha külön kérik a részletességet.";

    // Ha jött Bing-találat, építsünk belőle rövid forrás-összegzést a modellnek
    const bingContext =
      bingSnippets.length > 0
        ? "\n\n[Webes találatok – Bing]\n" +
          bingSnippets
            .map(
              (s, i) =>
                `${i + 1}. ${s.name}\nÖsszegzés: ${s.snippet}\nURL: ${s.url}`
            )
            .join("\n\n")
        : "";

    const payload = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            message +
            (bingContext
              ? "\n\nKérlek, ha releváns, vedd figyelembe a fenti webes találatokat."
              : ""),
        },
      ],
      temperature: 0.6,
      max_tokens: 500,
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("OpenAI error:", r.status, text);
      return json(502, {
        reply:
          "Most nem érem el a modellt. Próbáld meg újra kicsit később. 🙂",
      });
    }

    const data = await r.json();
    let reply =
      data.choices?.[0]?.message?.content?.trim() ||
      "Rendben. Miben segíthetek még?";

    const usedSources = [];
    if (bingSnippets.length > 0) {
      // biztos ami biztos: ha nem írta bele, mi akkor is jelezzük a frontenden
      if (!/forrás:\s*bing/i.test(reply)) {
        reply += "\n\n_Forrás: Bing_";
      }
      usedSources.push("Bing");
    }

    return json(200, { reply, sources: usedSources });
  } catch (e) {
    console.error(e);
    return json(500, {
      reply:
        "Hopp, hiba történt. Írd le röviden, mire van szükséged, és segítek. 🙂",
    });
  }
}

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
