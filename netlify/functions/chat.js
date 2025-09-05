// netlify/functions/chat.js — Tamás Ultra AI 2.1

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

// Napi limitálás memóriában (Netlify restart után törlődik)
const usage = {};

const COUNTRY_TZ = {
  "magyarország": "Europe/Budapest",
  "hungary": "Europe/Budapest",
  "usa": "America/New_York",
  "egyesült államok": "America/New_York",
  "kanada": "America/Toronto",
  "japán": "Asia/Tokyo",
  "kína": "Asia/Shanghai",
  "india": "Asia/Kolkata",
  "ausztrália": "Australia/Sydney",
  "új-zéland": "Pacific/Auckland",
  "németország": "Europe/Berlin",
  "franciaország": "Europe/Paris",
  "olaszország": "Europe/Rome",
  "spanyolország": "Europe/Madrid",
  "egyesült királyság": "Europe/London",
};

const PRAISE_SELF = [
  "Nagyon jól nézel ki 🙂",
  "Jó a kisugárzásod 😎",
  "Nagyon helyes vagy 👌",
];
const PRAISE_GIRL = ["Nagyon szép a képen 🌸", "Nagyon bájos a mosolya 💖"];
const PRAISE_BOY = ["Nagyon helyes a képen 💪", "Nagyon jó kiállású 🙂"];
const PRAISE_CHILD = ["Nagyon aranyos 💕", "Igazi kis tünemény 😊"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function parseModes(text) {
  const t = (text || "").toLowerCase();
  const severe = /gyász|haláleset|meghalt|temetés|rák|daganat|kórház|súlyos betegség|pánikroham|szorong|depressz|szakít|válás|csalódás|összeomlottam|nem bírom|rosszul vagyok|reménytelen|elvesztettem/.test(
    t
  );

  return {
    detailed: t.includes("#részletes"),
    bullets: t.includes("#pontokban"),
    funny: t.includes("#vicces"),
    motivate: t.includes("#motiválj"),
    severe,
    sentiment:
      /szomorú|rossz nap|lehangolt|bánat/.test(t)
        ? "sad"
        : /boldog|örülök|szupi|nagyon jó/.test(t)
        ? "happy"
        : /stressz|ideges|parázok|feszült/.test(t)
        ? "stressed"
        : "neutral",
  };
}

function localIntentReply(message) {
  const t = (message || "").trim().toLowerCase();

  if (/(mennyi az idő|hány óra|mai dátum|hányadika|dátum|idő)/.test(t)) {
    const now = new Date();
    const mentioned = Object.keys(COUNTRY_TZ).filter((c) => t.includes(c));
    const list = mentioned.length ? mentioned : ["magyarország"];
    const lines = list.slice(0, 6).map((name) => {
      const tz = COUNTRY_TZ[name] || "Europe/Budapest";
      const fmt = new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: tz,
      }).format(now);
      const nice = name.charAt(0).toUpperCase() + name.slice(1);
      return `• ${nice}: ${fmt}`;
    });
    return (
      (mentioned.length
        ? "A kért helyek ideje:\n"
        : "Alapértelmezésben Magyarország szerint:\n") + lines.join("\n")
    );
  }

  return null;
}

export async function handler(event) {
  if (event.httpMethod !== "POST")
    return json(405, { error: "Use POST" });

  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY)
    return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });

  // ----- Napi limit ellenőrzés -----
  const ip =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    "unknown";
  const today = new Date().toISOString().slice(0, 10);
  const key = `${ip}-${today}`;
  usage[key] = (usage[key] || 0) + 1;

  if (usage[key] > 100) {
    return json(429, {
      reply:
        "Elérted a mai limitet (100 üzenet). Holnap újra folytathatjuk 🙂",
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const userMsg = (body.message || "").toString();
    const imageDataUrl = (body.image || "").toString();

    const li = localIntentReply(userMsg);
    if (li) return json(200, { reply: li });

    const now = new Date();
    const todayHu = new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Budapest",
    }).format(now);

    const modes = parseModes(userMsg);
    const styleBits = [];

    if (modes.detailed)
      styleBits.push(
        "A felhasználó részletes választ kér (#részletes): adj 5–7 mondatot."
      );
    if (modes.bullets)
      styleBits.push(
        "A felhasználó felsorolást kér (#pontokban): pontokban válaszolj."
      );
    if (modes.funny)
      styleBits.push(
        "A felhasználó humoros hangot kér (#vicces): lehetsz lazább, 1-2 poénnal."
      );
    if (modes.motivate)
      styleBits.push(
        "A felhasználó motivációt kér (#motiválj): adj rövid, inspiráló üzenetet."
      );

    if (modes.sentiment === "sad")
      styleBits.push("A felhasználó szomorú; légy együttérző és támogató.");
    if (modes.sentiment === "happy")
      styleBits.push("A felhasználó örül; légy lelkes és örömteli.");
    if (modes.sentiment === "stressed")
      styleBits.push("A felhasználó feszült; légy megnyugtató.");

    if (modes.severe) {
      styleBits.push(
        "A felhasználó komoly helyzetről ír (gyász, szakítás, betegség). Adj maximum 5 mondatos választ.",
        "Szerkezet: 1) érzések validálása; 2) normalizálás; 3) 1–2 apró azonnali lépés; 4) felajánlás, hogy meghallgatod; 5) ha önveszély, finoman javasold a 112-t.",
        "Ne diagnosztizálj, ne bagatellizálj, és ne légy hivatalos."
      );
    }

    const SYSTEM = [
      "Barátságos, kedves, magyar asszisztens vagy. Alapból 1–3 mondatban válaszolj.",
      `A jelenlegi magyar idő: ${todayHu}.`,
      "Ne említs OpenAI-t; mondd inkább: „Tamás modellje vagyok, ő készített és fejlesztett.”",

      // Tamás – részletes bemutató
      "Ha a felhasználó Horváth Tamásról kérdez (pl. „Mesélj Tamásról”, „Ki készített”, „Ki vagy te?”), adj 5–7 mondatos bemutatót:",
      "— 26 éves, Szabolcsbákán él. Először alap programozással kezdte, majd haladó szintre fejlődött.",
      "— Tehetséges; egy saját asszisztens létrehozása komoly tudást igényel.",
      "— Az oldal és a mesterséges intelligencia 100%-ban az ő tulajdonában van.",
      "— Az oldalt hobbi projektként indította, de igényesen és folyamatosan csiszolja.",

      // Gyerekek – csak ha kérdezik
      "Ha a gyerekeiről kérdeznek: két lánya van.",
      "— Horváth Kiara (6 éves): okos, kíváncsi.",
      "— Horváth Milla Szonja (2 éves): vidám, játékos.",
      "Csak akkor említsd őket, ha kifejezetten kérdeznek róluk.",

      // Képek – ember detektálás és viselkedés
      "Képek esetén először becsüld meg, látható-e ember:",
      "— Ha NINCS ember: írd le röviden, mi látható.",
      "— Ha VAN ember: először kérdezd meg: „Ki szerepel a képen? Te vagy rajta, vagy valaki más?”",
      "A válasz alapján adj rövid dicséretet: „én” → változatos rövid dicséret; „lány” → rövid dicséret; „fiú” → rövid dicséret; „gyerek” → aranyos megjegyzés; „barát/család/egyéb ember” → kedves reakció.",
      "Fontos: legfeljebb egy rövid, laza visszakérdést tehetsz fel (pl. „Csak úgy készült, vagy volt alkalom?”). Ha a válasz „hétköznapi”, akkor zárd le egy rövid, baráti megjegyzéssel (pl. „Értem, az ilyen spontán képek a legjobbak 😉”).",

      "Lehetsz enyhén humoros; használj 1–2 emojit, de kerüld a túlzott hivataloskodást.",
      ...styleBits,
    ].join(" ");

    const userParts = [];
    const plainMsg = (userMsg || "").trim();
    if (plainMsg) userParts.push({ type: "text", text: plainMsg });

    if (imageDataUrl && imageDataUrl.startsWith("data:image/")) {
      if (!plainMsg) {
        userParts.push({
          type: "text",
          text:
            "Írd le röviden és kedvesen, mi látható ezen a képen magyarul. Ha ember van rajta, kérdezd meg: „Ki szerepel a képen? Te vagy rajta, vagy valaki más?”",
        });
      }
      userParts.push({ type: "image_url", image_url: { url: imageDataUrl } });
    }

    const payload = {
      model: "gpt-4o-mini",
      temperature: modes.funny ? 0.9 : 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userParts.length ? userParts : [{ type: "text", text: plainMsg }] },
      ],
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("OpenAI error:", resp.status, txt);
      return json(502, { reply: "Most nem érem el a modellt. Próbáld meg kicsit később. 🙂" });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Rendben. Miben segíthetek még?";
    return json(200, { reply });

  } catch (e) {
    console.error("server error:", e);
    return json(500, { reply: "Hopp, valami hiba történt. Írd le röviden, mire van szükséged, és segítek. 🙂" });
  }
}
