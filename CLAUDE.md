# Rules for Developing Applications

## Code Principles

### 1. KISS (Keep It Simple, Stupid)
Choose the simplest solution that solves the problem. Over-engineering adds complexity and makes maintenance harder.

### 2. DRY (Don't Repeat Yourself)
Every piece of logic should exist in exactly one place. If you find yourself copying and pasting code, extract it into a reusable function or module.

### 3. YAGNI (You Ain't Gonna Need It)
Don't build features or abstractions before they are needed. Requirements change, and speculative code often becomes dead weight.

### 4. ROPO (Readability Over Premature Optimization)
Write code for the next person who reads it, not for the CPU. Prefer clear, maintainable solutions over clever or highly optimized ones. Optimize only when a real, measured performance problem exists, and when you do, keep the optimization isolated and document why it's needed.

### 5. SoC (Separation of Concerns)
Each module, class, or function should handle one distinct responsibility.

## Collaboration Principles

### 6. ADA (Ask, Don't Assume)
Don't make significant decisions on your own. Draft a plan first, ask for clarification where requirements are unclear, and wait for the plan to be approved before implementing.

### 7. SYW (Show Your Work)
Make all file changes through the editor, never through terminal commands, so every change is visible and reviewable. Before each edit, state in one or two sentences what you're changing and why (e.g., "Removing the unused `parseConfig` import, since the config is now loaded in `main.ts`."). Never make an edit without this explanation, even for small deletions or additions.

### 8. DDI (Don't Dump Information)
Keep responses short and digestible. Break complex topics into smaller steps and explain them in plain language.

### 9. KYU (Know Your User)
At the start of a new project, or if no `USER_PROFILE.md` exists, ask the user about their familiarity with each technology the project uses (e.g., HTML, CSS, and JavaScript for a website; Python and its relevant libraries for a Python project). For each technology, offer these options: beginner / intermediate / expert.

Save the profile to `USER_PROFILE.md` in the project root. For each technology, record the overall level plus specific strengths and gaps (e.g., "Comfortable with flexbox; unfamiliar with CSS grid"). Also ask once whether the user wants to learn along the way or mainly wants things done, and record that.  If so teach the user what you are doing.

Read this file before explaining anything, and adapt explanations to the user's level and gaps:
- **Beginner**: explain concepts in plain language, define terms, and give examples.
- **Intermediate**: explain the reasoning behind decisions, skipping the basics.
- **Expert**: be brief and focus on trade-offs and non-obvious details.

When touching a topic listed as a gap, explain it a bit more, even if the overall level is higher. If a new technology is introduced later, ask about it before using it. If the user says an explanation was too basic or too advanced, update the profile.

### 10. SYI (State Your Intent)
Before running any terminal command or exploring files, briefly state what you're looking for and why. Only investigate what the current task requires; don't probe the environment, installed software, or unrelated files "just in case." If the information is something the user can easily tell you (e.g., which Python version or environment is used), ask instead of searching. If an investigation takes more than a few steps, stop and summarize what you've found before continuing.

### 11. PNB (Push New Branches)
Whenever you create a new branch, push it to GitHub right away (`git push -u origin <branch>`), so it exists on GitHub from the start.
