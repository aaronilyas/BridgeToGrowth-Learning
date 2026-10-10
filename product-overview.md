# Mobile App

**Tech Stack:** React Native

**Purpose:**

To accept user input and enable account creation and registration, as well as accept users' requests for lessons to generate Manim videos to explain whatever the user wants, so long as it can be explained in no more than 90 seconds.

Then, to update the UI's state when it is done and the user has received a text message containing the video.

# Backend API

**Tech Stack:** Python, FastAPI, TypeScript, Node.js, Photon Spectrum SDK, Gemini API, Manim, Manim Voiceover, PostgreSQL, SQLAlchemy, Docker, Docker Compose.

**Other Technologies Used:** Cloudflare Tunnel

**Purpose:**

To accept requests from authenticated users and determine whether their requested lesson can be explained in a video of no more than 90 seconds. If it cannot, the API will ask the user to break their idea into smaller topics.

Each registered user has a dedicated Docker container that starts when needed and shuts down after 25 minutes of inactivity, provided no generation task is running.

Gemini generates Manim animation code inside an isolated environment. Manim renders the video, with optional audio explanations generated using Manim Voiceover.

A separate Gemini instance evaluates the rendered video for accuracy relative to the user's original intent, visual defects, and inconsistencies.

The backend then uses Photon Spectrum SDK to send the video directly to the user via text message. Node.js and TypeScript support the Photon integration, while Python and FastAPI handle the core backend.

The API communicates the job's status to the React Native application, including when Photon accepts the video message.

Generated videos are stored only temporarily for processing and delivery, not retained as persistent server-side files at launch.
