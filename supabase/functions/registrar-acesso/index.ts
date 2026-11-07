// Registra cada login com senha (e cada "Usar neste aparelho") em
// acessos_login: data, aparelho, navegador e cidade aproximada pelo IP.
// Ajuda a perceber senha compartilhada (vários aparelhos e cidades na
// mesma conta). Só o administrador vê (página acessos.html).
//
// Chamada pelo site com o token do aluno; quem grava é esta função, com a
// chave de serviço, então o aluno não consegue forjar nem apagar registros.
// Registros com mais de 90 dias são apagados (LGPD: guardar só o necessário).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const TIPOS = ['login', 'trocou_aparelho'];

function curto(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

async function localizar(ip: string | null) {
  if (!ip) return {};
  try {
    const resp = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?lang=pt-BR&fields=success,city,region_code,region,country_code`,
      { signal: AbortSignal.timeout(2500) }
    );
    const dados = await resp.json();
    if (!dados || dados.success === false) return {};
    return {
      cidade: curto(dados.city, 80),
      regiao: curto(dados.region_code || dados.region, 40),
      pais: curto(dados.country_code, 4)
    };
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('ok', { status: 200, headers: CORS });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });
  const { data: quem, error } = await sb.auth.getUser(token);
  if (error || !quem?.user) return new Response('não autorizado', { status: 401, headers: CORS });

  // deno-lint-ignore no-explicit-any
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }

  const ip = curto((req.headers.get('x-forwarded-for') || '').split(',')[0], 64)
    || curto(req.headers.get('x-real-ip'), 64);
  const local = await localizar(ip);
  const userId = quem.user.id;

  await sb.from('acessos_login').insert({
    user_id: userId,
    tipo: TIPOS.includes(corpo.tipo) ? corpo.tipo : 'login',
    dispositivo: curto(corpo.dispositivo, 64),
    navegador: curto(req.headers.get('user-agent'), 300),
    ip,
    ...local
  });
  await sb.from('acessos_login').delete()
    .eq('user_id', userId)
    .lt('criado_em', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  return new Response(null, { status: 204, headers: CORS });
});
