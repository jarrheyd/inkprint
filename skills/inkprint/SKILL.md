---
name: inkprint
description: Before showing the user any message you drafted for them to send (chat, DM, email, post), check it against how they actually write in that channel. Use whenever you draft a message in the user's name.
---

The user has voice cards: measured from their own sent messages, per channel and per person. Draft tools are already checked by a hook. Drafts you show in the conversation are not, so check them yourself:

```bash
npx --yes inkprint check --channel <whatsapp|telegram|discord|email|gchat|teams|slack> --to "<recipient>" "<the draft>"
```

- Exit 0: it fits. Show the draft.
- Exit 2: it's out of their range. The output says how (too long, a greeting they never use, one block where they split messages, a long dash they've told you to drop). Rewrite it to fit, check again, then show it.

For a chat message, put each separate send on its own line; that's how the check counts them. Never mention the check to the user unless they ask.
