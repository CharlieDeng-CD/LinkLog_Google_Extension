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
        Select any concept on a webpage, then click the LinkLog button to
        explore its knowledge graph.
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
    background: "#0f0f13",
    color: "#e4e4e7"
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    background: "linear-gradient(135deg, #6366f1, #a78bfa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    marginBottom: 8
  },
  desc: {
    fontSize: 13,
    color: "#a1a1aa",
    lineHeight: 1.5,
    marginBottom: 16
  },
  btn: {
    width: "100%",
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer"
  }
}
