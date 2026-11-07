-- =====================================================================
-- Um aparelho por vez (contra compartilhamento de senha)
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.
--
-- Cada navegador tem um código próprio (sync-offline.js), enviado em toda
-- consulta. profiles.dispositivo guarda o último aparelho em que o aluno
-- entrou com a senha (ou tocou em "Usar neste aparelho"). O conteúdo só é
-- liberado para esse aparelho; os outros voltam para a tela inicial.
-- Admin não tem esse limite. dispositivo vazio = ainda sem aparelho (libera).
-- =====================================================================

alter table public.profiles add column if not exists dispositivo text;

-- O aluno não pode mudar o próprio aparelho direto (só pela função abaixo).
create or replace function public.proteger_campos_perfil()
returns trigger
language plpgsql
set search_path = public
as '
begin
  if current_user in (''anon'', ''authenticated'') then
    if tg_op = ''INSERT'' then
      new.aprovado := false;
      new.admin := false;
      new.acesso_ate := null;
      new.dispositivo := null;
    else
      new.aprovado := old.aprovado;
      new.admin := old.admin;
      new.acesso_ate := old.acesso_ate;
      new.dispositivo := old.dispositivo;
    end if;
  end if;
  return new;
end;
';

-- Código do aparelho que fez a consulta (vem no cabeçalho X-Client-Info).
create or replace function public.dispositivo_da_requisicao()
returns text
language sql
stable
set search_path = public
as '
  select substring(
    coalesce(nullif(current_setting(''request.headers'', true), ''''), ''{}'')::json ->> ''x-client-info''
    from ''alfa-disp=([A-Za-z0-9-]+)''
  );
';

-- Faz do aparelho atual o único da conta.
create or replace function public.registrar_dispositivo(p_dispositivo text)
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  update public.profiles set dispositivo = left(p_dispositivo, 64) where id = auth.uid();
end;
';
revoke execute on function public.registrar_dispositivo(text) from public, anon;
grant execute on function public.registrar_dispositivo(text) to authenticated;

-- A regra "está em dia?" passa a conferir também o aparelho.
create or replace function public.acesso_valido()
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.admin = true
           or (p.aprovado = true
               and (p.acesso_ate is null or p.acesso_ate > now())
               and (p.dispositivo is null
                    or public.dispositivo_da_requisicao() is null
                    or p.dispositivo = public.dispositivo_da_requisicao())))
  );
';

-- Conferência: deve mostrar coluna_criada = 1 e funcao_criada = 1.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'dispositivo') as coluna_criada,
  (select count(*) from pg_proc where proname = 'registrar_dispositivo') as funcao_criada;
