<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/fc95c22c-e308-4f2d-bbba-bf1003cde72c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file by copying the example:
   ```bash
   cp .env.example .env
   ```
3. Fill in your project credentials in the newly created `.env` file. You can find these in your Supabase project dashboard under **Project Settings > API** and **Project Settings > Database**.
4. Run the app:
   ```bash
   npm run dev
   ```
