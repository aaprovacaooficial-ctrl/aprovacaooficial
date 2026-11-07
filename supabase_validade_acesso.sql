-- =====================================================================
-- Validade do acesso (etapa 3 da venda)
-- Rode no SQL Editor do Supabase DEPOIS do supabase_seguranca.sql.
-- Pode rodar mais de uma vez. Não apaga nenhum dado.
--
-- O QUE MUDA
-- Cada perfil ganha a coluna "acesso_ate" (data e hora em que o acesso
-- vence). Regra de acesso a partir de agora:
--   - admin: sempre tem acesso;
--   - aluno: precisa estar "aprovado" E com acesso_ate vazio ou no futuro.
-- acesso_ate vazio = sem prazo (como funciona hoje). Então, enquanto você
-- não preencher nenhuma data, nada muda para os alunos atuais.
-- Para dar um prazo: Table Editor → profiles → coluna acesso_ate.
-- Mais tarde o pagamento automático vai preencher essa data sozinho.
-- =====================================================================

alter table public.profiles add column if not exists acesso_ate timestamptz;

-- O aluno não pode mudar o próprio prazo (nem aprovado/admin).
create or replace function public.proteger_campos_perfil()
returns trigger
language plpgsql
as '
begin
  if current_user in (''anon'', ''authenticated'') then
    if tg_op = ''INSERT'' then
      new.aprovado := false;
      new.admin := false;
      new.acesso_ate := null;
    else
      new.aprovado := old.aprovado;
      new.admin := old.admin;
      new.acesso_ate := old.acesso_ate;
    end if;
  end if;
  return new;
end;
';

drop trigger if exists proteger_campos_perfil on public.profiles;
create trigger proteger_campos_perfil
  before insert or update on public.profiles
  for each row execute function public.proteger_campos_perfil();

-- Uma única regra "o aluno logado está em dia?", usada por todas as
-- tabelas abaixo. Se um dia a regra mudar, muda só aqui.
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
           or (p.aprovado = true and (p.acesso_ate is null or p.acesso_ate > now())))
  );
';

-- Troca o "está aprovado?" de cada regra por "está em dia?".
alter policy "Usuario ve suas proprias marcacoes" on public.apostila_highlights
  using ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuario cria suas proprias marcacoes" on public.apostila_highlights
  with check ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuario atualiza suas proprias marcacoes" on public.apostila_highlights
  using ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuario apaga suas proprias marcacoes" on public.apostila_highlights
  using ((auth.uid() = user_id) and public.acesso_valido());

alter policy "Aprovados veem apostilas" on public.apostilas
  using (public.acesso_valido());
alter policy "Aprovados registram apostilas" on public.apostilas
  with check (public.acesso_valido());
alter policy "Aprovados apagam apostilas" on public.apostilas
  using (public.acesso_valido());

alter policy "Usuário vê seus próprios dados" on public.dados_usuario
  using ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuário cria seus próprios dados" on public.dados_usuario
  with check ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuário atualiza seus próprios dados" on public.dados_usuario
  using ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuário apaga seus próprios dados" on public.dados_usuario
  using ((auth.uid() = user_id) and public.acesso_valido());

alter policy "Usuário vê suas próprias respostas detalhadas" on public.respostas_detalhadas
  using ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuário grava suas próprias respostas detalhadas" on public.respostas_detalhadas
  with check ((auth.uid() = user_id) and public.acesso_valido());
alter policy "Usuário atualiza suas próprias respostas detalhadas" on public.respostas_detalhadas
  using ((auth.uid() = user_id) and public.acesso_valido())
  with check ((auth.uid() = user_id) and public.acesso_valido());

alter policy "Aprovados veem resumos personalizados" on public.resumos_custom
  using (public.acesso_valido());
alter policy "Aprovados criam resumos personalizados" on public.resumos_custom
  with check (public.acesso_valido());
alter policy "Aprovados editam resumos personalizados" on public.resumos_custom
  using (public.acesso_valido());
alter policy "Aprovados apagam resumos personalizados" on public.resumos_custom
  using (public.acesso_valido());

alter policy "Alunos aprovados veem salas" on public.salas_estudo
  using (public.acesso_valido());
alter policy "Alunos aprovados criam salas" on public.salas_estudo
  with check ((host_id = auth.uid()) and public.acesso_valido());
alter policy "Ve participantes da sala" on public.salas_estudo_participantes
  using (public.acesso_valido());
alter policy "Entra na sala" on public.salas_estudo_participantes
  with check ((user_id = auth.uid()) and public.acesso_valido());
alter policy "Ve respostas da sala" on public.salas_estudo_respostas
  using (public.acesso_valido());
alter policy "Registra a propria resposta" on public.salas_estudo_respostas
  with check ((user_id = auth.uid()) and public.acesso_valido());

alter policy "Aprovados leem arquivos de apostilas" on storage.objects
  using ((bucket_id = 'apostilas') and public.acesso_valido());
alter policy "Aprovados enviam arquivos de apostilas" on storage.objects
  with check ((bucket_id = 'apostilas') and public.acesso_valido());
alter policy "Aprovados apagam arquivos de apostilas" on storage.objects
  using ((bucket_id = 'apostilas') and public.acesso_valido());

-- Conferência: deve mostrar coluna_criada = 1 e regras_atualizadas = 27.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'acesso_ate') as coluna_criada,
  (select count(*) from pg_policies
    where qual like '%acesso_valido%' or with_check like '%acesso_valido%') as regras_atualizadas;
