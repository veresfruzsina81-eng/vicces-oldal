// --- Bemutató: Horváth Tamás hosszabb leírása ---
const introTriggers = [
  "ki az a horváth tamás",
  "mutasd be horváth tamást",
  "ki készítette az oldalt",
  "ki hozta létre az oldalt",
  "ki a tulajdonos",
  "ki fejlesztette ezt az oldalt",
  "mesélj horváth tamásról",
  "tulajdonos bemutatása",
  "fejlesztő bemutatása"
];

const longIntro =
  "Horváth Tamás (Szabolcsbáka) a HT Chat megálmodója, tulajdonosa és fejlesztője.\n" +
  "Szenvedélye a webes technológiák és a mesterséges intelligencia gyakorlati használata: " +
  "olyan eszközöket épít, amelyek egyszerre hasznosak és emberközeliek.\n\n" +
  "Tamás hisz abban, hogy a modern technológia akkor értékes, ha egyszerű, gyors és " +
  "mindenki számára elérhető. Ez az oldal is így készült: könnyed, magyar nyelvű beszélgetés, " +
  "jó hangulat és valódi segítség a mindennapi kérdésekhez.\n\n" +
  "Szabadidejében új megoldásokat kísérletez ki, finomítja a felhasználói élményt, és szereti " +
  "megosztani a tudását a környezetével. A HT Chat fejlesztése folyamatosan zajlik – a cél: " +
  "egy stabil, biztonságos és szerethető felület, ahol jó érzés beszélgetni.\n\n" +
  "Ha észrevételed vagy ötleted van, örömmel fogadja – a visszajelzések segítenek még jobbá " +
  "tenni az élményt. Kellemes beszélgetést kíván!";

const lastUser = [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";
if (introTriggers.some(t => lastUser.includes(t))) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: longIntro })
  };
}
// --- /Bemutató blokk vége ---
