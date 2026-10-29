# Board cards – states and transitions

What a board card can be and which button turns it into what. The rendered picture is [board-states.svg](board-states.svg); this file is its source.

Button names are the English UI texts. "Erase text" means opening the note text ("Edit note" in the ⋮ menu, or a double click), clearing it and pressing Enter or clicking outside.

```mermaid
stateDiagram-v2
  direction LR

  state "Inbox notification" as Inbox
  state "Note" as Txt
  state "Note without text<br/>(links only)" as Bare
  state "Jira card" as Jira
  state "PR card" as PR

  [*] --> Txt : "+ Note" → Add (any other text)
  [*] --> Jira : "+ Note" → Add (a task key or link)<br/>"+ Jira Ticket" → pick a task
  [*] --> PR : "+ Note" → Add (a PR link)

  Inbox --> Jira : drag a Jira notification to a column
  Inbox --> PR : drag a PR notification to a column
  Inbox --> Txt : drag any other notification<br/>(its page is linked)

  Jira --> Txt : "Add description" → text → Enter<br/>(the task becomes the first link)

  Txt --> Jira : "Edit note" → text replaced with a task key or link
  Txt --> PR : "Edit note" → text replaced with a PR link
  Txt --> Jira : erase text – the first linked task or PR is a task
  Txt --> PR : erase text – the first linked task or PR is a PR
  Txt --> Bare : erase text – only pages linked,<br/>or that task or PR is already a card
  Txt --> [*] : erase text – nothing linked

  Bare --> Txt : "Edit note" → type text
  Bare --> [*] : × on the last link

```

## Rules behind the arrows

- ⋮ → "Remove from the board" removes a card in any state; it is left out of the picture to keep it readable.
- Every card – a note, a Jira card or a PR card – has one list of links: Jira tasks and pages (a linked PR is a page), in the order they were linked. "Add link" in the ⋮ menu adds to it, × on a link removes from it.
- A conversion keeps the card's links and deadline. The new card never links itself: a Jira card drops the link to its own task, a PR card – to its own pull request.
- A task or PR that is already a card on the board is never made into a second card. "+ Note" and Inbox show (flash) the existing card instead; a conversion just doesn't happen.
- "Add description" then Esc, or an empty description, leaves the Jira card as it was.
- A note lives while it has text or links. The deadline doesn't keep an empty note.
- No arrow changes the column: cards are dragged between columns in any state.
