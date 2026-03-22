# Concept 2: AURORA — Vibrant & Expressive

> A bold, colorful IDE that stands out with gradient accents, warm tones, and a distinctive identity.
> Reference energy: JetBrains Fleet + Vercel Dashboard + Raycast + Warp Terminal

---

## Design Philosophy

guIDE is **not** VS Code. It shouldn't try to look like VS Code. Aurora gives it a personality — warm gradients, rounded surfaces, generous spacing, and a unique layout that feels alive. The UI has energy without being distracting. Color is used strategically: the workspace is calm and neutral, but interactive elements pop with gradient accents that signal "this is different."

---

## Color System

### Core Palette
```
Background Base:                #101012    — Near-black with slight warmth
Background Surface:             #17171a    — Panels, sidebar
Background Raised:              #1e1e22    — Cards, sections, elevated
Background Overlay:             #24242a    — Modals, popovers
Background Wash:                #2a2a30    — Hover states, subtle fills

Border Default:                 #2a2a30    — Subtle panel borders
Border Active:                  #3a3a42    — Focused panels

Text Primary:                   #e8e8ec    — Main content
Text Secondary:                 #8e8e96    — Labels, secondary info
Text Tertiary:                  #56565e    — Disabled, hints
Text On Accent:                 #ffffff    — Text on gradient backgrounds

Accent Gradient Start:          #7c3aed    — Violet
Accent Gradient End:            #2563eb    — Blue
Accent Solid:                   #6d28d9    — When gradient isn't possible
Accent Hover:                   #7c3aed    — Brighter violet
Accent Muted:                   #6d28d915  — Low-opacity accent bg

Secondary Accent:               #f97316    — Orange — for special actions (AI, premium features)
Secondary Accent Muted:         #f9731612  — Orange glow bg

Success:                        #10b981    — Emerald green
Warning:                        #f59e0b    — Amber
Error:                          #ef4444    — Red
Info:                           #3b82f6    — Blue
```

### Gradient Definitions
```css
/* Primary accent gradient — buttons, active indicators, progress bars */
.gradient-accent {
  background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
}

/* Warm gradient — AI/premium features */
.gradient-warm {
  background: linear-gradient(135deg, #f97316 0%, #ec4899 100%);
}

/* Surface gradient — very subtle, gives panels dimension */
.gradient-surface {
  background: linear-gradient(180deg, #1a1a1e 0%, #17171a 100%);
}

/* Title bar gradient — ultra-subtle, 1% opacity difference top to bottom */
.gradient-titlebar {
  background: linear-gradient(180deg, #1e1e22 0%, #17171a 100%);
}

/* Glow effects */
.glow-violet {
  box-shadow: 0 0 30px rgba(124, 58, 237, 0.12), 0 0 80px rgba(124, 58, 237, 0.05);
}
.glow-orange {
  box-shadow: 0 0 30px rgba(249, 115, 22, 0.12), 0 0 80px rgba(249, 115, 22, 0.05);
}
```

---

## Typography

```
Font Stack:         'Geist', 'Inter', -apple-system, 'Segoe UI', sans-serif
Mono Font:          'Geist Mono', 'JetBrains Mono', 'Cascadia Code', monospace
Brand Font:         'Audiowide' (keep existing)

Title Bar:          13px / 500 weight / 0.01em
Panel Headers:      12px / 600 weight / 0.02em tracking (NOT uppercase — departure from VS Code)
Section Labels:     11px / 600 weight / 0.04em / uppercase / text-secondary
Body Text:          13px / 400 weight
Code:               13px / mono / 1.6 line-height
Small:              12px / 400 weight
Tiny:               10px / 500 weight / mono for numbers
```

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  TITLE BAR (40px) — gradient bg, rounded search bar center         │
├─────┬───────────┬─────────────────────────────────┬────────────────┤
│     │           │                                 │                │
│  A  │  SIDEBAR  │        EDITOR AREA              │   CHAT         │
│  C  │  (260px)  │                                 │   (380px)      │
│  T  │           │  ┌───────────────────────┐      │                │
│  I  │  Rounded  │  │ Tab Bar (40px)        │      │  Gradient      │
│  V  │  section  │  ├───────────────────────┤      │  header        │
│  I  │  cards    │  │                       │      │                │
│  T  │           │  │  Code Editor          │      │  Rounded       │
│  Y  │  Smooth   │  │                       │      │  message       │
│     │  section  │  │                       │      │  bubbles       │
│  B  │  dividers │  └───────────────────────┘      │                │
│  A  │           │  ┌───────────────────────┐      │  Floating      │
│  R  │           │  │ Terminal              │      │  pill input    │
│     │           │  └───────────────────────┘      │                │
│ 52px│           │                                 │                │
├─────┴───────────┴─────────────────────────────────┴────────────────┤
│  STATUS BAR (28px) — raised surface, gradient accent indicators    │
└─────────────────────────────────────────────────────────────────────┘
```

### Title Bar — 40px (bigger than current — more presence)

- **Background**: `gradient-titlebar` — ultra-subtle vertical gradient
- **Left**: guIDE logo (20px) with `gradient-accent` fill + brand name "guIDE" in brand font at 14px, `text-secondary`
- **Center**: Rounded search bar — pill shape (`border-radius: 20px`)
  - Background: `#1a1a1e` with `1px solid #2a2a30`
  - 280-480px wide based on viewport
  - **Hover**: border transitions to gradient `#7c3aed40`
  - **Focus**: `gradient-accent` thin border (1px)  
  - Contains: search icon + project name + `Ctrl+P` badge
- **Right**: 
  - Layout toggles as pill-shaped segmented control — all three in a single `#1e1e22` rounded container
  - Active segment: gradient background
  - Inactive: transparent
  - Window controls: minimize/maximize/close (Electron native or custom)

### Activity Bar — 52px (wider — room for labels)

- **Background**: `#101012` (base, darkest)
- **Icons**: 22px, in 48x42 touch targets
- **Active state**: 
  - Icon color: `text-primary`
  - Left indicator: 3px-wide pill with `gradient-accent` fill
  - Background: `#7c3aed10` (very subtle accent wash)
- **Inactive**: `text-tertiary` icon, transparent bg
- **Hover**: Icon brightens to `text-secondary`, bg `#ffffff05`
- **Icon groups separated by**: 12px gap (no divider line — just space)
- **Bottom section**: 
  - AI Chat icon with orange (`gradient-warm`) glow when AI is active/generating
  - Settings icon with gear rotation animation on hover (subtle, 45deg over 200ms)
  - Account icon with green dot if signed in

### Left Sidebar — 260px default (resizable 200-500px)

- **Background**: `gradient-surface` (subtle top-to-bottom gradient)
- **Border**: `1px solid #2a2a30` on right edge
- **Header**: 36px
  - Panel title in `panel-headers` style (NOT uppercase — uses Title Case)
  - Right: icon buttons for panel-specific actions (refresh, collapse all, etc.)
  - Bottom: 1px `#2a2a30` border
- **Content**:
  - **File Explorer sections**: Each section in a rounded container (`border-radius: 8px`)
    - Section header: 28px, collapsible with smooth height animation
    - Background: `#1a1a1e` — slightly raised from sidebar bg
    - Margin: 6px horizontal, 4px vertical between sections
    - Border: `1px solid #2a2a3015`
  - **File items**: 26px height, rounded-md on hover
    - Hover bg: `#2a2a30`
    - Selected: `gradient-accent` at 8% opacity + left border in accent
    - File icons: colored by file type (keep current behavior)
    - Modified dot: orange accent
  - **Search panel**: Input with rounded corners, `surface-inset` bg, focus ring with gradient border
  - **Source Control**: Changed files with colored status indicators (green=added, orange=modified, red=deleted)

### Editor Area

- **Tab bar**: 40px (taller — more comfortable)
  - **Active tab**: 
    - `#17171a` bg
    - 2px top border with `gradient-accent` — the gradient makes it distinctive
    - `text-primary` color
    - Slightly larger font (13px vs 12px)
  - **Inactive tab**: `#101012` bg, `text-tertiary`
  - **Hover**: `text-secondary`, bg `#1a1a1e`
  - **Tab shape**: Slightly rounded top corners (border-radius: 6px 6px 0 0)
  - **Close button**: Transparent circle, shows on hover
  - **Drag reorder**: Tab floats with shadow during drag
  - **New tab `+`**: Accent color, slightly larger than other icons
  - **Right of tabs**: Split view / preview mode buttons in a grouped pill

- **Editor bg**: `#101012` (matches base)
- **Active line highlight**: `#7c3aed08` (very subtle accent wash)
- **Selection**: `#7c3aed25` (violet tinted)
- **Find highlight**: `#f9731640` (orange glow around matches)
- **Bracket matching**: `gradient-accent` at 20% opacity

### Terminal / Bottom Panel

- **Separator**: 4px handle with gradient accent on hover
- **Tab strip**: 32px
  - Active: gradient underline (2px), `text-primary`
  - Inactive: no underline, `text-tertiary`
  - Tabs: Terminal | Problems | Output | Debug Console
- **Terminal bg**: `#0c0c0e` (even darker than editor for visual separation)
- **Header right**: Buttons for new terminal, split, maximize — with icon tooltips
- **Problem items**: Clickable, with colored severity icon (error=red circle, warning=amber triangle)

### Chat Panel — 380px default (resizable 300-600px)

- **Background**: `gradient-surface`
- **No hard border** — shadow separation (`box-shadow: -4px 0 20px rgba(0,0,0,0.25)`)
- **Header**: 48px
  - Title: "AI Chat" with sparkle icon in `gradient-warm` color
  - Model picker: Pill-shaped dropdown showing current model name + size
    - Dropdown arrow with smooth rotation animation on open
    - Dropdown menu: Rounded card with model list, each showing size + parameter count
  - Right: collapse button

- **Message area**:
  - **User messages**: 
    - `gradient-accent` at 10% opacity background
    - `border-left: 3px` with `gradient-accent` solid color
    - Rounded-lg (12px radius)
    - Slight left margin (doesn't touch edges)
    - Timestamp below in `text-tertiary`
  - **Assistant messages**: 
    - Transparent bg, full width
    - Avatar: Small gradient circle with AI icon
    - Name: "guIDE" in brand font, small
    - Content: Clean typography, generous line-height (1.7)
    - Tool calls: Collapsible section with gradient-outlined pill per tool
    - Thinking blocks: Collapsible with animated dots during generation
  - **Code blocks**: 
    - `#0c0c0e` bg, rounded-lg
    - Header: Language name + copy button + file name (if applicable)
    - Syntax highlighting: VS Code Dark+ compatible colors
    - Apply button: `gradient-accent` bg when code can be applied to a file

- **Input area**: 
  - Position: Fixed at bottom of chat panel
  - Margin: 12px from edges
  - Shape: Rounded-xl (16px radius) pill
  - Background: `#1e1e22` with `1px solid #2a2a30`
  - Focus: Border transitions to `gradient-accent` (thin, 1px)
  - **Inside**: 
    - Left: attachment icon (clip) → opens file/image picker
    - Center: text input, 14px, auto-resize up to 6 lines
    - Right: Send button — gradient circle with arrow icon
      - During generation: transforms into Stop button (square icon, red bg)
  - **Above input**: 
    - Context chips: current file, selected text — removable pills
    - Mode toggles: Web Search, RAG, Agent Mode — small toggles

### Status Bar — 28px (slightly taller — readable)

- **Background**: `#17171a` with top border `1px solid #2a2a30`
- **Left items** (spaced 16px apart):
  - Git branch: Icon + branch name, clickable (opens source control)
  - Errors: Red circle icon + count, clickable (opens Problems)
  - Warnings: Amber triangle + count
- **Center**: Empty (clean)
- **Right items** (spaced 16px apart):
  - AI Status: 
    - Idle: subtle `text-tertiary` indicator
    - Generating: Animated gradient spinner + `tokens/sec` counter
    - Loading model: Progress bar with model name
  - GPU: Ring indicator + percentage
  - Context: Ring indicator + `used/total`
  - Cursor: `Ln X, Col Y`
  - Language: Clickable (opens language selector)
  - Voice: Microphone button (gradient-warm when active)
- **All status items**: `text-secondary`, hover → `text-primary`

### Command Palette

- **Backdrop**: `rgba(0, 0, 0, 0.65)` with blur
- **Panel**: 580px wide, centered top 15%
  - Background: `#1e1e22` solid (not glass — for readability)
  - Border: `1px solid #2a2a30`
  - Border-radius: 16px (distinctly rounded — stands out from other IDEs)
  - Box-shadow: `0 20px 60px rgba(0,0,0,0.5)`
- **Input**: 44px height, 15px text, no border, transparent bg
  - Left: Gradient search icon
  - Right: `Esc` badge
- **Results**: Grouped by category with section headers
  - 36px per item, icon + name + path + shortcut
  - Selected: `accent-muted` bg + left accent border
  - Hover: `#2a2a30` bg
- **Footer**: Keyboard hints — `↑↓ navigate  ↵ open  esc dismiss`

### Welcome Screen

- **Background**: `#101012` with radial gradient — accent color at 2% opacity radiating from center
- **Hero**: 
  - guIDE logo: 64px, with gradient fill (`gradient-accent`)
  - Tagline: "Your code. Your models. Your machine." in 20px `text-secondary`
  - Animated: Subtle floating particles or aurora effect behind logo (CSS only, no JS animation)
- **Action row**: 3 cards, 200px wide each
  - "Open Folder" — folder icon with gradient accent
  - "New Project" — sparkle icon with `gradient-warm`
  - "Clone Repository" — git icon
  - Card style: `#17171a` bg, rounded-xl, `1px solid #2a2a30`, hover: lift + glow
- **Recent Projects**: Below cards, up to 5 items
  - Each: folder name + parent path + timestamp
  - Hover: accent-muted bg
  - Right: "open" arrow
- **Quick Setup**: If no model installed, show model download card
  - Gradient-warm border animation pulsing
  - "Download Recommended Model" button with size info
- **Footer**: `guIDE v1.8.x — by Brendan Gray` in `text-tertiary`

---

## Theme Variables (expanded)

All current variables kept, plus:
```
--theme-accent-gradient-start
--theme-accent-gradient-end
--theme-accent-gradient      // shorthand: linear-gradient(...)
--theme-secondary-accent     // orange/warm accent
--theme-bg-deep              // deepest bg (terminal, editor)
--theme-bg-raised            // cards, sections
--theme-bg-overlay           // modals, command palette
--theme-bg-wash              // hover state fill
--theme-surface-gradient     // subtle panel gradient
--theme-border-active        // focused panel borders
--theme-shadow-color         // base shadow color (dark or light)
--theme-radius-sm            // 4px
--theme-radius-md            // 8px
--theme-radius-lg            // 12px
--theme-radius-xl            // 16px
--theme-radius-pill          // 9999px
```

### Theme Variants for Aurora

Each Aurora theme defines TWO accent colors (primary gradient + secondary):

| Theme | Gradient | Secondary | Status Bar |
|---|---|---|---|
| Violet Dusk (default) | violet→blue | orange | gradient |
| Ocean Depth | teal→cyan | coral | teal |
| Solar Flare | orange→pink | violet | orange |
| Forest Canopy | emerald→lime | amber | emerald |
| Midnight Rose | pink→purple | gold | pink |
| Arctic Light | light mode — blue→indigo | orange | blue |

---

## Key Differentiators

| Current | Aurora |
|---|---|
| Flat monochrome accent | Gradient accent (violet→blue) |
| VS Code-alike layout | Distinctly different: rounded surfaces, taller bars, card-based sidebar sections |
| Uppercase panel headers | Title Case headers (friendlier) |
| Hard borders everywhere | Mix of subtle borders + shadows + spacing |
| 48px activity bar, icons only | 52px activity bar, room for future icon+label mode |
| Text-only AI status | Animated gradient spinner during generation |
| Standard welcome screen | Hero section with animated gradient, card-based actions |
| Generic search bar | Pill-shaped, gradient focus ring |
| Same font as VS Code | Geist font family (Vercel's font — modern, sharp, free) |
| Single accent per theme | Dual accent (primary gradient + secondary warm) |

---

## Implementation Priority

1. **ThemeProvider.tsx** — Add gradient variables, dual accents, radius tokens
2. **index.css** — New gradient utilities, rounded surface components, aurora animation
3. **Layout.tsx** — Taller title bar with pill search, wider activity bar, card-based sidebar sections
4. **ChatPanel.tsx** — Gradient header, gradient message borders, pill input
5. **StatusBar.tsx** — Taller, gradient AI spinner, cleaner layout
6. **WelcomeScreen.tsx** — Hero section with gradient logo, card actions
7. **TabBar.tsx** — Gradient top border on active tab, rounded corners
8. **CommandPalette.tsx** — Rounded design, gradient search icon
9. **Editor.tsx** — Accent-tinted selection and active line
10. **All panels** — Consistent card-based sections, rounded containers
