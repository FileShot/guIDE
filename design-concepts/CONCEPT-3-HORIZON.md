# Concept 3: HORIZON — Ultra-Minimal & Spatial

> Maximum content, minimum chrome. Every pixel earns its place.
> Reference energy: Zed Editor + Notion + Apple HIG + Linear (information density)

---

## Design Philosophy

The best interface is the one you forget about. Horizon strips the IDE to its essence: **code, files, chat**. No visible borders. No heavy chrome. Panels are separated by spatial whitespace and subtle tone shifts rather than lines. The UI breathes. When you focus on code, the interface literally fades — activity bar and status bar become translucent until you hover. This is an IDE for people who hate UI.

---

## Color System

### Core Palette — Neutral, warm-undertone grays
```
Background Deep:                #121214    — Editor, terminal (the void)
Background Base:                #161618    — Main background
Background Elevated:            #1c1c1f    — Sidebar, panels
Background Float:               #222226    — Cards, dropdowns, modals
Background Hover:               #28282d    — Interactive hover

Border:                         transparent — NO BORDERS BY DEFAULT
Border Hover:                   #ffffff08  — Appears on hover of resizable edges
Border Focus:                   #ffffff15  — Focus rings, active panels

Text Primary:                   #e4e4e7    — Main text (Zinc 200 equivalent)
Text Secondary:                 #a1a1aa    — Labels (Zinc 400)
Text Tertiary:                  #52525b    — Hints, disabled (Zinc 600)
Text Ghost:                     #3f3f46    — Barely visible (Zinc 700)

Accent:                         #3b82f6    — Clean blue — one accent only
Accent Hover:                   #60a5fa    — Lighter blue
Accent Muted:                   #3b82f610  — Background tint
Accent Subtle:                  #3b82f608  — Even subtler

Success:                        #22c55e    — Green 500
Warning:                        #eab308    — Yellow 500  
Error:                          #ef4444    — Red 500
```

### Design Tokens — Spacing as Separation
```css
/* The key insight: NO visible borders. Separation = bg color difference + spacing */

/* Panel gap — the "border" replacement. Panels are separated by 1-2px of the deepest bg */
.panel-gap {
  background: #121214; /* gap color = deepest bg */
  width: 1px;          /* thinnest possible gap — registers as separation without being a "line" */
}

/* Focus ring — only visible element that explicitly "draws" */
.focus-ring {
  outline: 2px solid #3b82f640;
  outline-offset: -2px;
}

/* Surface — hover reveals subtle boundary */
.surface-reveal {
  border: 1px solid transparent;
  transition: border-color 300ms ease;
}
.surface-reveal:hover {
  border-color: #ffffff06;
}
```

---

## Typography — Tight & Sharp

```
Font Stack:         'SF Pro Text', 'Inter', -apple-system, 'Segoe UI', sans-serif
Mono Font:          'SF Mono', 'JetBrains Mono', 'Cascadia Code', monospace
Brand Font:         'Audiowide' (keep)

Title Bar:          12px / 500 / default tracking
Panel Label:        11px / 600 / 0.06em / uppercase
Item Text:          13px / 400 / editor, file names in tree
Body:               13px / 400 / 1.65 line-height / chat messages
Code:               12.5px / mono / 1.5 line-height
Small:              11px / 400 / status bar
Tiny:               10px / 500 / badges, shortcuts

Key: ALL text uses the same typeface. No mixing. Brand font ONLY for the logo text.
```

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TITLE BAR (30px — minimal)                     │
├──┬──────────┬───1px───────────────────────────┬──1px──────────────┤
│  │          ║         EDITOR AREA             ║                    │
│  │ SIDEBAR  ║                                 ║   CHAT             │
│A │ (240px)  ║  ┌──────────────────────┐       ║   (340px)          │
│C │          ║  │ Tabs (32px, minimal) │       ║                    │
│T │ Clean    ║  ├──────────────────────┤       ║   Clean            │
│  │ tree     ║  │                      │       ║   messages         │
│B │ view     ║  │                      │       ║                    │
│A │          ║  │  Code                │       ║   Minimal          │
│R │ No       ║  │                      │       ║   input            │
│  │ section  ║  └──────────────────────┘       ║                    │
│40│ headers  ║  ┌──────────────────────┐       ║                    │
│px│          ║  │ Terminal             │       ║                    │
│  │          ║  └──────────────────────┘       ║                    │
├──┴──────────╨─────────────────────────────────╨────────────────────┤
│                     STATUS BAR (20px — fade-on-idle)               │
└─────────────────────────────────────────────────────────────────────┘
```

Note: The `║` represents **1px panel gaps** — no borders, just the deepest background color showing through.

### Title Bar — 30px (smallest possible while remaining usable)

- **Background**: Same as base bg (`#161618`) — title bar is visually continuous with the workspace
- **No gradient, no lines** — the title bar just *is* the top of the window
- **Left**: guIDE logo icon only (no text, 14px, `text-tertiary`) — hover reveals "guIDE" text
- **Menu items**: `text-secondary`, 12px, appear on hover of left zone
  - By default, only the logo is visible. Hovering the left 200px reveals File/Edit/View/etc.
  - After 1 second of no hover, they fade back to just the logo
- **Center**: Search — NOT a pill/button. Just a subtle text hint:
  - "Search or type > for commands" in `text-ghost` color
  - Clicking opens CommandPalette (same as before)
  - No background, no border — just text that invites interaction
  - On hover: text brightens to `text-tertiary`
- **Right**: 
  - Panel toggles: Three tiny dots (4px circles)
    - Filled circle = panel visible
    - Empty circle = panel hidden
    - Accent-colored when filled
  - Current file name in `text-ghost` — appears on hover
  - 140px reserved for window controls

### Activity Bar — 40px (narrowest comfortable)

- **Background**: `#121214` (deepest — creates natural separation from sidebar)
- **No border** — the bg difference IS the border
- **Icons**: 18px (smaller), in 36x36 touch targets
- **Active indicator**: 
  - Single accent-colored dot (3px circle) centered below the icon
  - Icon: `text-primary`
- **Inactive**: `text-ghost` → hover: `text-tertiary` → click: `text-primary`
- **Spacing**: Icons are vertically centered with 4px gaps
- **Icon groups**: No divider — just a larger 16px gap between groups
- **Bottom**: 
  - Settings: gear icon, `text-ghost`, hover: subtle rotation
  - Account: dot indicator only (no full avatar unless signed in)
- **Fade on idle**: After 3 seconds without mouse near left 40px, activity bar icons fade to 30% opacity
  - Moving mouse to left edge: fade back in over 200ms
  - CSS: `transition: opacity 600ms ease`

### Left Sidebar — 240px default

- **Background**: `#1c1c1f` (elevated)
- **No border on right** — the 1px panel gap provides separation
- **No panel header** — the content starts immediately
  - The panel type is indicated by the active activity bar icon — no need to label it
- **File Explorer**:
  - File tree starts at top with 4px top padding
  - No "EXPLORER" header. No "OPEN EDITORS" section. Just the file tree.
  - Items: 24px height (compact), 8px left padding + indentation
  - Hover: `#28282d` bg, rounded-sm (2px)
  - Selected: `accent-subtle` bg, no border, no indicator — just the tint
  - Expanded folder: Slightly brighter text than collapsed
  - File icons: Monochrome by default, colored only on hover
  - **Scrollbar**: 3px wide, `text-ghost` color, appears only on scroll (auto-hide)
- **Search panel**: 
  - Search input at top, flush with edges, 8px padding around
  - Results: file path in `text-secondary`, match preview in `text-primary`
  - No grouping headers — flat list sorted by relevance
- **Other panels**: Minimal chrome, content-first

### Editor Area

- **Tab bar**: 32px (compact)
  - **Active tab**: 
    - `#121214` bg (matches editor — tab IS the editor)
    - `text-primary` color
    - No top border, no indicators — the bg match tells you it's active
    - Bottom: 1px line of `#1c1c1f` below other tabs creates the illusion that inactive tabs are "behind"
  - **Inactive tab**: 
    - `#1c1c1f` bg (elevated — sits "above" the editor visually)
    - `text-tertiary` color
    - Hover: `text-secondary`
  - **Close X**: Only appears on hover of that tab, 12px
  - **Modified indicator**: `text-secondary` dot (not colored — stays monochrome)
  - **New tab**: `+` in `text-ghost`, appears only when hovering tab bar
  - **Right of tabs**: Nothing. Clean edge.
  - **Tab overflow**: Scroll indicator (tiny faded edge), not dropdown

- **Editor background**: `#121214` (deep dark)
- **Line numbers**: `text-ghost` (#3f3f46) — barely visible until you need them
  - Current line number: `text-secondary`
  - Hover gutter: numbers brighten to `text-tertiary`
- **Active line**: `#ffffff03` bg — almost invisible
- **Selection**: `#3b82f618` — subtle blue
- **Cursor**: `accent` color, 2px wide (not blinking — steady)
- **Minimap**: OFF by default (can enable in settings) — maximizes code space

### Terminal / Bottom Panel

- **Gap**: 1px of `#121214` (panel gap, not a border)
- **Tab bar**: 24px, minimal
  - Active: `text-primary`, 1px accent bottom line
  - Inactive: `text-ghost`
  - Only "Terminal" shown — "Problems" and "Output" are collapsed to icons
- **Background**: `#0e0e10` (darker than editor — very slightly)
- **No toolbar** — terminal actions are available via right-click context menu
- **Maximize**: Double-click the gap handle to toggle full height

### Chat Panel — 340px default

- **Background**: `#1c1c1f` (matches sidebar — symmetry)
- **1px panel gap** on left (no border)
- **Header**: 32px — absolutely minimal
  - "Chat" in `text-secondary` at 11px, left-aligned
  - Model name as small text next to it in `text-ghost`
  - Right: minimize button, nothing else
- **Messages**:
  - **No avatars, no names, no timestamps by default**
    - Timestamps appear on hover
    - User is distinguished by right-alignment + subtle bg tint
    - Assistant is left-aligned, no bg
  - **User messages**: Right-aligned, `accent-subtle` bg, rounded-lg, max-width 80%
  - **Assistant messages**: Left-aligned, transparent bg, full width
    - `text-primary` color, generous line-spacing (1.7)
    - No decorations — just clean text
  - **Code blocks**: 
    - `#121214` bg (same as editor — feels native)
    - No rounded corners (rect — code is serious)
    - File name header only if applicable
    - Copy button: appears on hover, top-right corner
  - **Tool calls**: Collapsible, shown as a single line: `Used read_file, grep_search` in `text-tertiary`
    - Click to expand details
  - **Thinking/reasoning**: Single animated dot while generating, expands to show thinking text on completion

- **Input area**:
  - Flush with panel edges, 8px padding
  - `#161618` bg (base — slightly lighter than panel for contrast)
  - 1px `#ffffff08` top border (the ONE explicit border in chat)
  - Text input: 13px, auto-resize, max 8 lines
  - Send: Right-aligned, accent circle icon, only appears when text is entered
  - Attachment: Paperclip icon in `text-ghost`, left of input
  - **Above input**: Tiny current-file indicator in `text-ghost` if a file is attached
  - **No mode toggles visible** — modes changed via `/commands` in the input
    - `/web` = web search
    - `/rag` = codebase context  
    - `/agent` = agent mode

### Status Bar — 20px (thinnest possible)

- **Background**: `#161618` (matches base — continuous surface)
- **No top border** — just the 1px panel gap
- **Fade behavior**: Fades to 30% opacity after 3 seconds of inactivity
  - Hovering bottom 20px: fades in over 200ms
  - During generation/error: stays fully visible
- **Left**: Brand: errors (red dot + count, only if > 0) | warnings (only if > 0) | git branch
- **Right**: Cursor position | language | encoding (only on hover) | GPU ring (only during generation)
- **All text**: 10px, `text-ghost` normally → `text-tertiary` on hover
- **Dividers**: None. Items spaced with 12px gaps.

### Command Palette

- **Backdrop**: `rgba(0, 0, 0, 0.7)`, no blur (sharp edges, fast render)
- **Panel**: 520px wide, centered top 12%
  - Background: `#1c1c1f`
  - Border: `1px solid #ffffff08`
  - Border-radius: 8px (subtle, not a pill)
  - Shadow: `0 16px 48px rgba(0,0,0,0.6)`
- **Input**: 36px, 14px text, transparent bg, no border
  - Caret: accent color
  - Placeholder: `text-ghost`
- **Results**: 28px per item (compact)
  - Icon (14px, monochrome) + name + path in `text-ghost` + shortcut
  - Selected: `accent-subtle` bg
  - No groups/headers — flat ranked list
  - Max 8 visible items (scroll for more)
- **No footer** — keyboard shortcuts are discoverable by doing them

### Welcome Screen

- **Background**: `#121214` — empty void
- **Center cluster** (vertically centered):
  - guIDE logo: 32px, monochrome white, 50% opacity
  - Below: "Open a folder to start" in `text-tertiary`, 14px
  - Two actions, stacked vertically:
    - "Open Folder" — text button with folder icon, `text-secondary`, hover: `text-primary`
    - "New Project" — text button with plus icon
  - Below gap: "Recent" label in `text-ghost`
  - Recent folders: Simple text list, hover: `text-primary`
  - No hero section, no animations, no cards — pure function
- **If no model**: 
  - Below recent: "No model loaded" in `text-ghost`
  - "Download recommended model →" text link in accent color

---

## The Fade System (unique to Horizon)

The defining UX feature: UI chrome fades to near-invisible when not needed.

```css
/* Fade targets */
.fade-zone {
  transition: opacity 600ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* When mouse is away, chrome fades */
.fade-zone.idle {
  opacity: 0.3;
}

/* On hover, chrome returns */
.fade-zone:hover,
.fade-zone.active {
  opacity: 1;
  transition-duration: 200ms; /* faster return */
}

/* Never fade during important states */
.fade-zone.generating,
.fade-zone.has-error {
  opacity: 1 !important;
}
```

**Zones that fade:**
1. Activity bar icons (fade to 30% after 3s without hover near left 40px)
2. Status bar text (fade to 30% after 3s without hover near bottom 20px)
3. Tab bar close buttons (fade to 0% — only appear on hover)
4. File tree icons (fade to monochrome, recolor on hover)
5. Chat input buttons (attachment/send appear only when input is focused)

**Zones that NEVER fade:**
1. Editor content
2. Terminal content  
3. Chat message content
4. File tree text (names stay readable)
5. Error/warning indicators (always full opacity)

---

## Theme Variables

Horizon uses FEWER variables than the others — simplicity is the point:

```
CORE (18 variables — reduced from 26):
--theme-bg-deep           // editor, terminal
--theme-bg                // main workspace
--theme-bg-elevated       // sidebar, panels
--theme-bg-float          // dropdowns, modals
--theme-bg-hover          // interactive hover

--theme-text-primary      // main text
--theme-text-secondary    // labels
--theme-text-tertiary     // hints
--theme-text-ghost        // barely visible

--theme-accent            // ONE accent color. That's it.
--theme-accent-hover      // lighter accent
--theme-accent-subtle     // bg tint

--theme-success
--theme-warning
--theme-error

--theme-gap               // panel gap color (= bg-deep)
--theme-scrollbar         // scrollbar thumb
--theme-cursor            // cursor color (= accent)
```

### Theme Variants for Horizon

| Theme | Base | Accent | Character |
|---|---|---|---|
| Midnight (default) | #161618 neutral | #3b82f6 blue | Clean, professional |
| Charcoal | #181819 warm | #10b981 emerald | Calm, nature-coded |
| Graphite | #141416 cool | #a78bfa violet | Creative, unique |
| Paper | #fafaf9 warm white | #1d4ed8 deep blue | Light mode. Minimal. |
| Ink | #0a0a0b pure black | #e4e4e7 white | Maximum contrast, OLED-friendly |

---

## Key Differentiators

| Current | Horizon |
|---|---|
| Borders everywhere | ZERO visible borders — separation via bg tone + spacing |
| Always-visible chrome | Chrome fades on idle, returns on hover |
| 48px activity bar | 40px, icons at 18px, fades to 30% when idle |
| 34px title bar with full menu | 30px, menu hidden by default (hover to reveal) |
| Panel labels/headers | No panel headers — activity bar icon IS the label |
| Colored file icons | Monochrome by default, color on hover |
| Complex status bar | 20px, fades on idle, shows only errors and cursor position |
| Chat with avatars, timestamps, names | No avatars/names, timestamps on hover only |
| Chat `/commands` hidden in buttons | All modes via `/commands` in input — power user pattern |
| Welcome screen with cards and animations | Dead simple: logo + "Open folder" + recent list |
| 10 theme variables for borders/surfaces | 18 variables total — radical simplification |
| Blinking cursor | Steady accent-colored cursor |
| Scrollbar always visible | Auto-hide scrollbar, 3px wide |

---

## Accessibility Notes

The fade system MUST respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .fade-zone {
    transition: none !important;
    opacity: 1 !important; /* never fade */
  }
}
```

And high contrast mode:
```css
@media (prefers-contrast: more) {
  :root {
    --theme-bg-deep: #000000;
    --theme-text-primary: #ffffff;
    --theme-text-ghost: #808080; /* visible, not faded */
    /* borders return in high contrast */
    --theme-gap: #333333;
  }
}
```

---

## Implementation Priority

1. **ThemeProvider.tsx** — Simplified 18-variable system, fade zone classes
2. **index.css** — Remove ALL border utilities, add `.panel-gap`, `.fade-zone`, `.surface-reveal`
3. **Layout.tsx** — Borderless layout with 1px gaps, fade behavior on activity bar + status bar
4. **StatusBar.tsx** — 20px, fade-on-idle, minimal items
5. **Layout.tsx (title bar)** — 30px, hover-to-reveal menu, ghost search text
6. **ChatPanel.tsx** — No avatars/names, monochrome, `/command` input
7. **TabBar.tsx** — 32px compact, no indicators, bg-based active state
8. **WelcomeScreen.tsx** — Stripped to essentials: logo + folder + recent
9. **FileExplorer/** — Remove section headers, monochrome icons, compact items
10. **CommandPalette.tsx** — Flat list, compact items, no groups
11. **All sidebar panels** — Remove panel headers, content-first, consistent 24px item height

---

## The Feel

If Obsidian is a luxury car dashboard and Aurora is a gaming setup with RGB,
Horizon is a Leica camera — precision instrument, nothing wasted, pure function.
The absence of UI IS the design.
