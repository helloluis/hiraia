# Hiraia — UI Specification

> Last updated: 2026-05-27

## 1. Layout Overview

The app has two primary regions:

```
┌──────────────────────────────────────────────────────────┐
│                    Hiraia App                            │
├─────────────┬────────────────────────────────────────────┤
│             │                                            │
│  Sidebar    │           Main Chat Area                   │
│  (320px)    │                                            │
│             │                                            │
│  Collapsible│  ┌──────────────────────────────────────┐  │
│  on mobile  │  │                                      │  │
│             │  │         Chat Messages                 │  │
│             │  │         (lazy loaded)                 │  │
│             │  │                                      │  │
│             │  │                                      │  │
│             │  └──────────────────────────────────────┘  │
│             │  ┌──────────────────────────────────────┐  │
│             │  │  [+]  Text input area          [>]   │  │
│             │  └──────────────────────────────────────┘  │
└─────────────┴────────────────────────────────────────────┘
```

### Responsive Behavior

| Breakpoint | Sidebar | Main Area |
|---|---|---|
| **Desktop/Web** (≥768px) | Persistent left panel, 320px wide, collapsible via hamburger | Fills remaining width |
| **Mobile** (<768px) | Hidden by default, slides in from left as overlay | Full width, sidebar dims background when open |

On mobile, the sidebar opens via a hamburger menu icon in the top-left of the chat header. Tapping outside the sidebar or selecting a chat closes it.

---

## 2. Sidebar

### Structure

The sidebar is divided into three accordion sections. Only one section is expanded at a time.

```
┌─────────────────────┐
│  Hiraia        [⚙]  │  ← App logo + settings gear
├─────────────────────┤
│                     │
│  ▾ Chats            │  ← Expanded accordion section
│    ├─ Science HW    │
│    ├─ Photosynthesis│
│    └─ Volcano quiz  │
│                     │
│  ▸ Notes            │  ← Collapsed accordion section
│                     │
│  ▸ Files            │  ← Collapsed accordion section
│                     │
│                     │
├─────────────────────┤
│  [+ New Chat]       │  ← Fixed action button at bottom
└─────────────────────┘
```

### 2.1 Chats Section

- Lists all chat conversations, sorted by most recent
- Each item shows: **title** (auto-generated from first message), **preview** (last message snippet), **timestamp**
- Active chat is highlighted
- Swipe-to-delete on mobile (or right-click menu on web)
- **"+ New Chat"** button at the bottom of the sidebar starts a fresh conversation

### 2.2 Notes Section

Notes are student-created reference material. They come from two sources:

**a) Student-written notes**
- Created via a "+ New Note" button within the Notes accordion
- Simple rich-text editor (bold, italic, bullet points — no complex formatting)
- Titled by the student or auto-titled from first line

**b) Saved from Chat**
- Any AI message in the chat thread has a "Save as Note" action (bookmark icon)
- The message content is copied into a new note with a link back to the original chat
- A small badge shows "From: [Chat Title]"

**Notes list items show:**
- Title
- First line preview
- Source indicator (manual vs. from chat)
- Date created

### 2.3 Files Section

Files are anything the student has uploaded to the app:

- **Photos/Screenshots** — taken with camera or selected from gallery
- **PDFs** — textbook pages, worksheets, homework
- **Images** — diagrams, photos of experiments

**Files list items show:**
- Thumbnail/icon based on file type
- Filename
- File size
- Date uploaded
- Which chat(s) the file was used in

**File handling:**
- Files are stored locally on-device (privacy-first, consistent with QVAC philosophy)
- OCR is applied to uploaded images/PDFs using QVAC's OCR capability so the tutor can "read" them
- Files can be attached to a specific chat or exist as general uploads

---

## 3. Main Chat Area

### 3.1 Chat Header

```
┌──────────────────────────────────────────────────────────┐
│  [☰]  Photosynthesis discussion        [EN] [G7]  [⋮]   │
└──────────────────────────────────────────────────────────┘
```

- **[☰]** Hamburger menu — opens sidebar (mobile) or toggles sidebar visibility (desktop)
- **Chat title** — auto-generated, editable on tap
- **[EN]** Language selector pill — tap to switch between English / Tagalog / Cebuano
- **[G7]** Grade level badge — tap to change (mostly set during onboarding)
- **[⋮]** More options — rename, delete chat, export, settings

### 3.2 Chat Thread

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─ 🤖 Hiraia ──────────────────────────────────────┐    │
│  │  Magandang araw! I'm Hiraia, your Science tutor. │    │
│  │  What topic would you like to explore today?      │    │
│  └───────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────── Student ─┐               │
│  │  Can you explain photosynthesis?        │               │
│  └─────────────────────────────────────────┘               │
│                                                          │
│  ┌─ 🤖 Hiraia ──────────────────────────────────────┐    │
│  │  Great question! Photosynthesis is how plants     │    │
│  │  make their own food using sunlight...            │    │
│  │                                                   │    │
│  │  [📊 Visual: Photosynthesis diagram]              │    │
│  │  [generating visual...]                           │    │
│  │                                                   │    │
│  │  💾 Save as Note                                  │    │
│  └───────────────────────────────────────────────────┘    │
│                                                          │
│  [⬇ Jump to latest]  ← appears when scrolled up >1 screen│
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Message Bubbles

- **Assistant messages** — left-aligned, subtle background, Hiraia avatar
- **Student messages** — right-aligned, accent color background
- **System messages** — centered, muted (e.g., "Language changed to Tagalog")
- Each message shows timestamp on hover/tap

#### AI Message Actions

Every AI message has subtle action buttons:
- **💾 Save as Note** — copies to Notes section with back-reference
- **📋 Copy** — copies text to clipboard
- **🔄 Regenerate** — re-runs inference for that turn

#### Visual Generation

When the tutor decides a concept needs a visual:
1. A placeholder card appears inline: "🎨 Generating visual for [concept]..."
2. The visual renders into the card when ready (async)
3. The student can tap to view full-screen

#### Lazy Loading (Virtualized Scroll)

- **Initial load**: Most recent 10 exchanges (1 exchange = 1 user message + 1 assistant response)
- **Scroll up**: Loads the next 10 exchanges when the user reaches the top
- **Loading indicator**: Subtle spinner at the top while loading older messages
- **Scroll position preserved**: New messages loading above don't push the viewport down
- Implementation: virtualized list (FlatList on mobile, react-virtuoso on web)

#### Jump-to-Latest Button

- A floating **"⬇"** button appears in the bottom-right of the chat area
- **Trigger condition**: User has scrolled up more than one full viewport height from the latest message
- **Behavior**: Smooth-scrolls to the bottom, then fades out
- **New message indicator**: If new messages arrive while scrolled up, the button shows a badge count

---

## 4. Text Input Area

### Structure

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │  [+]  Ask me anything about Science...       [>] │    │
│  │                                                  │    │
│  │  ┌──────┐ ┌──────┐                              │    │
│  │  │ 📄   │ │ 📷   │   ← file thumbnails          │    │
│  │  │hw.pdf│ │photo │                              │    │
│  │  │  [×] │ │  [×] │                              │    │
│  │  └──────┘ └──────┘                              │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Behavior

| Feature | Detail |
|---|---|
| **Auto-expand** | Input grows from 1 line to max 5 lines as the user types. Scrolls internally beyond 5 lines. |
| **[+] button** | Opens file picker: camera, gallery, PDF/document picker |
| **[>] submit button** | Sends the message. Disabled (greyed out) when input is empty and no files attached. |
| **File thumbnails** | Small inline previews (~48x48px) below the text input, with × to remove each |
| **Keyboard handling** | Input area docks above the keyboard. On mobile, the entire layout adjusts to avoid keyboard overlap. |
| **Submit on Enter** | On desktop/web: Enter sends, Shift+Enter for newline. On mobile: send button only. |

### File Attachment Flow

1. User taps **[+]**
2. System picker opens (camera / gallery / files)
3. Selected files appear as thumbnails in the input area
4. Files are OCR'd in the background (if image/PDF) so the tutor can reference their content
5. On submit, files are sent alongside the text message
6. Files are also indexed in the sidebar's Files section

---

## 5. Visual Design System

### Color Palette

| Token | Light Mode | Dark Mode | Usage |
|---|---|---|---|
| `--bg-primary` | `#FFFFFF` | `#0F0F0F` | Main background |
| `--bg-secondary` | `#F7F7F8` | `#1A1A1B` | Sidebar, card backgrounds |
| `--bg-tertiary` | `#ECECEC` | `#2A2A2B` | Input area, hover states |
| `--text-primary` | `#1A1A1A` | `#ECECEC` | Main text |
| `--text-secondary` | `#6B6B6B` | `#9B9B9B` | Timestamps, muted text |
| `--accent` | `#2563EB` | `#3B82F6` | Student bubbles, buttons, links |
| `--accent-soft` | `#DBEAFE` | `#1E3A5F` | Active states, selection |
| `--success` | `#16A34A` | `#22C55E` | Confirmations |
| `--error` | `#DC2626` | `#EF4444` | Error states |
| `--hiraia-gradient` | `linear(135deg, #6366F1, #8B5CF6)` | same | Hiraia branding, avatar |

### Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| Chat text | Inter / system | 15px (mobile), 16px (web) | 400 |
| Chat text (bold) | Inter / system | 15px | 600 |
| Sidebar title | Inter / system | 14px | 600 |
| Sidebar preview | Inter / system | 13px | 400 |
| Input placeholder | Inter / system | 15px | 400 |
| Code/technical terms | JetBrains Mono | 14px | 400 |

### Component Tokens

| Component | Border Radius | Shadow |
|---|---|---|
| Message bubble (student) | 18px (top-left, top-right, bottom-left) | none |
| Message bubble (assistant) | 18px (top-right, top-left, bottom-right) | subtle |
| Input area | 24px | elevated |
| Sidebar | 0 (edge-to-edge) | right shadow when overlaid |
| File thumbnail | 8px | none |
| Buttons | 12px | none |

---

## 6. Onboarding Flow

First launch experience before the user sees the chat interface:

```
┌──────────────────────────────────┐
│                                  │
│         ✦ Hiraia ✦              │
│                                  │
│   Your AI Science tutor that     │
│   works even without internet.   │
│                                  │
│        [Get Started]             │
│                                  │
└──────────────────────────────────┘
         ↓
┌──────────────────────────────────┐
│                                  │
│   What's your name?              │
│                                  │
│   [_________________________]    │
│                                  │
│   What grade are you in?         │
│                                  │
│   [3] [4] [5] [6]               │
│   [7] [8] [9] [10]              │
│                                  │
│        [Continue]                │
│                                  │
└──────────────────────────────────┘
         ↓
┌──────────────────────────────────┐
│                                  │
│   Which language do you prefer?  │
│                                  │
│   ┌────────────────────────┐     │
│   │  English               │     │
│   └────────────────────────┘     │
│   ┌────────────────────────┐     │
│   │  Tagalog / Filipino     │     │
│   └────────────────────────┘     │
│   ┌────────────────────────┐     │
│   │  Cebuano Bisaya        │     │
│   └────────────────────────┘     │
│                                  │
│   You can change this anytime    │
│   in the chat header.            │
│                                  │
└──────────────────────────────────┘
         ↓
┌──────────────────────────────────┐
│                                  │
│   📥 Downloading your tutor...   │
│                                  │
│   ████████████░░░░ 72%           │
│   AI model (1.5 GB)              │
│                                  │
│   ████████████████ 100% ✓        │
│   Science curriculum             │
│                                  │
│   This only happens once.        │
│   After this, Hiraia works       │
│   fully offline!                 │
│                                  │
│   [Start Learning] (when ready)  │
│                                  │
└──────────────────────────────────┘
```

---

## 7. State Management

### Persistent State (AsyncStorage / localStorage)

| Key | Type | Description |
|---|---|---|
| `user.profile` | `{ name, gradeLevel, language }` | Student profile from onboarding |
| `chats.list` | `ChatSummary[]` | List of all chat conversations |
| `chats.active` | `string \| null` | ID of currently active chat |
| `notes.list` | `Note[]` | All saved notes |
| `files.list` | `FileEntry[]` | All uploaded files metadata |
| `settings.theme` | `'light' \| 'dark' \| 'system'` | Theme preference |
| `models.downloaded` | `string[]` | List of downloaded model IDs |

### Runtime State (Zustand store)

| Slice | Contents |
|---|---|
| `chat` | Current conversation messages, streaming state, loading state |
| `sidebar` | Open/closed, active accordion section |
| `engine` | QVAC engine instance, model loaded state, ready status |
| `ui` | Theme, keyboard visible, scroll position |

---

## 8. Component Tree

```
<App>
  <OnboardingFlow />            ← shown only on first launch
  
  <MainLayout>
    <Sidebar>
      <SidebarHeader />         ← logo + settings
      <Accordion>
        <ChatsList />           ← chat history items
        <NotesList />           ← saved notes
        <FilesList />           ← uploaded files
      </Accordion>
      <NewChatButton />         ← fixed at bottom
    </Sidebar>
    
    <ChatArea>
      <ChatHeader />            ← title, language/grade pills, menu
      <ChatThread>              ← virtualized scroll
        <MessageList>
          <MessageBubble />     ← assistant message
          <MessageBubble />     ← student message
          <VisualCard />        ← inline generated image
          <SystemMessage />     ← language change, etc.
        </MessageList>
        <JumpToLatestButton />  ← floating, conditional
      </ChatThread>
      <TextInput>
        <AttachButton />        ← [+] file picker
        <ExpandableTextarea />  ← 1-5 lines auto-expand
        <SubmitButton />        ← [>] send
        <FileThumbnails />      ← attached file previews
      </TextInput>
    </ChatArea>
  </MainLayout>
</App>
```

---

## 9. Interaction Patterns

### Language Switching Mid-Conversation

1. Student taps the language pill in the chat header
2. A popover shows the three language options
3. On selection, the system:
   - Unloads current LoRA adapter (if any)
   - Loads the new language adapter
   - Inserts a system message: "Language changed to [language]"
   - All subsequent responses use the new language
   - Previous messages remain in their original language

### Saving a Message as Note

1. Student taps the 💾 icon on an AI message
2. A small modal appears: "Save as note" with editable title
3. On confirm:
   - Note is created in the Notes section
   - The message bubble shows a small 💾 indicator
   - Toast: "Saved to Notes"

### File Upload → OCR → Chat

1. Student uploads a photo of a textbook page
2. Background: QVAC OCR extracts text from the image
3. The extracted text is included as context in the next chat message
4. Student can ask: "Can you explain what's in this photo?"
5. The tutor references the OCR'd content in its response

---

## 10. Accessibility

| Requirement | Implementation |
|---|---|
| Minimum touch target | 44x44px on mobile |
| Color contrast | WCAG AA (4.5:1 for text, 3:1 for UI) |
| Screen reader | All interactive elements have `accessibilityLabel` / `aria-label` |
| Font scaling | Respect system font size settings |
| Keyboard navigation | Full tab-order support on web |
| Reduced motion | Respect `prefers-reduced-motion` for animations |

---

## 11. Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-05-27 | Initial UI specification | Project kickoff |
