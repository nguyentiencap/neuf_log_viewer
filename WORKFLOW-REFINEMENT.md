# Updated Workflow Summary

## What's Changed (User Request #3)

### 1. ✅ **Refined Interaction Workflow**
Updated from linear "Device → Time → Presets → Search" to interactive flow:

```
Ask User → Check Presets → Filter → Analyze → Expand (if needed)
```

### 2. ✅ **User Clarification Questions**
Now clearly documented what to ask users:
```
❓ Step 1: "Which device is affected?" 
   → For --device flag

❓ Step 2: "When did it happen?" 
   → For --time-from / --time-to

❓ Step 3: "Any error keywords?"
   → For --search (optional, can be inferred)
```

### 3. ✅ **Preset Exploration as Critical Step**
Help now emphasizes **always run presets first**:
```bash
node presets /path/to/logs
# ALWAYS do this to see available filters before searching
```

### 4. ✅ **Regex Support Highlighted**
`--search` now prominently shows regex capabilities:
```
⭐ SUPPORTS REGEX! Examples:
  --search "Exception|Error"
  --search "ERROR.*Connection"
  --search "Connection|refused|storage"
```

### 5. ✅ **Progressive Filtering Strategy**
Detailed "expand search" phase with order of precedence:
```
If no results, expand in order:
  a) Expand TIME WINDOW (±30 minutes)
  b) REMOVE COMPONENT FILTER
  c) LOOSEN PRESET (add warnings, debug)
  d) BROADEN KEYWORD (simpler regex)
  e) REMOVE DEVICE FILTER
```

### 6. ✅ **Keyword Inference Patterns**
Added table of common error patterns → search terms:
```
Java exceptions          → Exception|Throwable|Error
Network problems        → Connection|refused|Network|Socket|Timeout
Out of memory           → OutOfMemory|OOM|Heap|Memory
Auth/Permission error   → Permission|Denied|Unauthorized|Forbidden
Database error          → SQLException|Connection pool|Database
Thread/Lock issue       → Deadlock|Thread|Lock|Blocked
```

### 7. ✅ **Compact → JSON Strategy**
Introduced two-phase analysis approach:
```
Phase 1: Use --format compact  (quick pattern scanning, token efficient)
         └─ Fast visual inspection for patterns

Phase 2: Use --format json + --context N  (detailed analysis)
         └─ Structured data with surrounding context
```

---

## Files Updated/Created

### Files Changed
- **`neuf-log-viewer-cli.js`** 
  - Updated HELP_TEXT with 6 new phases
  - Emphasized regex support in --search
  - Added keyword inference patterns table
  - Showed progressive expansion strategy

### Files Created
- **`LLM-WORKFLOW.md`** (Complete workflow guide with all details)
- **`IMPROVEMENT-SUMMARY.md#3`** (This file)

---

## Key Differences from Previous Workflow

| Aspect | Old Workflow | New Workflow |
|--------|-------------|-------------|
| **Start** | Jump to filtering | **Ask user questions first** |
| **Presets** | Optional | **Always check presets command** |
| **Analysis Strategy** | N/A | **Compact first, JSON second** |
| **Keyword Search** | Single keyword | **Infer from patterns, use regex** |
| **No Results** | Unclear | **Clear expansion strategy (a→b→c→d→e)** |
| **Progressive Narrowing** | N/A | **Start broad + presets, narrow with search** |

---

## Workflow Phases (6 Total)

### Phase 1: ASK USER FOR CONTEXT
```
- Device identification
- Time window
- Optional: error keywords
```

### Phase 2: EXPLORE AVAILABLE PRESETS (Remove Noise!)
```bash
node presets /path/to/logs
# Select presets that match issue type
```

### Phase 3: RUN INITIAL FILTER (Broad + Presets)
```bash
node filter /logs \
  --device X --time-from Y --time-to Z \
  --preset "errors,warnings" \
  --format compact --page 1
```

### Phase 4: INFER KEYWORDS & SEARCH DETAILS
```
Analyze compact output → Find patterns →
  - Exception names
  - Component names
  - Error types

Then search with regex patterns
```

### Phase 5: ANALYZE LOGS (Find Root Cause)
Using JSON + context:
```
- Read exceptions
- Check timestamps
- Trace component interactions
- Analyze surrounding events
```

### Phase 6: EXPAND SEARCH (If Needed)
Progressive widening (in order):
```
a) Time window ±30 mins
b) Remove component filter
c) Loosen preset (add levels)
d) Broaden keyword regex
e) Remove device filter
```

---

## Example: Compare Old vs New

### Scenario: "App crashed around 10 AM"

#### Old Workflow
```bash
# Step 1: Direct filter
node filter /logs --device dev_x --time-from 9:45 --time-to 10:15 --format compact

# Step 2: Check presets (if remembered)
node presets /logs

# Step 3: Filter again with added filters
node filter /logs --device dev_x ... --preset errors --search "Exception"
```

#### New Workflow
```bash
# Phase 1: ASK USER
Q: Device? → "dev_x"
Q: Time? → "around 10 AM"

# Phase 2: EXPLORE PRESETS
node presets /logs
→ Available: errors, warnings, network_failures, connection_errors

# Phase 3: INITIAL FILTER (removes noise with presets)
node filter /logs \
  --device "dev_x" \
  --time-from "2026.05.08 09:45:00" --time-to "2026.05.08 10:15:00" \
  --preset "errors,network_failures" \
  --format compact --page 1

# Phase 4: INFER KEYWORDS
Looking at compact output:
  → Saw: Connection refused
  → Saw: Retry timeout
  → Can infer: search for "Connection|Timeout"

node filter /logs \
  --device "dev_x" \
  --time-from "2026.05.08 09:45:00" --time-to "2026.05.08 10:15:00" \
  --preset "errors" \
  --search "Connection|refused|Timeout" \
  --format json --context 5 --page 1

# Phase 5: ANALYZE
Found: DNS failure → Connection refused → Bootstrap failed → App crash

# Phase 6: (NOT NEEDED)
Already have sufficient data
```

**Benefits:**
- ✅ Start with user context (clearer)
- ✅ Presets reduce noise upfront (faster analysis)
- ✅ Compact format for quick scanning (token efficient)
- ✅ Regex support for flexible search (powerful)
- ✅ Clear expansion strategy if stuck (never lost)

---

## Regex Patterns for --search

Common patterns LLM should know:

| Pattern | Purpose | Example |
|---------|---------|---------|
| `Exception\|Error` | Catch exceptions or errors | Find any error-like messages |
| `ERROR.*Connection` | ERROR level + specific word | Find connection errors only |
| `Connection.*refused\|denied` | Either message | Connection problems |
| `OutOfMemory\|OOM` | Memory issues (both forms) | Memory crisis search |
| `Timeout\|Hung\|Stalled` | Performance issues | System hangs |
| `^\[FATAL\]` | Start with FATAL | Anchored patterns |
| `java:\d+` | Stack traces + line numbers | Specific error locations |
| `class.*\.java:\d+` | File and line | Exact failure point |

---

## Pro Tips for Implementation

### For LLM Agents:
```javascript
// Workflow pseudocode
1. Ask user 3 questions (device, time, keywords)
2. Run: presets /logs (explore options)
3. Run: filter --device X --time Y --preset "errors" --format compact
4. Analyze compact output for patterns
5. Infer regex keywords based on patterns
6. Run: filter --device X --time Y --preset "errors" --search REGEX --format json
7. Analyze JSON with context
8. If no results, progressively expand (time → preset → keyword → device)
```

### For Users:
- Always clarify device + time window first
- Always check presets before searching
- Use compact format first (efficient scanning)
- Use JSON format second (detailed analysis)
- Use regex for flexible keyword matching

---

## When Each Phase Applies

| Phase | When | Example |
|-------|------|---------|
| 1 | Always | User says "app crashed" |
| 2 | Always | Before filtering, explore options |
| 3 | Always | Initial broad filter with presets |
| 4 | When compact shows patterns | Recognize error keywords |
| 5 | Always | Analyze results |
| 6 | When lacking results | Found nothing, expand time |

---

## Key Takeaways

✅ **DO:**
1. Ask user first (device, time, keywords)
2. Always run presets command
3. Filter with presets to reduce noise (broad → narrow)
4. Use compact format for quick scanning
5. Use JSON format for detailed analysis
6. Use regex patterns for flexibility: `Exception|Error`, `Connection|Timeout`
7. Progressively expand if no results
8. Check surrounding context (--context 3-5)

❌ **DON'T:**
1. Search without user context
2. Skip presets command
3. Use overly specific keywords first
4. Ignore regex capabilities
5. Keep same filters if no results
6. Assume first error is root cause

---

## Next Steps

1. **View updated help:**
   ```bash
   node neuf-log-viewer-cli.js help
   ```

2. **Read detailed workflow guide:**
   ```bash
   cat LLM-WORKFLOW.md
   ```

3. **Follow 6-phase workflow** when investigating logs


