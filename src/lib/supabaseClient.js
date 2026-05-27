// 단일 파일 React 앱이라 @supabase/supabase-js 를 추가하지 않고
// REST 엔드포인트로 직접 호출하는 경량 클라이언트입니다.
// App.jsx 와 hooks/ 양쪽에서 같은 인스턴스를 import 해서 씁니다.

export const SUPABASE_URL="https://tzjpgqfdudbhygzmbygo.supabase.co";
export const SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6anBncWZkdWRiaHlnem1ieWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTkzNTIsImV4cCI6MjA5MDM5NTM1Mn0.xQheWcHI-GqjGR8HHjhE_0x9KkGci-McoSQbI4AEHxc
";
export const sbHeaders={
  "apikey":SUPABASE_KEY,
  "Authorization":`Bearer ${SUPABASE_KEY}`,
  "Content-Type":"application/json",
  "Prefer":"return=representation"
};

export const sb={
  async get(table){
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.desc`,{headers:sbHeaders});
      if(!r.ok)throw new Error(r.statusText);
      return await r.json();
    }catch(e){console.error(`[sb.get] ${table}:`,e);return[];}
  },
  async insert(table,data){
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:"POST",headers:sbHeaders,body:JSON.stringify(data)});
      if(!r.ok)throw new Error(r.statusText);
      return await r.json();
    }catch(e){console.error(`[sb.insert] ${table}:`,e);return null;}
  },
  async update(table,id,data){
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:{...sbHeaders,"Prefer":"return=representation"},body:JSON.stringify(data)});
      if(!r.ok)throw new Error(r.statusText);
      return await r.json();
    }catch(e){console.error(`[sb.update] ${table}:`,e);return null;}
  },
  async remove(table,id){
    try{
      await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:sbHeaders});
      return true;
    }catch(e){console.error(`[sb.delete] ${table}:`,e);return false;}
  }
};
