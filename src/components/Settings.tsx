import { useEffect, useState } from "react"

interface SettingsProps {
  apiKey: string
  apiBaseUrl: string
  onSave: (key: string, baseUrl: string) => void
  onClose: () => void
}

const PRESETS = [
  { label: "OpenAI", value: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", value: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "Custom", value: "", model: "" }
]

export default function Settings({ apiKey, apiBaseUrl, onSave, onClose }: SettingsProps) {
  const [key, setKey] = useState(apiKey)
  const [baseUrl, setBaseUrl] = useState(apiBaseUrl || "https://api.openai.com/v1")
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const match = PRESETS.find((p) => p.value === (apiBaseUrl || "https://api.openai.com/v1"))
    return match ? match.label : "Custom"
  })

  function handlePresetClick(label: string) {
    setSelectedPreset(label)
    const preset = PRESETS.find((p) => p.label === label)
    if (preset && preset.value) {
      setBaseUrl(preset.value)
    }
  }

  async function handleSave() {
    await chrome.storage.local.set({ apiKey: key, apiBaseUrl: baseUrl })
    await chrome.runtime.sendMessage({ action: "set-api-key" })
    onSave(key, baseUrl)
  }

  return (
    <div style={styles.container}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e4e4e7" }}>
        Settings
      </h2>

      <div>
        <div style={styles.label}>API Provider</div>
        <div style={{ display: "flex", gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => handlePresetClick(p.label)}
              style={{
                ...styles.presetBtn,
                ...(selectedPreset === p.label ? styles.presetBtnActive : {})
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={styles.label}>API Base URL</div>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value)
            setSelectedPreset("Custom")
          }}
          placeholder="https://api.deepseek.com"
          style={styles.input}
        />
      </div>

      <div>
        <div style={styles.label}>API Key</div>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-..."
          style={styles.input}
        />
        <p style={{ fontSize: 12, color: "#52525b", marginTop: 6 }}>
          Your key is stored locally and only sent to the API provider you configured.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={handleSave} style={styles.btn}>
          Save
        </button>
        <button onClick={onClose} style={styles.secondaryBtn}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#a1a1aa",
    marginBottom: 6
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #3f3f46",
    background: "#18181b",
    color: "#e4e4e7",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box"
  },
  presetBtn: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #3f3f46",
    background: "#27272a",
    color: "#a1a1aa",
    fontSize: 13,
    cursor: "pointer"
  },
  presetBtnActive: {
    background: "#6366f1",
    borderColor: "#6366f1",
    color: "#fff"
  },
  btn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer"
  },
  secondaryBtn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #3f3f46",
    background: "transparent",
    color: "#a1a1aa",
    fontSize: 14,
    cursor: "pointer"
  }
}
