<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>HT Chat — Kellemes beszélgetést!</title>
  <meta name="theme-color" content="#0d1017" />
  <style>
    :root{
      --bg1:#0d1017; --bg2:#141a24; --text:#e9edf4; --muted:#aab3c2;
      --card:#121826; --card2:#0f1521; --border:#223049;
      --accent:#ff8a1f; --accent2:#ffb256; --ok:#29c48a; --err:#ff6b6b;
      --shadow:0 10px 30px rgba(0,0,0,.35);
      --r:16px;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0; color:var(--text); font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      background:
        radial-gradient(1200px 700px at 90% -10%, #1f2744 0%, transparent 60%),
        radial-gradient(1000px 700px at 0% 100%, #14362a 0%, transparent 60%),
        linear-gradient(160deg, var(--bg1), var(--bg2));
      background-attachment: fixed;
      -webkit-font-smoothing: antialiased;
    }
    .wrap{max-width:1100px; margin:22px auto; padding:0 16px}
    header{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:14px}
    h1{margin:0; font-size:clamp(28px,4.4vw,46px); color:var(--accent); text-shadow:0 2px 0 #0007}
    .sub{color:var(--muted)}

    /* Chat kártya (nagyobb) */
    .card{
      background:linear-gradient(180deg, #1b2334, #0f1521);
      border:1px solid var(--border); border-radius:var(--r); box-shadow:var(--shadow);
      padding:12px;
    }
    .toolbar{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:8px 6px}
    .switch{display:inline-flex; gap:8px; align-items:center; background:#0d1322; border:1px solid var(--border);
            padding:8px 10px; border-radius:999px; color:#dfe6f3}
    .switch input{accent-color: var(--accent); transform:scale(1.1)}
    .tip{margin-left:auto; color:var(--muted); font-size:.95rem}

    .chat{
      height:min(72vh,760px); overflow:auto; padding:10px; scroll-behavior:smooth;
      background:#0f1626; border:1px solid var(--border); border-radius:12px;
      display:flex; flex-direction:column;
    }
    .row{display:flex; margin:10px 0}
    .row.user{justify-content:flex-end}
    .row.info{justify-content:center}
    .bubble{
      max-width:78%; padding:12px 14px; border-radius:14px; box-shadow: 0 6px 18px rgba(0,0,0,.25);
      border:1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.06); backdrop-filter: blur(6px);
    }
    .row.user .bubble{background: linear-gradient(180deg, var(--accent), var(--accent2)); color:#1d1209; border:none}
    .row.err .bubble{background:#3a1f24; border-color:#6a2b36}
    .row.info .bubble{background:#142a22; border-color:#1d6d4e}

    .inputbar{display:flex; gap:10px; align-items:center; margin-top:10px; background:#0c1424; border:1px solid var(--border); border-radius:12px; padding:8px}
    .inputbar input{flex:1; background:transparent; border:none; outline:none; color:var(--text); padding:10px; font-size:1rem}
    .btn{background: linear-gradient(180deg, var(--accent), var(--accent2)); color:#1b1209; border:none; border-radius:10px; padding:10px 14px; font-weight:700; cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,.25)}
    .btn:disabled{opacity:.6; cursor:not-allowed}

    /* Lebegő mikrofon + MODAL */
    .fab{position:fixed; right:20px; bottom:20px; z-index:50}
    .fab button{
      width:64px; height:64px; border-radius:50%; border:none; cursor:pointer; color:#111; font-size:24px; font-weight:900;
      background: radial-gradient(circle at 30% 30%, #fff2, #0000), linear-gradient(135deg, #ff8a1f, #ff5757);
      box-shadow:0 14px 36px rgba(0,0,0,.45);
    }
    .modal{
      position:fixed; inset:0; z-index:60; display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,.5); backdrop-filter: blur(2px);
    }
    .modal.open{display:flex}
    .sheet{
      width:min(560px, 94vw); background:linear-gradient(180deg,#162035,#0f1523); border:1px solid var(--border);
      border-radius:20px; box-shadow:0 28px 60px rgba(0,0,0,.55); padding:18px; color:var(--text);
      display:grid; gap:14px; animation:pop .18s ease-out both;
    }
    @keyframes pop{from{transform:scale(.98);opacity:.0} to{transform:scale(1);opacity:1}}

    .sheet header{display:flex; gap:10px; align-items:center; justify-content:space-between}
    .xbtn{background:#0f1626; border:1px solid var(--border); color:#dfe6f3; border-radius:10px; padding:8px 12px; cursor:pointer}
    .rowc{display:flex; gap:12px; align-items:center; flex-wrap:wrap}

    /* nagy kör alakú mikrofongomb pulzálással */
    .micwrap{display:grid; place-items:center; padding:6px; margin:6px 0}
    .micbtn{
      width:120px; height:120px; border-radius:50%; border:none; cursor:pointer; color:#111; font-size:28px; font-weight:900;
      background: radial-gradient(circle at 30% 30%, #fff3, #0000), linear-gradient(135deg, #ff8a1f, #ff5757);
      box-shadow:0 18px 50px rgba(0,0,0,.45), inset 0 1px 0 #ffffff66;
      transition: transform .1s ease;
    }
    .micbtn:active{transform: scale(.98)}
    .pulse{position:relative}
    .pulse::after{
      content:""; position:absolute; inset:-10px; border-radius:999px; border:2px solid #ff8a1f99; opacity:.7;
      animation:pulse 1.6s ease-out infinite;
    }
    @keyframes pulse{ 0%{transform:scale(1); opacity:.7} 100%{transform:scale(1.25); opacity:0} }

    .tog{display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; background:#10182a; border:1px solid var(--border); cursor:pointer}
    .tog input{accent-color:var(--accent); transform:scale(1.1)}
    .hint{color:var(--muted); font-size:.95rem}

    @media (max-width:720px){
      .chat{height:66vh}
      .bubble{max-width:88%}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>HT Chat — Kellemes beszélgetést! 🥳</h1>
      <div class="sub">Az oldalt létrehozta <strong>H.T</strong> — egyedi fejlesztéssel.</div>
    </header>

    <section class="card">
      <div class="toolbar">
        <label class="switch"><input id="copyToggle" type="checkbox"> Másolás (utolsó válasz)</label>
        <label class="switch"><input id="ttsToggle" type="checkbox"> Hang (felolvasás)</label>
        <span class="tip">Tipp: Enter = küldés, Shift+Enter = új sor</span>
      </div>

      <div id="chat" class="chat" aria-live="polite"></div>

      <form id="form" class="inputbar" autocomplete="off">
        <input id="msg" placeholder="Írj ide…" />
        <button class="btn">Küldés</button>
      </form>
    </section>
  </div>

  <!-- Lebegő mikrofon gomb -->
  <div class="fab"><button id="openVoice" title="Hangos asszisztens">🎤</button></div>

  <!-- Modern felugró (modal) Voice UI -->
  <div id="voiceModal" class="modal" role="dialog" aria-label="Hangos asszisztens">
    <div class="sheet">
      <header>
        <div style="font-weight:800; letter-spacing:.3px">Hangos asszisztens — magyar</div>
        <button class="xbtn" id="closeVoice">Bezár</button>
      </header>

      <div class="micwrap">
        <button id="mic" class="micbtn" title="Indítás / Leállítás">🎙️</button>
      </div>

      <div class="rowc">
        <label class="tog"><input id="autoMode" type="checkbox"> Folyamatos mód</label>
        <label class="tog"><input id="muteMode" type="checkbox"> Néma (ne olvassa fel)</label>
      </div>

      <div class="hint" id="vState">Állapot: inaktív. Tipp: Chrome/Edge + HTTPS. Első indításkor engedélyezd a mikrofont!</div>
    </div>
  </div>

  <script>
    // ------- Chat alapok -------
    const chat = document.getElementById('chat');
    const form = document.getElementById('form');
    const msg = document.getElementById('msg');
    const copyToggle = document.getElementById('copyToggle');
    const ttsToggle = document.getElementById('ttsToggle');

    let lastBot = '';

    function addRow(text, who='bot'){
      const row = document.createElement('div'); row.className = 'row ' + (who==='user'?'user':(who==='info'?'info':(who==='err'?'err':'')));
      const b = document.createElement('div'); b.className='bubble'; b.textContent = text;
      row.appendChild(b); chat.appendChild(row);
      chat.scrollTop = chat.scrollHeight;
      if (who==='bot'){ lastBot = text; if (ttsToggle.checked) speak(text); }
    }

    function speak(text){
      if (voiceMuted()) return; // ha némítva, ne beszéljen
      try{
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'hu-HU'; u.rate=1; u.pitch=1; u.volume=1;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      }catch{}
    }

    addRow('Szia! Írj bátran, miben segíthetek? Itt vagyok neked, segítek bármiben. 😊','info');

    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const text = (msg.value||'').trim(); if(!text) return;
      addRow(text,'user'); msg.value='';

      try{
        const r = await fetch('/.netlify/functions/chat', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ message: text })
        });
        if(!r.ok) throw new Error('HTTP '+r.status);
        const data = await r.json();
        const reply = (data.reply||'').toString() || 'Értem. Miben segíthetek még?';
        addRow(reply,'bot');
        if(copyToggle.checked){ try{ await navigator.clipboard.writeText(reply); }catch{} }
      }catch(err){
        addRow('Hiba: '+(err.message||err),'err');
      }
    });

    // ------- Modern modal Voice UI -------
    const openVoice = document.getElementById('openVoice');
    const voiceModal = document.getElementById('voiceModal');
    const closeVoice = document.getElementById('closeVoice');
    const micBtn = document.getElementById('mic');
    const autoCb = document.getElementById('autoMode');
    const muteCb = document.getElementById('muteMode');
    const vState = document.getElementById('vState');

    openVoice.addEventListener('click', ()=> voiceModal.classList.add('open'));
    closeVoice.addEventListener('click', ()=> stopAuto(true));

    function voiceMuted(){ return muteCb.checked || !ttsToggle.checked; }

    // STT — folyamatos mód támogatással
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null, listening = false, autoOn = false;
    let lastHeardAt = Date.now(), silenceTimer = null;
    const SILENCE_PROMPT_SEC = 20;

    function setState(txt){ vState.textContent = 'Állapot: ' + txt; }

    function startSilenceWatcher(){
      clearInterval(silenceTimer);
      silenceTimer = setInterval(()=>{
        if (!autoOn) return;
        const idle = (Date.now() - lastHeardAt)/1000;
        if (idle >= SILENCE_PROMPT_SEC){
          lastHeardAt = Date.now();
          speak('Szeretnél valamit kérdezni? Itt vagyok, szívesen segítek.');
        }
      }, 1000);
    }

    function ensureRec(){
      if (!SR) { setState('nem támogatott (Chrome/Edge ajánlott)'); micBtn.disabled=true; return null; }
      if (rec) return rec;
      rec = new SR(); rec.lang='hu-HU'; rec.continuous=true; rec.interimResults=false;
      rec.onstart = ()=>{ listening=true; micBtn.classList.add('pulse'); setState('hallgatok… mondd bátran'); };
      rec.onend   = ()=>{ listening=false; micBtn.classList.remove('pulse'); setState(autoOn?'újraindítom…':'inaktív'); if (autoOn){ try{ rec.start(); }catch{} } };
      rec.onerror = (e)=>{ setState('hiba: '+(e.error||'ismeretlen')); };
      rec.onresult = async (ev)=>{
        const res = ev.results[ev.results.length-1];
        if (!res || !res.isFinal) return;
        const said = (res[0]?.transcript || '').trim();
        if (!said) return;
        lastHeardAt = Date.now();

        // naplózzuk a kérdést a fő chatbe (csak a user buborék)
        addRow('🎤 ' + said, 'user');

        try{
          const r = await fetch('/.netlify/functions/chat', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ message: said })
          });
          const data = await r.json();
          if(!r.ok || data.error) throw new Error(data.error || ('HTTP '+r.status));
          const reply = (data.reply||'').toString() || 'Rendben.';
          // HANG: csak felolvassuk, nem jelenítjük meg külön
          speak(reply);
          lastHeardAt = Date.now();
        }catch(err){
          speak('Elnézést, hiba történt.');
        }
      };
      return rec;
    }

    async function startOnce(){
      const inst = ensureRec(); if(!inst) return;
      try{
        await navigator.mediaDevices.getUserMedia({audio:true});
        inst.start();
      }catch{
        setState('kérlek engedélyezd a mikrofont a böngészőben');
      }
    }

    function startAuto(){
      autoOn = true; lastHeardAt = Date.now(); startSilenceWatcher();
      startOnce();
      voiceModal.classList.add('open');
    }
    function stopAuto(close=false){
      autoOn = false; clearInterval(silenceTimer);
      try{ rec && rec.stop(); }catch{}
      setState('inaktív');
      if(close) voiceModal.classList.remove('open');
    }

    micBtn.addEventListener('click', ()=>{
      if(!listening){ // indítás
        autoCb.checked ? startAuto() : startOnce();
      }else{ // leállítás
        stopAuto(false);
      }
    });

    autoCb.addEventListener('change', ()=>{
      if (autoCb.checked && voiceModal.classList.contains('open') && !listening){
        startAuto();
      }else if(!autoCb.checked && autoOn){
        stopAuto(false);
      }
    });

    // ha a modalt a háttérre kattintva zárnád:
    voiceModal.addEventListener('click', (e)=>{ if(e.target===voiceModal) stopAuto(true); });
  </script>
</body>
</html>
