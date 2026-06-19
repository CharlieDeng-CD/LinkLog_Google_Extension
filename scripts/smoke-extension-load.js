const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const { chromium } = require("playwright")

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const extensionPath = path.resolve("build/chrome-mv3-prod")

function createServer() {
  const html = `<!doctype html>
    <html>
      <body>
        <article style="font: 20px Arial; margin: 80px; line-height: 1.6">
          <p id="target">Knowledge graphs help learners understand hidden prerequisites behind a concept.</p>
        </article>
      </body>
    </html>`

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

async function main() {
  if (!fs.existsSync(extensionPath)) {
    console.error("Missing build/chrome-mv3-prod. Run npm run build first.")
    process.exit(1)
  }

  const server = await createServer()
  const port = server.address().port
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "linklog-chrome-"))
  const errors = []

  let context
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ],
      viewport: { width: 900, height: 700 }
    })

    let worker = context.serviceWorkers()[0]
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 5000 }).catch(
        () => null
      )
    }
    const extensionId = worker?.url().split("/")[2] || null

    const page = await context.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })

    let extensionCards = []
    if (!extensionId) {
      await page.goto("chrome://extensions")
      await page.waitForTimeout(1000)
      extensionCards = await page.evaluate(() => {
        const manager = document.querySelector("extensions-manager")
        const list = manager?.shadowRoot?.querySelector("extensions-item-list")
        const items = list?.shadowRoot?.querySelectorAll("extensions-item") || []
        return Array.from(items).map((item) => item.shadowRoot?.textContent || "")
      })
    }

    await page.goto(`http://127.0.0.1:${port}`)
    await page.waitForTimeout(1200)

    await page.evaluate(() => {
      const target = document.getElementById("target")
      const text = target.firstChild
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 16)

      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)

      document.dispatchEvent(new Event("selectionchange"))
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    })

    await page.waitForTimeout(1000)

    const result = await page.evaluate(() => {
      const shadowHosts = Array.from(document.querySelectorAll("*"))
        .filter((element) => element.shadowRoot)
        .map((element) => ({
          tagName: element.tagName,
          shadowText: element.shadowRoot.textContent,
          buttons: Array.from(element.shadowRoot.querySelectorAll("button")).map(
            (button) => {
              const rect = button.getBoundingClientRect()
              return {
                text: button.innerText,
                title: button.title,
                rect: {
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height
                }
              }
            }
          )
        }))

      return {
        shadowHosts,
        selection: window.getSelection().toString()
      }
    })
    result.extensionId = extensionId
    result.serviceWorkers = context.serviceWorkers().map((item) => item.url())
    result.extensionCards = extensionCards

    const button = result.shadowHosts
      .flatMap((host) => host.buttons)
      .find((item) => item.text.includes("Explore"))

    if (!button) {
      console.error(JSON.stringify({ errors, result }, null, 2))
      process.exitCode = 1
      return
    }

    console.log(JSON.stringify({ ok: true, button, errors }, null, 2))
  } finally {
    await context?.close().catch(() => {})
    server.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
