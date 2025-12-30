# TradingApp macOS Application Bundle

## 📱 What is this?

`TradingApp.app` is a macOS application bundle that allows you to launch your Trading App with a simple double-click, just like any other Mac application.

## 🚀 How to Use

### First Time Setup

1. **Run the build script** (if you haven't already):
   ```bash
   ./create_mac_app.sh
   ```

2. **Make sure your project is set up**:
   - Run `./SETUP.sh` to install dependencies
   - Configure your `.env` file with API keys

### Launching the App

**Option 1: Double-click**
- Simply double-click `TradingApp.app` in Finder
- The app will start both backend and frontend servers
- Your browser will automatically open to `http://localhost:5173`

**Option 2: From Terminal**
```bash
open TradingApp.app
```

**Option 3: Add to Applications**
- Drag `TradingApp.app` to your `/Applications` folder
- Launch it from Launchpad or Applications folder
- Note: The app needs to find your project directory (see "Project Location" below)

## 📍 Project Location

The app needs to find your TradingApp project directory. It will look in this order:

1. **Same directory as the app** (recommended)
   - If `TradingApp.app` is in `/Users/you/Documents/MyProjects/TradingApp/`
   - It will automatically find the project files

2. **Common project locations**
   - `~/Documents/MyProjects/TradingApp`
   - `~/Projects/TradingApp`
   - `~/Development/TradingApp`

3. **First-time setup**
   - If the app can't find your project, it will ask you to select the folder
   - It will remember this location for future launches

## 🛑 Stopping the App

- **From Terminal**: Press `Ctrl+C` in the terminal window
- **From Activity Monitor**: Quit the `TradingApp` process
- **Automatically**: Close the terminal window (processes will be cleaned up)

## 🔧 Troubleshooting

### "Python 3 is required but not found"
- Install Python 3: `brew install python3` or download from python.org

### "Node.js is required but not found"
- Install Node.js: `brew install node` or download from nodejs.org

### "Virtual environment not found"
- Run `./SETUP.sh` in your project directory to set up dependencies

### "Backend failed to start"
- Check `/tmp/trading_app_backend.log` for error details
- Make sure port 8000 is not already in use
- Verify your `.env` file is configured correctly

### "Frontend failed to start"
- Check `/tmp/trading_app_frontend.log` for error details
- Make sure port 5173 is not already in use
- Run `npm install` in the frontend directory

### App can't find project directory
- Place `TradingApp.app` in the same folder as your project
- Or select the project directory when prompted (it will remember)

## 📝 Logs

Logs are stored in:
- Backend: `/tmp/trading_app_backend.log`
- Frontend: `/tmp/trading_app_frontend.log`

View logs in real-time:
```bash
tail -f /tmp/trading_app_backend.log
tail -f /tmp/trading_app_frontend.log
```

## 🎨 Customizing the Icon

To add a custom icon:

1. Create or find an `.icns` file (macOS icon format)
2. Replace `TradingApp.app/Contents/Resources/AppIcon.icns`
3. Or use an online converter to convert PNG to ICNS

## 🔄 Rebuilding the App

If you modify the launcher script or want to rebuild:

```bash
./create_mac_app.sh
```

This will recreate the app bundle with any updates.

## 💡 Tips

- Keep `TradingApp.app` in your project directory for easiest setup
- The app automatically opens your browser when ready
- You'll get a macOS notification when the app starts
- All processes are automatically cleaned up when you quit

## 📦 What's Inside?

The app bundle contains:
- `Contents/MacOS/TradingApp` - The launcher script
- `Contents/Info.plist` - macOS app metadata
- `Contents/Resources/` - Icons and resources (optional)

The app bundle is just a wrapper - your actual project files stay in your project directory.

