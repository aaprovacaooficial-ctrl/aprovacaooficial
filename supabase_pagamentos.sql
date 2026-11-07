-- =====================================================================
-- Pagamento automático pela Kiwify (etapa 5 da venda)
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.
--
-- assinaturas: o prazo de cada comprador, guardado pelo e-mail da compra.
-- pagamentos_eventos: tudo o que a Kiwify enviou (para conferir depois).
-- Nenhuma das duas pode ser lida pelos alunos; só a função do webhook
-- (kiwify-webhook) e você, pelo painel do Supabase.
-- =====================================================================

create table if not exists public.assinaturas (
  email text primary key,
  acesso_ate timestamptz,
  plano text,
  status text,
  atualizado_em timestamptz default now()
);
alter table public.assinaturas enable row level security;

create table if not exists public.pagamentos_eventos (
  id bigint generated always as identity primary key,
  recebido_em timestamptz default now(),
  email text,
  evento text,
  payload jsonb
);
alter table public.pagamentos_eventos enable row level security;

-- Copia o prazo da compra para o perfil do aluno com aquele e-mail.
create or replace function public.aplicar_assinatura(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  update public.profiles p
     set aprovado = true,
         acesso_ate = a.acesso_ate
    from public.assinaturas a, auth.users u
   where lower(a.email) = lower(p_email)
     and lower(u.email) = lower(a.email)
     and p.id = u.id;
end;
';
revoke execute on function public.aplicar_assinatura(text) from public, anon, authenticated;
grant execute on function public.aplicar_assinatura(text) to service_role;

-- Quem comprou antes de criar a conta recebe o acesso ao se cadastrar.
create or replace function public.perfil_aplica_assinatura()
returns trigger
language plpgsql
security definer
set search_path = public
as '
begin
  perform public.aplicar_assinatura((select email from auth.users where id = new.id));
  return new;
end;
';
revoke execute on function public.perfil_aplica_assinatura() from public, anon, authenticated;

drop trigger if exists perfil_aplica_assinatura on public.profiles;
create trigger perfil_aplica_assinatura
  after insert on public.profiles
  for each row execute function public.perfil_aplica_assinatura();
