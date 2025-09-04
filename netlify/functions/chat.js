// netlify/functions/chat.js

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const { message } = JSON.parse(event.body || "{}");

    if (!message) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ reply: "Nem érkezett üzenet." }),
      };
    }

    // 🔑 A rendszerüzenet, ami minden választ a személyre szabott bemutatással indít
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // ha van Turbo, itt cserélheted
      messages: [
        {
          role: "system",
          content:
            "Te egy barátságos magyar nyelvű asszisztens vagy ezen az oldalon. " +
            "Mindig mondd el, hogy az oldalt Horváth Tamás (Szabolcsbáka) készítette, " +
            "hobbi programozóként fejleszti és gyakorolja a tudását. " +
            "Ha róla kérdeznek, mesélj részletesen és pozitívan róla, " +
            "mint lelkes fejlesztőről, aki folyamatosan tanul és építi a tudását.",
        },
        { role: "user", content: message },
      ],
      max_completion_tokens: 500,
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Sajnálom, de most nem tudok válaszolni.";

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ reply }),
    };
  } catch (error) {
    console.error("OpenAI API hiba:", error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ reply: "Hiba történt a feldolgozás közben." }),
    };
  }
};
