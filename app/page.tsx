'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
const MAX_PAGES = 500

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)

  const [nomeCliente, setNomeCliente] = useState('')
  const [whatsappCliente, setWhatsappCliente] = useState('')
  const [emailCliente, setEmailCliente] = useState('')

  const [tipoImpressao, setTipoImpressao] = useState<'pb' | 'colorido'>('pb')
  const [quantidadePaginas, setQuantidadePaginas] = useState(1)

  const preco = tipoImpressao === 'pb' ? 2.5 : 3.5
  const valorTotal = preco * quantidadePaginas

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)

    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0]
    setMensagem('')

    if (!selectedFile) {
      setFile(null)
      return
    }

    const isPdf =
      selectedFile.type === 'application/pdf' ||
      selectedFile.name.toLowerCase().endsWith('.pdf')

    if (!isPdf) {
      setFile(null)
      e.target.value = ''
      setMensagem('Selecione um arquivo PDF valido.')
      return
    }

    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setFile(null)
      e.target.value = ''
      setMensagem('O PDF deve ter no maximo 20 MB.')
      return
    }

    setFile(selectedFile)
  }

  function handlePageCountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const pageCount = Number(e.target.value)

    if (!Number.isInteger(pageCount)) {
      setQuantidadePaginas(1)
      return
    }

    setQuantidadePaginas(Math.min(Math.max(pageCount, 1), MAX_PAGES))
  }

  function limparNomeArquivo(nome: string) {
    return nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9.]/g, '_')
  }

  function getStorageErrorMessage(message: string) {
    if (/failed to fetch|network|fetch/i.test(message)) {
      return 'Nao foi possivel enviar o PDF. Verifique as variaveis do Supabase na Vercel e as regras/CORS do bucket arquivos.'
    }

    if (/bucket|not found/i.test(message)) {
      return 'Bucket de arquivos nao encontrado no Supabase.'
    }

    if (/row-level security|permission|unauthorized|forbidden/i.test(message)) {
      return 'O Supabase bloqueou o envio. Revise as politicas de upload do bucket arquivos.'
    }

    return message || 'Nao foi possivel enviar o PDF.'
  }

  async function enviarArquivo() {
    if (enviando) return

    const nomeClienteLimpo = nomeCliente.trim()
    const whatsappClienteLimpo = whatsappCliente.trim()
    const emailClienteLimpo = emailCliente.trim()

    if (!file || !nomeClienteLimpo || !whatsappClienteLimpo || !emailClienteLimpo) {
      setMensagem('Preencha todos os campos e selecione um PDF.')
      return
    }

    if (
      file.size > MAX_FILE_SIZE_BYTES ||
      !(
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
      )
    ) {
      setMensagem('Selecione um PDF valido de ate 20 MB.')
      return
    }

    if (
      !Number.isInteger(quantidadePaginas) ||
      quantidadePaginas < 1 ||
      quantidadePaginas > MAX_PAGES
    ) {
      setMensagem(`Informe entre 1 e ${MAX_PAGES} paginas.`)
      return
    }

    setEnviando(true)
    setMensagem('')

    const nomeLimpo = limparNomeArquivo(file.name)
    const fileName = `${Date.now()}-${nomeLimpo}`

    try {
      if (!isSupabaseConfigured || !supabase) {
        setMensagem(
          'Supabase nao configurado. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel.'
        )
        return
      }

      const { error: uploadError } = await supabase.storage
        .from('arquivos')
        .upload(fileName, file, {
          contentType: 'application/pdf',
          upsert: false,
        })

      if (uploadError) {
        setMensagem(getStorageErrorMessage(uploadError.message))
        return
      }

      const { data } = supabase.storage.from('arquivos').getPublicUrl(fileName)

      const pagamento = await fetch('/api/criar-pagamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nomeClienteLimpo,
          email: emailClienteLimpo,
          whatsapp: whatsappClienteLimpo,
          tipoImpressao,
          quantidadePaginas,
        }),
      })

      const pagamentoData = await pagamento.json()

      if (!pagamento.ok) {
        setMensagem(pagamentoData.error || 'Erro ao gerar pagamento.')
        return
      }

      if (!pagamentoData.invoiceUrl || typeof pagamentoData.value !== 'number') {
        setMensagem('Resposta de pagamento invalida. Tente novamente.')
        return
      }

      const { error } = await supabase.from('pedidos_impressao').insert([
        {
          nome_arquivo: file.name,
          url_arquivo: data.publicUrl,
          status: 'aguardando_pagamento',
          nome_cliente: nomeClienteLimpo,
          whatsapp_cliente: whatsappClienteLimpo,
          email_cliente: emailClienteLimpo,
          tipo_impressao: tipoImpressao,
          quantidade_paginas: quantidadePaginas,
          valor: pagamentoData.value,
          payment_link: pagamentoData.invoiceUrl,
        },
      ])

      if (error) {
        setMensagem(error.message)
        return
      }

      setMensagem(`Pagamento gerado com sucesso: ${pagamentoData.invoiceUrl}`)
    } catch {
      setMensagem('Nao foi possivel concluir o pedido. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.bgGlowOne} />
      <div style={styles.bgGlowTwo} />

      <div style={styles.wrapper}>
        <section style={styles.leftCard}>
          <div style={styles.headerRow}>
            <div style={styles.logoWrap}>
              <Image
                src="/logo-maleiro-digital.png"
                alt="Maleiro Digital"
                width={72}
                height={72}
                style={{ objectFit: 'contain' }}
              />
            </div>

            <div>
              <span style={styles.badge}>Maleiro Digital</span>
              <h1 style={styles.title}>Impressão inteligente e automática</h1>
              <p style={styles.subtitle}>
                Envie seu PDF, escolha o tipo de impressão e gere o pagamento em
                poucos segundos. A impressão só será liberada após a confirmação.
              </p>
            </div>
          </div>

          <div style={styles.formGrid}>
            <div style={styles.fullCol}>
              <label style={styles.label}>Nome completo</label>
              <input
                value={nomeCliente}
                onChange={(e) => setNomeCliente(e.target.value)}
                placeholder="Digite seu nome completo"
                autoComplete="name"
                maxLength={120}
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>WhatsApp</label>
              <input
                type="tel"
                value={whatsappCliente}
                onChange={(e) => setWhatsappCliente(e.target.value)}
                placeholder="(21) 99999-9999"
                autoComplete="tel"
                maxLength={30}
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>E-mail</label>
              <input
                type="email"
                value={emailCliente}
                onChange={(e) => setEmailCliente(e.target.value)}
                placeholder="voce@email.com"
                autoComplete="email"
                maxLength={254}
                required
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Tipo de impressão</label>
              <select
                value={tipoImpressao}
                onChange={(e) =>
                  setTipoImpressao(e.target.value as 'pb' | 'colorido')
                }
                style={styles.input}
              >
                <option value="pb">Preto e branco</option>
                <option value="colorido">Colorido</option>
              </select>
            </div>

            <div>
              <label style={styles.label}>Quantidade de páginas</label>
              <input
                type="number"
                min="1"
                max={MAX_PAGES}
                value={quantidadePaginas}
                onChange={handlePageCountChange}
                style={styles.input}
              />
            </div>

            <div style={styles.fullCol}>
              <label style={styles.label}>Arquivo PDF</label>
              <div style={styles.uploadBox}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  disabled={enviando}
                  style={styles.fileInput}
                />
                <p style={styles.uploadText}>
                  {file
                    ? `Arquivo selecionado: ${file.name}`
                    : 'Selecione um arquivo PDF para continuar'}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={enviarArquivo}
            disabled={enviando}
            style={{
              ...styles.button,
              ...(enviando ? styles.buttonDisabled : {}),
            }}
          >
            {enviando ? 'Enviando pedido...' : 'Gerar pagamento e enviar pedido'}
          </button>

          {mensagem && (
            <div style={styles.messageBox}>
              <strong style={{ display: 'block', marginBottom: 6 }}>
                Status do pedido
              </strong>
              <span>{mensagem}</span>
            </div>
          )}
        </section>

        <section style={styles.rightCol}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryTop}>
              <div>
                <p style={styles.summaryLabel}>Resumo do pedido</p>
                <h2 style={styles.summaryTitle}>Seu pedido em tempo real</h2>
              </div>
              <span style={styles.summaryChip}>
                {tipoImpressao === 'pb' ? 'PB' : 'Colorido'}
              </span>
            </div>

            <div style={styles.summaryList}>
              <ResumoItem
                label="Tipo"
                value={tipoImpressao === 'pb' ? 'Preto e branco' : 'Colorido'}
              />
              <ResumoItem label="Páginas" value={String(quantidadePaginas)} />
              <ResumoItem
                label="Preço por página"
                value={`R$ ${preco.toFixed(2).replace('.', ',')}`}
              />
            </div>

            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Valor total</span>
              <strong style={styles.totalValue}>
                R$ {valorTotal.toFixed(2).replace('.', ',')}
              </strong>
            </div>
          </div>

          <div style={styles.previewCard}>
            <div style={styles.previewHeader}>
              <div>
                <p style={styles.previewMini}>Visualização</p>
                <h3 style={styles.previewTitle}>Prévia do arquivo</h3>
              </div>
              <span style={styles.pdfTag}>PDF</span>
            </div>

            {previewUrl ? (
              <div style={styles.iframeWrap}>
                <iframe
                  src={previewUrl}
                  title="Pré-visualização do PDF"
                  style={styles.iframe}
                />
              </div>
            ) : (
              <div style={styles.emptyPreview}>
                Seu PDF aparecerá aqui antes da geração do pagamento.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function ResumoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.summaryItem}>
      <span style={styles.summaryItemLabel}>{label}</span>
      <strong style={styles.summaryItemValue}>{value}</strong>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    position: 'relative',
    overflow: 'hidden',
    background:
      'radial-gradient(circle at top left, rgba(27,173,255,0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(255,145,0,0.12), transparent 22%), linear-gradient(135deg, #f4f8fc 0%, #eef5ff 48%, #fff8f1 100%)',
    padding: '28px 18px',
    fontFamily:
      'Inter, Arial, Helvetica, sans-serif',
  },
  bgGlowOne: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: '50%',
    background: 'rgba(20, 192, 255, 0.16)',
    filter: 'blur(60px)',
    pointerEvents: 'none',
  },
  bgGlowTwo: {
    position: 'absolute',
    bottom: -100,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: '50%',
    background: 'rgba(255, 153, 0, 0.18)',
    filter: 'blur(70px)',
    pointerEvents: 'none',
  },
  wrapper: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 1220,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '1.08fr 0.92fr',
    gap: 24,
  },
  leftCard: {
    background: 'rgba(255,255,255,0.8)',
    backdropFilter: 'blur(16px)',
    border: '1px solid rgba(11,74,143,0.08)',
    borderRadius: 30,
    padding: 30,
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.08)',
  },
  headerRow: {
    display: 'flex',
    gap: 18,
    alignItems: 'flex-start',
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #e3edf8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 25px rgba(11,74,143,0.08)',
    flexShrink: 0,
  },
  badge: {
    display: 'inline-flex',
    padding: '8px 12px',
    borderRadius: 999,
    background: '#eaf5ff',
    color: '#0b4a8f',
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 12,
  },
  title: {
    margin: 0,
    fontSize: 40,
    lineHeight: 1.05,
    color: '#083c75',
    fontWeight: 800,
    letterSpacing: '-0.03em',
  },
  subtitle: {
    marginTop: 14,
    marginBottom: 0,
    color: '#58687a',
    fontSize: 16,
    lineHeight: 1.65,
    maxWidth: 700,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  fullCol: {
    gridColumn: '1 / -1',
  },
  label: {
    display: 'block',
    marginBottom: 8,
    color: '#183b63',
    fontSize: 14,
    fontWeight: 700,
  },
  input: {
    width: '100%',
    padding: '15px 16px',
    borderRadius: 18,
    border: '1px solid #d4e3f3',
    background: '#fff',
    fontSize: 15,
    color: '#1b2c3d',
    boxSizing: 'border-box',
    outline: 'none',
    boxShadow: 'inset 0 1px 2px rgba(11,74,143,0.03)',
  },
  uploadBox: {
    border: '2px dashed #c8dcf0',
    borderRadius: 22,
    background: '#f8fbff',
    padding: 18,
  },
  fileInput: {
    width: '100%',
  },
  uploadText: {
    marginTop: 10,
    marginBottom: 0,
    color: '#667789',
    fontSize: 14,
  },
  button: {
    marginTop: 24,
    width: '100%',
    border: 'none',
    borderRadius: 20,
    padding: '17px 20px',
    background: 'linear-gradient(90deg, #ff8300 0%, #ffb400 100%)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 16px 34px rgba(255, 138, 0, 0.28)',
  },
  buttonDisabled: {
    opacity: 0.68,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  messageBox: {
    marginTop: 18,
    padding: '16px 18px',
    borderRadius: 18,
    background: '#eef7ff',
    border: '1px solid #c8e1fb',
    color: '#0b4a8f',
    fontSize: 14,
    lineHeight: 1.55,
    wordBreak: 'break-word',
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  summaryCard: {
    borderRadius: 30,
    padding: 28,
    color: '#fff',
    background:
      'linear-gradient(135deg, #083c75 0%, #0a57a4 45%, #14bfff 100%)',
    boxShadow: '0 24px 60px rgba(11,74,143,0.24)',
  },
  summaryTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'flex-start',
  },
  summaryLabel: {
    margin: 0,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    opacity: 0.8,
  },
  summaryTitle: {
    marginTop: 10,
    marginBottom: 0,
    fontSize: 26,
    lineHeight: 1.1,
  },
  summaryChip: {
    padding: '8px 12px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.14)',
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
  },
  summaryList: {
    display: 'grid',
    gap: 14,
    marginTop: 22,
  },
  summaryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'center',
  },
  summaryItemLabel: {
    fontSize: 14,
    opacity: 0.82,
  },
  summaryItemValue: {
    fontSize: 15,
  },
  totalRow: {
    marginTop: 24,
    paddingTop: 18,
    borderTop: '1px solid rgba(255,255,255,0.18)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 15,
    opacity: 0.9,
  },
  totalValue: {
    fontSize: 31,
    letterSpacing: '-0.03em',
  },
  previewCard: {
    background: 'rgba(255,255,255,0.84)',
    backdropFilter: 'blur(16px)',
    border: '1px solid rgba(11,74,143,0.08)',
    borderRadius: 30,
    padding: 20,
    boxShadow: '0 18px 50px rgba(16,24,40,0.06)',
    minHeight: 430,
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  previewMini: {
    margin: 0,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#6a7a8b',
  },
  previewTitle: {
    marginTop: 8,
    marginBottom: 0,
    fontSize: 22,
    color: '#163b66',
  },
  pdfTag: {
    fontSize: 12,
    color: '#ff7d00',
    background: '#fff3e8',
    borderRadius: 999,
    padding: '6px 10px',
    fontWeight: 800,
  },
  iframeWrap: {
    height: 350,
    borderRadius: 20,
    overflow: 'hidden',
    border: '1px solid #d8e8f7',
    background: '#f8fbff',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
  },
  emptyPreview: {
    height: 350,
    borderRadius: 20,
    border: '2px dashed #c7dcef',
    background: '#fbfdff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: '#6b7b8c',
    padding: 20,
    lineHeight: 1.6,
  },
}
