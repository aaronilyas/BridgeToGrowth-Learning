# Mobile App

**Tech Stack:** React Native

**Purpose:**

To accept user input and enable account creation and registration, as well as accept users' requests for lessons to generate Manim videos to explain whatever the user wants, so long as it can be explained in no more than 90 seconds.

Then, to update the UI's state when it is done and the user has received a text message containing the video.

# Backend API

**Tech Stack:** Photon Spectrum SDK, FastAPI, Manim, Gemini API, PostgreSQL, SQLAlchemy, Docker, Docker Compose.

**Other Technologies Used:** Cloudflare Tunnel

**Purpose:**

To accept requests from authenticated users and to determine if the request can be completed within 90 seconds. If it cannot, it will return a message asking the user to break down their idea into smaller chunks.

Then, if it can, it will animate using Manim, and using Manim voice-over technology, it will voice over the video recording and provide audio explanations if requested by the user.

After that, it will use Photon to text the user the video.

Videos will not be stored server-side at launch.
