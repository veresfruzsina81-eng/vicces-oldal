// ===== Alap elemek =====
const msgs   = document.getElementById('msgs');
const input  = document.getElementById('input');
const form   = document.getElementById('composer');

const STORE_KEY = 'tamas_chat_v2';
let history = loadHistory();

// Kezdő üzenet (csak ha üres)
if (history.length === 0) {
  addBot("Szia! Itt vagyok neked, segítek mindenben. Írj bátran! 😊");
  saveHistory();
} else {
  for (const m of history) {
    if (m.role === 'user') addUser(m.text, false);
    else addBot(m.text, false);
  }
  scrollToBottom();
}

// ===== Események =====
form.addEventListener('submit', (e)=>{
  e.preventDefault();
  send();
});
input.addEventListener('keydown', e=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    send();
  }
});

// ===== UI segédek =====
function addRow(html){
  const d=document.createElement('div');
  d.className='row';
  d.innerHTML=html;
  msgs.appendChild(d);
}

function addUser(text, persist = true){
  addRow(`<div class="msg user">${escapeHtml(text)}</div>`);
  if (persist) {
    history.push({role:'user', text});
    saveHistory();
  }
  scrollToBottom();
}

function addBot(text, persist = true){
  const id = 'm'+Math.random().toString(36).slice(2);
  addRow(`
    <div class="msg bot" id="${id}">
      ${escapeHtml(text)}
      <div class="msg-tools">
        <button class="tool" onclick="speak('${id}')">${icon('speaker')} Felolvasás</button>
        <button class="tool" onclick="copyMsg('${id}')">${icon('copy')} Másolás</button>
      </div>
    </div>
  `);
  if (persist) {
    history.push({role:'bot', text});
    saveHistory();
  }
  scrollToBottom();
}

function typingBubble(){
  const id = 'm'+Math.random().toString(36).slice(2);
  addRow(`<div class="msg bot" id="${id}">Gondolkodom…</div>`);
  scrollToBottom();
  return id;
}

function updateTyping(id, text){
  const el = document.getElementById(id);
  if (el) el.outerHTML = '';
  addBot(text);
}

function scrollToBottom(){ msgs.scrollTop = msgs.scrollHeight; }

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function icon(which){
  if(which==='copy') return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9h2a7 7 0 0 1 14 0h2a9 9 0 0 0-9-9zm-7 9a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0H5z"/></svg>`;
}

window.copyMsg = (id)=>{
  const el = document.getElementById(id);
  const txt = el?.childNodes[0]?.textContent || '';
  navigator.clipboard.writeText(txt).then(()=> toast("Szöveg kimásolva!"));
};

window.speak = (id)=>{
  try{
    const txt = document.getElementById(id).childNodes[0].textContent;
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'hu-HU';
    u.rate = 1.02;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){}
};

function toast(msg){
  const t=document.createElement('div');
  t.textContent=msg;
  Object.assign(t.style,{
    position:'fixed', left:'50%', bottom:'24px', transform:'translateX(-50%)',
    background:'rgba(0,0,0,.7)', color:'#fff', padding:'10px 14px', borderRadius:'12px',
    boxShadow:'0 8px 24px rgba(0,0,0,.3)', zIndex:50
  });
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),1400);
}

// ===== Küldés – valós backend hívás a Te Netlify functionodra =====
async function send(){
  const text = input.value.trim();
  if(!text) return;
  addUser(text);
  input.value='';

  const typingId = typingBubble();

  try{
    const r = await fetch('/.netlify/functions/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: text, history })
    });

    if(!r.ok){
      const errTxt = await r.text().catch(()=> '');
      throw new Error('HTTP '+r.status+' '+errTxt);
    }

    const data = await r.json();
    const reply = (data.reply || 'Rendben!').toString();

    updateTyping(typingId, reply);
  }catch(err){
    console.error(err);
    updateTyping(typingId, 'Bocsi, most épp nem érem el a szervert. Mondd el másképp, mit szeretnél pontosan? 😊');
  }
}

// ===== Mentés / betöltés =====
function loadHistory(){
  try{
    const s = localStorage.getItem(STORE_KEY);
    return s ? JSON.parse(s) : [];
  }catch(_){ return []; }
}
function saveHistory(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(history)); }catch(_){}
}
