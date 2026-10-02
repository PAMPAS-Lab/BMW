# DSH Sidebar coverage in BMW

BMW keeps DeepSeek Harness upgradeable and treats its Sidebar as an optional compatibility surface. The product-owned entry points below replace every default Sidebar responsibility originally audited against DSH `0.1.0-rc.6`. The current transport baseline is `0.2.0-rc.2`; session operations and WVL registration are covered by `npm run test:dsh-e2e`, while full Sidebar UI parity still requires manual verification.

| DSH Sidebar responsibility | BMW owner |
| --- | --- |
| Add, select, rename and remove a Workspace | Project switcher and Project Manager create, switch, rename and archive Projects. BMW intentionally creates product-owned directories instead of adopting arbitrary folders. |
| Workspace path and creation metadata | Project Manager and the Project's on-disk directory. |
| New and current Session | Session Center; the current selection is persisted per Project. |
| Session list and activity | Session Center shows Project membership, current/new/running/idle state and update time. |
| Search Session titles and content | Session Center search combines DSH metadata with `session.search`. |
| Rename, Fork and Archive | Per-row Session Center actions. Archive keeps the DSH log and selects or creates a safe replacement. |
| Session order | Session Center up/down actions persist through `workspace.insertSessionBefore`. |
| Settings | BMW Global Settings owns theme and product policy. Its DSH Runtime section opens the embedded, upstream DSH settings for model providers, input behavior, permission presets and plugin inventory. |
| New upstream Sidebar feature | The “Show legacy DSH Sidebar” global fallback restores the unmodified upstream surface. |

The default is `dshSidebarVisible: false`. BMW removes the DSH navigation column rather than leaving its 56 px collapsed rail, so the conversation receives the full Agent view width. The fallback is durable and can be toggled without restarting BMW.
