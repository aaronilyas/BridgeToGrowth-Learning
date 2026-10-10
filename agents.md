# AGENTS.md

## Architectural Constraints

- Execute Gemini-generated Manim code only in isolated user containers, never in the API or host process.
- Do not introduce persistent storage for generated videos.
- Maintain isolation between user containers and their files.
- Keep Photon SDK integration within the Node.js/TypeScript service.

## Container Lifecycle

- Stop inactive user containers after 25 minutes without authenticated requests.
- Never terminate containers with active jobs.

## Development Rules

- Don't introduce unnecessary dependencies.
- Flag ambiguities rather than inventing requirements.
