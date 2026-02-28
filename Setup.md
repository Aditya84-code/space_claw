# 🚀 Space Claw: The Ultimate Setup Guide

Welcome to Space Claw! This guide will walk you through setting up your own personal AI agent. Whether you are an experienced software developer or a non-tech beginner, this guide is designed to be extremely easy to follow step-by-step. Let's get started!

---

# 🟢 Phase 1: Basic Setup

## 📋 Prerequisites
Before we begin, you will need a few free accounts and tools installed.

**For Everyone:**
- A **Telegram** Account (to chat with your bot on your phone or computer).
- A free **OpenAI** or **Google (Gemini)** account to give your bot a "brain".

**For Windows/Mac Setup (Tech & Non-Tech):**
- **[Node.js](https://nodejs.org/)**: This is the engine that runs the bot on your computer. Download the "LTS" (Long Term Support) version and install it like any regular software. Just click next through the installer.
- **[VS Code](https://code.visualstudio.com/)**: A super-powered notepad for coding. Download and install it.

---

## 🛠️ Step 1: Open the Project
1. Open your code editor (**VS Code**).
2. Go to `File > Open Folder...` and select your downloaded `space-claw` folder.
3. Once the folder is opened, look at the top menu strip of VS Code and click `Terminal > New Terminal`. 
4. You should see a command box at the bottom of your screen. This is where we will type commands to your computer.

## 📦 Step 2: Install the Tools
In that bottom Terminal window, type the following command and press **Enter**:
```bash
npm install
```
*Tip: This downloads all the necessary background files your bot needs to run. It might take a minute, so sit tight!*

---

## 🔑 Step 3: Getting Your Keys (The .env file)
Your bot needs a few custom "passwords" and "keys" to connect to Telegram and the AI securely. 

1. In the file explorer on the left side of VS Code, look for a file named `.env`. (If there is only `.env.example`, make a copy of it and rename the copy to exactly `.env`).
2. Open the `.env` file. You will see several variables you need to fill in. 

Here is how to get the most important ones:

### 📱 1. `TELEGRAM_BOT_TOKEN` (To connect to Telegram)
- Open Telegram and search for exactly **@BotFather** (it has a blue verified checkmark).
- Click **Start** or send `/start`.
- Send `/newbot` to create a new bot.
- Give it a name (e.g., "My Space Claw") and a username that ends in `bot` (e.g., `mystuff_bot`).
- BotFather will reply with a long token that looks like `123456789:AAEln...`
- Copy that fully and paste it into your `.env` like this:
  `TELEGRAM_BOT_TOKEN=your_copied_token_here`

### 🕵️ 2. `ALLOWED_USER_ID` (To keep strangers out)
- We only want YOU to talk to your bot! We need your personal Telegram ID number.
- In Telegram, search for exactly **@userinfobot**.
- Send `/start`.
- It will reply with your `Id` (a number like `814712304`).
- Copy that number and paste it into your `.env`:
  `ALLOWED_USER_ID=your_copied_id_number_here`

### 🧠 3. `OPENAI_API_KEY` (The AI Brain)
- Go to [OpenAI API Keys](https://platform.openai.com/api-keys) and sign in or create an account.
- Click **Create new secret key**.
- Copy the key (it usually starts with `sk-proj...`) and paste it:
  `OPENAI_API_KEY=your_copied_key_here`

*(Optional) If you prefer Google Gemini over OpenAI:*
- Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and generate a key.
- Put it in the `GOOGLE_API_KEY=your_key` line inside the `.env`.

---

## 🟢 Step 4: Start the Bot!
Everything is ready. Go back to your Terminal at the bottom of VS Code and type:
```bash
npm run dev
```

If the console shows logs without any red errors saying it started — you did it! 🎉

## 💬 Step 5: Say Hello
1. Open the Telegram app on your phone or computer.
2. Search for the bot username you created in Step 3 (e.g., `@mystuff_bot`).
3. Send `/start`.
4. Say "Hello Space Claw!"

**Enjoy your fully understood, personal, persistent AI companion!**

---

# 🔴 Phase 2: Advanced Level (Superpowers)

Once your bot is running from Phase 1, you can unlock Space Claw's true potential. You don't need to do these all at once — pick what sounds exciting to you!

## 💾 1. Supabase Long-Term Memory
Space Claw can remember things forever by using an advanced vector database:
1. Go to [Supabase.com](https://supabase.com) and create a free project.
2. In your Supabase settings, find your **Project URL** and **Service Role Key** under `API`.
3. Paste them into your `.env` file:
   ```env
   SUPABASE_URL=your_project_url_here
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   SEMANTIC_MEMORY_ENABLED=true
   ```

## ⚡ 2. Zapier Automations (MCP)
Let Space Claw control thousands of apps like Gmail, Slack, and Google Calendar!
1. Get an API key for the Zapier MCP Server.
2. Open your `.env` file and paste the key into the Zapier line:
   ```env
   ZAPIER_MCP_API_KEY=your_zapier_key_here
   ```
3. Restart your bot, and it will now have the power to execute Zapier actions!

## 🧠 3. The `soul.md` File (Bot Personality)
You can fundamentally change who your bot is, how it speaks, and what it cares about.
1. Find the `soul.md` file in the left sidebar of VS Code.
2. Open it and change the text! You can write commands on how it should behave.
3. *Tip: You can even chat with the bot on Telegram and simply ask it to "update your soul to be more sarcastic" and it will overwrite this file on its own!*

## �️ 4. The Skills System (`/skills` folder)
Want your bot to know exactly how to do a complicated task (like coding a website, or formatting a specialized report)?
1. Look at the `skills/` folder in your project.
2. Inside, you can create new `.md` files that act as customized "instruction manuals".
3. Provide a `# Description` and step-by-step rules. Space Claw will automatically read these to learn new skills!

## 🔍 5. Other Cool Integrations
- **Web Search (`TAVILY_API_KEY`)**: Get a free key at [app.tavily.com](https://app.tavily.com/) so your bot can browse the live internet.
- **Text-to-Speech (`ELEVENLABS_API_KEY`)**: Use [ElevenLabs](https://elevenlabs.io/) to let your bot reply with natural voice messages (`TTS_ENABLED=true`).
