const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(status,obj){return{statusCode:status,headers:{"Content-Type":"application/json",...corsHeaders},body:JSON.stringify(obj)}}

export async function handler(event){
  if(event.httpMethod==="OPTIONS") return{statusCode:204,headers:corsHeaders,body:""};
  if(event.httpMethod!=="POST") return json(405,{error:"Use POST"});
  if(!OPENAI_API_KEY) return json(503,{error:"Missing OPENAI_API_KEY"});

  try{
    const {message,image}=JSON.parse(event.body||"{}");
    const userMsg=String(message||"").trim();

    const userContent=[];
    if(userMsg) userContent.push({type:"text",text:userMsg});
    if(image) userContent.push({type:"image_url",image_url:{url:image}});
    if(image && !userMsg){
      userContent.unshift({type:"text",text:"Mit látsz ezen a képen?"});
    }

    const now=new Date();
    const today=now.toLocaleDateString("hu-HU",{year:"numeric",month:"2-digit",day:"2-digit",weekday:"long"});

    const payload={
      model:DEFAULT_MODEL,
      messages:[
        {
          role:"system",
          content:
            "Barátságos magyar asszisztens vagy. Rövid, érthető válaszokat adj. " +
            "Ne beszélj az OpenAI-ról; mondd azt: 'Tamás modellje vagyok, ő készített és fejlesztett.' " +
            "Ha ismert személy van a képen, írd le röviden. " +
            "Ha egészségi jel (pl. anyajegy) látható, ne diagnosztizálj, hanem javasolj orvost. " +
            "Ha a felhasználó magáról küld képet, dicsérd meg kedves szavakkal. " +
            `A mai dátum: ${today}.`
        },
        {role:"user",content:userContent.length?userContent:[{type:"text",text:userMsg}]}
      ],
      max_tokens:400,
      temperature:0.6
    };

    const r=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(!r.ok){const txt=await r.text();throw new Error(`OpenAI ${r.status}: ${txt}`)}
    const data=await r.json();
    const reply=data.choices?.[0]?.message?.content?.trim()||"Rendben. 🙂";
    return json(200,{reply});
  }catch(e){
    console.error(e);
    return json(500,{reply:"Hopp, hiba történt. Próbáld meg újra. 🙂"});
  }
}
