# Checklist de seguranca

## Segredos

- Rotacione a chave do Asaas que chegou a aparecer no codigo local.
- Mantenha `ASAAS_API_KEY` apenas em `.env.local` e nas variaveis de ambiente da Vercel.
- Nunca use prefixo `NEXT_PUBLIC_` em chaves secretas. Variaveis com esse prefixo ficam visiveis no navegador.
- Configure `APP_ORIGIN` com a origem publica do deploy, por exemplo `https://sistema-impressao.vercel.app`.

## Asaas

- Use `ASAAS_API_BASE_URL=https://sandbox.asaas.com/api/v3` para testes.
- Use `ASAAS_API_BASE_URL=https://api.asaas.com/api/v3` somente em producao.
- Confira no painel do Asaas se o webhook de pagamento confirmado valida a origem do evento antes de liberar qualquer impressao.

## Supabase

- Ative RLS na tabela `pedidos_impressao`.
- Permita inserts anonimos somente para as colunas necessarias do pedido.
- Nao permita que usuarios anonimos atualizem `status`, `valor`, `payment_link` ou campos administrativos.
- Restrinja o bucket `arquivos` a PDFs e limite o tamanho maximo do upload.
- Se possivel, troque o bucket publico por URLs assinadas quando houver painel administrativo.

## Deploy

- Depois de trocar variaveis de ambiente na Vercel, faca um novo deploy.
- Rode `npm run build` antes de publicar.
- Teste um pagamento sandbox de ponta a ponta antes de ativar producao.
