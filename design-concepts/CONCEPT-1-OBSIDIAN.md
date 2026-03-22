# Concept 1: OBSIDIAN — Dark Luxury

> Premium dark IDE with depth, frosted glass, and refined micro-interactions.
> Reference energy: Cursor IDE + Linear + Arc Browser

---

## Design Philosophy

Everything feels **expensive**. Panels have depth through subtle layered shadows. Glass morphism is used tastefully (not overdone). Typography is crisp with generous letter-spacing on labels. Every pixel has intention. The UI melts away when you're coding and emerges when you need it.

---

## Color System

### Core Palette
```
Background Layer 0 (deepest):   #0a0a0c    — True dark, nearly black
Background Layer 1 (surfaces):  #111114    — Main editor/panel bg
Background Layer 2 (elevated):  #18181b    — Sidebar, cards
Background Layer 3 (floating):  #1f1f23    — Dropdowns, popovers, modals
Background Layer 4 (hover):     #27272b    — Hover states on surfaces

Border (subtle):                #ffffff08  — Nearly invisible, just separation
Border (medium):                #ffffff12  — Panel edges
Border (strong):                #ffffff18  — Active/focused panel edges

Text Primary:                   #ececef    — High contrast, main text
Text Secondary:                 #a1a1a6    — Labels, descriptions
Text Tertiary:                  #636366    — Placeholder, disabled
Text Inverted:                  #0a0a0c    — On accent backgrounds

Accent Primary:                 #6366f1    — Indigo — buttons, links, focus rings
Accent Primary Hover:           #818cf8    — Lighter indigo
Accent Secondary:               #8b5cf6    — Violet — secondary actions
Accent Glow:                    #6366f140  — Glow effect behind accent elements

Success:                        #34d399
Warning:                        #fbbf24
Error:                          #f87171
Info:                           #60a5fa
```

### Surface Effects
```css
/* Frosted glass — used on floating panels (command palette, modals, popovers) */
.surface-glass {
  background: rgba(17, 17, 20, 0.72);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 8px 40px rgba(0, 0, 0, 0.5),
    0 2px 12px rgba(0, 0, 0, 0.3);
}

/* Elevated surface — sidebar, panels (no glass, just layered shadow) */
.surface-elevated {
  background: #18181b;
  border-right: 1px solid rgba(255, 255, 255, 0.04);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
}

/* Inset surface — input fields, code blocks in chat */
.surface-inset {
  background: #0a0a0c;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
}

/* Accent glow — behind focused/active elements */
.glow-accent {
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.15), 0 0 60px rgba(99, 102, 241, 0.05);
}
```

---

## Typography

```
Font Stack:         'Inter', -apple-system, 'Segoe UI', sans-serif
Mono Font:          'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace
Brand Font:         'Audiowide' (keep existing)

Title Bar Labels:   12px / 500 weight / 0.01em tracking
Panel Headers:      11px / 600 weight / 0.08em tracking / uppercase
Section Labels:     11px / 500 weight / 0.04em tracking / uppercase / text-secondary
Body Text:          13px / 400 weight / editor content, chat messages
Small Text:         11px / 400 weight / status bar, metadata
Tiny Text:          10px / 400 weight / keyboard shortcuts, badges
```

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  TITLE BAR  (32px) — transparent bg, floating search pill center   │
├──┬──────────┬───────────────────────────────────────┬──────────────┤
│  │          │                                       │              │
│A │ SIDEBAR  │          EDITOR AREA                  │   CHAT       │
│C │ (240px)  │                                       │   PANEL      │
│T │          │  ┌─────────────────────────────┐      │   (360px)    │
│  │ Sections │  │  Tab Bar (36px)             │      │              │
│B │ with     │  ├─────────────────────────────┤      │  Floating    │
│A │ rounded  │  │                             │      │  input at    │
│R │ section  │  │  Monaco Editor              │      │  bottom      │
│  │ headers  │  │                             │      │              │
│44│          │  │                             │      │              │
│px│          │  └─────────────────────────────┘      │              │
│  │          │  ┌─────────────────────────────┐      │              │
│  │          │  │  Terminal (collapsible)      │      │              │
│  │          │  └─────────────────────────────┘      │              │
├──┴──────────┴───────────────────────────────────────┴──────────────┤
│  STATUS BAR (24px) — semi-transparent, blends with bg             │
└─────────────────────────────────────────────────────────────────────┘
```

### Title Bar — 32px
- **Background**: transparent (blends with editor bg via `-webkit-app-region: drag`)
- **Left**: guIDE logo (16px, subtle glow on hover) + menu items with `text-secondary` color
- **Center**: Floating search pill — `surface-glass` background, rounded-full, 240-440px wide
  - Icon: magnifying glass at 12px, `text-tertiary`
  - Placeholder: project name in `text-tertiary`
  - Shortcut badge: `Ctrl+P` in tiny text
  - **Hover**: border brightens to `#ffffff12`, subtle glow
- **Right**: Layout toggle icons (PanelLeft, PanelBottom, PanelRight) — 24x24 touch targets
  - Active: `text-primary` + tiny accent dot below
  - Inactive: `text-tertiary`
- Far right: current filename in `text-tertiary` + brand "guIDE" in `text-tertiary` at 10px

### Activity Bar — 44px (narrower than current 48px)
- **Background**: `#0a0a0c` (darkest layer)
- **Icons**: 20px, vertically centered in 40x40 touch targets
- **Active indicator**: 2px-wide accent-colored pill on left edge (rounded, 50% height of button)
- **Active icon color**: `text-primary`
- **Inactive icon color**: `text-tertiary` → `text-secondary` on hover
- **Hover**: icon brightens + very subtle bg highlight (`#ffffff06`)
- **Divider**: thin `1px #ffffff08` line between primary and secondary icon groups
- **Bottom icons**: Settings gear + Account avatar (show actual avatar circle if signed in, otherwise `UserCircle`)
- **"More Tools" popover**: Opens to right of activity bar as a floating `surface-glass` menu

### Left Sidebar — 240px default (resizable 180-480px)
- **Background**: `#111114` (layer 1)
- **No visible border** — separation is achieved through background color difference + shadow
- **Header**: 32px, panel name in section-label style, no background — just text
  - Right side of header: action buttons (collapse, filter, etc.) appear on hover
- **Content sections**: Each section (OPEN EDITORS, FOLDERS) has:
  - Collapsible header: 28px, `text-secondary`, chevron icon
  - Section bg: transparent (inherits sidebar)
  - Items: 26px height, 10px left padding + indent levels
  - Selected item: `#6366f115` bg with `1px solid #6366f130` left border
  - Hover: `#ffffff06` bg
- **Resize handle**: 4px invisible hitzone, shows `accent` color line on hover/drag
- **Animation**: Width transition `200ms cubic-bezier(0.4, 0, 0.2, 1)` (same as current)

### Editor Area
- **Tab bar**: 36px height
  - **Active tab**: `#111114` bg (matches editor) + 2px accent top border + `text-primary`
  - **Inactive tab**: `#0a0a0c` bg + `text-tertiary` → hover `text-secondary`
  - **Modified indicator**: Tiny accent dot (not the default circle)
  - **Close button**: appears on hover, 14px X icon
  - **Tab separator**: 1px `#ffffff06` vertical line
  - **New tab button**: `+` at end, `text-tertiary`
  - **Overflow**: horizontal scroll with fade-out edges
- **Editor bg**: `#0a0a0c` — true dark for maximum contrast with code
- **Editor gutters**: Numbers in `text-tertiary`, current line number in `text-primary`
- **Minimap**: Semi-transparent, narrower (60px vs default 80px)

### Terminal / Bottom Panel
- **Resize handle**: 4px, accent on hover
- **Tab strip**: 28px — "Terminal", "Problems", "Output" tabs
  - Active: `text-primary` + 2px accent bottom border
  - Inactive: `text-tertiary`
- **Terminal bg**: `#0a0a0c` (matches editor deep dark)
- **Terminal toolbar**: right-aligned, icons for new terminal, split, kill, maximize

### Chat Panel — 360px default (resizable 280-560px)
- **Background**: `#111114` (same as sidebar for symmetry)
- **No visible border** — shadow separation only: `box-shadow: -4px 0 24px rgba(0,0,0,0.3)`
- **Header**: 40px — "AI Chat" label + model picker dropdown + collapse button
  - Model picker shows current model name as a pill with Cpu icon
- **Message area**: Virtualized list
  - **User messages**: Right-aligned, accent bg (`#6366f1` at 15% opacity), rounded-lg, max-width 85%
  - **Assistant messages**: Left-aligned, transparent bg, full width, with subtle `border-left: 2px solid #ffffff08`
  - **Code blocks**: `surface-inset` bg, syntax highlighted, copy button appears on hover
  - **Tool call indicators**: Inline pills with tool icon + name, collapsible
- **Input area**: Fixed at bottom
  - **Input field**: `surface-inset` bg, rounded-xl, 12-14px text
  - **Send button**: Accent bg circle, arrow-up icon, pulses subtly when ready
  - **Attachment buttons**: appear on hover/focus of input — file, image, context
  - **Above input**: Contextual chip showing current file name if attached

### Status Bar — 24px
- **Background**: Semi-transparent `rgba(10, 10, 12, 0.85)` with `backdrop-filter: blur(12px)`
- **Left section**: 
  - Git branch icon + name in `text-secondary`
  - Error/warning counts with colored indicators
- **Center section**: (empty — clean look)
- **Right section**:
  - GPU usage ring (14px, accent-colored)
  - Tokens/sec counter
  - Cursor position `Ln X, Col Y` in `text-tertiary`
  - Language mode
  - Encoding
- **All items**: 11px text, `text-secondary` default → `text-primary` on hover
- **Dividers**: Tiny `#ffffff08` vertical separators between items

### Command Palette
- **Overlay**: `rgba(0, 0, 0, 0.6)` backdrop
- **Dialog**: `surface-glass` with extra blur (32px), 560px wide, centered at top 20%
- **Input**: Large (38px height), 14px text, no visible border, inset bg
- **Results**: 32px per item, icon + label + description + shortcut
  - Selected: `#6366f115` bg
  - Hover: `#ffffff06` bg
- **Categories**: "Files" and "Commands" section headers in tiny uppercase

### Welcome Screen (no project open)
- **Full center area**: Dark gradient bg from center outward
- **Hero section**: guIDE logo large (48px), brand font, subtle glow animation
- **Action cards**: 3 cards in a row — "Open Folder", "New Project", "Recent"
  - `surface-elevated` bg, rounded-xl, hover: lift + glow
- **Recent projects**: List below cards, 3-5 items, click to open
- **Model section**: Show installed/recommended models with "Use" buttons
- **Bottom**: Version number, "by Brendan Gray" in `text-tertiary`

---

## Theme Variables (expanded from current 26 to 40+)

```
New variables added:
--theme-bg-deep           // Deepest background (editor, terminal)
--theme-bg-float          // Floating surfaces (popovers, dropdowns)
--theme-border-subtle     // Nearly invisible borders
--theme-border-strong     // Active/focused borders
--theme-accent-glow       // Glow color for focus states
--theme-accent-muted      // Low-opacity accent for backgrounds
--theme-accent-secondary  // Secondary accent color
--theme-surface-glass     // Glass surface base
--theme-shadow-sm         // Small shadow
--theme-shadow-md         // Medium shadow
--theme-shadow-lg         // Large shadow
--theme-shadow-glow       // Accent glow shadow
--theme-radius-sm         // 4px
--theme-radius-md         // 8px
--theme-radius-lg         // 12px
--theme-radius-xl         // 16px
--theme-radius-full       // 9999px (pills)
--theme-transition-fast   // 100ms
--theme-transition-base   // 200ms
--theme-transition-slow   // 300ms
```

---

## Micro-interactions

1. **Panel open/close**: Width animates with spring curve (`cubic-bezier(0.34, 1.56, 0.64, 1)`)
2. **Activity bar icon**: On hover, icon scales 1.05x with 100ms ease
3. **Tab close**: Tab slides out and remaining tabs slide to fill gap
4. **Toast notifications**: Slide in from bottom-right with fade, glass bg
5. **Command palette**: Fades in with 60ms scale-up from 0.97 to 1.0
6. **Theme switch**: CSS transitions on all color properties (200ms), seamless
7. **Status bar items**: Hover reveals tooltip with detailed info (e.g., GPU: NVIDIA RTX 3060, 12GB)
8. **Chat messages**: Appear with subtle fade-in + slide-up (100ms)
9. **Resize handles**: Show a 2px accent line on hover before drag starts
10. **Search results**: Each result fades in staggered (30ms delay between items)

---

## Key Differentiators from Current Design

| Current | Obsidian |
|---|---|
| `#1e1e1e` background (VS Code gray) | `#0a0a0c` true dark |
| Hard borders between panels | Shadow-based separation |
| `#007acc` blue accent | `#6366f1` indigo accent |
| 48px activity bar | 44px, more refined |
| Hardcoded hex in components | Everything flows through CSS vars |
| Flat panel surfaces | Layered depth with multiple bg levels |
| Standard dropdowns | Glass morphism popovers |
| Basic hover states | Glow + scale micro-interactions |
| Segoe UI font | Inter font (sharper on screens) |
| 10 themes | Expandable to 20+ with new variable system |

---

## Implementation Priority

1. **ThemeProvider.tsx** — Expand `Theme` interface with new variables, update all 10 themes
2. **index.css** — New design system tokens, remove hardcoded hex overrides (replace with proper var usage)
3. **Layout.tsx** — Restructure title bar, activity bar, sidebar shell, resize handles
4. **StatusBar.tsx** — Redesign with semi-transparent glass bar
5. **ChatPanel.tsx** — Redesign message bubbles, input area, header
6. **Editor.tsx / TabBar.tsx** — New tab bar design with accent top borders
7. **MenuBar.tsx** — Glass dropdown menus
8. **CommandPalette.tsx** — Glass overlay redesign
9. **WelcomeScreen.tsx** — Hero section + card layout
10. **All sidebar panels** — Consistent section headers, item heights, hover states
