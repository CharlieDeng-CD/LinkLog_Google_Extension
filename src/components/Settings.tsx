import React, { useState } from "react"
import type { UiLanguage } from "~types"

interface SettingsProps {
  apiKey: string
  apiBaseUrl: string
  language: UiLanguage
  onSave: (key: string, baseUrl: string) => void
  onClose: () => void
}

const DEFAULT_HOSTED_URL = process.env.PLASMO_PUBLIC_LINKLOG_API_BASE_URL || ""
const SHOW_ADVANCED_SETTINGS =
  process.env.PLASMO_PUBLIC_LINKLOG_SHOW_ADVANCED_SETTINGS === "true"

const PRESETS = [
  ...(DEFAULT_HOSTED_URL
    ? [{ label: "Hosted Trial", value: DEFAULT_HOSTED_URL, model: "deepseek-chat" }]
    : []),
  { label: "OpenAI", value: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", value: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "Custom", value: "", model: "" }
]

const COPY = {
  en: {
    title: "Settings",
    hostedTitle: "LinkLog Hosted Trial",
    hostedStatus: "You are using the hosted trial service. No API key is required.",
    hostedDetail: "LinkLog sends requests through its backend proxy so trial users can start immediately.",
    advanced: "Advanced API settings",
    provider: "API Provider",
    baseUrl: "API Base URL",
    apiKey: "API Key",
    hostedPlaceholder: "Not required for hosted trial",
    hostedHelp: "Hosted Trial uses the LinkLog backend proxy. Users do not need an API key.",
    keyHelp: "Your key stays in local Chrome storage and is only sent to the provider you choose.",
    save: "Save",
    cancel: "Cancel"
  },
  zh: {
    title: "设置",
    hostedTitle: "LinkLog Hosted Trial",
    hostedStatus: "当前正在使用试用服务，不需要填写 API Key。",
    hostedDetail: "LinkLog 会通过后端代理请求模型，试用用户可以直接开始使用。",
    advanced: "高级 API 设置",
    provider: "API 服务商",
    baseUrl: "API Base URL",
    apiKey: "API Key",
    hostedPlaceholder: "Hosted Trial 不需要填写",
    hostedHelp: "Hosted Trial 使用 LinkLog 后端代理，用户不需要填写 API Key。",
    keyHelp: "你的 API Key 只保存在本地 Chrome storage 中，并只会发送给你选择的服务商。",
    save: "保存",
    cancel: "取消"
  }
}

export default function Settings({
  apiKey,
  apiBaseUrl,
  language,
  onSave,
  onClose
}: SettingsProps) {
  const copy = COPY[language]
  const hasHostedTrial = Boolean(DEFAULT_HOSTED_URL)
  const [key, setKey] = useState(apiKey)
  const [baseUrl, setBaseUrl] = useState(apiBaseUrl || DEFAULT_HOSTED_URL || "https://api.deepseek.com")
  const canShowAdvanced = !hasHostedTrial || SHOW_ADVANCED_SETTINGS
  const [showAdvanced, setShowAdvanced] = useState(!hasHostedTrial)
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const match = PRESETS.find((p) => p.value && p.value === (apiBaseUrl || DEFAULT_HOSTED_URL || "https://api.deepseek.com"))
    return match ? match.label : "Custom"
  })

  function handlePresetClick(label: string) {
    setSelectedPreset(label)
    const preset = PRESETS.find((p) => p.label === label)
    if (preset && preset.value) {
      setBaseUrl(preset.value)
      if (label === "Hosted Trial") setKey("")
    }
  }

  async function handleSave() {
    await chrome.storage.local.set({ apiKey: key, apiBaseUrl: baseUrl })
    await chrome.runtime.sendMessage({ action: "set-api-key" })
    onSave(key, baseUrl)
  }

  return (
    <div style={styles.container}>
      <h2 style={{ fontSize: 18, fontWeight: 760, color: "#1d1a15", margin: 0 }}>
        {copy.title}
      </h2>

      {hasHostedTrial && (
        <section style={styles.hostedPanel}>
          <div style={styles.hostedBadge}>ACTIVE</div>
          <div style={styles.hostedTitle}>{copy.hostedTitle}</div>
          <p style={styles.hostedText}>{copy.hostedStatus}</p>
          <p style={styles.hostedSubtext}>{copy.hostedDetail}</p>
        </section>
      )}

      {hasHostedTrial && canShowAdvanced && (
        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          style={styles.advancedToggle}
        >
          {showAdvanced ? "−" : "+"} {copy.advanced}
        </button>
      )}

      {showAdvanced && canShowAdvanced && (
        <>
          <div>
            <div style={styles.label}>{copy.provider}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
            <div style={styles.label}>{copy.baseUrl}</div>
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
            <div style={styles.label}>{copy.apiKey}</div>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={selectedPreset === "Hosted Trial" ? copy.hostedPlaceholder : "sk-..."}
              style={styles.input}
            />
            <p style={{ fontSize: 12, color: "#52525b", marginTop: 6 }}>
              {selectedPreset === "Hosted Trial"
                ? copy.hostedHelp
                : copy.keyHelp}
            </p>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {showAdvanced && canShowAdvanced && (
          <button onClick={handleSave} style={styles.btn}>
            {copy.save}
          </button>
        )}
        <button
          onClick={onClose}
          style={showAdvanced && canShowAdvanced ? styles.secondaryBtn : styles.btn}
        >
          {copy.cancel}
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
    gap: 16,
    background: "#f7f3ea",
    color: "#25231e"
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#5f574b",
    marginBottom: 6
  },
  hostedPanel: {
    border: "1px solid #ded3c2",
    borderRadius: 8,
    background: "#fffaf0",
    padding: 14
  },
  hostedBadge: {
    display: "inline-flex",
    alignItems: "center",
    height: 20,
    padding: "0 8px",
    borderRadius: 999,
    background: "#e4efe8",
    color: "#315f46",
    fontSize: 10,
    fontWeight: 850,
    letterSpacing: 0
  },
  hostedTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: 780,
    color: "#1d1a15"
  },
  hostedText: {
    margin: "6px 0 0",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#3d372f"
  },
  hostedSubtext: {
    margin: "5px 0 0",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#746a5b"
  },
  advancedToggle: {
    width: "100%",
    padding: "8px 0",
    border: "none",
    background: "transparent",
    color: "#746a5b",
    fontSize: 12,
    fontWeight: 750,
    textAlign: "left" as const,
    cursor: "pointer"
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d7cbb8",
    background: "#fffaf0",
    color: "#25231e",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box"
  },
  presetBtn: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #d7cbb8",
    background: "#fffaf0",
    color: "#5f574b",
    fontSize: 13,
    cursor: "pointer"
  },
  presetBtnActive: {
    background: "#26392f",
    borderColor: "#26392f",
    color: "#fffaf0"
  },
  btn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #26392f",
    background: "#26392f",
    color: "#fffaf0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer"
  },
  secondaryBtn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #d7cbb8",
    background: "transparent",
    color: "#5f574b",
    fontSize: 14,
    cursor: "pointer"
  }
}
