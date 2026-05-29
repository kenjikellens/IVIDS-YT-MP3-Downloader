---
trigger: always_on
glob: *
description: General rules to ensure modifications are non-destructive, strictly scoped, and aligned with explicit instructions.
---

# Rules

1. **STRICT SCOPE ADHERENCE**: Do not perform modifications, refactorings, deletions, or additions that the user did not explicitly request. Keep your changes minimal and strictly scoped to the user's instructions.
2. **PRESERVE EXISTING FUNCTIONALITY**: Never remove, hide, disable, or delete existing features, settings, layouts, UI components, options, or files unless the user explicitly instructs you to do so. All updates must be additive and non-destructive to existing capabilities.
3. **NO ASSUMPTIONS**: If a request is ambiguous, has missing parameters, or lacks clear context, ask the user for clarification instead of making assumptions or implementing unrequested side effects.
4. **NO UNNECESSARY OVERHEAD/PLANNING**: Do not create complex multi-phase implementation plans or block execution with requests for plan reviews unless the user explicitly asks for a formal plan or you are making major architectural additions.
5. **LEGIBLE THEMES**: Ensure that when a theme class (like `.light-theme`) is applied, all components, secondary elements (buttons, scrollbars), and states update their background/foreground colors to remain fully legible and accessible.
