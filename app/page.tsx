'use client'

import { FormEvent, useEffect, useState } from 'react'
import Image from 'next/image'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
const MAX_PAGES = 500

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)

  const [nomeCliente, setNomeCliente] = useState('')
  const [documentoCliente, setDocumentoCliente] = useState('')
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

  async function enviarArquivo(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (enviando) return

    const nomeClienteLimpo = nomeCliente.trim()
    const documentoClienteLimpo = documentoCliente.trim()
    const whatsappClienteLimpo = whatsappCliente.trim()
    const emailClienteLimpo = emailCliente.trim()

    if (
      !file ||
      !nomeClienteLimpo ||
      !documentoClienteLimpo ||
      !whatsappClienteLimpo ||
      !emailClienteLimpo
    ) {
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

    try {
      const formData = new FormData()
      formData.append('nome', nomeClienteLimpo)
      formData.append('cpfCnpj', documentoClienteLimpo)
      formData.append('email', emailClienteLimpo)
      formData.append('whatsapp', whatsappClienteLimpo)
      formData.append('tipoImpressao', tipoImpressao)
      formData.append('quantidadePaginas', String(quantidadePaginas))
      formData.append('arquivo', file)

      const resposta = await fetch('/api/enviar-pedido', {
        method: 'POST',
        body: formData,
      })

      const pedidoData = await resposta.json()

      if (!resposta.ok) {
        setMensagem(pedidoData.error || 'Erro ao enviar pedido.')
        return
      }

      if (!pedidoData.invoiceUrl || typeof pedidoData.value !== 'number') {
        setMensagem('Resposta de pagamento invalida. Tente novamente.')
        return
      }

      setMensagem(`Pagamento gerado com sucesso: ${pedidoData.invoiceUrl}`)
    } catch {
      setMensagem('Nao foi possivel concluir o pedido. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Maleiro Digital">
          <Image
            src="/logo-maleiro-digital.png"
            alt=""
            width={44}
            height={44}
            className="brand-logo"
            priority
          />
          <span>
            <strong>Maleiro Digital</strong>
            <small>Copiadora do hub</small>
          </span>
        </a>
        <div className="header-meta">
          <span>Centro</span>
          <span>PIX</span>
          <span>Retirada assistida</span>
        </div>
      </header>

      <section className="intro-band" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Impressao sob demanda</p>
          <h1 id="page-title">Pedido de impressao</h1>
        </div>
        <div className="service-note">
          <span className="status-dot" aria-hidden="true" />
          Aberto para novos pedidos
        </div>
      </section>

      <div className="workspace-layout">
        <form className="order-panel" onSubmit={enviarArquivo}>
          <div className="section-heading">
            <p>Dados do pedido</p>
            <span>Arquivo PDF, contato e pagamento</span>
          </div>

          <div className="form-grid">
            <label className="field field-wide">
              <span>Nome completo</span>
              <input
                value={nomeCliente}
                onChange={(e) => setNomeCliente(e.target.value)}
                placeholder="Digite seu nome completo"
                autoComplete="name"
                maxLength={120}
                required
              />
            </label>

            <label className="field">
              <span>CPF ou CNPJ</span>
              <input
                value={documentoCliente}
                onChange={(e) => setDocumentoCliente(e.target.value)}
                placeholder="Somente numeros"
                autoComplete="off"
                maxLength={18}
                required
              />
            </label>

            <label className="field">
              <span>WhatsApp</span>
              <input
                type="tel"
                value={whatsappCliente}
                onChange={(e) => setWhatsappCliente(e.target.value)}
                placeholder="(21) 99999-9999"
                autoComplete="tel"
                maxLength={30}
                required
              />
            </label>

            <label className="field">
              <span>E-mail</span>
              <input
                type="email"
                value={emailCliente}
                onChange={(e) => setEmailCliente(e.target.value)}
                placeholder="voce@email.com"
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>

            <fieldset className="field field-wide print-choice">
              <legend>Tipo de impressao</legend>
              <label>
                <input
                  type="radio"
                  name="tipoImpressao"
                  value="pb"
                  checked={tipoImpressao === 'pb'}
                  onChange={() => setTipoImpressao('pb')}
                />
                <span>Preto e branco</span>
                <strong>R$ 2,50</strong>
              </label>
              <label>
                <input
                  type="radio"
                  name="tipoImpressao"
                  value="colorido"
                  checked={tipoImpressao === 'colorido'}
                  onChange={() => setTipoImpressao('colorido')}
                />
                <span>Colorido</span>
                <strong>R$ 3,50</strong>
              </label>
            </fieldset>

            <label className="field">
              <span>Quantidade de paginas</span>
              <input
                type="number"
                min="1"
                max={MAX_PAGES}
                value={quantidadePaginas}
                onChange={handlePageCountChange}
              />
            </label>

            <label className="field file-field">
              <span>Arquivo PDF</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                disabled={enviando}
              />
            </label>
          </div>

          <div className="selected-file" aria-live="polite">
            <span>{file ? file.name : 'Nenhum arquivo selecionado'}</span>
            <small>PDF ate 20 MB</small>
          </div>

          <button className="primary-action" type="submit" disabled={enviando}>
            {enviando ? 'Enviando pedido...' : 'Gerar pagamento'}
          </button>

          {mensagem && (
            <div className="status-message" role="status">
              <strong>Status do pedido</strong>
              <span>{mensagem}</span>
            </div>
          )}
        </form>

        <aside className="order-sidebar" aria-label="Resumo do pedido">
          <section className="summary-panel">
            <div className="section-heading">
              <p>Resumo</p>
              <span>Atualizado em tempo real</span>
            </div>

            <div className="summary-list">
              <ResumoItem
                label="Tipo"
                value={tipoImpressao === 'pb' ? 'Preto e branco' : 'Colorido'}
              />
              <ResumoItem label="Paginas" value={String(quantidadePaginas)} />
              <ResumoItem
                label="Preco por pagina"
                value={`R$ ${preco.toFixed(2).replace('.', ',')}`}
              />
            </div>

            <div className="total-row">
              <span>Total</span>
              <strong>R$ {valorTotal.toFixed(2).replace('.', ',')}</strong>
            </div>
          </section>

          <section className="preview-panel">
            <div className="section-heading">
              <p>Previa</p>
              <span>{file ? 'PDF carregado' : 'Aguardando arquivo'}</span>
            </div>

            {previewUrl ? (
              <iframe
                src={previewUrl}
                title="Pre-visualizacao do PDF"
                className="pdf-preview"
              />
            ) : (
              <div className="empty-preview">
                <span>PDF</span>
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  )
}

function ResumoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
