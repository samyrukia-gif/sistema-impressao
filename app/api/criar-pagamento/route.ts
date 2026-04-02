import { NextResponse } from 'next/server'

async function criarClienteAsaas(nome: string, email: string, celular: string) {
  const response = await fetch('https://sandbox.asaas.com/api/v3/customers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      access_token: process.env.ASAAS_API_KEY as string,
    },
    body: JSON.stringify({
      name: nome,
      email,
      mobilePhone: celular,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.errors?.[0]?.description || 'Erro ao criar cliente no Asaas')
  }

  return data.id
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const { nome, email, whatsapp, valor } = body

    const customerId = await criarClienteAsaas(nome, email, whatsapp)

    const hoje = new Date()
    const dueDate = hoje.toISOString().split('T')[0]

    const paymentResponse = await fetch('https://sandbox.asaas.com/api/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: process.env.ASAAS_API_KEY as string,
      },
      body: JSON.stringify({
        customer: customerId,
        billingType: 'PIX',
        value: valor,
        dueDate,
        description: 'Pedido de impressão',
      }),
    })

    const paymentData = await paymentResponse.json()

    if (!paymentResponse.ok) {
      throw new Error(paymentData?.errors?.[0]?.description || 'Erro ao criar cobrança no Asaas')
    }

    return NextResponse.json(paymentData)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Erro interno ao criar pagamento',
      },
      { status: 500 }
    )
  }
}