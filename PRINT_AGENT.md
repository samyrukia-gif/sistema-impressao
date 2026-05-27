# Agente local de impressao

Este agente roda no computador onde a impressora esta instalada.

Por padrao ele roda em modo seguro:

```env
PRINT_AGENT_SIMULATE=true
```

Nesse modo ele busca pedidos `pago`, baixa o PDF e muda o pedido para `simulado`, mas nao imprime.

## Configuracao local

Crie ou edite `.env.print-agent.local` com:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
PRINT_AGENT_SIMULATE=true
PRINT_AGENT_POLL_MS=15000
PRINT_AGENT_PRINTER_NAME=Microsoft Print to PDF
PRINT_AGENT_DOWNLOAD_DIR=print-agent-downloads
```

## Rodar

```powershell
npm.cmd run print-agent
```

Para parar, pressione `Ctrl+C`.

## Impressao real

Depois que a impressora aparecer no Windows, confira o nome:

```powershell
Get-Printer | Select-Object Name
```

Coloque o nome exato em `PRINT_AGENT_PRINTER_NAME` e altere:

```env
PRINT_AGENT_SIMULATE=false
```

Enquanto a impressora nao estiver instalada, deixe `PRINT_AGENT_SIMULATE=true`.
