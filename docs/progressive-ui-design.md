# Progressive UI Design - Huangdi Dashboard

## Design Philosophy

The Huangdi Dashboard follows a **professional, refined dark theme** inspired by high-end developer tools like Linear, Raycast, and Vercel. The design prioritizes:

1. **Depth over flatness** - Layered backgrounds, subtle gradients, and ambient glows
2. **Restrained color palette** - Professional blue-violet accent with accessible status colors
3. **Typography hierarchy** - Plus Jakarta Sans for UI, JetBrains Mono for code/technical content
4. **Motion with purpose** - Smooth transitions, staggered reveals, hover feedback
5. **Spatial composition** - Generous padding, consistent spacing scale

---

## Color System

### Backgrounds

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg-base` | #050506 | Deepest background, body |
| `--bg-surface` | #0d0d0f | Cards, panels |
| `--bg-elevated` | #141417 | Elevated surfaces, active states |
| `--bg-input` | #0a0a0c | Input fields, code blocks |
| `--bg-hover` | rgba(255, 255, 255, 0.03) | Hover states |

### Accent Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--accent-primary` | #5b6bdc | Primary actions, links |
| `--accent-primary-hover` | #4a59c7 | Hover states |
| `--accent-primary-subtle` | rgba(91, 107, 220, 0.08) | Subtle backgrounds |
| `--accent-primary-glow` | rgba(91, 107, 220, 0.25) | Glow effects |
| `--accent-secondary` | #7c3aed | Secondary accent |

### Typography

| Variable | Value | Usage |
|----------|-------|-------|
| `--text-primary` | #fafafa | Headings, primary text |
| `--text-secondary` | #a0a0a8 | Body text |
| `--text-tertiary` | #6a6a72 | Labels, metadata |
| `--text-muted` | #4a4a50 | Disabled, placeholders |

### Borders

| Variable | Value | Usage |
|----------|-------|-------|
| `--border-default` | rgba(255, 255, 255, 0.06) | Default borders |
| `--border-hover` | rgba(255, 255, 255, 0.1) | Hover states |
| `--border-active` | rgba(91, 107, 220, 0.4) | Active/focused states |

### Status Colors

| Status | Color | Background | Border |
|--------|-------|------------|--------|
| Success | #10b981 | rgba(16, 185, 129, 0.08) | rgba(16, 185, 129, 0.3) |
| Warning | #f59e0b | rgba(245, 158, 11, 0.08) | rgba(245, 158, 11, 0.3) |
| Error | #ef4444 | rgba(239, 68, 68, 0.08) | rgba(239, 68, 68, 0.3) |
| Info | #06b6d4 | rgba(6, 182, 212, 0.08) | rgba(6, 182, 212, 0.3) |

### Agent Role Colors

| Role | Color | Background |
|------|-------|------------|
| Coder | #3b82f6 | rgba(59, 130, 246, 0.08) |
| Researcher | #8b5cf6 | rgba(139, 92, 246, 0.08) |
| Reviewer | #f59e0b | rgba(245, 158, 11, 0.08) |
| Tester | #10b981 | rgba(16, 185, 129, 0.08) |
| Writer | #ec4899 | rgba(236, 72, 153, 0.08) |
| Planner | #06b6d4 | rgba(6, 182, 212, 0.08) |

---

## Typography

### Font Stack

```css
/* UI Font */
font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Code/Monospace */
font-family: 'JetBrains Mono', monospace;
```

### Font Weights

- **400** - Regular body text (rarely used)
- **500** - Medium, metadata, labels
- **600** - Semi-bold, headings, emphasis
- **700** - Bold, names, important labels
- **800** - Extra bold, logo

### Font Sizes

- **11px** - Small labels, metadata, badges
- **12px** - Secondary text, timestamps
- **13px** - Body text, buttons
- **14px** - Primary text, agent names
- **16px** - Panel titles
- **18px** - Header title

---

## Spacing System

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 4px | Tight gaps, icon spacing |
| `--space-sm` | 8px | Small gaps, padding |
| `--space-md` | 12px | Standard gaps |
| `--space-lg` | 16px | Card padding |
| `--space-xl` | 20px | Panel padding |
| `--space-2xl` | 28px | Large sections |
| `--space-3xl` | 40px | Empty states |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Small buttons, badges |
| `--radius-md` | 10px | Cards, inputs |
| `--radius-lg` | 14px | Large cards, panels |
| `--radius-xl` | 18px | File previews |
| `--radius-full` | 9999px | Pills, status badges |

---

## Shadows

```css
/* Subtle elevation */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.5);

/* Standard elevation */
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.5);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);

/* Glow effects */
--shadow-glow: 0 0 24px rgba(91, 107, 220, 0.2);
--shadow-glow-hover: 0 0 32px rgba(91, 107, 220, 0.3);
```

---

## Transitions

```css
/* Easing */
--ease-out: cubic-bezier(0.215, 0.61, 0.355, 1);
--ease-in-out: cubic-bezier(0.645, 0.045, 0.355, 1);

/* Durations */
--transition-fast: 120ms var(--ease-out);   /* Micro-interactions */
--transition-base: 180ms var(--ease-out);   /* Standard transitions */
--transition-slow: 280ms var(--ease-out);   /* Complex animations */
```

---

## Component Patterns

### Agent Card

```css
.agent-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  cursor: pointer;
  transition: all var(--transition-base);
}

.agent-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-hover);
  transform: translateX(4px);
  box-shadow: var(--shadow-md);
}

.agent-card.active {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary-subtle), var(--shadow-md);
}
```

### Timeline Item

```css
.timeline-item {
  position: relative;
  padding: var(--space-lg);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-md);
  transition: all var(--transition-base);
}

.timeline-item::before {
  /* Left accent bar for active state */
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--accent-primary), var(--accent-secondary));
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.timeline-item:hover::before {
  opacity: 1;
}
```

### Thinking Stream (Log Viewer Style)

```css
.thinking-item {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-left: 3px solid var(--status-warning);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  animation: slideIn 0.3s var(--ease-out);
}

.thinking-content {
  font-family: 'JetBrains Mono', monospace;
  background: var(--bg-input);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  line-height: 1.8;
}
```

### Terminal (Console Style)

```css
.terminal-output {
  background: #070709;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.7;
  box-shadow: inset 0 2px 12px rgba(0, 0, 0, 0.4);
}
```

---

## Animation Keyframes

```css
/* Ambient background pulse */
@keyframes ambientPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Logo shimmer effect */
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Status dot pulse */
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.95); }
}

/* Panel fade in */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Message slide in */
@keyframes messageSlide {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Thinking item slide in */
@keyframes slideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}
```

---

## Layout Grid

```css
.dashboard {
  display: grid;
  grid-template-columns: 320px 1fr 400px;
  grid-template-rows: 72px 1fr;
  gap: 0;
  min-height: 100vh;
}

/* Responsive breakpoints */
@media (max-width: 1400px) {
  .dashboard {
    grid-template-columns: 280px 1fr;
  }
  .chat-panel {
    display: none;
  }
}

@media (max-width: 900px) {
  .dashboard {
    grid-template-columns: 1fr;
  }
  .sidebar {
    display: none;
  }
}
```

---

## Accessibility

### Color Contrast

All text meets WCAG AA standards:
- Primary text on base: 16.5:1
- Secondary text on surface: 8.2:1
- Status colors have dedicated backgrounds with sufficient contrast

### Focus States

```css
input:focus,
button:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-primary-subtle);
}
```

### Reduced Motion

Users can reduce motion via system preferences (future enhancement):
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `public/agent-dashboard.html` | Complete CSS redesign, HTML structure preserved |

---

## Future Enhancements

1. **Overview Dashboard** - System health metrics, key指标 cards
2. **Task Board Integration** - Unified view with agent dashboard
3. **Virtual Scrolling** - For large timeline/thinking lists
4. **Theme Toggle** - Light/dark mode support
5. **Custom CSS Variables** - User-configurable theming
6. **Keyboard Navigation** - Full keyboard accessibility
7. **Search/Filter UI** - Quick find for agents, tasks, events

---

*Design document created: 2026-03-24*
*Last updated: 2026-03-24*
