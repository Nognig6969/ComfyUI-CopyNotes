# ComfyUI CopyNotes
This is giga vibe coded btw, I just want it for myself but I put it here just incase I lose the file.

A ComfyUI sidebar for organizing reusable prompt snippets into color-coded, collapsible groups. Search, pin favorites, view recent copy history, undo deletes, and export/import your snippet library as JSON with automatic backups.

## Features

- **Groups** — organize snippets into named, color-coded, collapsible, drag-to-reorder groups.
- **Search** — filter snippets by text, with matching groups auto-expanded.
- **Pinned (quick access)** — star any snippet to surface it in a collapsible "Pinned" section at the top, independent of which group it lives in.
- **History** — the last 5 unique snippets you've copied, newest first, in a collapsible section above Pinned.
- **Undo on delete** — deleting a group or a snippet shows a 5-second "Undo" toast before it's gone for good.
- **Truncate long snippets** — anything over ~200 characters or 10 lines is truncated with a "Show more" / "Show less" toggle.
- **Export / Import** — export your whole snippet library as a JSON file; importing replaces the current library, automatically backing up what was there beforehand.
- **One-click copy** — click any snippet to copy it to your clipboard.
- Data is stored locally in this node's own `data/` folder, so it survives ComfyUI restarts and has nothing to do with any particular workflow.
 <img src="Screenshot of Sidebar.jpg" width="500">
## Installation

1. Go to your ComfyUI `custom_nodes` folder:
   ```
   cd ComfyUI/custom_nodes
   ```
2. Clone this repo:
   ```
   git clone https://github.com/Nognig6969/ComfyUI-CopyNotes.git
   ```
3. Restart ComfyUI.
4. Look for the **Copy Notes** tab (clipboard icon) in the sidebar.

## Usage

- Click **+ Group** to create a new group, then **+** on a group's header to add a snippet to it.
- Click any snippet to copy it to your clipboard.
- Click the pencil icon to edit a snippet, or the ✕ icon to delete it (with a 5-second undo).
- Click the star icon to pin/unpin a snippet to the Pinned section.
- Double-click a group's name to rename it, or click its color dot to recolor it.
- Drag the grip handle (⠿) on a group or snippet to reorder it.
- Use **Export** to download a backup of your whole library, and **Import** to load one back in (this replaces your current library, after backing up the old one to `data/backups/`).

## Data storage

All snippets are stored in `data/copynotes.json` inside this node's own folder — this is per-install data, not part of any workflow file. It's excluded from version control via `.gitignore`, so it's safe to update this node without losing your snippets, and safe to fork/clone without exposing anyone else's data.

## License

MIT — see [LICENSE](LICENSE).
