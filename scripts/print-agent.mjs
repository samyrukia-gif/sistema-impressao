import { createClient } from '@supabase/supabase-js'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue
      }

      const [key, ...valueParts] = trimmed.split('=')
      const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '')

      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch {
    // Env files are optional. Missing files should not stop the agent.
  }
}

await loadEnvFile(path.resolve('.env.local'))
await loadEnvFile(path.resolve('.env.print-agent.local'))

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const pollMs = Number.parseInt(process.env.PRINT_AGENT_POLL_MS || '15000', 10)
const simulatePrint = (process.env.PRINT_AGENT_SIMULATE ?? 'true') !== 'false'
const printerName = process.env.PRINT_AGENT_PRINTER_NAME?.trim()
const runOnce = process.argv.includes('--once') || process.env.PRINT_AGENT_ONCE === 'true'
const printTimeoutMs = Number.parseInt(
  process.env.PRINT_AGENT_PRINT_TIMEOUT_MS || '90000',
  10
)
const configuredPdfPrinterPath = process.env.SUMATRA_PDF_PATH?.trim()
const downloadDir = path.resolve(
  process.env.PRINT_AGENT_DOWNLOAD_DIR || 'print-agent-downloads'
)

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de iniciar o agente.'
  )
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

function log(message, meta = {}) {
  const suffix = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
  process.stdout.write(`[print-agent] ${new Date().toISOString()} ${message}${suffix}\n`)
}

function cleanFileName(name) {
  return String(name || 'pedido.pdf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.-]/g, '_')
}

async function findPaidOrder() {
  const { data, error } = await supabase
    .from('pedidos_impressao')
    .select('id,nome_arquivo,storage_path,url_arquivo,status,paid_at')
    .eq('status', 'pago')
    .order('paid_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Erro ao buscar pedidos pagos: ${error.message}`)
  }

  return data
}

async function claimOrder(orderId) {
  const { data, error } = await supabase
    .from('pedidos_impressao')
    .update({
      status: 'em_impressao',
      print_started_at: new Date().toISOString(),
      print_error: null,
    })
    .eq('id', orderId)
    .eq('status', 'pago')
    .select('id,nome_arquivo,storage_path,url_arquivo')
    .maybeSingle()

  if (error) {
    throw new Error(`Erro ao reservar pedido: ${error.message}`)
  }

  return data
}

async function downloadOrderPdf(order) {
  await mkdir(downloadDir, { recursive: true })

  const fileName = `${order.id}-${cleanFileName(order.nome_arquivo)}`
  const localPath = path.join(downloadDir, fileName)
  let bytes

  if (order.storage_path) {
    const { data, error } = await supabase.storage
      .from('arquivos')
      .download(order.storage_path)

    if (error) {
      throw new Error(`Erro ao baixar PDF do Supabase: ${error.message}`)
    }

    bytes = Buffer.from(await data.arrayBuffer())
  } else if (order.url_arquivo) {
    const response = await fetch(order.url_arquivo)

    if (!response.ok) {
      throw new Error(`Erro ao baixar PDF pela URL publica: HTTP ${response.status}`)
    }

    bytes = Buffer.from(await response.arrayBuffer())
  } else {
    throw new Error('Pedido sem storage_path ou url_arquivo.')
  }

  await writeFile(localPath, bytes)
  return localPath
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findSumatraPdf() {
  const candidates = [
    configuredPdfPrinterPath,
    path.resolve('tools', 'SumatraPDF', 'SumatraPDF.exe'),
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'SumatraPDF', 'SumatraPDF.exe')
      : null,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }

  return null
}

async function runPrintCommand(exePath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, { windowsHide: true })
    let stderr = ''
    let stdout = ''

    const timer = setTimeout(() => {
      child.kill()
      reject(
        new Error(
          `Tempo limite de impressao atingido (${printTimeoutMs}ms). Verifique se a impressora esta ligada e sem janelas abertas.`
        )
      )
    }, printTimeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('exit', (code) => {
      clearTimeout(timer)

      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `Comando de impressao saiu com codigo ${code}`
        )
      )
    })
  })
}

async function printPdf(localPath) {
  if (simulatePrint) {
    log('Simulacao ativa, nao vou imprimir de verdade.', { localPath })
    return
  }

  if (!printerName) {
    throw new Error('Configure PRINT_AGENT_PRINTER_NAME para imprimir de verdade.')
  }

  const sumatraPath = await findSumatraPdf()

  if (!sumatraPath) {
    throw new Error(
      'SumatraPDF nao encontrado. Baixe a versao portatil em tools\\SumatraPDF ou configure SUMATRA_PDF_PATH.'
    )
  }

  await runPrintCommand(sumatraPath, [
    '-print-to',
    printerName,
    '-silent',
    '-exit-when-done',
    localPath,
  ])
}

async function finishOrder(orderId, localPath) {
  const { error } = await supabase
    .from('pedidos_impressao')
    .update({
      status: simulatePrint ? 'simulado' : 'impresso',
      local_file_path: localPath,
      printed_at: new Date().toISOString(),
      print_error: null,
    })
    .eq('id', orderId)

  if (error) {
    throw new Error(`Erro ao finalizar pedido: ${error.message}`)
  }
}

async function failOrder(orderId, error) {
  const { error: updateError } = await supabase
    .from('pedidos_impressao')
    .update({
      status: 'erro_impressao',
      print_error: error instanceof Error ? error.message : String(error),
    })
    .eq('id', orderId)

  if (updateError) {
    log('Erro ao registrar falha no Supabase.', { message: updateError.message })
  }
}

async function processOnce() {
  const pendingOrder = await findPaidOrder()

  if (!pendingOrder) {
    log('Nenhum pedido pago aguardando impressao.')
    return
  }

  const order = await claimOrder(pendingOrder.id)

  if (!order) {
    log('Pedido ja foi reservado por outro agente.', { id: pendingOrder.id })
    return
  }

  log('Pedido reservado.', { id: order.id, arquivo: order.nome_arquivo })

  try {
    const localPath = await downloadOrderPdf(order)
    log('PDF baixado.', { id: order.id, localPath })
    await printPdf(localPath)
    await finishOrder(order.id, localPath)
    log('Pedido finalizado.', { id: order.id, status: simulatePrint ? 'simulado' : 'impresso' })
  } catch (error) {
    await failOrder(order.id, error)
    throw error
  }
}

async function main() {
  log('Agente iniciado.', {
    simulatePrint,
    runOnce,
    pollMs,
    printTimeoutMs,
    printerName: printerName || null,
    downloadDir,
  })

  for (;;) {
    try {
      await processOnce()
    } catch (error) {
      log('Erro no ciclo do agente.', {
        message: error instanceof Error ? error.message : String(error),
      })
    }

    if (runOnce) {
      log('Execucao unica concluida.')
      break
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

main()
