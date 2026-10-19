import { useState } from 'react'
import { API_BASE, setAccessKey } from '../lib/api'

/** Shown when the backend answers 401: asks for the access key and reloads. */
export function AccessGate() {
  const [key, setKey] = useState('')
  return (
    <div className="gate">
      <form
        className="card gate-card"
        onSubmit={(e) => {
          e.preventDefault()
          setAccessKey(key.trim())
          window.location.reload()
        }}
      >
        <h2>Access key needed</h2>
        <p className="hint">
          The backend{API_BASE ? ` at ${API_BASE}` : ''} rejected this browser. Enter the access key (the backend's <code>ACCESS_KEY</code>). It is
          saved in this browser only.
        </p>
        <input type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="Access key" />
        <button className="primary" type="submit" disabled={!key.trim()}>
          Continue
        </button>
      </form>
    </div>
  )
}
