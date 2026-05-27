import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const PAID_EVENTS = new Set(['PAYMENT_RECEIVED'])

type AsaasWebhookPayload = {
  id?: unknown
  event?: unknown
  payment?: {
    id?: unknown
    externalReference?: unknown
    value?: unknown
  }
}

class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string
  ) {
    super(publicMessage)
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function getWebhookToken() {
  const token = process.env.ASAAS_WEBHOOK_TOKEN?.trim()

  if (!token) {
    throw new PublicApiError(500, 'Webhook nao configurado.')
  }

  return token
}

function validateWebhookToken(req: Request) {
  const expectedToken = getWebhookToken()
  const receivedToken = req.headers.get('asaas-access-token')?.trim()

  if (!receivedToken || receivedToken !== expectedToken) {
    throw new PublicApiError(401, 'Webhook nao autorizado.')
  }
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !supabaseKey) {
    throw new PublicApiError(500, 'Supabase nao configurado.')
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function readPayload(req: Request) {
  try {
    return (await req.json()) as AsaasWebhookPayload
  } catch {
    throw new PublicApiError(400, 'JSON invalido.')
  }
}

export async function POST(req: Request) {
  try {
    validateWebhookToken(req)

    const payload = await readPayload(req)
    const event = readString(payload.event)
    const paymentId = readString(payload.payment?.id)
    const externalReference = readString(payload.payment?.externalReference)
    const eventId = readString(payload.id) || `${event || 'event'}:${paymentId || crypto.randomUUID()}`

    if (!event || !paymentId) {
      throw new PublicApiError(400, 'Evento de pagamento invalido.')
    }

    const supabase = getSupabaseClient()

    const { error: eventError } = await supabase.from('webhook_events').insert([
      {
        id: eventId,
        event,
        payment_id: paymentId,
        payload,
      },
    ])

    if (eventError) {
      if (/duplicate key|already exists/i.test(eventError.message)) {
        return NextResponse.json({ ok: true, duplicate: true })
      }

      console.error('Webhook event insert failed', {
        message: eventError.message,
      })

      throw new PublicApiError(500, 'Nao foi possivel registrar o webhook.')
    }

    if (!PAID_EVENTS.has(event)) {
      return NextResponse.json({ ok: true, ignored: true, event })
    }

    const updatePayload = {
      status: 'pago',
      paid_at: new Date().toISOString(),
      asaas_payment_id: paymentId,
      ...(externalReference ? { external_reference: externalReference } : {}),
    }

    const query = externalReference
      ? `asaas_payment_id.eq.${paymentId},external_reference.eq.${externalReference}`
      : `asaas_payment_id.eq.${paymentId}`

    const { data: updatedOrders, error: updateError } = await supabase
      .from('pedidos_impressao')
      .update(updatePayload)
      .or(query)
      .select('id,status')

    if (updateError) {
      console.error('Order payment update failed', {
        message: updateError.message,
        paymentId,
        externalReference,
      })

      throw new PublicApiError(500, 'Nao foi possivel atualizar o pedido.')
    }

    if (!updatedOrders || updatedOrders.length === 0) {
      console.error('Paid payment without matching order', {
        paymentId,
        externalReference,
        eventId,
      })

      return NextResponse.json({ ok: true, matched: false })
    }

    return NextResponse.json({
      ok: true,
      matched: true,
      orderIds: updatedOrders.map((order) => order.id),
    })
  } catch (error) {
    if (error instanceof PublicApiError) {
      return jsonError(error.publicMessage, error.status)
    }

    console.error('Unexpected Asaas webhook error', { error })
    return jsonError('Erro interno no webhook.', 500)
  }
}
