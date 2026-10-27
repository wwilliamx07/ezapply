# The side panel

The extension's side panel ([ui.md](../../components/ui.md#the-side-panel-srcpanel)): it opens on the
[list of applications](list.md), and opening one shows [its conversation](application.md) (or
[the general one](general.md)). The [frame](frame.md) (header menu, banners, the agent settings) is on every screen.

| Page | The screen |
|---|---|
| [frame.md](frame.md) | On every screen: the menu, the setup and error banners, the agent settings |
| [menu.md](menu.md) | The header's menu, open |
| [list.md](list.md) | The list of applications and the general card |
| [changes.md](changes.md), [changes-list.md](changes-list.md) | The workspace changes card, and its list once open |
| [chat.md](chat.md) | Any conversation: the action buttons, the chat box, the conversation's tool lines |
| [application.md](application.md) | An application's conversation: the switch, the posting popover's button, the needs-you line |
| [general.md](general.md) | The general conversation |
| [posting.md](posting.md) | The posting popover, open |
| [requests.md](requests.md) | Tailor documents' menu, open |
| [ask.md](ask.md), [ask-reply.md](ask-reply.md) | A question card, and replying in words instead |
| [permission.md](permission.md), [permission-reason.md](permission-reason.md) | An approval card, and denying with a reason |
| [handoff.md](handoff.md) | The hand-off card |

**Scenarios** (`scripts/fuzz/lib/scenarios.ts`): `panel-empty` (no applications), `panel-quiet` (three
applications, documents, workspace changes, setup not finished, three agents installed), `panel-busy` (agents
working, a question and approvals waiting, a capture that fails), `panel-offline`, `panel-unpaired`.
