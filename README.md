# LightCurve

[![Build Installers](https://github.com/nambatipudi/LightCurve/actions/workflows/build-installers.yml/badge.svg)](https://github.com/nambatipudi/LightCurve/actions/workflows/build-installers.yml)

An observatory for your message streams - built with Electron, React, and TypeScript.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

Run the app in development mode with hot-reload:

```bash
npm run dev
```

This will start the Vite dev server and launch Electron.

### Building

Build the application for production:

```bash
npm run build
```

This will:
1. Build the React renderer with Vite
2. Compile the Electron main process
3. Package the app with electron-builder

The packaged application will be in the `release` directory.

### Continuous Integration (CI)

This project builds installers via GitHub Actions on Windows, macOS, and Linux using Electron Builder.

- Workflow: `.github/workflows/build-installers.yml`
- Triggers: push, pull_request, and manual dispatch
- Artifacts: platform-specific outputs under `release/`

To download artifacts:

1. Open the latest workflow run on GitHub
2. Scroll to Artifacts
3. Download the archive for your platform

### Scripts

- `npm run dev` - Start development server and Electron
- `npm run build` - Build and package the application
- `npm run lint` - Run ESLint
- `npm run typecheck` - Check TypeScript types

## Project Structure

```
lightcurve/
├── electron/          # Electron main process files
│   ├── main.ts       # Main process entry
│   └── preload.ts    # Preload script with IPC API
├── src/              # React application
│   ├── App.tsx       # Main App component
│   ├── App.css       # App styles
│   ├── index.tsx     # React entry point
│   └── index.css     # Global styles
├── dist/             # Vite build output (renderer)
├── dist-electron/    # TypeScript build output (main)
└── release/          # Final packaged application
```

## Technology Stack

- **Electron** - Desktop application framework
- **React** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool and dev server
- **ESLint** - Code linting

## License

MIT
