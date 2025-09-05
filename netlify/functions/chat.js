// public/js/chat.js
// Feltételezzük, hogy van input mező (textarea/input) és egy "küldés" gomb, és egy chat-lista renderelés.

window.__lastIntent = null; // ide mentjük a szerver által visszaküldött intentet

async function sendMessage(userText) {
  addBubble(userText, "user"); // saját UI-d: felhasználói buborék

  try {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userText,
        context: { last_intent: window.__lastIntent || null }
      })
    });

    const data = await res.json();
    const reply = data?.answer || "Hiba történt, próbáld meg később.";
    addBubble(reply, "bot");   // saját UI-d: bot buborék

    // Mentjük a legutóbbi intentet, ha kaptunk
    if (data?.meta?.intent) {
      window.__lastIntent = data.meta.intent;
    } else if (data?.meta?.last_intent) {
      window.__lastIntent = data.meta.last_intent;
    }
  } catch (e) {
    console.error("chat fetch error:", e);
    addBubble("Hálózati hiba. Próbáld újra kicsit később.", "bot");
  }
}

// Példa: űrlapkezelés (illeszd a sajátodhoz)
document.getElementById("chat-form")?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = document.getElementById("chat-input");
  const text = (input?.value || "").trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
});

// Segédfüggvény: UI-hoz illeszd
function addBubble(text, who) {
  // Itt a saját megvalósításod van; placeholder:
  const list = document.getElementById("chat-list");
  const li = document.createElement("li");
  li.className = who === "user" ? "me" : "bot";
  li.textContent = text;
  list?.appendChild(li);
  list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
}
