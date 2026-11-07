-- =====================================================================
-- Segurança extra: ranking à prova de trapaça
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.
--
-- Os resultados dos simulados são gravados pelo próprio navegador do
-- aluno, então alguém que entende de programação poderia gravar notas
-- falsas e subir no ranking. Agora o banco:
--   - não deixa alterar um resultado já gravado;
--   - grava sempre com o horário do servidor e o dono certo;
--   - recusa números impossíveis (negativos, mais de 1000 questões,
--     percentual fora de 0 a 100);
--   - aceita no máximo 1 resultado a cada 15 segundos e 100 por dia
--     por aluno (bem acima do uso normal).
-- Também tira o acesso às funções admin_* antigas, que o site não usa.
-- =====================================================================

create or replace function public.validar_resultado()
returns trigger
language plpgsql
set search_path = public
as '
begin
  if current_user in (''anon'', ''authenticated'') then
    if tg_op = ''UPDATE'' then
      raise exception ''Resultados não podem ser alterados.'';
    end if;
    new.user_id := auth.uid();
    new.criado_em := now();
    new.acertos := greatest(coalesce(new.acertos, 0), 0);
    new.erros := greatest(coalesce(new.erros, 0), 0);
    new.percentual := least(greatest(coalesce(new.percentual, 0), 0), 100);
    if new.acertos + new.erros > 1000 then
      raise exception ''Resultado inválido.'';
    end if;
    if exists (select 1 from public.resultados r
               where r.user_id = new.user_id and r.criado_em > now() - interval ''15 seconds'') then
      raise exception ''Aguarde alguns segundos antes de enviar outro resultado.'';
    end if;
    if (select count(*) from public.resultados r
        where r.user_id = new.user_id and r.criado_em > now() - interval ''1 day'') >= 100 then
      raise exception ''Limite diário de resultados atingido.'';
    end if;
  end if;
  return new;
end;
';

drop trigger if exists validar_resultado on public.resultados;
create trigger validar_resultado
  before insert or update on public.resultados
  for each row execute function public.validar_resultado();

revoke execute on function public.admin_list_students() from authenticated;
revoke execute on function public.admin_set_acesso(uuid, text, boolean) from authenticated;
revoke execute on function public.admin_set_aprovado(uuid, boolean) from authenticated;

-- Conferência: deve mostrar gatilho_criado = 1.
select count(*) as gatilho_criado from pg_trigger where tgname = 'validar_resultado';
