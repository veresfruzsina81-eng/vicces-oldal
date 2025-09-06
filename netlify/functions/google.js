// netlify/functions/google.js

// Google CSE keresés frissesség szűréssel (utóbbi recencyDays nap)
export async function searchGoogle(query, { num = 8, recencyDays = 14 } = {}) {
  const key = process.env.GOOGLE_API_KEY;
  const cx  = process.env.GOOGLE_CX;
  if (!key || !cx) throw new Error("Google API kulcs vagy CX hiányzik.");

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(Math.max(num, 1), 10)));
  url.searchParams.set("safe", "off");
  url.searchParams.set("hl", "hu"); // magyar UI
  url.searchParams.set("gl", "hu"); // magyar lokációs bias

  // Csak friss találatok az utóbbi X napból, a legújabbak elöl
  if (recencyDays && recencyDays > 0) {
    url.searchParams.set("dateRestrict", `d${recencyDays}`);           // pl. d14
    url.searchParams.set("sort", `date:r:${formatSortRange(recencyDays)}`); // legújabbak
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google CSE hiba: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return (data.items || []).map(it => ({
    title: it.title,
    link : it.link,
    snippet: it.snippet || "",
  }));
}

// Oldal letöltés + egyszerű HTML → szöveg kivonat
export async function fetchPagePlainText(url, { maxChars = 16000 } = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Tamas-AI-Bot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let html = await res.text();

    // script/style/noscript ki
    html = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
               .replace(/<style[\s\S]*?<\/style>/gi, " ")
               .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

    // tagek le, entitások dekódolása
    let text = html.replace(/<\/?(?:[^>]+)?>/g, " ");
    text = text.replace(/&nbsp;/g, " ")
               .replace(/&amp;/g, "&")
               .replace(/&quot;/g, "\"")
               .replace(/&#39;/g, "'")
               .replace(/&lt;/g, "<")
               .replace(/&gt;/g, ">");
    text = text.replace(/\s+/g, " ").trim();

    if (text.length > maxChars) text = text.slice(0, maxChars) + " …";
    return { url, content: text };
  } catch (e) {
    return { url, content: "", error: String(e) };
  }
}

// pl. "date:r:20250823:20250906" – a sort paramhoz
function formatSortRange(recencyDays) {
  const end   = new Date();
  const start = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000);
  const fmt = (d) =>
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  return `${fmt(start)}:${fmt(end)}`;
}
