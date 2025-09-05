// netlify/functions/bing.js
export const handler = async (event) => {
  try {
    const key = process.env.BING_API_KEY;
    if (!key) {
      return { statusCode: 500, body: JSON.stringify({ error: "Hiányzik a BING_API_KEY." }) };
    }

    const q = (event.queryStringParameters && event.queryStringParameters.q) ? event.queryStringParameters.q.trim() : "";
    if (!q) {
      return { statusCode: 400, body: JSON.stringify({ error: "Add meg a q paramétert." }) };
    }

    const url = new URL("https://api.bing.microsoft.com/v7.0/search");
    url.searchParams.set("mkt", "hu-HU");
    url.searchParams.set("q", q);

    const res = await fetch(url.toString(), {
      headers: { "Ocp-Apim-Subscription-Key": key }
    });

    if (!res.ok) {
      const txt = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: "Bing hiba", detail: txt }) };
    }

    const json = await res.json();

    const items = (json.webPages?.value || []).slice(0, 5).map(v => ({
      title: v.name,
      url: v.url,
      snippet: v.snippet
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, items })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Szerver hiba", detail: String(e) }) };
  }
};
