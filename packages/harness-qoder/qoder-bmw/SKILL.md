---
name: qoder-bmw
description: Operate the active BMW Project's browser pages, images, native media and Video Studio through an already connected BMW browser tool.
---

Use the connected `browser` tool and its current schema. BMW owns the active Project, pages, media, permissions and conversation scope. The Qoder Agent owns planning and its model loop.

Start with `browser` action `status` when the current page or Project is unknown. Open and inspect pages through the advertised actions. Use admitted screenshots for visual questions; a tool's text description is not evidence of unseen pixels. Keep generated/imported artifacts in the current Project and report returned artifact identities.

For Video Studio, use `video.studio` with the advertised `studioRequest`. Read the current draft and revision before an edit. Preserve the draft's owning BMW Session. If a revision conflict occurs, read the current state and reconcile the user's requested change; do not overwrite intervening edits. Script or voice changes can require new narration before export. Check the draft before rendering and report the actual returned output.

BMW permissions are handled by BMW's controls. If an action is denied, explain the required permission and wait for the user to change it. If the connection is lost or a submitted action's result is uncertain, report that state; do not repeat a mutation to guess whether it succeeded.

The Host supplies Project/Session context and an ephemeral connection. Do not choose a different Session identity, request connection tokens or substitute host shell/file operations for BMW actions. If `browser` is unavailable, ask the user to open BMW and connect the Qoder driver. Installing this guidance alone does not establish a connection or synchronize the Qoder desktop sidebar.
