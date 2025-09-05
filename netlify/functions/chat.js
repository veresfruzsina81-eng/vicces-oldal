// netlify/functions/chat.js — Tamás Ultra AI 3.0 (GPT-4 + DDG + optional Bing + Weather/FX/News/Wiki/Sports)

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

// ----- In-memory napi limit (restartnál nullázódik)
const usage = {};

// ----- Fix whitelist + dinamikus whitelist (admin parancs)
const WHITELIST_BASE = ["176.77.144.113"]; // ← a te IPv4-ed
let dynamicWhitelist = [...WHITELIST_BASE];

// ----- Ország → időzóna (részleges)
const COUNTRY_TZ = {
  "magyarország": "Europe/Budapest", "hungary": "Europe/Budapest",
  "egyesült államok": "America/New_York", "usa": "America/New_York",
  "németország": "Europe/Berlin", "franciaország": "Europe/Paris",
  "olaszország": "Europe/Rome", "spanyolország": "Europe/Madrid",
  "egyesült királyság": "Europe/London", "japán": "Asia/Tokyo",
  "kína": "Asia/Shanghai", "india": "Asia/Kolkata",
  "ausztrália": "Australia/Sydney", "új-zéland": "Pacific/Auckland",
};

const PRAISE_SELF  = ["Nagyon jól nézel ki 🙂","Jó a kisugárzásod 😎","Nagyon helyes vagy 👌"];
const PRAISE_GIRL  = ["Nagyon szép a képen 🌸","Nagyon bájos a mosolya 💖"];
const PRAISE_BOY   = ["Nagyon helyes a képen 💪","Nagyon jó kiállású 🙂"];
const PRAISE_CHILD = ["Nagyon aranyos 💕","Igazi kis tünemény 😊"];

const ADMIN_PASS = "Admin.19981010";

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)] }

// ---------- Módok / hangulat / „komoly helyzet” detektálása
function parseModes(text) {
  const t = (text || "").toLowerCase();
  const severe = /gyász|haláleset|meghalt|temetés|rák|daganat|kórház|súlyos betegség|pánikroham|szorong|depressz|szakít|válás|csalódás|összeomlottam|nem bírom|rosszul vagyok|reménytelen|elvesztettem/.test(t);
  return {
    detailed: t.includes("#részletes"),
    bullets: t.includes("#pontokban"),
    funny: t.includes("#vicces"),
    motivate: t.includes("#motiválj"),
    severe,
    sentiment:
      /szomorú|rossz nap|lehangolt|bánat/.test(t) ? "sad" :
      /boldog|örülök|szupi|nagyon jó/.test(t) ? "happy" :
      /stressz|ideges|parázok|feszült/.test(t) ? "stressed" : "neutral",
  };
}

// ---------- Helyi „statikus” idő/dátum (AI hívás nélkül)
function localIntentReply(message) {
  const t = (message || "").trim().toLowerCase();
  if (/(mennyi az idő|hány óra|mai dátum|hányadika|dátum|idő)/.test(t)) {
    const now = new Date();
    const mentioned = Object.keys(COUNTRY_TZ).filter((c) => t.includes(c));
    const list = mentioned.length ? mentioned : ["magyarország"];
    const lines = list.slice(0, 6).map((name) => {
      const tz = COUNTRY_TZ[name] || "Europe/Budapest";
      const fmt = new Intl.DateTimeFormat("hu-HU", { dateStyle:"full", timeStyle:"short", timeZone: tz }).format(now);
      const nice = name.charAt(0).toUpperCase() + name.slice(1);
      return `• ${nice}: ${fmt}`;
    });
    return (mentioned.length ? "A kért helyek ideje:\n" : "Alapértelmezésben Magyarország szerint:\n") + lines.join("\n");
  }
  return null;
}

/* ===========================
   FRISS ADAT MODULOK (kulcs nélkül + opcionális Bing)
   =========================== */

// ---------- Időjárás (Open-Meteo)
async function fetchWeatherRaw(city) {
  const q = encodeURIComponent(city || "Budapest");
  const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=hu&format=json`);
  if (!g.ok) throw new Error("Geocoding hiba");
  const gj = await g.json();
  const first = gj?.results?.[0];
  if (!first) throw new Error("Nem találtam ilyen várost.");
  const { latitude, longitude, name, country } = first;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Europe%2FBudapest&forecast_days=2`;
  const w = await fetch(url);
  if (!w.ok) throw new Error("Időjárás hiba");
  const wx = await w.json();
  return { place: `${name}${country ? ", " + country : ""}`, daily: wx?.daily };
}
function wcodeToHu(code){
  const m = {
    0:"derült",1:"nagyrészt derült",2:"változó felhőzet",3:"borult",
    45:"köd",48:"zúzmarás köd",51:"gyenge szitálás",53:"szitálás",55:"erős szitálás",
    61:"enyhe eső",63:"eső",65:"erős eső",71:"enyhe havazás",73:"havazás",75:"erős havazás",
    80:"zápor",81:"erősebb zápor",82:"viharos zápor",95:"zivatar",96:"jéggel kísért zivatar",99:"erős jéggel kísért zivatar"
  }; return m[code] || "változó";
}
function fmtC(n){ return `${Math.round(n)}°C`; }
function fmtMm(n){ return `${Math.round(n)} mm`; }
async function getWeatherText(query){
  const m = /időjárás(?:\s+(.*))?/i.exec(query || "");
  const cityRaw = (m && m[1]) ? m[1].replace(/ma|holnap|milyen|most|\?|\.|,|ben|ban|on|en|ön/gi,"").trim() : "";
  const city = cityRaw || "Budapest";
  const { place, daily } = await fetchWeatherRaw(city);
  const [today, tomorrow] = [0,1].map(i => ({
    code: wcodeToHu(daily.weathercode[i]),
    tmin: fmtC(daily.temperature_2m_min[i]),
    tmax: fmtC(daily.temperature_2m_max[i]),
    pr  : fmtMm(daily.precipitation_sum[i]),
  }));
  return `Időjárás – ${place}\n• Ma: ${today.code}, ${today.tmin} / ${today.tmax}, csapadék: ${today.pr}\n• Holnap: ${tomorrow.code}, ${tomorrow.tmin} / ${tomorrow.tmax}, csapadék: ${tomorrow.pr}`;
}

// ---------- Árfolyam (Frankfurter API)
function parseFxQuery(q){
  const t = (q||"").toUpperCase().replace(",",".");
  const amountMatch = t.match(/(\d+(\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 1;
  const pairs = [
    ["EUR","HUF"],["USD","HUF"],["HUF","EUR"],["HUF","USD"],
    ["EUR","USD"],["USD","EUR"],["GBP","HUF"],["HUF","GBP"]
  ];
  for (const [a,b] of pairs){
    const rg = new RegExp(`${a}\\s*${b}`);
    const rg2 = new RegExp(`${a}.*MENNYI.*${b}`);
    if (rg.test(t) || rg2.test(t)) return { base:a, quote:b, amount };
  }
  return { base:"EUR", quote:"HUF", amount };
}
async function getFxText(q){
  const { base, quote, amount } = parseFxQuery(q);
  const r = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${quote}`);
  if (!r.ok) throw new Error("Árfolyam hiba");
  const j = await r.json();
  const rate = j?.rates?.[quote];
  if (!rate) throw new Error("Nincs elérhető árfolyam.");
  const conv = amount * rate;
  const nf = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 4 });
  return amount !== 1
    ? `${amount} ${base} ≈ ${nf.format(conv)} ${quote} (1 ${base} = ${nf.format(rate)} ${quote})`
    : `1 ${base} = ${nf.format(rate)} ${quote}`;
}

// ---------- Hírek (Google News RSS → top 3)
async function getNewsText(q){
  const t = (q||"").toLowerCase();
  const mt = /hírek?\s+(.*)/i.exec(t);
  const topic = mt ? mt[1].trim() : "";
  const url = topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=hu&gl=HU&ceid=HU:hu`
    : `https://news.google.com/rss?hl=hu&gl=HU&ceid=HU:hu`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Hírek hiba");
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,3).map(m=>{
    const block = m[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [,"(cím)"])[1];
    const link  = (block.match(/<link>(.*?)<\/link>/) || [,""])[1];
    return { title, link };
  });

  if (!items.length) return "Most nem találtam friss hírt.";
  const head = topic ? `Hírek – ${topic}` : "Hírek – főbb címek";
  return `${head}\n` + items.map((it,i)=>`${i+1}. ${it.title}\n   ${it.link}`).join("\n");
}

// ---------- Wikipédia (HU → EN fallback)
async function getWikiText(q){
  const t = (q||"").trim();
  let subj = "";
  const m1 = /^mi az a\s+(.+)/i.exec(t);
  const m2 = /^ki az a\s+(.+)/i.exec(t);
  const m3 = /wikipedia|wiki:\s*(.+)/i.exec(t);
  if (m1) subj = m1[1]; else if (m2) subj = m2[1]; else if (m3) subj = m3[1];
  if (!subj) subj = t.replace(/(mi az a|ki az a|mi az az|wik(i|ipédia)|\?|\.|,)/gi,"").trim();
  if (!subj) return "Adj meg egy kifejezést (pl. „mi az a kvantumszámítógép?”).";

  const enc = encodeURIComponent(subj);
  async function summary(base){
    const r = await fetch(`${base}/api/rest_v1/page/summary/${enc}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.extract) return `${j.title} — ${j.extract}\n${j.content_urls?.desktop?.page || ""}`;
    return null;
  }
  return await summary("https://hu.wikipedia.org") || await summary("https://en.wikipedia.org") || "Nem találtam jó összefoglalót.";
}

// ---------- Sport – utolsó meccs (TheSportsDB, key=1)
async function getSportLastMatchText(q){
  const t = (q||"").toLowerCase();
  const m = /(meccs|eredmény|mérkőzés)\s+(.+)/i.exec(t);
  const team = m ? m[2].trim() : t.replace(/meccs|eredmény|mérkőzés|\?|\.|,|ma|tegnap|majd/gi,"").trim();
  if (!team) return "Írd be a csapat nevét is (pl. „meccs Real Madrid”).";

  const s = await fetch(`https://www.thesportsdb.com/api/v1/json/1/searchteams.php?t=${encodeURIComponent(team)}`);
  if (!s.ok) throw new Error("Sports search hiba");
  const sj = await s.json();
  const id = sj?.teams?.[0]?.idTeam;
  const name = sj?.teams?.[0]?.strTeam;
  if (!id) return "Nem találtam ilyen csapatot.";

  const last = await fetch(`https://www.thesportsdb.com/api/v1/json/1/eventslast.php?id=${id}`);
  if (!last.ok) throw new Error("Sports eventi hiba");
  const lj = await last.json();
  const ev = lj?.results?.[0];
  if (!ev) return `Nincs elérhető legutóbbi meccs: ${name}`;

  const home = ev.strHomeTeam, away = ev.strAwayTeam;
  const hs = ev.intHomeScore, as = ev.intAwayScore;
  const date = ev.dateEvent;
  const league = ev.strLeague || "";
  return `Utoljára: ${home} ${hs}–${as} ${away} (${date}) ${league ? "— " + league : ""}`;
}

// ---------- Általános keresés — 1) Bing (ha van kulcs) 2) DuckDuckGo fallback
async function getBingSearchText(q){
  const key = process.env.BING_API_KEY;
  if (!key) throw new Error("NoBing");
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&mkt=hu-HU&safeSearch=Moderate`;
  const r = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": key } });
  if (!r.ok) throw new Error("Bing hiba");
  const j = await r.json();
  const items = j?.webPages?.value?.slice(0,3) || [];
  if (!items.length) return "Nem találtam jó találatot Binggel.";
  return "Találatok (Bing):\n" + items.map((it,i)=>`${i+1}. ${it.name}\n   ${it.snippet}\n   ${it.url}`).join("\n");
}
async function getDDGISearchText(q){
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("DDG hiba");
  const j = await r.json();
  const abs = j?.Abstract || j?.AbstractText || "";
  if (abs) return `DuckDuckGo: ${abs}`;
  const rels = j?.RelatedTopics?.slice(0,3) || [];
  if (rels.length) {
    const lines = rels.map(rt => {
      const txt = rt?.Text || "";
      const f = (rt?.FirstURL || "");
      return `• ${txt}\n  ${f}`;
    }).join("\n");
    return lines || "Nem találtam jó találatot.";
  }
  return "Nem találtam jó találatot.";
}
async function getSearchText(q){
  try { return await getBingSearchText(q); }
  catch(e){
    if (e?.message === "NoBing") {
      // nincs kulcs → menjen DDG-re
      try { return await getDDGISearchText(q); }
      catch(_) { return "Most nem érem el a kereső szolgáltatást. 🌐"; }
    } else {
      // Bing hiba → fallback DDG
      try { return await getDDGISearchText(q); }
      catch(_) { return "Most nem érem el a kereső szolgáltatást. 🌐"; }
    }
  }
}

// ---------- Külső adat igény detektálás; ha talál, visszaad szöveget (AI-t nem hívjuk)
async function externalDataIfAny(message){
  const t = (message || "").toLowerCase();

  if (/időjárás/.test(t)) {
    try { return await getWeatherText(message); }
    catch(e){ return "Most nem érem el az időjárás szolgáltatást. Próbáld meg később. 🌦️"; }
  }
  if (/(árfolyam|euró|euro|usd|dollár|forint|huf|gbp)/.test(t)) {
    try { return await getFxText(message); }
    catch(e){ return "Most nem érem el az árfolyam szolgáltatást. Próbáld meg később. 💱"; }
  }
  if (/hírek?/.test(t)) {
    try { return await getNewsText(message); }
    catch(e){ return "Most nem érem el a hírszolgáltatást. Próbáld meg később. 📰"; }
  }
  if (/^mi az a|^ki az a|wikipédi|wiki/.test(t)) {
    try { return await getWikiText(message); }
    catch(e){ return "Most nem érem el a Wikipédiát. Próbáld meg később. 📚"; }
  }
  if (/(meccs|eredmény|mérkőzés|mikor játszik)/.test(t)) {
    try { return await getSportLastMatchText(message); }
    catch(e){ return "Most nem érem el a sportadatokat. Próbáld meg később. ⚽"; }
  }
  if (/(keress|nézz utána|bing|duckduckgo|googl(e|izz)|mit mondanak róla|mi található róla)/.test(t)) {
    try { return await getSearchText(message); }
    catch(e){ return "Most nem érem el a kereső szolgáltatást. 🌐"; }
  }

  return null;
}

/* ===========================
   FŐ HANDLER
   =========================== */
export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });

  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) return json(503, { error: "Missing OPENAI_API_KEY on Netlify." });

  // ----- IP
  const ip =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown";

  // ----- ADMIN: /admin JELSZÓ → aktuális IP fehérlistára
  try {
    const bodyAdm = JSON.parse(event.body || "{}");
    const rawMsgAdm = (bodyAdm.message || "").toString();
    if (rawMsgAdm.startsWith("/admin ")) {
      const pass = rawMsgAdm.split(" ")[1] || "";
      if (pass === ADMIN_PASS) {
        if (!dynamicWhitelist.includes(ip)) dynamicWhitelist.push(ip);
        return json(200, { reply: `🛠️ ADMIN: Az IP hozzáadva a whitelisthez: ${ip}` });
      } else {
        return json(403, { reply: "🛠️ ADMIN: Hibás jelszó." });
      }
    }
  } catch(_) {}

  // ----- Limit csak NEM whitelistes IP-re
  const isWhitelisted = dynamicWhitelist.includes(ip);
  const today = new Date().toISOString().slice(0,10);
  const usageKey = `${ip}-${today}`;
  if (!isWhitelisted) {
    usage[usageKey] = (usage[usageKey] || 0) + 1;
    if (usage[usageKey] > 100) {
      return json(429, { reply: "Elérted a mai limitet (100 üzenet). Holnap újra folytathatjuk 🙂" });
    }
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const userMsg = (body.message || "").toString();
    const imageDataUrl = (body.image || "").toString();

    // 0) nagyon gyors helyi (óra/dátum)
    const local = localIntentReply(userMsg);
    if (local) return json(200, { reply: local });

    // 1) FRISS adatok? (időjárás / árfolyam / hírek / wiki / sport / keresés)
    const external = await externalDataIfAny(userMsg);
    if (external) return json(200, { reply: external });

    // 2) AI – GPT-4 (a maradék mindenre)
    const now = new Date();
    const todayHu = new Intl.DateTimeFormat("hu-HU", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Budapest" }).format(now);

    const modes = parseModes(userMsg);
    const styleBits = [];
    if (modes.detailed) styleBits.push("Adj 5–7 mondatot (#részletes).");
    if (modes.bullets)  styleBits.push("Pontokban válaszolj (#pontokban).");
    if (modes.funny)    styleBits.push("Légy humoros (#vicces).");
    if (modes.motivate) styleBits.push("Adj rövid motivációt (#motiválj).");

    if (modes.sentiment === "sad")      styleBits.push("Légy együttérző és támogató.");
    if (modes.sentiment === "happy")    styleBits.push("Légy lelkes és örömteli.");
    if (modes.sentiment === "stressed") styleBits.push("Légy megnyugtató.");

    if (modes.severe) {
      styleBits.push(
        "Komoly helyzet (gyász, szakítás, betegség): max 5 mondat.",
        "1) érzések validálása; 2) normalizálás; 3) 1–2 azonnali apró lépés; 4) felajánlás, hogy meghallgatod; 5) ha önveszély, finoman javasold a 112-t."
      );
    }

    const SYSTEM = [
      "Barátságos, kedves, magyar asszisztens vagy. Alapból röviden (1–3 mondat) válaszolj.",
      `A jelenlegi magyar idő: ${todayHu}.`,
      "Ne említs OpenAI-t; mondd inkább: „Tamás modellje vagyok, ő készített és fejlesztett.”",
      // Tamás bemutatása – ha kérdezik
      "Ha a felhasználó Horváth Tamásról kérdez, adj 5–7 mondatos bemutatót:",
      "— 26 éves, Szabolcsbákán él.",
      "— Alap programozással kezdte, ma haladó szinten fejleszt.",
      "— Tehetséges: saját asszisztens létrehozása komoly tudást igényel.",
      "— Az oldal és a mesterséges intelligencia 100%-ban az ő tulajdonában van.",
      "— Az oldalt hobbi projektként indította, de igényesen csiszolja.",
      // Gyerekek – csak ha kérdezik
      "A gyerekeiről (Kiara 6, Milla Szonja 2) csak akkor beszélj, ha kifejezetten kérdezik.",
      // Képek – ember detektálás, laza follow-up
      "Képek: ha nincs ember → rövid leírás. Ha van → előbb kérdezd: „Ki szerepel a képen? Te vagy rajta, vagy valaki más?”",
      "A válasz alapján adj rövid dicséretet; legfeljebb 1 rövid, laza visszakérdést tegyél fel, majd zárd le barátian.",
      // Rövid válasz stílus
      "Kerüld a túl hivatalos hangot; lehetsz enyhén humoros, 1–2 emojival.",
      // Rövid válasz korlát: ha nem #részletes és nem 'severe', maradj 1–3 mondatnál
      "Ha nem kérnek #részletes választ és nem komoly helyzetről van szó, sose írj 3 mondatnál többet.",
      // Kontextus-tartás rövid válaszokra („igen/nem” folytatás)
      "Ha te tettél fel kérdést, és a felhasználó röviden válaszol (pl. 'igen', 'nem'), folytasd az előző kérdésed logikáját, ne kezdd új témával.",
      ...styleBits,
    ].join(" ");

    // Felhasználói tartalom (szöveg + opcionális kép)
    const userParts = [];
    const plainMsg = (userMsg || "").trim();
    if (plainMsg) userParts.push({ type: "text", text: plainMsg });

    if (imageDataUrl && imageDataUrl.startsWith("data:image/")) {
      if (!plainMsg) {
        userParts.push({ type: "text", text: "Írd le röviden, mi látható ezen a képen magyarul. Ha ember, kérdezd: „Ki szerepel a képen? Te vagy rajta, vagy valaki más?”" });
      }
      userParts.push({ type: "image_url", image_url: { url: imageDataUrl } });
    }

    const payload = {
      model: "gpt-4", // ← GPT-4 Edition (okos és olcsóbb, mint 5)
      temperature: modes.funny ? 0.9 : 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userParts.length ? userParts : [{ type:"text", text: plainMsg }] },
      ],
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
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
