# BridgeToGrowth Learning

BridgeToGrowth-Learning is a mobile app that enables users to have their questions answered across several STEM subjects through powerful animations generated using Manim.

The goal of the app is to give users a way to better understand STEM concepts by having an animation made based on the question they ask, rather than only receiving an answer in text.

## How It Works

The mobile app communicates with the backend API when a user is authenticating, as well as whenever they send a request for an animation to be made.

Once an animation is requested, the backend uses the Gemini API to generate the Manim code for the animation inside a containerized Docker environment. After the code is written and the animation has been rendered, another instance of the Gemini API performs a video analysis of the animation. If it finds anything that needs to be changed, it provides feedback to the instance responsible for generating the animation.

Photon is then used primarily as a means for the user to receive their animation.

In general, the process works as follows:

1. A user sends a question through the mobile app.
2. The mobile app sends the animation request to the FastAPI backend through a REST API.
3. The Gemini API writes Manim code and renders the animation in a Docker container.
4. Another Gemini API instance analyzes the rendered video and provides feedback if changes need to be made.
5. Photon is used to help deliver the animation to the user.

## Tech Stack

### Backend

- **FastAPI** — Backend API used by the mobile app.
- **PostgreSQL** — Database used by the backend.
- **SQLAlchemy** — Used for interacting with the database.
- **Gemini API** — Used to generate Manim code and analyze the rendered animations.
- **Manim** — Used to create the STEM animations.
- **Docker** — Provides the containerized environment where animation code is generated and rendered.
- **Photon Spectrum TypeScript SDK** — Used primarily to help users receive their generated animations.

### Mobile App

- **React Native** — Mobile app framework.
- **Expo** — Used for developing the React Native app.
- **TypeScript** — Main language used for the mobile app.
- **Expo Router** — Used for navigation and routing.
- **TanStack React Query** — Used for handling API queries and server state.
- **React Hooks** — Used to manage state and behavior in the app.
- **React Native StyleSheet** — Used for styling.
- **Expo SecureStore** — Used for securely storing data on the device.
- **REST APIs** — Used to communicate with the backend during authentication and animation requests.
- **Jest** — Used for testing.
- **ESLint** — Used for linting and maintaining code consistency.

## Overall Architecture

BridgeToGrowth-Learning is organized around a React Native mobile app and a FastAPI backend. The mobile app handles the user-facing experience, while the backend handles requests, database interactions, animation generation, and the process of analyzing the rendered videos.

A major part of the backend is the use of two Gemini API instances for different purposes: one for generating the Manim animation and another for analyzing the resulting video and providing feedback when changes are needed. This process takes place alongside the Docker-based rendering environment, with Photon being used primarily for getting the completed animation to the user.

## AI Assistance and Project Ownership

This README was generated with the assistance of **OpenAI's ChatGPT**, based on my own product pitch and high-level overview of how the application works.

**All of the code in this repository is AI-generated.** However, the ideas behind BridgeToGrowth-Learning are my own. This includes the idea for the app itself, the overall architecture, how the different technologies are used together, and the way the project is organized.

AI was used to help turn my ideas and architectural decisions into code, as well as to help write this README. The overall direction of the project, the design of its architecture, and the decisions behind how everything is structured came from me.
