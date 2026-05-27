import { NextResponse } from 'next/server'

const ASAAS_API_VERSION_PATH = '/api/v3'
const MAX_REQUEST_BYTES = 10_000
const MAX_PAGES = 500

const PRICE_BY_PRINT_TYPE = {
  pb: 2.5,
  colorido: 3.5,
} as const

type PrintType = keyof typeof PRICE_BY_PRINT_TYPE

type PaymentRequestBody = {
  nome?: unknown
  email?: unknown
  whatsapp?: unknown
  tipoImpressao?: unknown
  quantidadePaginas?: unknown
}

type AsaasCustomerResponse = {
  id?: string
}

type AsaasPaymentResponse = {
  id?: string
  invoiceUrl?: string
  bankSlipUrl?: string
  value?: number
  dueDate?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTextField(value: unknown, fieldName: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new PublicApiError(400, `Informe ${fieldName}.`)
  }

  const normalized = value.trim().replace(/\s+/g, ' ')

  if (!normalized || normalized.length > maxLength) {
    throw new PublicApiError(400, `Informe ${fieldName} valido.`)
  }

  return normalized
}

function readEmail(value: unknown) {
  const email = readTextField(value, 'um e-mail', 254).toLowerCase()
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  if (!isValidEmail) {
    throw new PublicApiError(400, 'Informe um e-mail valido.')
  }

  return email
}

function readWhatsapp(value: unknown) {
  const raw = readTextField(value, 'um WhatsApp', 30)
  const digitsOnly = raw.replace(/\D/g, '')
  const normalized =
    digitsOnly.length === 13 && digitsOnly.startsWith('55')
      ? digitsOnly.slice(2)
      : digitsOnly

  if (!/^\d{10,11}$/.test(normalized)) {
    throw new PublicApiError(400, 'Informe um WhatsApp valido com DDD.')
  }

  return normalized
}

function readPrintType(value: unknown): PrintType {
  if (value === 'pb' || value === 'colorido') {
    return value
  }

  throw new PublicApiError(400, 'Tipo de impressao invalido.')
}

function readPageCount(value: unknown) {
  const pageCount =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10)

  if (
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > MAX_PAGES
  ) {
    throw new PublicApiError(
      400,
      `A quantidade de paginas deve ficar entre 1 e ${MAX_PAGES}.`
    )
  }

  return pageCount
}

function getAsaasApiKey() {
  const apiKey = process.env.ASAAS_API_KEY?.trim()

  if (!apiKey) {
    throw new PublicApiError(500, 'Servico de pagamento indisponivel.')
  }

  return apiKey
}

function getAsaasBaseUrl(apiKey: string) {
  const configuredUrl = process.env.ASAAS_API_BASE_URL?.trim()

  if (configuredUrl) {
    const url = new URL(configuredUrl)
    const allowedHostnames = new Set(['api.asaas.com', 'sandbox.asaas.com'])

    if (
      url.protocol !== 'https:' ||
      !allowedHostnames.has(url.hostname) ||
      !url.pathname.startsWith(ASAAS_API_VERSION_PATH)
    ) {
      throw new PublicApiError(500, 'Configuracao de pagamento invalida.')
    }

    return configuredUrl.replace(/\/+$/, '')
  }

  return apiKey.includes('_prod_')
    ? `https://api.asaas.com${ASAAS_API_VERSION_PATH}`
    : `https://sandbox.asaas.com${ASAAS_API_VERSION_PATH}`
}

function validateRequestOrigin(req: Request) {
  const origin = req.headers.get('origin')

  if (!origin) {
    throw new PublicApiError(403, 'Origem da requisicao nao autorizada.')
  }

  const requestOrigin = new URL(req.url).origin
  const configuredOrigin = process.env.APP_ORIGIN?.trim()
  const allowedOrigins = new Set(
    [requestOrigin, configuredOrigin].filter(Boolean)
  )

  if (!allowedOrigins.has(origin)) {
    throw new PublicApiError(403, 'Origem da requisicao nao autorizada.')
  }
}

async function readJsonBody(req: Request) {
  try {
    return (await req.json()) as PaymentRequestBody
  } catch {
    throw new PublicApiError(400, 'JSON invalido.')
  }
}

async function postToAsaas<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  let data: unknown = null

  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    console.error('Asaas request failed', {
      path,
      status: response.status,
      response: data,
    })

    throw new PublicApiError(
      502,
      'Nao foi possivel processar o pagamento agora.'
    )
  }

  return data as T
}

async function createAsaasCustomer(
  baseUrl: string,
  apiKey: string,
  nome: string,
  email: string,
  whatsapp: string
) {
  const data = await postToAsaas<AsaasCustomerResponse>(
    baseUrl,
    apiKey,
    '/customers',
    {
      name: nome,
      email,
      mobilePhone: whatsapp,
    }
  )

  if (!data.id) {
    console.error('Asaas customer response without id', { response: data })
    throw new PublicApiError(
      502,
      'Nao foi possivel processar o pagamento agora.'
    )
  }

  return data.id
}

export async function POST(req: Request) {
  try {
    validateRequestOrigin(req)

    const contentLength = Number(req.headers.get('content-length') || 0)

    if (contentLength > MAX_REQUEST_BYTES) {
      return jsonError('Pedido muito grande.', 413)
    }

    const contentType = req.headers.get('content-type') || ''

    if (!contentType.toLowerCase().includes('application/json')) {
      return jsonError('Envie os dados em JSON.', 415)
    }

    const body = await readJsonBody(req)

    if (!isRecord(body)) {
      throw new PublicApiError(400, 'Pedido invalido.')
    }

    const nome = readTextField(body.nome, 'o nome completo', 120)
    const email = readEmail(body.email)
    const whatsapp = readWhatsapp(body.whatsapp)
    const tipoImpressao = readPrintType(body.tipoImpressao)
    const quantidadePaginas = readPageCount(body.quantidadePaginas)
    const valor = Number(
      (PRICE_BY_PRINT_TYPE[tipoImpressao] * quantidadePaginas).toFixed(2)
    )
    const dueDate = new Date().toISOString().split('T')[0]
    const externalReference = globalThis.crypto.randomUUID()

    const apiKey = getAsaasApiKey()
    const baseUrl = getAsaasBaseUrl(apiKey)

    const customerId = await createAsaasCustomer(
      baseUrl,
      apiKey,
      nome,
      email,
      whatsapp
    )

    const paymentData = await postToAsaas<AsaasPaymentResponse>(
      baseUrl,
      apiKey,
      '/payments',
      {
        customer: customerId,
        billingType: 'PIX',
        value: valor,
        dueDate,
        description: 'Pedido de impressao',
        externalReference,
      }
    )

    const invoiceUrl = paymentData.invoiceUrl || paymentData.bankSlipUrl

    if (!paymentData.id || !invoiceUrl) {
      console.error('Asaas payment response incomplete', {
        response: paymentData,
      })

      throw new PublicApiError(
        502,
        'Nao foi possivel processar o pagamento agora.'
      )
    }

    return NextResponse.json({
      paymentId: paymentData.id,
      invoiceUrl,
      value: valor,
      dueDate: paymentData.dueDate || dueDate,
    })
  } catch (error) {
    if (error instanceof PublicApiError) {
      return jsonError(error.publicMessage, error.status)
    }

    console.error('Unexpected payment route error', { error })
    return jsonError('Erro interno ao criar pagamento.', 500)
  }
}
