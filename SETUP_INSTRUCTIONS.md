# guIDE — Setup Instructions

## Quick Start (Windows)

### Option 1: Double-Click (Recommended)
1. Double-click **`START_GUIDE.bat`**
2. It will install dependencies if needed, then launch guIDE
3. The IDE window opens automatically

### Option 2: Terminal
```bash
npm install
npm run dev
```

---

## Prerequisites

### Required
- **Node.js 18+** — https://nodejs.org/ (LTS recommended)
- **Visual C++ Build Tools** — for native modules (node-pty, node-llama-cpp)
  - https://visualstudio.microsoft.com/visual-cpp-build-tools/
  - Select "Desktop development with C++"

### GPU Acceleration (Optional)
- **NVIDIA GPU** with CUDA drivers — auto-detected, 4GB+ VRAM recommended
- **AMD GPU** with Vulkan — auto-detected
- **CPU-only** works fine, just slower

### AI Model
- Place a `.gguf` model file in the project root or `models/` directory
- Recommended: [Qwen 2.5 Coder 7B Q4_K_M](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF) (~4.7 GB)

---

## What Happens on Launch

1. **Vite dev server** starts on port 5174 (React frontend)
2. **Electron** launches and loads the Vite server
3. **Model auto-detection** scans for `.gguf` files
4. **GPU detection** — CUDA kernels compile on first run (~60-120s), cached after
5. **IDE** appears with editor, file explorer, terminal, AI chat, 52 MCP tools

---

## Building for Distribution

```bash
npx vite build                  # Build React app → dist/
npx electron-builder --win      # Package installer → dist-electron/
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Node.js not found | Install from https://nodejs.org/, restart terminal |
| npm does nothing | Use `npm.cmd install` on Windows |
| Native module build fails | Install Visual C++ Build Tools |
| GPU not detected | Update NVIDIA drivers, check with `nvidia-smi` |
| Model won't load | Ensure .gguf file isn't corrupted, check RAM (7B needs ~6GB) |
| Port 5174 in use | Kill zombie processes: `taskkill /f /im node.exe` |
| Window won't open | Run `npm run dev` manually to see errors |

---

**guIDE** — Your code, your models, your machine.
