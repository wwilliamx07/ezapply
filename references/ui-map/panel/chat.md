# A conversation

What every conversation shows, an application's or the general one: the back arrow, the conversation (messages,
the agent's text, each tool call on a line, turn ends with their cost), a line naming another application that
needs the user, what the current tab is, the action buttons, the line saying what the agent is doing, and the chat
box. In the general conversation the action buttons are there but disabled (there's no posting).

**Marker:** `role=textbox[name="Message"]`

| Control | When | Selector | Does | Leads to |
|---|---|---|---|---|
| All applications | | `role=button[name="All applications"]` | Back to the list | [List](list.md) |
| Tailor documents | | `role=button[name="Tailor documents"]` | `panel.workspaceChanges` for the Documents conversation; with a needed change pending, opens the changes card with Go on; else `panel.send` of `/ezapply-resume …` there | stays |
| More document requests | | `css=summary[aria-label="More document requests"]` | Opens the menu of requests | [Document requests](requests.md) |
| Fill form | the tab is the application, or the posting knows no address | `role=button[name="Fill form"]` | As Tailor documents, to the Application conversation: `/ezapply-apply … (tabId N)` | stays |
| Open the application | the tab isn't the application, and the posting knows its address | `role=button[name="Open the application"]` | `openTab` with the application's address | stays |
| Message | | `role=textbox[name="Message"]` | What to send; Enter sends | stays |
| Send | the agent isn't working here, or the box has text | `role=button[name="Send"]` | `panel.send { key, text }` (disabled until there's text) | stays |
| The needs-you line | another application, or the general conversation, waits on the user | `css=.ez-panel-elsewhere` | Opens that one, or the list when more than one waits | [Application](application.md), [General](general.md), [List](list.md) |
| Stop | an agent works in this conversation and the box is empty | `role=button[name=/^Stop$/]` | `panel.stop { key }` | stays |
| A tool call | the conversation has one | `css=.ez-tool > summary` | Unfolds its summary or error | stays |
