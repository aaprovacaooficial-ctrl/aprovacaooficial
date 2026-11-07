// Recebe os avisos de pagamento da Kiwify e libera/bloqueia o acesso.
//
// Endereço para colocar na Kiwify (Apps → Webhooks):
//   https://ghlaukrbwwecpeanlmlp.supabase.co/functions/v1/kiwify-webhook?segredo=<KIWIFY_SEGREDO>
// KIWIFY_SEGREDO é um segredo da função (Edge Functions → Secrets).
//
// Compra aprovada / assinatura renovada:
//   - assinatura (mensal): acesso até a próxima cobrança + 3 dias de folga
//     (ou 33 dias, se a Kiwify não mandar a data);
//   - pagamento único ("até a prova"): acesso até o dia da prova cadastrada
//     no site (configuracoes.prova), ou 1 ano se não houver data.
// Reembolso / chargeback: acesso termina na hora.
// Assinatura cancelada ou atrasada: nada muda; o acesso vence sozinho no
// fim do período já pago.
//
// Tudo é registrado em pagamentos_eventos e o prazo fica em assinaturas
// (por e-mail), então quem compra antes de criar a conta no site recebe o
// acesso assim que se cadastrar com o mesmo e-mail.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DIA_MS = 24 * 60 * 60 * 1000;
const APROVADOS = ['paid', 'approved', 'order_approved', 'subscription_renewed', 'compra_aprovada'];
const ESTORNADOS = ['refunded', 'chargedback', 'chargeback', 'order_refunded', 'reembolso'];

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

Deno.serve(async (req) => {
  const segredo = Deno.env.get('KIWIFY_SEGREDO');
  const url = new URL(req.url);
  if (!segredo || url.searchParams.get('segredo') !== segredo) {
    return new Response('não autorizado', { status: 401 });
  }
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  // deno-lint-ignore no-explicit-any
  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return new Response('corpo inválido', { status: 400 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const cliente = corpo.Customer || corpo.customer || {};
  const email = texto(cliente.email || corpo.email);
  const evento = texto(corpo.webhook_event_type);
  const status = texto(corpo.order_status);
  const assinatura = corpo.Subscription || corpo.subscription || null;
  const ehAssinatura = !!(assinatura || corpo.subscription_id || evento.startsWith('subscription'));

  await sb.from('pagamentos_eventos').insert({ email, evento: evento || status, payload: corpo });
  if (!email) return new Response('sem e-mail', { status: 200 });

  const atual = await sb.from('assinaturas').select('acesso_ate').eq('email', email).maybeSingle();
  const acessoAtual = atual.data?.acesso_ate ? new Date(atual.data.acesso_ate).getTime() : 0;

  let novoAcesso: number | null = null;
  let novoStatus = evento || status;

  if (APROVADOS.includes(evento) || APROVADOS.includes(status)) {
    if (ehAssinatura) {
      const proxima = assinatura && (assinatura.next_payment || assinatura.next_charge_date);
      const proximaMs = proxima ? new Date(proxima).getTime() : NaN;
      novoAcesso = Number.isFinite(proximaMs) ? proximaMs + 3 * DIA_MS : Date.now() + 33 * DIA_MS;
    } else {
      const cfg = await sb.from('configuracoes').select('valor').eq('chave', 'prova').maybeSingle();
      const dataProva = cfg.data?.valor?.data ? new Date(cfg.data.valor.data).getTime() : NaN;
      novoAcesso = Number.isFinite(dataProva) && dataProva > Date.now()
        ? dataProva + DIA_MS
        : Date.now() + 365 * DIA_MS;
    }
    // Uma compra nunca encurta um acesso que já ia mais longe.
    novoAcesso = Math.max(novoAcesso, acessoAtual);
    novoStatus = 'ativo';
  } else if (ESTORNADOS.includes(evento) || ESTORNADOS.includes(status)) {
    novoAcesso = Date.now();
    novoStatus = 'estornado';
  } else {
    return new Response('evento registrado', { status: 200 });
  }

  await sb.from('assinaturas').upsert({
    email,
    acesso_ate: new Date(novoAcesso).toISOString(),
    plano: ehAssinatura ? 'mensal' : 'ate_a_prova',
    status: novoStatus,
    atualizado_em: new Date().toISOString()
  });
  await sb.rpc('aplicar_assinatura', { p_email: email });

  return new Response('ok', { status: 200 });
});
