# Login crash test

Checks the "Aw, Snap" crash that can happen right after logging in from an app link on dev
(papaya.morfius.ai). Each run uses a brand-new Chrome Incognito profile:

1. opens the app link while logged out;
2. logs in;
3. waits 20 seconds;
4. records what happened and saves a screenshot.

## Setup (once)

You need **Google Chrome** and **Node.js 18 or newer** (`node -v`). Unzip the folder, then run:

```
cd login-crash-test
npm install
```

## Run

```
node crash-test.cjs
```

It asks for your **email** and **password**. The password is hidden as you type and is never saved.

Chrome windows will open and close by themselves. **Don't use the mouse or keyboard until it finishes**
(about 30 seconds per run, so about 5 minutes for 10 runs).

On a **Mac**, the first run may ask to let your terminal record the screen; allow it (System Settings ->
Privacy & Security -> Screen Recording), then run again.

On **Linux**, run it from a desktop session (not plain SSH). It finds Google Chrome or Chromium in the usual places.
For screenshots it uses whichever of these is installed: `gnome-screenshot`, `scrot`, ImageMagick `import`,
`spectacle`, or `grim` (Wayland). If none of them works, it still saves screenshots of runs that didn't crash, but
not of crashed ones. Prefer Google Chrome over Chromium, since the crash was seen in Chrome.

### Options

| Option | Default | Example |
|---|---|---|
| `--runs` | 10 | `--runs 20` |
| `--url` | Skills demo app | `--url https://papaya.morfius.ai/app/MVS26KC65KOUS51Q/` |
| `--wait` | 20000 (ms after login) | `--wait 30000` |
| `--chrome` | first standard install path found | `--chrome "/path/to/Google Chrome"` |

## Results

Each run prints one line, and a summary is printed at the end. Everything is also saved in `runs/<date-time>/`:

- `run-01-OK.png`, `run-02-CRASH.png`, ... : a screenshot of each run
- `results.csv` : one row per run
- `summary.txt` : the totals, your machine, and the build revision tested

| Result | Meaning |
|---|---|
| **CRASH** | the "Aw, Snap" crash page appeared (the bug) |
| **STUCK** | a blank page appeared and the app never loaded (also the bug) |
| **OK** | the app loaded normally |
| **ERROR** | a problem with the test itself (for example a wrong password), not the bug |

**Send back `summary.txt` and any CRASH or STUCK screenshots.**
