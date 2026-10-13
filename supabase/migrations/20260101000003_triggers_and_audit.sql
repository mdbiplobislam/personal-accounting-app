-- Migration 003: row-level integrity triggers and the audit trail.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger loans_set_updated_at before update on public.loans
  for each row execute function public.set_updated_at();
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();
create trigger transfers_set_updated_at before update on public.transfers
  for each row execute function public.set_updated_at();
create trigger budgets_set_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();
create trigger savings_goals_set_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Transaction validation
--   * income must use an income category; expense and refund must use an expense category.
--   * no new money movement may touch an archived account.
-- ---------------------------------------------------------------------------
create or replace function public.validate_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.category_kind;
  v_archived boolean;
begin
  if new.category_id is not null then
    select c.kind into v_kind
    from public.categories c
    where c.id = new.category_id and c.user_id = new.user_id;

    if (new.type = 'income' and v_kind <> 'income')
      or (new.type in ('expense', 'refund') and v_kind <> 'expense') then
      raise exception 'category kind does not match transaction type'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    select a.is_archived into v_archived
    from public.accounts a
    where a.id = new.account_id and a.user_id = new.user_id;

    if v_archived then
      raise exception 'account is archived' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger transactions_validate
  before insert or update on public.transactions
  for each row execute function public.validate_transaction();

create or replace function public.validate_transfer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.accounts a
      where a.user_id = new.user_id
        and a.id in (new.from_account_id, new.to_account_id)
        and a.is_archived
    ) then
      raise exception 'account is archived' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger transfers_validate
  before insert or update on public.transfers
  for each row execute function public.validate_transfer();

-- Budgets only apply to expense categories.
create or replace function public.validate_budget()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.category_kind;
begin
  select c.kind into v_kind
  from public.categories c
  where c.id = new.category_id and c.user_id = new.user_id;

  if v_kind is distinct from 'expense' then
    raise exception 'budgets can only be set on expense categories'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger budgets_validate
  before insert or update on public.budgets
  for each row execute function public.validate_budget();

-- ---------------------------------------------------------------------------
-- Audit trail. Runs as the table owner so it can write audit_logs even though
-- clients have no INSERT policy on that table.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_record uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.user_id;
    v_record := old.id;
  else
    v_owner := new.user_id;
    v_record := new.id;
  end if;

  insert into public.audit_logs (user_id, table_name, record_id, action, old_data, new_data)
  values (
    coalesce((select auth.uid()), v_owner),
    tg_table_name,
    v_record,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

create trigger accounts_audit after insert or update or delete on public.accounts
  for each row execute function public.audit_row();
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function public.audit_row();
create trigger loans_audit after insert or update or delete on public.loans
  for each row execute function public.audit_row();
create trigger transactions_audit after insert or update or delete on public.transactions
  for each row execute function public.audit_row();
create trigger transfers_audit after insert or update or delete on public.transfers
  for each row execute function public.audit_row();
create trigger loan_repayments_audit after insert or update or delete on public.loan_repayments
  for each row execute function public.audit_row();
create trigger budgets_audit after insert or update or delete on public.budgets
  for each row execute function public.audit_row();
create trigger savings_goals_audit after insert or update or delete on public.savings_goals
  for each row execute function public.audit_row();
