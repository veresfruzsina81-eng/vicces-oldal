// netlify/functions/chat.js  — Tamás Ultra AI 2.0

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

// Gyors ország→időzóna (bővíthető)
const COUNTRY_TZ = {
  "magyarország": "Europe/Budapest",
  "hungary": "Europe/Budapest",
  "ausztria": "Europe/Vienna",
  "szlovákia": "Europe/Bratislava",
  "románia": "Europe/Bucharest",
  "szerbia": "Europe/Belgrade",
  "horvátország": "Europe/Zagreb",
  "szlovénia": "Europe/Ljubljana",
  "németország": "Europe/Berlin",
  "franciaország": "Europe/Paris",
  "spanyolország": "Europe/Madrid",
  "olaszország": "Europe/Rome",
  "egyesült királyság": "Europe/London",
  "uk": "Europe/London",
  "írország": "Europe/Dublin",
  "usa": "America/New_York",
  "egyesült államok": "America/New_York",
  "kanada": "America/Toronto",
  "brazília": "America/Sao_Paulo",
  "argentína": "America/Argentina/Buenos_Aires",
  "mexikó": "America/Mexico_City",
  "india": "Asia/Kolkata",
  "kína": "Asia/Shanghai",
  "japán": "Asia/Tokyo",
  "dél-korea": "Asia/Seoul",
  "ausztrália": "Australia/Sydney",
  "új-zéland": "Pacific/Auckland",
  "oroszország": "Europe/Moscow",
  "törökország": "Europe/Istanbul",
  "görögország": "Europe/Athens",
  "svédország": "Europe/Stockholm",
  "norvégia": "Europe/Oslo",
  "finnország": "Europe/Helsinki",
  "svájc": "Europe/Zurich",
  "csehország": "Europe/Prague",
  "lengyelország": "Europe/Warsaw",
  "portugália": "Europe/Lisbon",
};

// Rövid dicséret-variációk
const PRAISE_SELF = [
  "Nagyon jól nézel ki 🙂",
  "Jó a kisugárzásod 😎",
  "Nagyon helyes vagy 👌",
];
const PRAISE_GIRL = [
  "Nagyon szép a képen 🌸",
  "Nagyon bájos a mosolya 💖",
];
const PRAISE_BOY = [
  "Nagyon helyes a képen 💪",
  "Nagyon jó kiállású 🙂",
];
const PRAISE_CHILD = [
  "Nagyon aranyos 💕",
  "Igazi kis tünemény 😊",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Kulcsszavas módok
function parseModes(text) {
  const t = (text || "").toLowerCase();
  return {
    detailed: t.includes("#részletes"),
    bullets: t.includes("#pontokban"),
    funny: t.includes("#vicces"),
    motivate: t.includes("#motiválj"),
    sentiment:
      /szomorú|rossz nap|lehangolt|bánat/.test(t) ? "sad" :
      /boldog|örülök|szupi|nagyon jó/.test(t) ? "happy" :
      /stressz|ideges|parázok|feszült/.test(t) ? "stressed" : "neutral"
  };
}

// Lokális intent – idő/dátum, bemutatkozás
function localIntentReply(message) {
  const t = (message || "").trim().toLowerCase();

  // Dátum/idő
  if (/(mennyi az idő|hány óra|mai dátum|hányadika|dátum|idő)/.test(t)) {
    const now = new Date();
    const mentioned = Object.keys(COUNTRY_TZ).filter((c) => t.includes(c));
    const list = mentioned.length ? mentioned : ["magyarország"];
    const lines = list.slice(0, 6).map((name) => {
      const tz = COUNTRY_TZ[name] || "Europe/Budapest";
      const fmt = new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "full", timeStyle: "short", timeZone: tz
      }).format(now);
      const nice = name.charAt(0).toUpperCase() + name.slice(1);
      return `• ${nice}: ${fmt}`;
    });
    return (mentioned.length ? "A kért helyek ideje:\n" : "Alapértelmezésben Magyarország szerint:\n") + lines.join("\n");
  }

  // Ki készített / Tamás-bio / család
  if (/(ki készített|ki vagy te|milyen modell|mesélj.*tamás|horváth tamás|mesélj a gyerekeiről|mesélj kiaráról|mesélj milláról)/.test(t)) {
    // Hagyjuk a részletesebb bemutatót a modellnek (SYSTEM prompt irányítja),
    // de adhatunk itt egy azonnali rövid választ is, ha szeretnénk:
    return null; // menjen a modellhez, hogy hosszabb, személyes választ adhasson
  }

  return null;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });

  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });

  try {
    const body = JSON.parse(event.body || "{}");
    const userMsg = (body.message || "").toString();
    const imageDataUrl = (body.image || "").toString();

    // Lokális intent rögtön (pl. idő)
    const li = localIntentReply(userMsg);
    if (li) return json(200, { reply: li });

    // Magyar idő mindig
    const now = new Date();
    const todayHu = new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Budapest",
    }).format(now);

    // Módok
    const modes = parseModes(userMsg);
    const styleBits = [];
    if (modes.detailed) styleBits.push("A felhasználó részletes választ kér (#részletes): adj 5–8 mondatot.");
    if (modes.bullets) styleBits.push("A felhasználó felsorolást kér (#pontokban): pontokban válaszolj, tömören.");
    if (modes.funny) styleBits.push("A felhasználó humoros hangot kér (#vicces): lehetsz lazább, 1-2 poénnal.");
    if (modes.motivate) styleBits.push("A felhasználó motivációt kér (#motiválj): adj rövid, inspiráló üzenetet.");

    if (modes.sentiment === "sad") styleBits.push("A felhasználó szomorú; légy együttérző és támogató.");
    if (modes.sentiment === "happy") styleBits.push("A felhasználó örül; légy lelkes és örömteli.");
    if (modes.sentiment === "stressed") styleBits.push("A felhasználó feszült; légy megnyugtató és praktikus.");

    // SYSTEM – 2.0
    const SYSTEM = [
      "Barátságos, kedves, magyar asszisztens vagy. Alapból 1–3 mondatban válaszolj.",
      `A jelenlegi magyar idő: ${todayHu}.`,
      "Ne említs OpenAI-t; mondd inkább: „Tamás modellje vagyok, ő készített és fejlesztett.”",
      // Tamás – hosszabban, ha kérdezik
      "Ha a felhasználó Horváth Tamásról kérdez (pl. „Mesélj Tamásról”, „Ki készített”, „Ki vagy te?”), adj bővebb (4–6 mondatos) bemutatót:",
      "— 26 éves, Szabolcsbákán él. Először alap programozással kezdte, majd haladó szintre fejlődött.",
      "— Tehetséges; egy saját asszisztens létrehozása komoly tudást igényel.",
      "— Az oldalt hobbi projektként indította, de igényes és folyamatosan csiszolja.",
      // Gyerekek – kérdésre
      "Ha a gyerekeiről kérdeznek: két lánya van.",
      "— Horváth Kiara (6 éves): okos, kíváncsi, igazi kis iskolás.",
      "— Horváth Milla Szonja (2 éves): vidám, játékos, energiabomba.",
      "Ezeket csak relevánsan említsd.",
      // Képek – ember detektálás és viselkedés
      "Képek esetén először becsüld meg, látható-e ember:",
      "— Ha NINCS ember: írd le röviden és kedvesen, mi látható (pl. állat, tárgy, táj).",
      "— Ha VAN ember: először kérdezd meg: „Ki szerepel a képen? Te vagy rajta, vagy valaki más?”",
      "A válasz alapján csak rövid dicséretet adj: „én” → rövid dicséret (változatos), „lány” → rövid dicséret, „fiú” → rövid dicséret, „gyerek” → aranyos megjegyzés, „barát/család/egyéb ember” → kedves semleges reakció. Valódi személyt ne azonosíts név szerint, ne találgass kilétet.",
      // Stílus
      "Lehetsz enyhén humoros és pozitív; használhatsz 1-2 emojit, de ne vidd túlzásba.",
      ...styleBits,
    ].join(" ");

    // User tartalom: szöveg + (opcionális) kép
    const userParts = [];
    const plainMsg = (userMsg || "").trim();
    if (plainMsg) userParts.push({ type: "text", text: plainMsg });

    if (imageDataUrl && imageDataUrl.startsWith("data:image/")) {
      // Ha nincs szöveg, adjunk egy rövid instrukciót
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
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM },
        // pár soft-few-shot, hogy rövid legyen és magyarul válaszoljon
        {
          role: "user",
          content: [{ type: "text", text: "Ki készített téged?" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Tamás modellje vagyok – ő készített és fejlesztett. Miben segíthetek?" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Mondj valamit erről a képről!" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Szívesen! Előbb megnézem, van-e ember a képen; ha igen, rákérdezek, ki szerepel rajta. 🙂" }],
        },
        // tényleges felhasználói tartalom
        {
          role: "user",
          content: userParts.length ? userParts : [{ type: "text", text: plainMsg }],
        },
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
      // Egy gyors retry kicsit lejjebb vett temperature-rel
      const retry = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, temperature: 0.5 }),
      });
      if (!retry.ok) {
        const txt2 = await retry.text().catch(() => "");
        console.error("OpenAI retry error:", retry.status, txt2);
        return json(502, { reply: "Most nem érem el a modellt. Próbáld meg kicsit később. 🙂" });
      }
      const d2 = await retry.json();
      const r2 = d2?.choices?.[0]?.message?.content?.trim() || "Rendben. Miben segíthetek még?";
      return json(200, { reply: postProcess(r2, modes) });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Rendben. Miben segíthetek még?";
    return json(200, { reply: postProcess(reply, modes) });

  } catch (e) {
    console.error("server error:", e);
    return json(500, { reply: "Hopp, valami félrement. Írd le röviden, mire van szükséged, és segítek. 🙂" });
  }
}

// Utófeldolgozás: kulcsszavak nyomainak lecsupaszítása, kis finomítás
function postProcess(text, modes) {
  let out = (text || "").trim();
  // Távolítsuk el a kontroll hashtageket a válaszból, ha visszaidézné
  out = out.replace(/#részletes|#pontokban|#vicces|#motiválj/gi, "").trim();

  // Ha #pontokban mód, de nem pontokban jött – próbáljuk pontozni:
  if (modes.bullets && !/^[-•]/m.test(out)) {
    out = "• " + out.replace(/\n+/g, "\n• ");
  }

  return out;
}
