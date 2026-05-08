# NEUF Log Viewer User Guide (End Users)

This document is for end users who use the `neuf-log-viewer.exe` release package.

## 1) Preparation

- Operating system: Windows (64-bit)
- A log folder to analyze (containing NEUF `.log` files)
- Release package files:
  - `neuf-log-viewer.exe`
  - `preset.json`
  - `USERGUIDE.md`

> Keep `neuf-log-viewer.exe` and `preset.json` in the same folder.

---

## 2) Run the Application

Open Command Prompt or PowerShell in the folder containing `neuf-log-viewer.exe`, then run:

```powershell
.\neuf-log-viewer.exe <path-to-log-folder>
```

Example:

```powershell
.\neuf-log-viewer.exe D:\logs\NEUF
```

When started successfully, the app launches the Web UI at:

- **http://localhost:3001**

---

## 3) Use the Web Interface

In your browser, open `http://localhost:3001` and follow these steps:

1. Select filters in the left sidebar (log level, device, component, time range, search keyword, etc.)
2. Click **Apply** to filter logs
3. Use **Presets** to quickly apply predefined filter sets
4. Use **Pagination** to move through large result sets
5. Click **Export** to download all filtered results as a `.log` file

### Quick Filtering Tips

- Start with the `errors_and_warnings` preset to reduce noise
- If you need specific issues, enter keywords in **Search**
- Increase **Context Lines** to include lines before/after each match

---

## 4) Where is the database stored?

The app automatically creates a database on first run at:

```text
<log-folder>/log-filter-db/neuf-logs.db
```

On Windows, this path is equivalent to:

```text
<log-folder>\log-filter-db\neuf-logs.db
```

If you add new logs or want a full re-index:

1. Stop the application
2. Delete the `log-filter-db` folder inside your log folder
3. Run `neuf-log-viewer.exe` again

---

## 5) Common Issues

### Cannot open `http://localhost:3001`

- Check whether the terminal window shows an error
- Make sure you provided the correct log folder path
- Restart the application

### Error: log folder path does not exist

- Verify the path passed to the run command
- If the path contains spaces, wrap it in double quotes:

```powershell
.\neuf-log-viewer.exe "D:\My Logs\NEUF"
```
