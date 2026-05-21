'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function ConnectForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !apiKey.trim()) return

    setStatus('loading')
    try {
      const res = await fetch('/api/pod/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, wallbitApiKey: apiKey.trim() }),
      })

      if (!res.ok) {
        const data = await res.json()
        setErrorMsg(data.error ?? 'Algo salió mal')
        setStatus('error')
        return
      }

      setStatus('done')
    } catch {
      setErrorMsg('Error de conexión — revisá tu internet e intentá de nuevo')
      setStatus('error')
    }
  }

  if (!token) {
    return <p style={styles.subtitle}>Link inválido. Pedile un nuevo link al bot.</p>
  }

  if (status === 'done') {
    return <p style={styles.subtitle}>✅ Cuenta Wallbit conectada. Podés cerrar esta página.</p>
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <input
        type="text"
        placeholder="Pegá tu Wallbit API key aquí"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        style={styles.input}
        autoComplete="off"
        spellCheck={false}
      />
      {status === 'error' && <p style={styles.error}>{errorMsg}</p>}
      <button
        type="submit"
        disabled={status === 'loading' || !apiKey.trim()}
        style={styles.button}
      >
        {status === 'loading' ? 'Conectando...' : 'Conectar cuenta'}
      </button>
    </form>
  )
}

export default function ConnectPage() {
  return (
    <main style={styles.container}>
      <h1 style={styles.title}>Conectar cuenta Wallbit</h1>
      <p style={styles.subtitle}>
        Tu API key va directamente a nuestro servidor encriptado. Nunca la guardamos en texto plano.
      </p>
      <Suspense fallback={<p style={styles.subtitle}>Cargando...</p>}>
        <ConnectForm />
      </Suspense>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
    margin: '80px auto',
    padding: '0 24px',
    fontFamily: 'system-ui, sans-serif',
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    marginBottom: 8,
  },
  subtitle: {
    color: '#666',
    marginBottom: 24,
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    padding: '12px 14px',
    fontSize: 14,
    border: '1px solid #ddd',
    borderRadius: 8,
    outline: 'none',
  },
  button: {
    padding: '12px',
    fontSize: 15,
    fontWeight: 600,
    background: '#000',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  error: {
    color: '#c00',
    fontSize: 13,
  },
}
