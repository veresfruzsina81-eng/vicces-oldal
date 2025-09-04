<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HT Chat — Kellemes beszélgetést!</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22%23ff9d37%22/></svg>">

  <style>
    :root{
      --glass: rgba(20,20,20,.65);
      --line: rgba(255,255,255,.08);
      --text: #e8eaed;
    }
    /* Görgetés fix + mobilbarát alap */
    html,body{height:auto;min-height:100%;overflow-y:auto;background:#0b0e13;color:var(--text);margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial;}
    body::before{
      /* halvány sötét overlay a háttérkép fölött (ha használsz bg_tamas.jpg) */
      content:"";position:fixed;inset:0;background:
        radial-gradient(60% 80% at 70% 10%, rgba(255,157,55,.25), transparent 60%),
        radial-gradient(60% 80% at 10% 90%, rgba(80,120,255,.20), transparent 60%);
      pointer-events:none;
    }
    .wrap{max-width:1200px;margin:40px auto;padding:0 16px;}
    h1{margin:0 0 16px;font-weight:800;letter-spacing:.5px}
    .subtitle{opacity:.8;margin-bottom:24px}

    /* Fő layout */
    .shell{display:flex;gap:16px;align-items:stretch;flex-direction:column;}
    @media (min-width:1024px){ .shell{flex-direction:row;} }

    /* 3D kártya */
    .card{background:var(--glass);border:1px solid var(--line);border-radius:18px;backdrop-filter:blur(8px);box-shadow:0 10px 30px rgba(0,0,0,.35);}
    .bot-card{flex:1 1 420px;position:relative;overflow:hidden;}
    .bot-header{font-weight:600;font-size:14px;letter-spacing:.5px;padding:10px 14px;color:#e8eaed;opacity:.9;border-bottom:1px solid var(--line);}
    .bot-stage{position:relative;width:100%;aspect-ratio:1/1;min-height:280px}
    .bot-status{position:absolute;inset:auto 12px 12px 12px;background:rgba(0,0,0,.55);color:#cfd3d8;font-size:12px;padding:8px 10px;border-radius:10px;pointer-events:none}

    /* CHAT kártya */
    .chat-card{flex:2 1 520px;display:flex;flex-direction:column;}
    .toolbar{display:flex;gap:12px;align-items:center;justify-content:flex-start;padding:10px 14px;border-bottom:1px solid var(--line);color:var(--text)}
    .board{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;}
    .msg{max-width:90%;padding:12px 14px;border-radius:14px;border:1px solid var(--line)}
    .msg.user{margin-left:auto;background:linear-gradient(180deg,#ff9d37,#f08b1d);color:#1b1307}
    .msg.bot{background:linear-gradient(180deg,#2a2f3a,#1f232b);color:#e9edf1}
    .msg.info{align-self:center;background:rgba(50,120,255,.12);color:#a9c7ff}
    .composer{display:flex;gap:10px;padding:12px 12px 14px;border-top:1px solid var(--line)}
    .composer input{flex:1;background:#12151b;color:var(--text);border:1px solid var(--line);border-radius:12px;padding:12px 14px;outline:none}
    .btn{background:#ff9d37;border:none;color:#2b1a07;padding:10px 14px;border-radius:12px;font-weight:700;cursor:pointer}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .voice-box{background:rgba(28,28,28,.9);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:10px;margin-left:auto}

    /* Háttérkép – ha szeretnéd, nevezd át a tiedet bg_tamas.jpg-re */
    body{background-image:url('bg_tamas.jpg');background-size:cover;background-attachment:fixed;background-position:center; }
    /* ha nincs háttérkép, ez a szín marad */
    @supports (-webkit-touch-callout: none) { /* iOS parányi fix */
      .board{scrollbar-gutter:stable}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>HT Chat — Kellemes beszélgetést! 🎉</h1>
    <div class="subtitle">Az oldalt <strong>H.T.</strong> készítette hobbi fejlesztésként. Jó szórakozást!</div>

    <div class="shell">
      <!-- 3D ROBOT -->
      <div class="card bot-card">
        <div class="bot-header">🤖 3D asszisztens</div>
        <div id="botStage" class="bot-stage"></div>
        <div id="botStatus" class="bot-status">Robot betöltése…</div>
      </div>

      <!-- CHAT -->
      <div class="card chat-card">
        <div class="toolbar">
          <label><input type="checkbox" id="cbCopy"/> Másolás (utolsó válasz)</label>
          <label style="margin-left:16px"><input type="checkbox" id="cbSpeak"/> Hang (felolvasás)</label>
          <span style="opacity:.7;margin-left:auto">Tipp: Enter = küldés, Shift+Enter = új sor</span>
        </div>

        <div id="board" class="board"></div>

        <div class="composer">
          <input id="txt" type="text" placeholder="Írj ide…" />
          <button id="btnSend" class="btn">Küldés</button>
          <button id="btnMic" class="voice-box" title="(Demó) Hang rögzítés">🎙</button>
        </div>
      </div>
    </div>
  </div>

  <!-- three.js modulok a 3D-hez -->
  <script type="module">
    import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
    import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
    import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

    const container = document.getElementById('botStage');
    const statusEl  = document.getElementById('botStatus');
    let renderer, scene, camera, controls, clock, mixer;

    function init3D(){
      renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, container.clientWidth/container.clientHeight, 0.1, 100);
      camera.position.set(2.2,1.6,2.4);
      scene.add(camera);

      scene.add(new THREE.AmbientLight(0xffffff,.7));
      const dir = new THREE.DirectionalLight(0xffffff,1.1);
      dir.position.set(3,5,3); scene.add(dir);

      const grid = new THREE.GridHelper(10,10,0x666666,0x333333);
      grid.material.opacity=.25; grid.material.transparent=true; scene.add(grid);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.enablePan=false;
      controls.minDistance=1.2; controls.maxDistance=6;

      clock = new THREE.Clock();
      loadModel();

      window.addEventListener('resize', ()=>{
        const w=container.clientWidth, h=container.clientHeight;
        camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h);
      });

      (function animate(){
        requestAnimationFrame(animate);
        const dt = clock.getDelta(); if(mixer) mixer.update(dt);
        controls.update(); renderer.render(scene,camera);
      })();
    }

    function loadModel(){
      const loader = new GLTFLoader();
      loader.load('./CesiumMan.glb', (gltf)=>{
        const model=gltf.scene; model.scale.set(1.2,1.2,1.2); scene.add(model);
        if(gltf.animations?.length){
          mixer = new THREE.AnimationMixer(model);
          const act = mixer.clipAction(gltf.animations[0]); act.play();
        }
        statusEl.textContent='Kész. Forgasd, nagyíts!'; setTimeout(()=>statusEl.style.display='none',2000);
      }, (prog)=>{
        const p = prog.total ? Math.round((prog.loaded/prog.total)*100) : 0;
        statusEl.textContent = p ? `Robot betöltése… ${p}%` : 'Robot betöltése…';
      }, (err)=>{
        console.error('GLB hiba:',err);
        statusEl.textContent='Nem sikerült betölteni a modellt. Ellenőrizd: CesiumMan.glb a gyökérben.';
      });
    }

    // gyors WebGL ellenőrzés
    const WEBGL_OK = (()=>{ try{
      const c=document.createElement('canvas');
      return !!(window.WebGLRenderingContext&&(c.getContext('webgl')||c.getContext('experimental-webgl')));
    }catch(e){return false}})();
    if(WEBGL_OK) init3D(); else statusEl.textContent='A böngésződ nem támogatja a WebGL-t.';
  </script>

  <!-- CHAT front-end (a háttér /netlify/functions/chat végpontot hívja) -->
  <script>
    const board = document.getElementById('board');
    const txt   = document.getElementById('txt');
    const send  = document.getElementById('btnSend');
    const cbCopy= document.getElementById('cbCopy');
    const cbSpeak=document.getElementById('cbSpeak');
    const micBtn= document.getElementById('btnMic');

    let lastBot = "";

    function addMsg(text, who='bot', kind=''){
      const b = document.createElement('div');
      b.className = `msg ${who} ${kind||''}`.trim();
      b.textContent = text;
      board.appendChild(b);
      board.scrollTop = board.scrollHeight;

      lastBot = (who==='bot') ? text : lastBot;

      if (who==='bot' && cbCopy.checked) navigator.clipboard.writeText(text).catch(()=>{});
      if (who==='bot' && cbSpeak.checked && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'hu-HU'; u.rate = 1.0; u.pitch = 1.0;
        speechSynthesis.speak(u);
      }
    }

    // Kezdő köszöntés
    addMsg("Szia! Örülök, hogy itt vagy! Kérdezz bátran; segítek. 😊", 'bot');

    async function ask(){
      const text = (txt.value || "").trim();
      if (!text) return;
      addMsg(text, 'user');
      txt.value = '';

      // Gyors helyi válaszok (fixek)
      const fx = fixedAnswer(text);
      if (fx){ addMsg(fx,'bot'); return; }

      // infó üzenet a backend hívás előtt
      addMsg("…", 'bot', 'info');

      try{
        const r = await fetch('/.netlify/functions/chat', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ message: text })
        });
        const info = document.querySelector('.msg.info:last-of-type');
        if (!r.ok){ info.textContent = `Hiba: HTTP ${r.status}`; return; }
        const data = await r.json();
        info.remove();
        const reply = (data.reply||"").toString();
        addMsg(reply||"Értem. Miben segíthetek még?","bot");
      }catch(e){
        const info = document.querySelector('.msg.info:last-of-type');
        if (info) info.textContent = `Hiba: ${e?.message||e}`;
      }
    }

    send.addEventListener('click', ask);
    txt.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); ask(); }});

    // (Egyszerű) mikrofon gomb – csak jelzés (nem rögzít most)
    micBtn.addEventListener('click', ()=> {
      addMsg("Hangos mód: most csak demó gomb. (A szövegfelismerést később kapcsoljuk vissza.)", "bot");
    });

    // Fix válaszok (dátum, napok, készítő, stb.)
    function fixedAnswer(q){
      const t = q.toLowerCase().replaceAll('ö','o').replaceAll('ü','u').replaceAll('á','a').replaceAll('é','e').replaceAll('í','i').replaceAll('ó','o').replaceAll('ő','o').replaceAll('ú','u').trim();

      // Ki készítette?
      if (/(ki keszitette|ki hozta letre)/.test(t)){
        return "Az oldalt Horváth Tamás (Szabolcsbáka) készítette hobbi fejlesztésként; folyamatosan tanul és kísérletezik webes projektekkel. 😊";
      }
      // Mesélj Tamásról
      if (/meselj.*tamas|ki az a horvath tamas|tamas modellje|milyen modell vagy/.test(t)){
        return "Én Tamás modellje vagyok: ő készített és fejlesztett, hogy segítsek neked bármiben. Ha kérdezel, barátságosan és érthetően válaszolok. 🙂";
      }
      // Dátum/idő
      if (/milyen datum van|hanyadika|mai nap/.test(t)){
        const d = new Date();
        return `Ma ${d.toLocaleDateString('hu-HU', { year:'numeric', month:'long', day:'numeric', weekday:'long' })}.`;
      }
      if (/mennyi az ido|hany ora van|aktualis ido/.test(t)){
        const d = new Date();
        return `Most ${d.toLocaleTimeString('hu-HU', { hour:'2-digit', minute:'2-digit' })} van.`;
      }
      // Következő napok (rövid)
      if (/kovetkezo napok|kov napok|heti napok/.test(t)){
        const d = new Date();
        const out = [];
        for(let i=0;i<7;i++){
          const di = new Date(d); di.setDate(d.getDate()+i);
          out.push(di.toLocaleDateString('hu-HU',{weekday:'long', month:'2-digit', day:'2-digit'}));
        }
        return "A következő napok: " + out.join(' • ');
      }
      return null;
    }
  </script>
</body>
</html>
