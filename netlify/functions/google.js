// netlify/functions/google.js
export async function handler(event) {
  try {
    const { query = "" } = JSON.parse(event.body || "{}");

    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Hiányzik a keresési lekérdezés (query)." }),
      };
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Hiányzik a Google API kulcs vagy a CX azonosító." }),
      };
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;

    const response = await fetch(url);
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "Google API hiba", detail: await response.text() }),
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ results: data.items || [] }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Hiba a Google keresés feldolgozásakor", detail: error.message }),
    };
  }
}
