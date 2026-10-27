# The general conversation

The conversation not about a posting: "General" and "Not about a posting" in the header, and Reset in place of the
posting popover. The rest is [a conversation](chat.md).

**Marker:** `role=button[name="Reset conversation"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| Reset conversation | | `role=button[name="Reset conversation"]` | Asks first, then `panel.reset { key: "general" }`: a new session | stays |
