import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useRef, useState } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

interface SelectionInfo {
  text: string
  x: number
  y: number
}

function extractPageContent(): string {
  try {
    const article = document.querySelector("article")
    if (article) return article.textContent?.trim().slice(0, 8000) || ""

    const main = document.querySelector("main, [role='main']")
    if (main) return main.textContent?.trim().slice(0, 8000) || ""

    const body = document.body
    if (!body) return document.title

    const clone = body.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll("script,style,noscript,iframe,nav,header,footer")
      .forEach((el) => el.remove())
    return clone.textContent?.trim().slice(0, 8000) || document.title
  } catch {
    return document.title
  }
}

function PlasmoOverlay() {
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function isInsideOverlay(e: Event): boolean {
      return e.composedPath().some((el) => el === containerRef.current)
    }

    function handleMouseUp(e: MouseEvent) {
      if (isInsideOverlay(e)) return

      setTimeout(() => {
        const sel = window.getSelection()
        const text = sel?.toString().trim()

        if (text && text.length > 1 && text.length < 100) {
          const range = sel?.getRangeAt(0)
          if (range) {
            const rect = range.getBoundingClientRect()
            setSelection({
              text,
              x: rect.left + rect.width / 2,
              y: rect.bottom + 8
            })
          }
        } else {
          setSelection(null)
        }
      }, 10)
    }

    function handleMouseDown(e: MouseEvent) {
      if (!isInsideOverlay(e)) {
        setSelection(null)
      }
    }

    document.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("mousedown", handleMouseDown)
    return () => {
      document.removeEventListener("mouseup", handleMouseUp)
      document.removeEventListener("mousedown", handleMouseDown)
    }
  }, [])

  if (!selection) return null

  function handleTrigger() {
    if (!selection) return

    const pageContent = extractPageContent()
    const selectedText = selection.text

    chrome.storage.local.set({
      _pendingGeneration: {
        selectedText,
        pageContent,
        pageTitle: document.title,
        pageUrl: window.location.href
      }
    })

    setSelection(null)

    chrome.runtime.sendMessage({ type: "open-side-panel" })
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: selection.x - 18,
        top: selection.y,
        zIndex: 2147483647,
        pointerEvents: "auto"
      }}
    >
      <button
        onClick={handleTrigger}
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "none",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "#fff",
          fontSize: 16,
          fontWeight: "bold",
          cursor: "pointer",
          boxShadow: "0 2px 12px rgba(99,102,241,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.15s",
          padding: 0
        }}
        onMouseEnter={(e) =>
          ((e.target as HTMLElement).style.transform = "scale(1.15)")
        }
        onMouseLeave={(e) =>
          ((e.target as HTMLElement).style.transform = "scale(1)")
        }
        title={`Explore "${selection.text}" with LinkLog`}
      >
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
      </button>
    </div>
  )
}

export default PlasmoOverlay
