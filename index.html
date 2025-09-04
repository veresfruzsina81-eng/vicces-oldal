<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HT Chat — Kellemes beszélgetést!</title>
  <link rel="icon" href="data:image/svg+xml,\
  %3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23ff7a18'/%3E%3Ctext x='32' y='40' text-anchor='middle' font-size='32' font-family='Arial' fill='white'%3EHT%3C/text%3E%3C/svg%3E">
  <style>
    /* ---- Alap: az oldal ne görgessen, a chat része görgessen ---- */
    :root{
      --brand:#ff7a18;         /* narancs akcentus */
      --brand-2:#ffb347;       /* világos narancs */
      --bg-1:#0e0f13;          /* mély háttér */
      --glass: rgba(255,255,255,.08);
      --glass-2: rgba(255,255,255,.10);
      --text:#e9e9ee;
      --muted:#b9b9c6;
      --ok:#1ec46b;
      --danger:#ff5d5d;
      --radius:18px;
      --shadow: 0 10px 35px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.05);
    }
    html, body{height:100%;}
    html, body {margin:0; background: var(--bg-1); color: var(--text); overflow:hidden; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;}
    *{box-sizing:border-box}

    /* ---- 3D háttér canvas ---- */
    #bg{
      position:fixed; inset:0; z-index:-2;
      display:block; width:100%; height:100%;
      background: radial-gradient(1200px 800px at 10% -10%, #3a1d53 0%, transparent 60%),
                  radial-gradient(900px 700px at 110% 10%, #1c3a5a 0%, transparent 60%),
                  radial-gradient(1000px 800px at 50% 120%, #1f2a3b 0%, transparent 60%),
                  linear-gradient(180deg, #0b0c11 0%, #12131a 100%);
    }
    /* fényes film grain */
    .grain{
      position:fixed; inset:-50px; z-index:-1; pointer-events:none; opacity:.12;
      background-image: url('data:image/svg+xml;utf8,\
      <svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">\
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2"/></filter>\
      <rect width="100%" height="100%" filter="url(%23n)" opacity=".9"/></svg>');
      mix-blend-mode: soft-light;
      animation: drift 30s linear infinite;
    }
    @keyframes drift{from{transform:translate3d(0,0,0)} to{transform:translate3d(-140px,-140px,0)}}

    /* ---- Oldal keret ---- */
    .app{
      min-height:100vh; display:flex; flex-direction:column; gap:16px;
      padding: clamp(16px, 2vw, 24px);
    }
    header{
      padding: 10px 14px 0 14px;
    }
    h1{
      margin:0 0 6px 0;
      font-weight:800;
      letter-spacing:.3px;
      font-size: clamp(26px, 3.6vw, 38px);
      text-shadow: 0 2px 0 rgba(0,0,0,.25);
    }
    .accent{
      background: linear-gradient(90deg, var(--brand) 0%, var(--brand-2) 80%);
      -webkit-background-clip: text; background-clip:text; color: transparent;
      filter: drop-shadow(0 2px 0 rgba(0,0,0,.35));
    }
    .subtitle{
      color: var(--muted); font-size: 14px; opacity:.95
    }

    /* ---- Chat shell: csak ez a blokk legyen görgethető ---- */
    .chat-shell{
      flex:1; min-height:0; display:flex; flex-direction:column; gap:10px;
      max-width: 980px; width:100%; margin: 0 auto;
    }
    .panel{
      backdrop-filter: blur(14px) saturate(120%);
      background: linear-gradient(180deg, var(--glass) 0%, rgba(255,255,255,.04) 100%);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid rgba(255,255,255,.06);
    }

    /* ---- Felső gyors-akciók ---- */
    .toolbar{
      display:flex; align-items:center; gap:14px; padding: 10px 14px; flex-wrap: wrap;
    }
    .control{
      display:inline-flex; align-items:center; gap:8px; padding:8px 12px;
      border-radius:12px; background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.07);
      color: var(--text); font-size: 14px; cursor:pointer; user-select:none;
      transition: transform .12s ease, background .2s ease;
    }
    .control:hover{ transform: translateY(-1px); background: rgba(255,255,255,.10); }

    /* ---- Üzenetek ---- */
    .messages{
      flex:1; min-height:0; overflow-y:auto; padding: 16px;
      display:flex; flex-direction:column; gap:10px;
    }
    .bubble{
      max-width: 90%; width: fit-content;
      padding: 12px 14px; border-radius:16px; line-height:1.45;
      background: rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.08);
      box-shadow: 0 6px 18px rgba(0,0,0,.25);
      white-space: pre-wrap;
    }
    .user{ margin-left:auto; background: linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.06)); }
    .bot{  margin-right:auto; }
    .error{ border-color: rgba(255,0,0,.35); background: rgba(255,0,0,.12) }

    /* ---- Input sáv mindig alul marad ---- */
    .input-bar{
      padding: 10px;
      display:flex; gap:10px; align-items:flex-end;
    }
    .ta-wrap{
      position:relative; flex:1;
      border-radius:14px; overflow:hidden;
      background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.09);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.03), 0 6px 18px rgba(0,0,0,.25);
    }
    textarea{
      width:100%; background: transparent; border:0; outline:0;
      color: var(--text); padding: 12px 12px 14px 12px; font-size:15px;
      resize:none; line-height:1.5; max-height:160px; overflow-y:auto;
    }
    .hint{
      position:absolute; left:12px; bottom:6px; font-size:12px; color:var(--muted);
      pointer-events:none; user-select:none;
    }
    button.send{
      background: linear-gradient(90deg, var(--brand), var(--brand-2));
      color:#111; font-weight:700; border:0; padding: 12px 16px; border-radius:12px; cursor:pointer;
      box-shadow: 0 8px 24px rgba(255,122,24,.35);
      transition: transform .1s ease, filter .2s ease, box-shadow .2s ease;
    }
    button.send:disabled{ filter:saturate(.3) brightness(.7); cursor:not-allowed; box-shadow:none; }
    button.send:hover:not(:disabled){ transform: translateY(-1px); }

    /* Görgetősáv finom */
    .messages{ scrollbar-width:thin; scrollbar-color: rgba(255,255,255,.25) transparent; }
    .messages::-webkit-scrollbar{width:10px}
    .messages::-webkit-scrollbar-thumb{ background: rgba(255,255,255,.18); border-radius:8px; }
    .messages::-webkit-scrollbar-track{ background: transparent; }

    /* Mobil kényelmesebb padding */
    @media (max-width: 640px){
      .toolbar{gap:8px}
      .messages{padding:12px}
      .input-bar{padding:8px}
    }
  </style>
</head>
<body>
  <!-- 3D háttér (canvas + finom szemcsézés) -->
  <canvas id="bg" aria-hidden="true"></canvas>
  <div class="grain" aria-hidden="true"></div>

  <div class="app">
    <header>
      <h1><span class="accent">HT Chat</span> — Kellemes beszélgetést! 🥳</h1>
      <div class="subtitle">Az oldalt létre hozta <strong>H.T</strong> — egyedi fejlesztéssel.</div>
    </header>

    <main class="chat-shell panel">
      <!-- felső sáv: gyors akciók -->
      <div class="toolbar">
        <button id="copyBtn" class="control" type="button">📋 Másolás (utolsó válasz)</button>
        <label class="control" style="gap:10px;">
          <input id="ttsToggle" type="checkbox" />
          Hang (felolvasás)
        </label>
        <span id="status" style="color:var(--muted); font-size:14px;"></span>
      </div>

      <!-- beszélgetéslista – CSAK ez görgessen -->
      <section id="messages" class="messages" aria-live="polite" aria-label="Beszélgetés">
        <div class="bubble bot">Szia! Írj egy üzenetet, és válaszolok. 😊</div>
      </section>

      <!-- input sáv – mindig alul -->
      <div class="input-bar">
        <div class="ta-wrap">
          <textarea id="input" rows="1" placeholder="Írj ide..."></textarea>
          <div class="hint">Tipp: Enter = küldés, Shift+Enter = új sor</div>
        </div>
        <button id="send" class="send" type="button">Küldés</button>
      </div>
    </main>
  </div>

  <script>
    /* ====== 3D háttér – lebegő „gömbök” mélységgel ====== */
    (() => {
      const c = document.getElementById('bg');
      const ctx = c.getContext('2d', { alpha: false });
      let w, h, dpr;
      const balls = [];
      const BALLS = 38;

      function resize(){
        dpr = Math.min(2, window.devicePixelRatio || 1);
        w = c.width = innerWidth * dpr;
        h = c.height = innerHeight * dpr;
        c.style.width = innerWidth + 'px';
        c.style.height = innerHeight + 'px';
      }
      resize(); addEventListener('resize', resize);

      function rand(a,b){ return a + Math.random()*(b-a); }
      for(let i=0;i<BALLS;i++){
        balls.push({
          x: rand(0, w), y: rand(0,h),
          r: rand(30, 120),
          z: rand(0.4, 1.4),  // mélység (1=közel)
          vx: rand(-0.25,0.25), vy: rand(-0.25,0.25),
          hue: rand(15, 260)
        });
      }

      function tick(){
        ctx.clearRect(0,0,w,h);
        for(const b of balls){
          b.x += b.vx * b.z; b.y += b.vy * b.z;
          if(b.x < -200 || b.x > w+200) b.vx *= -1;
          if(b.y < -200 || b.y > h+200) b.vy *= -1;

          const r = b.r * b.z;
          // lágy fény-átmenet
          const g = ctx.createRadialGradient(b.x, b.y, r*0.1, b.x, b.y, r);
          g.addColorStop(0, `hsla(${b.hue}, 80%, ${35 + b.z*20}%, .65)`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI*2); ctx.fill();
        }
        requestAnimationFrame(tick);
      }
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches){ tick(); }
    })();

    /* ====== Chat kliens ====== */
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn  = document.getElementById('send');
    const copyBtn  = document.getElementById('copyBtn');
    const ttsToggle = document.getElementById('ttsToggle');
    const statusEl = document.getElementById('status');

    let lastBotText = '';

    function addBubble(text, who='bot', isError=false){
      const div = document.createElement('div');
      div.className = `bubble ${who}${isError?' error':''}`;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight; // csak a lista gördül
      if(who==='bot'){ lastBotText = text; if(ttsToggle.checked) speak(text); }
    }

    async function send(){
      const text = inputEl.value.trim();
      if(!text) return;
      addBubble(text, 'user');
      inputEl.value=''; autoGrow();

      sendBtn.disabled = true; statusEl.textContent = 'Küldés…';
      try{
        const r = await fetch('/.netlify/functions/chat', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ messages: [{role:'user', content:text}] })
        });
        const data = await r.json();
        if(!r.ok) throw new Error(data && (data.error || data.message) || ('HTTP '+r.status));
        const reply = (data.reply || data.choices?.[0]?.message?.content || '').trim();
        addBubble(reply || 'Rendben.', 'bot');
      }catch(err){
        addBubble('Hiba: ' + err.message, 'bot', true);
      }finally{
        sendBtn.disabled = false; statusEl.textContent = '';
      }
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }
    });

    /* textarea auto-magasság, de max 160px */
    function autoGrow(){
      inputEl.style.height='auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    }
    inputEl.addEventListener('input', autoGrow); autoGrow();

    /* Másolás az utolsó bot válaszból */
    copyBtn.addEventListener('click', async ()=>{
      if(!lastBotText){ return; }
      try{ await navigator.clipboard.writeText(lastBotText);
           flashStatus('Kimásolva!', 'ok'); }
      catch{ flashStatus('A másolás nem sikerült.', 'err'); }
    });
    function flashStatus(msg, t='ok'){
      statusEl.textContent = msg;
      statusEl.style.color = t==='ok' ? 'var(--ok)' : 'var(--danger)';
      setTimeout(()=>{ statusEl.textContent=''; statusEl.style.color='var(--muted)'; }, 1600);
    }

    /* Egyszerű TTS magyar hanggal (ha van) */
    function speak(text){
      if(!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      const pickVoice = () => {
        const voices = speechSynthesis.getVoices();
        let v = voices.find(v=>/hu|hungarian/i.test(v.lang)) || voices[0];
        if(v) u.voice = v;
        speechSynthesis.speak(u);
      };
      if(speechSynthesis.getVoices().length) pickVoice();
      else speechSynthesis.onvoiceschanged = pickVoice;
    }
  </script>
</body>
</html>
