const fs = require("fs")
const path = require("path")
const vm = require("vm")

const bundleDir = path.join(process.cwd(), "build", "chrome-mv3-prod")

if (!fs.existsSync(bundleDir)) {
  console.error("Missing build/chrome-mv3-prod. Run npm run build first.")
  process.exit(1)
}

const entryFiles = fs
  .readdirSync(bundleDir)
  .filter((file) => /^(content|popup|sidepanel)\..*\.js$/.test(file))

if (!entryFiles.length) {
  console.error("No popup or sidepanel bundles found.")
  process.exit(1)
}

function createSandbox() {
  const sandbox = {
    console,
    clearTimeout,
    setTimeout,
    TextDecoder,
    TextEncoder,
    MessageChannel
  }

  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.chrome = {
    runtime: {
      onMessage: {
        addListener: () => {}
      },
      sendMessage: () => Promise.resolve({ success: true })
    },
    sidePanel: {
      open: () => Promise.resolve()
    },
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve()
      }
    },
    tabs: {
      query: () => Promise.resolve([])
    }
  }
  sandbox.document = {
    documentElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      appendChild: () => {},
      contains: () => true
    },
    body: {
      appendChild: () => {},
      contains: () => true
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({
      appendChild: () => {},
      attachShadow: () => ({
        appendChild: () => {}
      }),
      contains: () => true,
      setAttribute: () => {},
      style: {},
      remove: () => {}
    }),
    getElementById: () => ({
      nodeType: 1,
      ownerDocument: sandbox.document,
      appendChild: () => {},
      contains: () => true
    })
  }
  sandbox.Element = function Element() {}
  sandbox.HTMLElement = sandbox.Element
  sandbox.MutationObserver = function MutationObserver() {
    return {
      observe: () => {},
      disconnect: () => {}
    }
  }
  sandbox.getComputedStyle = () => ({ position: "static" })
  sandbox.addEventListener = () => {}
  sandbox.removeEventListener = () => {}
  sandbox.scrollX = 0
  sandbox.scrollY = 0

  return sandbox
}

let failed = false

for (const file of entryFiles) {
  const code = fs.readFileSync(path.join(bundleDir, file), "utf8")

  try {
    vm.runInNewContext(code, createSandbox(), { filename: file })
    console.log(`${file}: dependency resolution ok`)
  } catch (error) {
    if (/Cannot find module/.test(error.message)) {
      console.error(`${file}: ${error.message}`)
      failed = true
    } else {
      console.log(`${file}: dependency resolution ok (${error.message})`)
    }
  }
}

process.exit(failed ? 1 : 0)
