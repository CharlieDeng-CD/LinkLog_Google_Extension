import React from "react"

export default function Popup() {
  async function openSidePanel() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>LinkLog</h1>
      <p style={styles.desc}>
        Select a concept on a page. LinkLog maps the hidden assumptions behind it.
      </p>
      <button onClick={openSidePanel} style={styles.btn}>
        Open Side Panel
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 300,
    padding: 20,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: "#f7f3ea",
    color: "#25231e"
  },
  title: {
    fontSize: 18,
    fontWeight: 760,
    color: "#1d1a15",
    marginBottom: 8
  },
  desc: {
    fontSize: 13,
    color: "#665f53",
    lineHeight: 1.5,
    marginBottom: 16
  },
  btn: {
    width: "100%",
    padding: "10px 16px",
    borderRadius: 8,
    border: "1px solid #26392f",
    background: "#26392f",
    color: "#fffaf0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer"
  }
}
