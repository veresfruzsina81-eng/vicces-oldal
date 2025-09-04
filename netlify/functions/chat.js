/* ====== Tamás AI – Chat kliens ====== */

/* DOM */
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const themeBtn = document.getElementById('themeBtn');
const qqWrap = document.getElementById('qqWrap');

/* Light/Dark (auto -> felhasználó dönt) */
(function initTheme(){
  const saved = localStorage.getItem('t_theme');
  if(saved){ document.documentElement.classList.toggle('light', saved === 'light'); }
  themeBtn.addEventListener('click', ()=>{
    const nowLight = !document.documentElement.classList.contains('light');
    document.documentElement.classList.toggle('light', nowLight);
    localStorage.setItem('t_theme', nowLight ? 'light' : 'dark');
  });
})();

/* Hang – TTS */
function speak(text){
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'hu-HU';
    u.rate = 1.02;
    u.pitch = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){/* nincs TTS */}
}

/* Másolás */
async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}

/* Üzenet hozzáadása */
function addMsg(text, who='bot'){
  const wrap = document.createElement('div');
  wrap.className = `msg ${who}`;
  wrap.innerText = text;
  chat.appendChild(wrap);

  if(who === 'bot'){
    const actions = document.createElement('div');
    actions.className = 'actions';

    const speakBtn = document.createElement('button');
    speakBtn.className = 'chip speak';
    speakBtn.textContent = '🔊 Felolvasás';
    speakBtn.addEventListener('click', ()=>speak(text));

    const copyBtn  = document.createElement('button');
    copyBtn.className = 'chip copy';
    copyBtn.textContent = '📋 Másolás';
    copyBtn.addEventListener('click', ()=>copyText(text));

    actions.appendChild(speakBtn);
    actions.appendChild(copyBtn);
    wrap.appendChild(actions);
  }

  // Auto scroll
  wrap.scrollIntoView({behavior:'smooth', block:'end'});
  return wrap;
}

/* Tipográfia – kis figyelmes válasz javítások */
function localRules(q){
  const t = q.trim().toLowerCase();

  if(/ki (készítette|hozta létre)/.test(t)){
    return "Az oldalt Horváth Tamás készítette hobbifejlesztésként. Folyamatosan tanul és kísérletezik webes projektekkel. 🙂";
  }
  if(/milyen modell (vagy|vagy\?)/.test(t) || t === 'milyen modell vagy?'){
    return "Tamás modellje vagyok: egy barátságos magyar asszisztens, akit Tamás készített és fejleszt. Az a dolgom, hogy segítsek neked bármiben. 🤝";
  }
  if(/mi a mai dátum|milyen dátum van ma/.test(t)){
    const d = new Date();
    const opts = {year:'numeric', month:'2-digit', day:'2-digit', weekday:'long'};
    return `Ma ${d.toLocaleDateString('hu-HU', opts)}.`;
  }
  return null;
}

/* Küldés */
async function send(){
  const text = input.value.trim();
  if(!text) return;

  // quick kérdések eltüntetése első írás után
  if(qqWrap) qqWrap.style.display = 'none';

  addMsg(text, 'user');
  input.value = '';

  // gépel jelzés
  const typing = addMsg('Írok…', 'bot');

  // 1) helyi szabály?
  const lr = localRules(text);
  if(lr){
    typing.remove();
    addMsg(lr, 'bot');
    return;
  }

  // 2) Netlify/OpenAI hívás
  try{
    const r = await fetch('/.netlify/functions/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: text })
    });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    typing.remove();
    if(data && data.reply){
      addMsg(data.reply, 'bot');
    }else{
      addMsg("Hopp, most nem kaptam választ a háttérből. Próbáld újra egy pillanat múlva! 🙏", 'bot');
    }
  }catch(err){
    typing.remove();
    addMsg("Hálózati hiba történt. Ellenőrizd az internetet vagy a szervert, és próbáld újra! (Ha szeretnéd, ideiglenesen demo választ is tudok adni.)", 'bot');
  }
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});

/* Quick kérdések kattintásra menjenek az inputba/küldésre */
if(qqWrap){
  qqWrap.addEventListener('click', (e)=>{
    const b = e.target.closest('.qq');
    if(!b) return;
    input.value = b.textContent.trim();
    send();
  });
}
