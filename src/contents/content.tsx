import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"
import React, { useEffect, useRef, useState } from "react"
import type { UiLanguage } from "~types"
import { getDefaultUiLanguage, normalizeUiLanguage } from "~utils/language"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "linklog-content-ping") {
      sendResponse({ ready: true })
      return false
    }

    return false
  })
}

interface SelectionInfo {
  text: string
  x: number
  y: number
}

interface NoticeInfo {
  message: string
  x: number
  y: number
  action?: "reload"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getSelectionInfo(): SelectionInfo | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim()

  if (!sel || !text || text.length < 2 || text.length > 140 || sel.rangeCount === 0) {
    return null
  }

  const range = sel.getRangeAt(0)
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  )
  const rect = rects[rects.length - 1] || range.getBoundingClientRect()

  if (!rect || (rect.width === 0 && rect.height === 0)) return null

  return {
    text,
    x: clamp(rect.left + rect.width / 2, 12, window.innerWidth - 120),
    y: clamp(rect.bottom + 10, 12, window.innerHeight - 48)
  }
}

function extractPageContent(): string {
  try {
    const readableDoc = document.cloneNode(true) as Document
    const readable = new Readability(readableDoc).parse()
    const readableText = readable?.textContent?.trim()
    if (readableText) return readableText.slice(0, 10000)

    const article = document.querySelector("article")
    if (article) return article.textContent?.trim().slice(0, 10000) || ""

    const main = document.querySelector("main, [role='main']")
    if (main) return main.textContent?.trim().slice(0, 10000) || ""

    const body = document.body
    if (!body) return document.title

    const clone = body.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll("script,style,noscript,iframe,nav,header,footer")
      .forEach((el) => el.remove())
    return clone.textContent?.trim().slice(0, 10000) || document.title
  } catch {
    return document.title
  }
}

function PlasmoOverlay() {
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [notice, setNotice] = useState<NoticeInfo | null>(null)
  const [language, setLanguage] = useState<UiLanguage>(getDefaultUiLanguage)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chrome.storage?.local || !chrome.storage?.onChanged) return

    chrome.storage.local.get("uiLanguage", (result) => {
      setLanguage(normalizeUiLanguage(result.uiLanguage) || getDefaultUiLanguage())
    })

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>
    ) {
      if (changes.uiLanguage) {
        setLanguage(
          normalizeUiLanguage(changes.uiLanguage.newValue) ||
            getDefaultUiLanguage()
        )
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  useEffect(() => {
    function isInsideOverlay(e: Event): boolean {
      return e.composedPath().some((el) => el === containerRef.current)
    }

    function syncSelection(e?: Event) {
      if (e && isInsideOverlay(e)) return
      setTimeout(() => {
        setSelection(getSelectionInfo())
      }, 10)
    }

    function handleMouseDown(e: MouseEvent) {
      if (!isInsideOverlay(e)) {
        setSelection(null)
        setNotice(null)
      }
    }

    document.addEventListener("mouseup", syncSelection)
    document.addEventListener("keyup", syncSelection)
    document.addEventListener("selectionchange", syncSelection)
    document.addEventListener("mousedown", handleMouseDown)
    return () => {
      document.removeEventListener("mouseup", syncSelection)
      document.removeEventListener("keyup", syncSelection)
      document.removeEventListener("selectionchange", syncSelection)
      document.removeEventListener("mousedown", handleMouseDown)
    }
  }, [])

  async function handleTrigger() {
    if (!selection) return

    const pageContent = extractPageContent()
    const selectedText = selection.text
    const generationId = Date.now()
    const position = {
      x: selection.x,
      y: selection.y
    }
    setSelection(null)

    try {
      await chrome.runtime.sendMessage({
        type: "linklog-open-selection",
        selectedText,
        pageContent,
        pageTitle: document.title,
        pageUrl: window.location.href,
        language,
        generationId
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes("Extension context invalidated")
          ? language === "zh"
            ? "LinkLog 已重新加载，请刷新页面。"
            : "LinkLog was reloaded. Refresh this page."
          : language === "zh"
            ? "LinkLog 启动失败，请刷新页面。"
            : "LinkLog could not start. Refresh this page."
      console.warn("LinkLog could not start from the page selection.", error)
      setNotice({ ...position, message, action: "reload" })
    }
  }

  return (
    <>
      {selection && (
        <div
          ref={containerRef}
          style={{
            position: "fixed",
            left: selection.x,
            top: selection.y,
            zIndex: 2147483647,
            pointerEvents: "auto"
          }}
        >
          <button
            onClick={handleTrigger}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            style={styles.exploreButton}
            onMouseEnter={(e) =>
              ((e.target as HTMLElement).style.transform = "scale(1.06)")
            }
            onMouseLeave={(e) =>
              ((e.target as HTMLElement).style.transform = "scale(1)")
            }
            title={
              language === "zh"
                ? `用 LinkLog 探索「${selection.text}」`
                : `Explore "${selection.text}" with LinkLog`
            }
          >
            <CompassIcon />
            <span>{language === "zh" ? "探索" : "Explore"}</span>
          </button>
        </div>
      )}

      {notice && (
        <div
          ref={containerRef}
          style={{
            position: "fixed",
            left: notice.x,
            top: notice.y,
            zIndex: 2147483647,
            pointerEvents: "auto"
          }}
        >
          <button
            onClick={() => {
              if (notice.action === "reload") window.location.reload()
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            style={styles.noticeButton}
            title={notice.message}
          >
            {notice.message}
          </button>
        </div>
      )}
    </>
  )
}

function CompassIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="1" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  exploreButton: {
    height: 34,
    borderRadius: 999,
    border: "1px solid rgba(255,250,240,0.7)",
    background: "#26392f",
    color: "#fffaf0",
    fontSize: 12,
    fontWeight: 750,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(38,57,47,0.28)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transition: "transform 0.15s",
    padding: "0 12px"
  },
  noticeButton: {
    maxWidth: 260,
    borderRadius: 8,
    border: "1px solid #d0a15d",
    background: "#fff8e8",
    color: "#6c4510",
    boxShadow: "0 8px 22px rgba(65,45,20,0.18)",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 720,
    lineHeight: 1.35,
    cursor: "pointer",
    textAlign: "left" as const
  }
}

export default PlasmoOverlay
