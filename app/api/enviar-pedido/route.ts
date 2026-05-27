import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const ASAAS_API_VERSION_PATH = '/v3'
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_FILE_SIZE_BYTES + 50_000
const MAX_PAGES = 500

const PRICE_BY_PRINT_TYPE = {
  pb: 2.5,
  colorido: 3.5,
} as const

type PrintType = keyof typeof PRICE_BY_PRINT_TYPE

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

function readTextField(value: FormDataEntryValue | null, fieldName: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new PublicApiError(400, `Informe ${fieldName}.`)
  }

  const normalized = value.trim().replace(/\s+/g, ' ')

  if (!normalized || normalized.length > maxLength) {
    throw new PublicApiError(400, `Informe ${fieldName} valido.`)
  }

  return normalized
}

function readEmail(value: FormDataEntryValue | null) {
  const email = readTextField(value, 'um e-mail', 254).toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PublicApiError(400, 'Informe um e-mail valido.')
  }

  return email
}

function readWhatsapp(value: FormDataEntryValue | null) {
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

function readPrintType(value: FormDataEntryValue | null): PrintType {
  if (value === 'pb' || value === 'colorido') {
    return value
  }

  throw new PublicApiError(400, 'Tipo de impressao invalido.')
}

function readPageCount(value: FormDataEntryValue | null) {
  const pageCount = Number.parseInt(String(value), 10)

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

function readPdfFile(value: FormDataEntryValue | null) {
  if (!(value instanceof File)) {
    throw new PublicApiError(400, 'Selecione um arquivo PDF.')
  }

  const isPdf =
    value.type === 'application/pdf' ||
    value.name.toLowerCase().endsWith('.pdf')

  if (!isPdf) {
    throw new PublicApiError(400, 'Selecione um arquivo PDF valido.')
  }

  if (value.size <= 0 || value.size > MAX_FILE_SIZE_BYTES) {
    throw new PublicApiError(400, 'O PDF deve ter no maximo 20 MB.')
  }

  return value
}

function cleanFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.]/g, '_')
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

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

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
    const allowedHostnames = new Set(['api.asaas.com', 'api-sandbox.asaas.com'])

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
    : `https://api-sandbox.asaas.com${ASAAS_API_VERSION_PATH}`
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

    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return jsonError('Envie o pedido como formulario.', 415)
    }

    const formData = await req.formData()
    const nome = readTextField(formData.get('nome'), 'o nome completo', 120)
    const email = readEmail(formData.get('email'))
    const whatsapp = readWhatsapp(formData.get('whatsapp'))
    const tipoImpressao = readPrintType(formData.get('tipoImpressao'))
    const quantidadePaginas = readPageCount(formData.get('quantidadePaginas'))
    const file = readPdfFile(formData.get('arquivo'))
    const valor = Number(
      (PRICE_BY_PRINT_TYPE[tipoImpressao] * quantidadePaginas).toFixed(2)
    )
    const dueDate = new Date().toISOString().split('T')[0]
    const externalReference = globalThis.crypto.randomUUID()

    const supabase = getSupabaseClient()
    const apiKey = getAsaasApiKey()
    const baseUrl = getAsaasBaseUrl(apiKey)
    const fileName = `${Date.now()}-${externalReference}-${cleanFileName(file.name)}`

    const { error: uploadError } = await supabase.storage
      .from('arquivos')
      .upload(fileName, file, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadError) {
      console.error('Supabase storage upload failed', {
        message: uploadError.message,
      })

      throw new PublicApiError(
        502,
        'Nao foi possivel enviar o PDF agora.'
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from('arquivos')
      .getPublicUrl(fileName)

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

    const { error: insertError } = await supabase
      .from('pedidos_impressao')
      .insert([
        {
          asaas_payment_id: paymentData.id,
          external_reference: externalReference,
          nome_arquivo: file.name,
          storage_path: fileName,
          url_arquivo: publicUrlData.publicUrl,
          status: 'aguardando_pagamento',
          nome_cliente: nome,
          whatsapp_cliente: whatsapp,
          email_cliente: email,
          tipo_impressao: tipoImpressao,
          quantidade_paginas: quantidadePaginas,
          valor,
          payment_link: invoiceUrl,
        },
      ])

    if (insertError) {
      console.error('Supabase order insert failed', {
        message: insertError.message,
      })

      throw new PublicApiError(
        502,
        'Pagamento criado, mas nao foi possivel registrar o pedido.'
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

    console.error('Unexpected order route error', { error })
    return jsonError('Erro interno ao enviar pedido.', 500)
  }
}
