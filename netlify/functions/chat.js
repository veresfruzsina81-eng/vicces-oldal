// netlify/functions/chat.js
// Teljes, egyben bemásolható verzió

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Use POST" });
  }

  // ====== Beállítások ======
  const BUILD_VERSION = "TUAI-3.1.0";
  const { OPENAI_API_KEY, BING_API_KEY } = process.env;

  // Napi limit/IP (kivételek: a te IP-d)
  const DAILY_LIMIT = 100;
  const WHITELIST_IPS = [
    "176.77.144.113",               // a te IPv4
    "2a0a:f640:1603:d3e6::1"        // a te IPv6
  ];
  const ADMIN_RESET_PASS = "Admin.19981010";

  // ====== Rate limit (memóriában) ======
  // (Netlify function cold start esetén nullázódhat – ez neked jó.)
  globalThis._rl = globalThis._rl || { day: dayKey(), counts: {} };
  if (globalThis._rl.day !== dayKey()) {
    globalThis._rl = { day: dayKey(), counts: {} };
  }

  // ====== Kliens üzenet + IP ======
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }
  const rawMessage = String(body.message || "").trim();

  const clientIp = getClientIP(event) || "unknown";
  const whitelisted = WHITELIST_IPS.includes(clientIp);

  // Admin reset (chatből): "Admin.19981010 reset"
  if (rawMessage.toLowerCase().startsWith(ADMIN_RESET_PASS.toLowerCase())) {
    const parts = rawMessage.split(/\s+/);
    const cmd = parts[1]?.toLowerCase() || "";
    if (cmd === "reset") {
      globalThis._rl.counts[clientIp] = 0;
      return json(200, { reply: "Limit nullázva erre az IP-re. ✅", version: BUILD_VERSION });
    }
  }

  // Rate limit
  if (!whitelisted) {
    const used = globalThis._rl.counts[clientIp] || 0;
    if (used >= DAILY_LIMIT) {
      return json(429, {
        reply: "Elérted a mai limitet (100 üzenet). Holnap újra használhatod. Ha sürgős, írd: Admin.19981010 reset",
        version: BUILD_VERSION
      });
    }
    globalThis._rl.counts[clientIp] = used + 1;
  }

  // ====== Ha üres üzenet ======
  if (!rawMessage) {
    return json(200, { reply: "Írj bátran egy kérdést! 🙂", version: BUILD_VERSION });
  }

  // ====== Keresés/külső adat (DDG/Bing/Sports) ======
  let externalSnippet = null;
  try {
    externalSnippet = await externalDataIfAny(rawMessage, BING_API_KEY);
  } catch (e) {
    console.error("externalDataIfAny error:", e);
  }

  // ====== OpenAI (összefoglal, röviden válaszol) ======
  if (!OPENAI_API_KEY) {
    // Ha nincs kulcs, akkor legalább a snippetet (vagy egy rövid választ) adjuk vissza
    const fallback = externalSnippet || "Most nem érem el a modellt. Próbáld meg kicsit később. 🙂";
    return json(200, { reply: fallback, version: BUILD_VERSION });
  }

  const todayHu = new Date().toLocaleDateString("hu-HU", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "long"
  });

  const system = [
    "Barátságos magyar asszisztens vagy. Válaszaid legyenek rövidek (2–5 mondat), közérthetőek, pozitív hangvételűek.",
    "Ne említsd az OpenAI-t; helyette: 'Tamás modellje vagyok, ő készített és fejlesztett.'",
    `Mai dátum: ${todayHu}.`,
    "Ha kapsz 'Keresési eredmények' szöveget, azt foglald össze, és hagyd meg a 'Forrás:' sort a végén.",
    "Ha a felhasználó szomorú/nehéz helyzetben van, adj rövid, empatikus bátorítást (max. 5 mondat).",
    "Ha a felhasználó ország nélkül kérdezi a dátumot/időt, magyar formát használj.",
  ].join(" ");

  const messages = [
    { role: "system", content: system },
  ];

  // Ha találtunk friss adatot, add oda a modellnek „eredményként”
  if (externalSnippet) {
    messages.push({
      role: "assistant",
      content: "Keresési eredmények (nyers):\n" + externalSnippet
    });
  }

  messages.push({ role: "user", content: rawMessage });

  try {
    const payload = {
      model: "gpt-4o-mini", // ezt később átírhatod GPT-4.1/5-re
      messages,
      temperature: 0.6,
      max_tokens: 400
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("OpenAI error:", r.status, t);
      const fb = externalSnippet || "Most nem érem el a modellt. Próbáld meg később. 🙂";
      return json(200, { reply: fb, version: BUILD_VERSION });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim()
      || externalSnippet
      || "Rendben. Miben segíthetek még?";
    return json(200, { reply, version: BUILD_VERSION });

  } catch (e) {
    console.error(e);
    const fb = externalSnippet || "Hopp, hiba történt. Írd le röviden, mire van szükséged, és segítek. 🙂";
    return json(200, { reply: fb, version: BUILD_VERSION });
  }
}

// =================== Segédfüggvények ===================

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(obj)
  };
}

function dayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
}

function getClientIP(event) {
  // Netlify: x-nf-client-connection-ip
  const h = event.headers || {};
  const a = h["x-nf-client-connection-ip"]
    || h["client-ip"]
    || h["x-forwarded-for"]
    || "";
  return String(a).split(",")[0].trim();
}

// ---- DDG / Bing kereső összefoglaló
async function getBingSearchText(q){
  const key = process.env.BING_API_KEY;
  if (!key) throw new Error("NoBing");
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&mkt=hu-HU&safeSearch=Moderate`;
  const r = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": key } });
  if (!r.ok) throw new Error("Bing hiba");
  const j = await r.json();
  const items = j?.webPages?.value?.slice(0,3) || [];
  if (!items.length) return "Nem találtam jó találatot Binggel. Forrás: Bing 🌐";
  return "Találatok (Bing):\n" + items.map((it,i)=>`${i+1}. ${it.name}\n   ${it.snippet}\n   ${it.url}`).join("\n") + "\nForrás: Bing 🌐";
}

async function getDDGISearchText(q){
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("DDG hiba");
  const j = await r.json();
  const abs = j?.Abstract || j?.AbstractText || "";
  if (abs) return `DuckDuckGo: ${abs}\nForrás: DuckDuckGo 🔍`;
  const rels = j?.RelatedTopics?.slice(0,3) || [];
  if (rels.length) {
    const lines = rels.map(rt => `• ${(rt?.Text||"")}\n  ${(rt?.FirstURL||"")}`).join("\n");
    return `${lines}\nForrás: DuckDuckGo 🔍`;
  }
  return "Nem találtam jó találatot.\nForrás: DuckDuckGo 🔍";
}

async function getSearchText(q){
  try {
    return await getBingSearchText(q);
  } catch {
    // nincs Bing vagy hiba → DDG
    return await getDDGISearchText(q);
  }
}

// ---- Sport: LEGUTÓBBI meccs (TheSportsDB)
async function getSportLastMatchText(q){
  const t = (q||"").toLowerCase();
  const team = t.replace(/meccs|eredmény|mérkőzés|ki nyert|mikor játszik|következő meccs|program|\?|\.|,|ma|tegnap|holnap/gi,"").trim();
  if (!team) return "Írd be a csapat nevét is (pl. „barcelona legutóbbi meccs”).";

  const s = await fetch(`https://www.thesportsdb.com/api/v1/json/1/searchteams.php?t=${encodeURIComponent(team)}`);
  if (!s.ok) throw new Error("Sports search hiba");
  const sj = await s.json();
  const id = sj?.teams?.[0]?.idTeam;
  const name = sj?.teams?.[0]?.strTeam;
  if (!id) return "Nem találtam ilyen csapatot.";

  const last = await fetch(`https://www.thesportsdb.com/api/v1/json/1/eventslast.php?id=${id}`);
  if (!last.ok) throw new Error("Sports last hiba");
  const lj = await last.json();
  const ev = lj?.results?.[0];
  if (!ev) return `Nincs elérhető legutóbbi meccs: ${name}`;

  const home = ev.strHomeTeam, away = ev.strAwayTeam;
  const hs = ev.intHomeScore, as = ev.intAwayScore;
  const date = ev.dateEvent;
  return `Legutóbbi: ${home} ${hs}–${as} ${away} — ${date}`;
}

// ---- Sport: KÖVETKEZŐ meccs (TheSportsDB)
async function getSportNextMatchText(q){
  const t = (q||"").toLowerCase();
  const team = t.replace(/meccs|eredmény|mérkőzés|ki nyert|mikor játszik|következő meccs|program|\?|\.|,|ma|tegnap|holnap/gi,"").trim();
  if (!team) return "Írd be a csapat nevét is (pl. „következő meccs Barcelona”).";

  const s = await fetch(`https://www.thesportsdb.com/api/v1/json/1/searchteams.php?t=${encodeURIComponent(team)}`);
  if (!s.ok) throw new Error("Sports search hiba");
  const sj = await s.json();
  const id = sj?.teams?.[0]?.idTeam;
  const name = sj?.teams?.[0]?.strTeam;
  if (!id) return "Nem találtam ilyen csapatot.";

  const nxt = await fetch(`https://www.thesportsdb.com/api/v1/json/1/eventsnext.php?id=${id}`);
  if (!nxt.ok) throw new Error("Sports next hiba");
  const nj = await nxt.json();
  const ev = nj?.events?.[0];
  if (!ev) return `Nincs elérhető közelgő meccs: ${name}`;

  const home = ev.strHomeTeam, away = ev.strAwayTeam;
  const date = ev.dateEvent;
  const time = ev.strTime || "";
  const league = ev.strLeague || "";
  return `Következő: ${home} vs ${away} — ${date}${time ? " " + time : ""}${league ? " — " + league : ""}`;
}

// ---- Mit kérjünk kintről?
async function externalDataIfAny(message, bingKey){
  const t = (message || "").toLowerCase().trim();

  // Saját bio – gyakori név miatt ne webet kérdezzünk
  if (/\bhorváth\s+tamás\b/.test(t) || /\bhorvath\s+tamas\b/.test(t)) {
    return (
      "Horváth Tamás 26 éves és Szabolcsbákán él. Először alap szinten programozott, " +
      "ma már haladó szinten fejleszt. Tehetségesnek tartják, mert a saját működő " +
      "mesterséges intelligens asszisztensét is megalkotta — ez az oldal és az asszisztens " +
      "100%-ban az ő tulajdona. A projekt hobbiként indult, igényesen csiszolja, " +
      "és örömmel fogad visszajelzéseket."
    );
  }

  // Sport – következő / legutóbbi
  if (/(meccs|eredmény|mérkőzés|ki nyert|mikor játszik|következő meccs|program|barca|barcelona|real madrid|liverpool|manchester|arsenal|chelsea|bayern|dortmund|juventus|milan|inter|psg)/.test(t)) {
    try {
      if (/mikor játszik|következő meccs|program/.test(t)) {
        const nxt = await getSportNextMatchText(message);
        if (/Nem találtam|Nincs elérhető|Írd be a csapat nevét/.test(nxt)) {
          return await getSearchText(`${message} következő meccs időpontja`);
        }
        return nxt;
      } else {
        const last = await getSportLastMatchText(message);
        if (/Nem találtam|Nincs elérhető|Írd be a csapat nevét/.test(last)) {
          return await getSearchText(`${message} legutóbbi meccs eredménye`);
        }
        return last;
      }
    } catch (e) {
      const q = /mikor játszik|következő meccs|program/.test(t)
        ? `${message} következő meccs időpontja`
        : `${message} legutóbbi meccs eredménye`;
      return await getSearchText(q);
    }
  }

  // Általános „nézz utána / keress”
  if (/(keress|nézz utána|mit mondanak róla|mi található róla|hogy működik|mi ez|mi az|hogyan kell|ár|vélemények|összehasonlítás|hírek|breaking|friss)/.test(t)) {
    try { return await getSearchText(message); }
    catch { return "Most nem érem el a kereső szolgáltatást. 🌐"; }
  }

  return null;
}
