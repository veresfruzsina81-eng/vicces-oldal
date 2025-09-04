<script>
  // ... a többi kódod maradhat ...

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const text = (msg.value||'').trim(); 
    if(!text) return;

    addRow(text,'user');
    msg.value='';

    try{
      const r = await fetch('/.netlify/functions/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: text })
      });

      let data;
      try { data = await r.json(); } catch { data = null; }

      if(!r.ok || data?.error){
        const errTxt = data?.error || `Szerver hiba (HTTP ${r.status})`;
        addRow('Hiba: '+errTxt, 'err');
        return;
      }

      const answer = (data?.reply ?? '').toString().trim();
      const finalText = answer || 'Értem. Miben segíthetek még?';
      addRow(finalText,'bot');

      if(copyToggle.checked){
        try{ await navigator.clipboard.writeText(finalText); }catch{}
      }
    }catch(err){
      addRow('Hálózati hiba: '+(err.message||err), 'err');
    }
  });
</script>
