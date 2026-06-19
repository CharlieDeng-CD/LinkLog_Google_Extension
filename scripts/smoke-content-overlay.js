const path = require("path")
const fs = require("fs")
const { chromium } = require("playwright")

function getContentBundlePath() {
  const buildDir = path.resolve("build/chrome-mv3-prod")
  const file = fs
    .readdirSync(buildDir)
    .find((item) => /^content\..*\.js$/.test(item))

  if (!file) throw new Error("No content script bundle found. Run npm run build first.")
  return path.join(buildDir, file)
}

async function main() {
  const chromePath =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true
  })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []

  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })

  await page.addInitScript(() => {
    const chromeApi = {
      runtime: {
        onMessage: {
          addListener: () => {}
        },
        sendMessage: async (message) => {
          window.__linklogMessages.push(message)
          return { success: true }
        }
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {}
        }
      },
      tabs: {
        query: async () => []
      },
      sidePanel: {
        open: async () => {}
      }
    }
    window.__linklogMessages = []
    Object.defineProperty(window, "chrome", {
      value: chromeApi,
      configurable: true
    })
  })

  await page.setContent(`<!doctype html>
    <html>
      <body>
        <article style="font: 20px Arial; margin: 80px; line-height: 1.6">
          <p id="target">Knowledge graphs help learners understand hidden prerequisites behind a concept.</p>
        </article>
      </body>
    </html>`)

  await page.addScriptTag({
    path: getContentBundlePath()
  })
  await page.waitForTimeout(500)

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

  await page.waitForTimeout(800)

  const beforeClick = await page.evaluate(() => {
    function collectButtons(root) {
      return Array.from(root.querySelectorAll("button")).map((button) => {
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
      })
    }

    const shadowHosts = Array.from(document.querySelectorAll("*"))
      .filter((element) => element.shadowRoot)
      .map((element) => ({
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        shadowText: element.shadowRoot.textContent,
        buttons: collectButtons(element.shadowRoot)
      }))

    const buttons = Array.from(document.querySelectorAll("button")).map((button) => {
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
    })

    return {
      buttons,
      shadowHosts,
      allButtons: [
      ...buttons,
      ...shadowHosts.flatMap((host) => host.buttons)
      ],
      plasmoNodes: Array.from(
        document.querySelectorAll("[id*=plasmo], .plasmo-csui-container")
      ).map((element) => ({
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        text: element.textContent,
        childCount: element.childElementCount
      })),
      selection: window.getSelection().toString()
    }
  })

  const shadowButtons = beforeClick.shadowHosts.flatMap((host) => host.buttons)
  const button = [...beforeClick.buttons, ...shadowButtons].find((item) =>
    item.text.includes("Explore") || item.text.includes("探索")
  )
  if (!button) {
    console.error(JSON.stringify({ errors, result: beforeClick }, null, 2))
    process.exit(1)
  }

  const afterRender = await page.evaluate(() => ({
    shadowText: Array.from(document.querySelectorAll("*"))
      .filter((element) => element.shadowRoot)
      .map((element) => element.shadowRoot.textContent)
      .join("\n")
  }))

  await browser.close()

  if (afterRender.shadowText.includes("Mapping hidden prerequisites")) {
    console.error(
      JSON.stringify({ errors, result: beforeClick, afterRender }, null, 2)
    )
    process.exit(1)
  }

  console.log(JSON.stringify({ ok: true, button, errors }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
