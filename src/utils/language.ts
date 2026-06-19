import type { UiLanguage } from "~types"

export function getDefaultUiLanguage(): UiLanguage {
  const browserLanguage =
    (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== "undefined" && navigator.language) ||
    ""

  return browserLanguage.toLowerCase().startsWith("zh") ? "zh" : "en"
}

export function normalizeUiLanguage(value: unknown): UiLanguage | null {
  if (value === "zh" || value === "en") return value
  return null
}
