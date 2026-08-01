# DailyDrink — Hydration Tracker

A simple React web version of the DailyDrink hydration tracker. It keeps the important features from the original app while using beginner-friendly code.

## Features

- Add water with quick buttons or a custom amount
- Set a daily water goal
- See today's intake log and remove an incorrect entry
- View weekly or monthly progress
- Calculate a suggested goal from body weight (`35 ml × weight in kg`)
- Save all data in the browser with `localStorage`
- Toggle dark mode and reset today's data

## Run the project

Open PowerShell in this folder and run:

```powershell
npm.cmd run dev
```

Then open the URL printed in the terminal, normally `http://localhost:5173/`.

## Project structure

```
DailyDrink/
├── src/
│   ├── App.jsx       # Components and application logic
│   ├── main.jsx      # React starting point
│   └── styles.css    # All styling
├── index.html        # HTML page used by Vite
├── package.json      # Node scripts and dependencies
└── README.md         # This guide
```

## Build for submission

```powershell
npm.cmd run build
```

The ready-to-upload website is created in the `dist` folder.
