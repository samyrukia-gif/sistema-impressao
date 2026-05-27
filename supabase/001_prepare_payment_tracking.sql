alter table public.pedidos_impressao
  add column if not exists asaas_payment_id text,
  add column if not exists external_reference text,
  add column if not exists storage_path text,
  add column if not exists paid_at timestamptz,
  add column if not exists print_started_at timestamptz,
  add column if not exists printed_at timestamptz,
  add column if not exists print_error text;

create unique index if not exists pedidos_impressao_asaas_payment_id_key
  on public.pedidos_impressao (asaas_payment_id)
  where asaas_payment_id is not null;

create unique index if not exists pedidos_impressao_external_reference_key
  on public.pedidos_impressao (external_reference)
  where external_reference is not null;

create table if not exists public.webhook_events (
  id text primary key,
  event text not null,
  payment_id text,
  payload jsonb not null,
  processed_at timestamptz default now()
);
